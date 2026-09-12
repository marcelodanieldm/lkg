/**
 * /api/baja — La baja de un clic desde el cliente de correo.
 *
 * Este endpoint es el que apunta la cabecera `List-Unsubscribe` con
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Cuando alguien toca
 * "Cancelar suscripción" arriba del correo en Gmail, Gmail hace un POST acá
 * directamente: no hay pantalla, no hay confirmación, no hay forma de
 * preguntar nada.
 *
 * Está separado de la página /baja por una razón concreta. La página usa GET
 * para mostrar un botón y no da de baja al abrirse, porque los escáneres de
 * enlaces de los antivirus corporativos visitan todas las URLs de un correo
 * antes de entregarlo: si el GET ejecutara, media lista se desuscribiría sola.
 * Acá, en cambio, el POST viene de una acción deliberada de la persona y tiene
 * que ejecutar sin preguntar.
 *
 * Siempre responde 200. Un error acá hace que Gmail muestre "no se pudo
 * cancelar la suscripción", que es peor que cualquier problema que se pueda
 * arreglar después mirando la bitácora.
 */

import { darDeBaja, agregar } from '../../../lib/db/supabase.js';

export const dynamic = 'force-dynamic';

async function ejecutar(req) {
  const lead = new URL(req.url).searchParams.get('lead');
  if (!lead) return new Response('OK', { status: 200 });

  try {
    await darDeBaja(lead, 'email');
  } catch (e) {
    await agregar('Bitacora', {
      agente: 'sistema', accion: 'baja', lead_id: lead, decision: 'error',
      razon: `FALLÓ la baja de un clic (List-Unsubscribe): ${String(e.message).slice(0, 300)}. Resolvela a mano YA.`,
    }).catch(() => {});
  }
  return new Response('OK', { status: 200 });
}

export const POST = ejecutar;

/**
 * GET NO ejecuta: lleva a la pantalla con el botón.
 *
 * Es el mismo cuidado que en /baja. Un GET sobre esta URL puede venir de un
 * escáner de seguridad y no de una persona, y una baja disparada por un
 * escáner se pierde en silencio: el prospecto nunca se entera de que dejó de
 * recibir, y vos nunca te enterás de por qué se cayó la lista. Los clientes de
 * correo que hacen la baja de verdad usan POST, como manda el RFC 8058.
 */
export function GET(req) {
  const lead = new URL(req.url).searchParams.get('lead') || '';
  return Response.redirect(
    new URL(`/baja?lead=${encodeURIComponent(lead)}`, new URL(req.url).origin), 302
  );
}
