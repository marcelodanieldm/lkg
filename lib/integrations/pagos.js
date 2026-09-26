/**
 * pagos.js — Integración con MercadoPago (ARS) y dLocal (USD).
 *
 * Regla de selección de pasarela:
 *   moneda ARS → MercadoPago preapproval API
 *   moneda USD → dLocal subscriptions API
 *
 * Ninguna función aquí envía correos ni modifica la base de datos.
 * Solo hablan con las APIs externas y devuelven el resultado.
 * La orquestación (guardar, notificar, etc.) la hace la server action.
 */

// ── MercadoPago ──────────────────────────────────────────────────────────────

const MP_API = 'https://api.mercadopago.com';

function mpHeaders() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('Falta MP_ACCESS_TOKEN en el entorno.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Crea una suscripción preaprobada en MercadoPago.
 * El cliente debe visitar `urlAprobacion` para autorizar el débito automático.
 *
 * @returns {{ suscripcionId, urlAprobacion }}
 */
export async function crearSuscripcionMercadoPago({ clienteId, negocio, plan, email, montoARS }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app';

  const payload = {
    reason: `Lokigi · ${plan} — ${negocio}`,
    payer_email: email,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: Number(montoARS),
      currency_id: 'ARS',
    },
    back_url: `${appUrl}/clientes/bienvenido`,
    // Referencia interna para reconciliar el webhook
    external_reference: clienteId,
    status: 'pending',
  };

  const res = await fetch(`${MP_API}/preapproval`, {
    method: 'POST',
    headers: mpHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      `MercadoPago ${res.status}: ${data?.message || data?.error || JSON.stringify(data).slice(0, 200)}`
    );
  }

  return {
    suscripcionId: data.id,
    urlAprobacion: data.init_point,
  };
}

/**
 * Verifica la firma HMAC-SHA256 de un webhook de MercadoPago.
 * MercadoPago envía la firma en el header `x-signature` con formato:
 *   ts=<timestamp>,v1=<hmac>
 */
export async function verificarFirmaMP(payload, headerSignature, secret) {
  if (!headerSignature || !secret) return false;

  // Parsear ts y v1 del header
  const partes = Object.fromEntries(
    headerSignature.split(',').map(p => p.trim().split('='))
  );
  const ts = partes.ts || '';
  const v1 = partes.v1 || '';
  if (!ts || !v1) return false;

  // El mensaje a firmar es: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
  // Para webhooks de preapproval, MP firma el body completo + ts
  const mensaje = `${ts}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(mensaje));
  const firmaHex = Array.from(new Uint8Array(firma)).map(b => b.toString(16).padStart(2, '0')).join('');

  return firmaHex === v1;
}

// ── dLocal ───────────────────────────────────────────────────────────────────

const DLOCAL_API = 'https://api.dlocal.com';

/**
 * Genera los headers de autenticación V2-HMAC-SHA256 que requiere dLocal.
 * Documentación: https://docs.dlocal.com/reference/security
 */
async function dLocalHeaders(body = '') {
  const apiKey = process.env.DLOCAL_API_KEY;
  const secretKey = process.env.DLOCAL_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error('Faltan DLOCAL_API_KEY o DLOCAL_SECRET_KEY.');

  const xDate = new Date().toISOString();
  const xLogin = apiKey;

  // Firma: HMAC-SHA256(apiKey + xDate + body, secretKey)
  const mensaje = `${xLogin}${xDate}${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(mensaje));
  const firmaHex = Array.from(new Uint8Array(firma)).map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    'Content-Type': 'application/json',
    'X-Date': xDate,
    'X-Login': xLogin,
    Authorization: `V2-HMAC-SHA256, Signature: ${firmaHex}`,
  };
}

/**
 * Crea una suscripción en dLocal (USD).
 * @returns {{ suscripcionId, urlAprobacion }}
 */
export async function crearSuscripcionDLocal({ clienteId, negocio, plan, email, montoUSD }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app';

  const payload = JSON.stringify({
    plan_id: null, // sin plan preconfigurado — datos inline
    currency: 'USD',
    amount: Number(montoUSD),
    payment_method_flow: 'REDIRECT',
    country: 'AR',
    payer: { name: negocio, email },
    description: `Lokigi · ${plan} — ${negocio}`,
    notification_url: `${appUrl}/api/webhooks/pagos`,
    success_url: `${appUrl}/clientes/bienvenido`,
    external_id: clienteId,
  });

  const headers = await dLocalHeaders(payload);

  const res = await fetch(`${DLOCAL_API}/payments`, {
    method: 'POST',
    headers,
    body: payload,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      `dLocal ${res.status}: ${data?.message || data?.description || JSON.stringify(data).slice(0, 200)}`
    );
  }

  return {
    suscripcionId: data.id,
    urlAprobacion: data.redirect_url,
  };
}

/**
 * Verifica la firma del webhook de dLocal.
 * dLocal envía la firma en el header `x-dlocal-signature`.
 * La firma es HMAC-SHA256(secretKey, body).
 */
export async function verificarFirmaDLocal(payload, headerSignature) {
  const secret = process.env.DLOCAL_SECRET_KEY;
  if (!headerSignature || !secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const firmaHex = Array.from(new Uint8Array(firma)).map(b => b.toString(16).padStart(2, '0')).join('');

  return firmaHex === headerSignature;
}

/**
 * Detecta la pasarela correcta según la moneda.
 * No hay excepciones: ARS → MP, USD → dLocal. Regla inmutable.
 */
export function detectarPasarela(moneda) {
  if (moneda === 'ARS') return 'mercadopago';
  if (moneda === 'USD') return 'dlocal';
  throw new Error(`Moneda no soportada: ${moneda}. Usar ARS o USD.`);
}
