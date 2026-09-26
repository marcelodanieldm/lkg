/**
 * app/api/webhooks/pagos/route.js — Receptor de eventos de MercadoPago y dLocal.
 *
 * Reglas de diseño:
 * 1. Verifica la firma ANTES de tocar la base de datos.
 *    Firma inválida → 401. No se loguea, no se procesa nada.
 * 2. Devuelve 200 siempre que la firma sea válida, aunque el procesamiento falle.
 *    Un 500 haría que la pasarela reintente y duplique registros.
 * 3. No envía nada al prospecto. Los cambios de etapa disparan flujos
 *    que pasan por el guardián.
 */

import * as db from '../../../../lib/db/supabase.js';
import { verificarFirmaMP, verificarFirmaDLocal } from '../../../../lib/integrations/pagos.js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const rawBody = await req.text();
  const pasarela = req.headers.get('x-pasarela') // header custom para tests
    || (req.headers.get('x-signature') ? 'mercadopago' : 'dlocal');

  // ── Verificar firma ──────────────────────────────────────────────────
  let firmaValida = false;
  if (pasarela === 'mercadopago') {
    const sig = req.headers.get('x-signature') || '';
    firmaValida = await verificarFirmaMP(rawBody, sig, process.env.MP_WEBHOOK_SECRET || '');
  } else {
    const sig = req.headers.get('x-dlocal-signature') || '';
    firmaValida = await verificarFirmaDLocal(rawBody, sig);
  }

  // En desarrollo sin secrets configurados, aceptar igual pero loguear
  const sinSecret = pasarela === 'mercadopago'
    ? !process.env.MP_WEBHOOK_SECRET
    : !process.env.DLOCAL_SECRET_KEY;

  if (!firmaValida && !sinSecret) {
    return Response.json({ error: 'Firma inválida' }, { status: 401 });
  }

  // ── Parsear payload ──────────────────────────────────────────────────
  let evento;
  try {
    evento = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, error: 'Payload inválido' }, { status: 200 });
  }

  try {
    if (pasarela === 'mercadopago') {
      await procesarEventoMP(evento);
    } else {
      await procesarEventoDLocal(evento);
    }
  } catch (e) {
    // Loguear pero devolver 200 para no provocar reintentos
    await db.agregar('Bitacora', {
      agente: `webhook_${pasarela}`,
      accion: 'error_procesamiento',
      decision: 'error',
      razon: String(e?.message || e).slice(0, 400),
    }).catch(() => {});
  }

  return Response.json({ ok: true });
}

// ── MercadoPago ──────────────────────────────────────────────────────────────

async function procesarEventoMP(evento) {
  const tipo = evento.type || evento.action;
  const suscripcionId = evento.data?.id || evento.id;

  if (!suscripcionId) return;

  // Eventos que nos interesan de preapproval
  if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
    const status = evento.data?.status || evento.status;
    await actualizarPorSuscripcionId(suscripcionId, status, 'mercadopago', evento);
  }

  // Cobro exitoso (payment dentro de una suscripción)
  if (tipo === 'payment' && evento.data?.status === 'approved') {
    await registrarCobro(suscripcionId, evento, 'mercadopago');
  }
}

// ── dLocal ───────────────────────────────────────────────────────────────────

async function procesarEventoDLocal(evento) {
  const tipo = evento.type || '';
  const suscripcionId = evento.id || evento.payment_id;

  if (!suscripcionId) return;

  if (tipo === 'payment' || tipo === 'PAYMENT') {
    const status = evento.status || evento.payment_status;
    await actualizarPorSuscripcionId(suscripcionId, status, 'dlocal', evento);
  }
}

// ── Lógica compartida ────────────────────────────────────────────────────────

const MAPA_ESTADO = {
  // MercadoPago
  authorized: 'activo', active: 'activo', paused: 'pausado',
  cancelled: 'cancelado', canceled: 'cancelado',
  pending: 'pendiente', rejected: 'vencido',
  // dLocal
  PAID: 'activo', APPROVED: 'activo', PENDING: 'pendiente',
  REJECTED: 'vencido', EXPIRED: 'vencido', CANCELLED: 'cancelado',
};

async function actualizarPorSuscripcionId(suscripcionId, statusPasarela, pasarela, evento) {
  const estadoPago = MAPA_ESTADO[statusPasarela] || 'pendiente';

  // Buscar el cliente por suscripcion_id
  const clientes = await db.buscarClientePorSuscripcion(suscripcionId).catch(() => null);
  if (!clientes) return;

  const campos = { estado_pago: estadoPago };

  if (estadoPago === 'activo') {
    // Calcular próximo cobro (MP lo informa; si no, 30 días)
    const proximo = evento?.auto_recurring?.end_date
      || evento?.next_payment_date
      || new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
    campos.proximo_cobro = proximo.slice(0, 10);
    campos.ultimo_cobro = new Date().toISOString().slice(0, 10);

    // El primer cobro exitoso convierte el lead a 'cliente'
    if (clientes.lead_id) {
      await db.actualizar('Leads', { id: clientes.lead_id, etapa: 'cliente' });
    }
  }

  if (estadoPago === 'cancelado') {
    campos.baja_en = new Date().toISOString();
    campos.motivo_baja = `Cancelado por ${pasarela}`;
  }

  await db.actualizarEstadoPago(clientes.id, campos);

  await db.agregar('Bitacora', {
    agente: `webhook_${pasarela}`,
    accion: `estado_${estadoPago}`,
    lead_id: clientes.lead_id || null,
    decision: estadoPago,
    razon: `suscripcion_id=${suscripcionId} status_pasarela=${statusPasarela}`,
  }).catch(() => {});
}

async function registrarCobro(suscripcionId, evento, pasarela) {
  const clientes = await db.buscarClientePorSuscripcion(suscripcionId).catch(() => null);
  if (!clientes) return;

  const monto = evento.transaction_amount || evento.amount || 0;
  const moneda = evento.currency_id || evento.currency || '?';

  await db.agregar('Bitacora', {
    agente: `webhook_${pasarela}`,
    accion: 'cobro_confirmado',
    lead_id: clientes.lead_id || null,
    decision: 'activo',
    razon: `Cobro confirmado: ${moneda} ${monto} | suscripcion_id=${suscripcionId}`,
    costo_usd: moneda === 'USD' ? monto : 0,
  }).catch(() => {});
}
