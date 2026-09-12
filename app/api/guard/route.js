/**
 * /api/guard — La única puerta de salida.
 *
 * Existe como ruta HTTP y no solo como función importada por una razón
 * concreta: cualquier cosa que en el futuro quiera mandar un mensaje —un flujo
 * de n8n que decidas reactivar, un script suelto, una automatización de
 * Workspace— tiene que poder consultar al guardián sin importar el código del
 * núcleo. Si la única forma de preguntar fuera un `import`, tarde o temprano
 * algo enviaría sin preguntar.
 *
 * Contrato: se le pasa un INTENTO, devuelve un VEREDICTO. Nunca envía.
 * Ninguna respuesta de esta ruta hace que salga un correo; solo dice si
 * podría.
 *
 * Falla cerrada. Si algo acá adentro se rompe, el veredicto es "bloqueado".
 */

import { NextResponse } from 'next/server';
import * as db from '../../../lib/db/supabase.js';
import { evaluar, registrar, usarFuente, lintear, VEREDICTO, huella } from '../../../lib/guardrails/guard.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

usarFuente(db);

function autorizado(req) {
  const clave = process.env.LOKIGI_API_KEY;
  if (!clave) return process.env.NODE_ENV !== 'production';
  return req.headers.get('x-api-key') === clave;
}

export async function POST(req) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  let intento;
  try {
    intento = await req.json();
  } catch {
    return NextResponse.json({ error: 'cuerpo inválido' }, { status: 400 });
  }

  if (!intento?.destinatario || !intento?.cuerpo) {
    // Un intento incompleto no se evalúa: se rechaza. Evaluar algo a medias y
    // devolver "permitido" sería la peor respuesta posible.
    return NextResponse.json({
      veredicto: VEREDICTO.BLOQUEADO,
      regla: 'intento_incompleto',
      razon: 'Falta destinatario o cuerpo. Ante la duda no se envía.',
    });
  }

  try {
    const v = await evaluar(intento);
    // Registrar es contabilidad, no control: que falle no debe cambiar el
    // veredicto ni tumbar la respuesta.
    await registrar(intento, v).catch(() => {});
    return NextResponse.json(v);
  } catch (e) {
    return NextResponse.json({
      veredicto: VEREDICTO.BLOQUEADO,
      regla: 'guardian_caido',
      razon: `El guardián no pudo evaluar (${e.message}). Ante la duda no se envía.`,
      id: huella(intento),
    });
  }
}

/**
 * GET devuelve solo el linter: revisa el texto sin tocar la base.
 * Sirve para la pantalla de aprobaciones, que muestra las advertencias
 * mientras editás, y no necesita saber nada del contexto del lead.
 */
export async function GET(req) {
  if (!autorizado(req)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const texto = new URL(req.url).searchParams.get('texto') || '';
  return NextResponse.json(lintear({ cuerpo: texto, asunto: '' }));
}
