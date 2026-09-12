/**
 * gmail.js — Envío y lectura por Gmail API.
 *
 * Números que definen el diseño (verificados 2026):
 *   - Gmail personal: 500 destinatarios/día.
 *   - Google Workspace: 2.000 correos/día, 3.000 destinatarios, 2.000 externos.
 *     Una cuenta nueva arranca cerca de 500 y sube en semanas.
 *   - El límite REAL de correo en frío no es el de Google: es la reputación.
 *     La recomendación de la industria son unas pocas decenas por día por
 *     buzón calentado, no miles. Por eso el cupo por defecto son 25.
 *   - "Remitente masivo" (reglas estrictas de SPF+DKIM+DMARC y baja de un clic)
 *     arranca en 5.000 diarios a direcciones @gmail.com. Lokigi nunca llega
 *     ahí, así que le alcanza con UN método de autenticación — pero igual se
 *     configuran los tres, porque la tasa de quejas por debajo de 0,1% sí
 *     aplica siempre y es lo que decide si el correo entra o no.
 *
 * Decisión de arquitectura: dominio de envío DEDICADO, distinto del dominio
 * principal. Si la prospección junta quejas, se quema el dominio de
 * prospección y no el correo con el que le escribís a tus clientes.
 */

import { llamar } from './google-oauth.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// El token y los reintentos viven en google-oauth.js, compartidos con Sheets,
// Docs, Drive y Calendar: son la misma cuenta y el mismo proyecto de Google
// Cloud, y renovar el token cinco veces en la misma corrida no tiene sentido.
const api = (ruta, opciones = {}) => llamar(`${API}${ruta}`, opciones);

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// RFC 2047 para acentos en el asunto. Sin esto, "Auditoría" llega roto.
const encAsunto = (s) => /[^\x00-\x7F]/.test(s)
  ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s;

function construirMime({ para, de, asunto, textoPlano, html, responderA, urlBaja, headersExtra = {} }) {
  const limite = `lok_${Date.now().toString(36)}`;
  const headers = {
    From: de,
    To: para,
    Subject: encAsunto(asunto),
    'MIME-Version': '1.0',
    ...(responderA ? { 'Reply-To': responderA } : {}),
    // Baja de un clic. No es obligatoria por debajo del umbral de remitente
    // masivo, pero baja las marcas de spam y las marcas de spam son lo único
    // que importa a este volumen.
    ...(urlBaja ? {
      'List-Unsubscribe': `<${urlBaja}>, <mailto:${process.env.EMAIL_BAJA || de}?subject=BAJA>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    } : {}),
    ...headersExtra,
    'Content-Type': `multipart/alternative; boundary="${limite}"`,
  };

  const cabecera = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
  return `${cabecera}\r\n\r\n` +
    `--${limite}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${textoPlano}\r\n\r\n` +
    `--${limite}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n\r\n` +
    `--${limite}--`;
}

export async function enviar(opciones) {
  const de = opciones.de || process.env.GMAIL_FROM;
  if (!de) throw new Error('Falta GMAIL_FROM');
  const raw = b64url(construirMime({ ...opciones, de }));
  const r = await api('/messages/send', { method: 'POST', body: JSON.stringify({ raw }) });
  return { id: r.id, threadId: r.threadId };
}

/** Deja el mensaje como borrador. Es el modo de arranque más seguro. */
export async function borrador(opciones) {
  const de = opciones.de || process.env.GMAIL_FROM;
  const raw = b64url(construirMime({ ...opciones, de }));
  const r = await api('/drafts', { method: 'POST', body: JSON.stringify({ message: { raw } }) });
  return { id: r.id, messageId: r.message?.id };
}

export async function responder({ threadId, para, asunto, textoPlano, html, messageIdOriginal }) {
  const de = process.env.GMAIL_FROM;
  const raw = b64url(construirMime({
    para, de, asunto: asunto.startsWith('Re:') ? asunto : `Re: ${asunto}`,
    textoPlano, html,
    headersExtra: messageIdOriginal
      ? { 'In-Reply-To': messageIdOriginal, References: messageIdOriginal } : {},
  }));
  return api('/messages/send', { method: 'POST', body: JSON.stringify({ raw, threadId }) });
}

/** Respuestas nuevas desde la última corrida. Alimenta al agente conversador. */
export async function respuestasNuevas({ desde, etiqueta = 'INBOX', max = 30 } = {}) {
  const q = ['is:unread', '-category:promotions', '-from:me',
             desde ? `after:${Math.floor(new Date(desde).getTime() / 1000)}` : 'newer_than:2d'].join(' ');
  const lista = await api(`/messages?q=${encodeURIComponent(q)}&labelIds=${etiqueta}&maxResults=${max}`);
  const out = [];
  for (const m of lista.messages || []) {
    const full = await api(`/messages/${m.id}?format=full`);
    out.push(normalizar(full));
  }
  return out;
}

function normalizar(m) {
  const h = Object.fromEntries((m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
  return {
    id: m.id,
    threadId: m.threadId,
    de: h.from,
    email: (h.from || '').match(/<(.+?)>/)?.[1] || h.from,
    asunto: h.subject,
    messageId: h['message-id'],
    fecha: new Date(Number(m.internalDate)).toISOString(),
    texto: extraerTexto(m.payload).slice(0, 4000),
    esRebote: /mailer-daemon|postmaster/i.test(h.from || '') ||
              /delivery status notification|undeliverable|no se pudo entregar/i.test(h.subject || ''),
  };
}

function extraerTexto(parte) {
  if (!parte) return '';
  if (parte.mimeType === 'text/plain' && parte.body?.data) {
    return Buffer.from(parte.body.data, 'base64').toString('utf8');
  }
  for (const p of parte.parts || []) {
    const t = extraerTexto(p);
    if (t) return t;
  }
  if (parte.body?.data) {
    return Buffer.from(parte.body.data, 'base64').toString('utf8').replace(/<[^>]+>/g, ' ');
  }
  return '';
}

/** Quita la marca de no leído de un mensaje. */
export const marcarLeido = (id) =>
  api(`/messages/${id}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) });

/** Aplica una etiqueta a un mensaje en Gmail para organización manual. */
export const etiquetar = (id, labelId) =>
  api(`/messages/${id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: [labelId] }) });

/** Crea una etiqueta en Gmail si no existe. Utilitario para inicialización manual de etiquetas. */
export async function crearEtiqueta(nombre) {
  try {
    return await api('/labels', { method: 'POST', body: JSON.stringify({
      name: nombre, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
  } catch (e) {
    if (!/already exists|409/i.test(e.message)) throw e;
    const l = await api('/labels');
    return (l.labels || []).find(x => x.name === nombre);
  }
}

/** Cuántos se enviaron hoy, leído de Gmail y no de nuestro registro. */
export async function enviadosHoy() {
  const hoy = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const r = await api(`/messages?q=${encodeURIComponent(`in:sent after:${hoy}`)}&maxResults=500`);
  return (r.messages || []).length;
}
