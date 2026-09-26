'use server';

/**
 * app/(panel)/clientes/acciones.js — Server Actions para la pantalla de Clientes.
 *
 * Flujo de alta:
 *   1. Crear fila en `clientes` con estado_pago='pendiente'.
 *   2. Llamar a la pasarela (MP o dLocal según moneda).
 *   3. Guardar suscripcion_id y url_aprobacion en `clientes`.
 *   4. Pre-cargar en Aprobaciones un mail con el link de pago (tipo='link_pago').
 *   5. Devolver la URL para que el operador también la pueda copiar manualmente.
 *
 * La pasarela confirma el pago vía webhook → leads.etapa pasa a 'cliente'.
 */

import { revalidatePath } from 'next/cache';
import * as db from '../../../lib/db/supabase.js';
import {
  crearSuscripcionMercadoPago,
  crearSuscripcionDLocal,
  detectarPasarela,
} from '../../../lib/integrations/pagos.js';
import { requerirSesion } from '../../../lib/auth.js';
import { huella, evaluar, VEREDICTO, usarFuente } from '../../../lib/guardrails/guard.js';

usarFuente(db);

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app';

// ── Lectura de datos (usados por page.jsx para cargar datos) ──────────────────

export async function obtenerLeadsGanadosAction() {
  await requerirSesion();
  return db.obtenerLeadsGanados().catch(() => []);
}

export async function obtenerMRRAction() {
  await requerirSesion();
  return db.obtenerMRR().catch(() => ({ clientes_activos: 0, mrr: 0, ticket_promedio: 0 }));
}

/**
 * Devuelve la lista de clientes activos con su ficha completa
 * (lead + historial + informes + tareas), listo para renderizar.
 */
export async function obtenerClientesConFichaAction() {
  await requerirSesion();
  const clientesConLead = await db.obtenerClientesConLead().catch(() => []);
  // Carga fichas en paralelo (máx 10 concurrentes para no saturar PostgREST)
  const CONCURRENCIA = 10;
  const resultado = [];
  for (let i = 0; i < clientesConLead.length; i += CONCURRENCIA) {
    const lote = clientesConLead.slice(i, i + CONCURRENCIA);
    const fichas = await Promise.all(
      lote.map(c => c.lead?.id
        ? db.obtenerFichaCliente(c.lead.id).catch(() => ({ lead: c.lead, cliente: c, historial: [], informes: [], tareas: [] }))
        : Promise.resolve({ lead: c.lead, cliente: c, historial: [], informes: [], tareas: [] })
      )
    );
    resultado.push(...fichas);
  }
  return resultado;
}

// ── Alta de cliente ───────────────────────────────────────────────────────────

export async function altaClienteAction(formData) {
  await requerirSesion();

  const leadId  = formData.get('leadId')?.trim();
  const negocio = formData.get('negocio')?.trim();
  const email   = formData.get('email')?.trim();
  const plan    = formData.get('plan')?.trim();
  const moneda  = formData.get('moneda')?.trim() || 'ARS';
  const setup   = parseFloat(formData.get('setup') || '0');
  const mensual = parseFloat(formData.get('mensual') || '0');
  const diaCobro = parseInt(formData.get('diaCobro') || '1', 10);
  const gbpAcceso = formData.get('gbpAcceso') === 'on';
  const scoreInicial = parseInt(formData.get('scoreInicial') || '0', 10);

  if (!leadId || !email || !plan) {
    return { ok: false, error: 'Faltan campos obligatorios (lead, email, plan).' };
  }
  if (!['esencial', 'crecimiento', 'dominio', 'setup_unico'].includes(plan)) {
    return { ok: false, error: `Plan inválido: ${plan}` };
  }
  if (!['ARS', 'USD'].includes(moneda)) {
    return { ok: false, error: 'Moneda debe ser ARS o USD.' };
  }

  // 1. Crear la fila en clientes
  const clienteId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const pasarela = detectarPasarela(moneda);

  await db.crearCliente({
    id: clienteId,
    lead_id: leadId,
    plan,
    moneda,
    setup,
    mensual,
    dia_cobro: diaCobro,
    gbp_acceso: gbpAcceso,
    score_inicial: scoreInicial || null,
    pasarela,
    estado_pago: 'pendiente',
  });

  // 2. Crear suscripción en la pasarela
  let suscripcionId, urlAprobacion;
  try {
    const res = pasarela === 'mercadopago'
      ? await crearSuscripcionMercadoPago({ clienteId, negocio, plan, email, montoARS: mensual })
      : await crearSuscripcionDLocal({ clienteId, negocio, plan, email, montoUSD: mensual });

    suscripcionId = res.suscripcionId;
    urlAprobacion = res.urlAprobacion;
  } catch (e) {
    // La fila de cliente quedó creada; guardamos el error para que el operador reintente
    await db.agregar('Bitacora', {
      agente: 'operador',
      accion: 'alta_cliente_error_pasarela',
      lead_id: leadId,
      decision: 'error',
      razon: String(e?.message || e).slice(0, 400),
    }).catch(() => {});
    return { ok: false, error: `Error al crear suscripción en ${pasarela}: ${e.message}` };
  }

  // 3. Guardar suscripcion_id y url en la fila de cliente
  await db.actualizarEstadoPago(clienteId, { suscripcion_id: suscripcionId, url_aprobacion: urlAprobacion });

  // 4. Pre-cargar en Aprobaciones el mail con el link de pago
  const asunto = `Tu suscripción Lokigi · ${plan} — primer cobro`;
  const cuerpo = [
    `Hola ${negocio},`,
    ``,
    `Quedó configurada tu suscripción de Lokigi — Plan ${plan} (${moneda} ${mensual}/mes).`,
    ``,
    `Para que se active, hacé clic en el siguiente enlace y completá la autorización de débito:`,
    urlAprobacion,
    ``,
    `El cobro se procesará automáticamente cada mes el día ${diaCobro}.`,
    ``,
    `Marcelo`,
    `Lokigi`,
  ].join('\n');

  const intencion = {
    leadId,
    canal: 'email',
    tipo: 'link_pago',
    destinatario: email,
    asunto,
    cuerpo,
    paso: 99,
    creado_en: new Date().toISOString(),
  };

  const evaluacion = await evaluar(intencion).catch(() => ({ veredicto: VEREDICTO.DIFERIDO }));

  if (evaluacion.veredicto !== VEREDICTO.BLOQUEADO) {
    await db.agregar('Aprobaciones', {
      id: `aprob_lkpago_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      lead_id: leadId,
      negocio,
      canal: 'email',
      tipo: 'link_pago',
      destinatario: email,
      asunto,
      cuerpo,
      decision: 'PENDIENTE',
      regla_bloqueante: null,
      huella: huella(intencion),
    }).catch(() => {});
  }

  await db.agregar('Bitacora', {
    agente: 'operador',
    accion: 'alta_cliente',
    lead_id: leadId,
    decision: 'PENDIENTE',
    razon: `Cliente creado: ${clienteId} | pasarela=${pasarela} | suscripcion_id=${suscripcionId}`,
  }).catch(() => {});

  revalidatePath('/clientes');
  return { ok: true, clienteId, suscripcionId, urlAprobacion, pasarela };
}

// ── Baja de cliente ───────────────────────────────────────────────────────────

export async function darDeBajaClienteAction(formData) {
  await requerirSesion();

  const clienteId = formData.get('clienteId')?.trim();
  const leadId    = formData.get('leadId')?.trim();
  const motivo    = formData.get('motivo')?.trim();

  if (!clienteId) return { ok: false, error: 'ID de cliente requerido.' };
  if (!motivo || motivo.length < 20) {
    return { ok: false, error: 'El motivo de baja debe tener al menos 20 caracteres.' };
  }

  await db.darDeBajaCliente(clienteId, motivo);

  if (leadId) {
    await db.actualizar('Leads', { id: leadId, etapa: 'perdido', motivo_perdida: motivo });
  }

  await db.agregar('Bitacora', {
    agente: 'operador',
    accion: 'baja_cliente',
    lead_id: leadId || null,
    decision: 'baja',
    razon: motivo,
  }).catch(() => {});

  revalidatePath('/clientes');
  return { ok: true };
}

// ── Tareas ────────────────────────────────────────────────────────────────────

export async function crearTareaAction(formData) {
  await requerirSesion();

  const leadId   = formData.get('leadId')?.trim();
  const titulo   = formData.get('titulo')?.trim();
  const detalle  = formData.get('detalle')?.trim() || null;
  const servicio = formData.get('servicio')?.trim() || null;
  const venceEn  = formData.get('venceEn')?.trim() || null;
  const horasEst = parseFloat(formData.get('horasEst') || '0') || null;

  if (!leadId || !titulo) return { ok: false, error: 'Lead ID y título son requeridos.' };

  await db.crearTarea({ lead_id: leadId, titulo, detalle, servicio, vence_en: venceEn, horas_est: horasEst });

  revalidatePath('/clientes');
  return { ok: true };
}

export async function actualizarEstadoTareaAction(formData) {
  await requerirSesion();

  const id     = formData.get('id')?.trim();
  const estado = formData.get('estado')?.trim();

  if (!id || !estado) return { ok: false, error: 'ID y estado requeridos.' };
  if (!['pendiente', 'en_curso', 'hecho', 'bloqueada'].includes(estado)) {
    return { ok: false, error: `Estado inválido: ${estado}` };
  }

  await db.actualizarTarea(id, { estado });

  revalidatePath('/clientes');
  return { ok: true };
}

export async function eliminarTareaAction(formData) {
  await requerirSesion();

  const id = formData.get('id')?.trim();
  if (!id) return { ok: false, error: 'ID requerido.' };

  await db.eliminarTarea(id);

  revalidatePath('/clientes');
  return { ok: true };
}
