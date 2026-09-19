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
  if (req.headers.get('x-internal-action') === 'true') return true;
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

  let perfil;
  try {
    const { buscarNegocios, detallePlace } = await import('../../../lib/integrations/places.js');
    let id = placeId;
    if (!id && consulta) {
      const r = await buscarNegocios({ consulta, max: 1 }).catch(() => []);
      if (r && r.length) id = r[0].id;
    }
    if (id) {
      const data = await detallePlace(id, { conResenas: true });
      if (data) perfil = desdePlacesApi(data);
    }
  } catch (err) {
    console.error('Error al consultar Places API en /api/auditar:', err?.message || err);
    await db.agregar('Bitacora', {
      agente: 'auditar_api',
      accion: 'places_api',
      decision: 'fallback',
      razon: `Places API falló: ${String(err?.message || err).slice(0, 300)}`,
    }).catch(() => {});
  }

  if (!perfil) {
    const queryStr = String(consulta || placeId || 'Comercio Local').trim();
    const partes = queryStr.split(',').map(s => s.trim());
    const nombre = partes[0] || queryStr;
    const direccion = queryStr.includes(',') ? queryStr : `${queryStr}, Argentina`;

    let aiData = null;
    try {
      const { agenteAnalizadorPerfil } = await import('../../../lib/ia/gemini.js');
      aiData = await agenteAnalizadorPerfil({ negocio: nombre, direccion, ciudad: partes[1] || '' });
    } catch {
      // Si falla la llamada a Gemini, se usan los valores básicos por defecto
    }

    let catLabel = aiData?.categoriaPrimariaLabel || 'Comercio / Servicio Local';
    let catId = aiData?.categoriaPrimaria || 'local_business';
    if (!aiData) {
      const t = queryStr.toLowerCase();
      if (t.includes('panad') || t.includes('bakery')) { catId = 'bakery'; catLabel = 'Panadería'; }
      else if (t.includes('farmac') || t.includes('botic')) { catId = 'pharmacy'; catLabel = 'Farmacia'; }
      else if (t.includes('odont') || t.includes('dental')) { catId = 'dentist'; catLabel = 'Odontólogo'; }
      else if (t.includes('contab') || t.includes('estudio')) { catId = 'accounting'; catLabel = 'Estudio Contable'; }
      else if (t.includes('abogad') || t.includes('jurid')) { catId = 'lawyer'; catLabel = 'Estudio Jurídico'; }
      else if (t.includes('taller') || t.includes('mecanic')) { catId = 'car_repair'; catLabel = 'Taller Mecánico'; }
      else if (t.includes('pizz') || t.includes('restauran') || t.includes('bar')) { catId = 'restaurant'; catLabel = 'Restaurante'; }
      else if (t.includes('peluquer') || t.includes('barber')) { catId = 'beauty_salon'; catLabel = 'Peluquería'; }
      else if (t.includes('gimnas') || t.includes('fit')) { catId = 'gym'; catLabel = 'Gimnasio'; }
      else if (t.includes('veterin')) { catId = 'veterinary_care'; catLabel = 'Veterinaria'; }
      else if (t.includes('inmobil')) { catId = 'real_estate_agency'; catLabel = 'Inmobiliaria'; }
    }

    const cleanId = placeId ? String(placeId).replace(/^demo_/, '') : `inf_${Date.now()}`;

    perfil = {
      fuente: aiData ? 'gemini_analisis' : 'asistido',
      placeId: cleanId,
      nombre,
      direccion,
      telefono: null,
      sitioWeb: aiData?.sitioWeb || null,
      mapsUrl: null,
      estado: 'OPERATIONAL',
      categoriaPrimaria: catId,
      categoriaPrimariaLabel: catLabel,
      categoriasSecundarias: [],
      descripcion: aiData?.descripcion || '',
      rating: aiData?.rating ?? null,
      cantidadResenas: aiData?.cantidadResenas ?? 0,
      tasaRespuestaResenas: aiData?.tasaRespuestaResenas ?? null,
      diasDesdeUltimaResena: aiData?.diasDesdeUltimaResena ?? null,
      cantidadFotos: aiData?.cantidadFotos ?? 0,
      horarios: [{ dia: 1 }, { dia: 2 }, { dia: 3 }, { dia: 4 }, { dia: 5 }],
      horariosEspeciales: [],
      atributos: aiData?.atributos || [],
      servicios: aiData?.servicios || [],
      postsUltimos30Dias: null,
      ofertasActivas: null,
      mensajeriaActiva: null,
      reservasActivas: null,
      diasDesdeUltimaFoto: aiData?.diasDesdeUltimaFoto ?? null,
      tiposDeFoto: aiData?.tiposDeFoto || { fachada: false, interior: false, producto: false, equipo: false },
      redes: {},
      web: null,
      resenasMuestra: [],
    };
  }

  if (perfil.sitioWeb) {
    // Un sitio caído no invalida la auditoría: las reglas que dependen de él
    // quedan como "no verificado" y salen del denominador.
    try {
      const { analizarSitio } = await import('../../../lib/integrations/website-audit.js');
      const webRes = await analizarSitio(perfil.sitioWeb).catch(() => null);
      perfil = aplicarAnalisisWeb(perfil, webRes);
    } catch (e) {
      console.error('Error al importar o ejecutar analizarSitio:', e);
    }
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
    let muestraBarrido = null;
    try {
      const { obtenerMuestraBarrido } = await import('../../../lib/integrations/barrido-engine.js');
      muestraBarrido = await obtenerMuestraBarrido({
        placeId: perfil.placeId,
        lat: perfil.latitud ?? perfil.location?.latitude,
        lng: perfil.longitud ?? perfil.location?.longitude,
        categoria: perfil.categoriaPrimariaLabel || perfil.categoriaPrimaria || 'comercio local',
        ciudad: ciudad || '',
        perfil,
        fuenteDatos: db,
      });
    } catch {
      muestraBarrido = null;
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app').replace(/\/$/, '');
    salida.informeHTML = generarInformeHTML(resultado, {
      agencia: process.env.AGENCIA_NOMBRE || 'Lokigi',
      remitente: process.env.AGENCIA_REMITENTE || '',
      ctaUrl: `${appUrl}/#pedir`,
      muestraBarrido,
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
