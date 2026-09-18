/**
 * /api/webhook/gmail — Aviso instantáneo de Gmail (opcional).
 *
 * El sistema YA funciona sin esto: la tarea `bandeja` revisa el correo cada
 * diez minutos. Este webhook sirve para que una respuesta se procese en
 * segundos en vez de en minutos, que importa cuando alguien contesta "cuánto
 * sale" y está mirando el teléfono en ese momento.
 *
 * Cómo se conecta (tres pasos, ninguno obligatorio):
 *   1. Crear un tema de Pub/Sub en el mismo proyecto de Google Cloud.
 *   2. Darle permiso de publicación a gmail-api-push@system.gserviceaccount.com.
 *   3. Llamar a users.watch apuntando a ese tema, y renovarlo cada 7 días
 *      (Google lo caduca solo).
 *
 * Ese punto 3 es la razón por la que esto es opcional: si te olvidás de
 * renovar, deja de avisar en silencio. Por eso la revisión cada diez minutos
 * se mantiene aunque el webhook esté andando. Redundancia a propósito.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const APP = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app').replace(/\/$/, '');

export async function POST(req) {
  // Pub/Sub firma con un token que se define al crear la suscripción. Sin
  // esto, cualquiera puede hacer que Lokigi lea la bandeja cuando quiera —
  // no filtra datos, pero sí gasta cuota de API y de Gemini.
  const esperado = process.env.PUBSUB_TOKEN;
  if (esperado) {
    const recibido = new URL(req.url).searchParams.get('token');
    if (recibido !== esperado) return NextResponse.json({ error: 'token inválido' }, { status: 401 });
  }

  // Siempre 200, incluso si algo falla. Pub/Sub reintenta durante días ante
  // cualquier otro código, y un reintento acá significa volver a procesar la
  // misma respuesta: doble clasificación, doble gasto de modelo.
  try {
    await fetch(`${APP()}/api/cron/bandeja`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.LOKIGI_API_KEY || '',
      },
      body: JSON.stringify({ origen: 'gmail_push' }),
    });
  } catch { /* la corrida de los diez minutos lo va a levantar igual */ }

  return NextResponse.json({ ok: true });
}
