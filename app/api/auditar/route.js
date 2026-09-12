/**
 * /api/auditar — Auditar un perfil suelto, sin esperar a la corrida diaria.
 *
 * Tres usos, en orden de frecuencia real:
 *   1. Alguien te pasa un negocio por WhatsApp y querés el número ahora.
 *   2. Probar un cambio en la rúbrica contra un perfil conocido.
 *   3. Re-auditar un cliente antes de una reunión.
 *
 * Lo que NO hace: contactar. Esta ruta audita, guarda en el corpus y devuelve
 * el resultado. El primer toque lo decide la tarea de prospección y lo
 * autoriza el guardián, siempre. Que exista un botón "auditar" no puede
 * convertirse en un atajo para escribirle a alguien sin pasar por la puerta.
 */

import { NextResponse } from 'next/server';
import * as db from '../../../lib/db/supabase.js';
import { auditar } from '../../../lib/core/audit-engine.js';
import { generarInformeHTML } from '../../../lib/core/report.js';
import { generarPresupuestos } from '../../../lib/core/quote-engine.js';
import { desdePlacesApi, aplicarAnalisisWeb } from '../../../lib/core/normalize.js';
import { tokenValido, COOKIE } from '../../../lib/auth.js';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Acepta sesión del panel (uso desde el navegador) o clave de API (scripts). */
async function autorizado(req) {
  const clave = process.env.LOKIGI_API_KEY;
  if (clave && req.headers.get('x-api-key') === clave) return true;
  const c = (await cookies()).get(COOKIE)?.value;
  if (c && tokenValido(c)) return true;
  return !clave && process.env.NODE_ENV !== 'production';
}

export async function POST(req) {
  if (!await autorizado(req)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const cuerpo = await req.json().catch(() => ({}));
  const { placeId, consulta, guardar = true, conInforme = false, conPresupuesto = false } = cuerpo;

  if (!placeId && !consulta) {
    return NextResponse.json(
      { error: 'Mandá `placeId` (de Google) o `consulta` (ej.: "Parrilla Don José, Rosario")' },
      { status: 400 }
    );
  }

  const { buscarNegocios, detallePlace } = await import('../../../lib/integrations/places.js');
  const { analizarSitio } = await import('../../../lib/integrations/website-audit.js');

  let id = placeId;
  if (!id) {
    const r = await buscarNegocios({ consulta, max: 1 });
    if (!r.length) return NextResponse.json({ error: `Sin resultados para "${consulta}"` }, { status: 404 });
    id = r[0].id;
  }

  let perfil = desdePlacesApi(await detallePlace(id, { conResenas: true }));
  if (perfil.sitioWeb) {
    // Un sitio caído no invalida la auditoría: las reglas que dependen de él
    // quedan como "no verificado" y salen del denominador, que es exactamente
    // lo que el motor hace con cualquier dato ausente.
    perfil = aplicarAnalisisWeb(perfil, await analizarSitio(perfil.sitioWeb).catch(() => null));
  }

  const resultado = auditar(perfil);
  const ciudad = (perfil.direccion || '').split(',').slice(-2, -1)[0]?.trim() || null;
  const dim = (d) => resultado.dimensiones.find(x => x.id === d)?.score ?? null;

  let percentil = null;
  if (guardar) {
    await db.agregar('Corpus', {
      place_id: perfil.placeId, categoria: perfil.categoriaPrimariaLabel, ciudad,
      score: resultado.score, potencial: resultado.potencial, cobertura: resultado.meta.cobertura,
      d_fundamentos: dim('fundamentos'), d_reputacion: dim('reputacion'), d_visual: dim('visual'),
      d_actividad: dim('actividad'), d_conversion: dim('conversion'), d_presencia: dim('presencia'),
      resenas: perfil.cantidadResenas, rating: perfil.rating, fotos: perfil.cantidadFotos,
      version_rubrica: resultado.meta.version,
    }).catch(() => {});
    percentil = await db.percentil(resultado.score, perfil.categoriaPrimariaLabel, ciudad).catch(() => null);
  }

  const salida = {
    placeId: perfil.placeId,
    negocio: perfil.nombre,
    categoria: perfil.categoriaPrimariaLabel,
    ciudad,
    score: resultado.score,
    potencial: resultado.potencial,
    brecha: resultado.brecha,
    banda: resultado.banda.nombre,
    cobertura: resultado.meta.cobertura,
    percentil,
    dimensiones: resultado.dimensiones,
    fortalezas: resultado.fortalezas,
    hallazgos: resultado.hallazgos,
    noVerificados: resultado.noVerificados,
    version: resultado.meta.version,
  };

  if (conPresupuesto) {
    const [moneda, tipoCambio, tarifa] = await Promise.all([
      db.config('moneda', 'ars'), db.config('tipo_cambio', null), db.config('tarifa_hora_usd', 22),
    ]);
    try {
      salida.presupuestos = generarPresupuestos(resultado, {
        moneda, tipoCambio: tipoCambio ? Number(tipoCambio) : null, tarifaHoraUSD: Number(tarifa),
      });
    } catch (e) {
      // Cotizar en pesos sin tipo de cambio cargado es el caso típico. Se dice
      // qué falta en vez de devolver un 500 que no explica nada.
      salida.presupuestos = { error: e.message };
    }
  }

  if (conInforme) {
    salida.informeHTML = generarInformeHTML(resultado, {
      agencia: process.env.AGENCIA_NOMBRE || 'Lokigi',
      remitente: process.env.AGENCIA_REMITENTE || '',
    });
  }

  return NextResponse.json(salida);
}

/** GET /api/auditar?consulta=... — el mismo trabajo, cómodo desde el navegador. */
export async function GET(req) {
  const p = new URL(req.url).searchParams;
  return POST(new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify({
      placeId: p.get('placeId') || undefined,
      consulta: p.get('consulta') || undefined,
      guardar: p.get('guardar') !== 'false',
      conInforme: p.get('informe') === 'true',
      conPresupuesto: p.get('presupuesto') === 'true',
    }),
  }));
}
