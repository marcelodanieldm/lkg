/**
 * app/api/barrido/[id]/export/route.js
 *
 * Exporta el desglose de reglas de un barrido (barrido_reglas) en formato CSV o JSON.
 *
 * REQUISITOS CRÍTICOS:
 * 1. Formato largo: 1 fila por competidor Y por regla.
 * 2. UTF-8 CON BOM (\uFEFF) al inicio del CSV para que Excel y Power BI en español
 *    reconozcan correctamente acentos y ñ al usar "Obtener datos › Web".
 * 3. NINGÚN dato de contacto de competidores (teléfono, email) en la salida.
 */

import * as db from '../../../../../lib/db/supabase.js';
import { REGLAS } from '../../../../../lib/core/rubric.js';

export const dynamic = 'force-dynamic';

function escapeCSV(val) {
  if (val == null) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export async function GET(req, { params }) {
  const p = await params;
  const id = p?.id;
  const url = new URL(req.url);
  const format = url.searchParams.get('format') || 'csv';

  if (!id) {
    return new Response(JSON.stringify({ error: 'Falta identificador de barrido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const completo = await db.obtenerBarridoCompleto(id).catch(() => null);

  if (!completo || !completo.barrido) {
    return new Response(JSON.stringify({ error: 'Barrido no encontrado' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { barrido, competidores = [], reglas = [] } = completo;

  // Mapa de reglas por ID para enriquecer el CSV con titulo, dimensión y peso
  const mapaReglasDef = new Map(REGLAS.map(r => [r.id, r]));

  // Mapa de competidores por place_id para cruzar datos sin incluir datos de contacto (email/telefono)
  const mapaComp = new Map();
  for (const c of competidores) {
    mapaComp.set(c.place_id, {
      nombre: c.nombre,
      distancia_m: c.distancia_m,
      anillo: c.anillo,
      origen_dato: c.origen_dato,
      score: c.score,
    });
  }

  const origenComp = mapaComp.get(barrido.origen_place_id);
  const origenNombre = barrido.origen_nombre || origenComp?.nombre || 'Origen';

  // Armar lista plana de filas par (competidor - regla)
  const filas = reglas.map(r => {
    const comp = mapaComp.get(r.place_id) || {};
    const def = mapaReglasDef.get(r.regla_id) || {};
    return {
      barrido_id: barrido.id,
      fecha: barrido.fecha,
      origen_place_id: barrido.origen_place_id,
      origen_nombre: origenNombre,
      place_id: r.place_id,
      nombre_competidor: comp.nombre || 'Desconocido',
      distancia_m: comp.distancia_m ?? 0,
      anillo: comp.anillo || 'amplio',
      regla_id: r.regla_id,
      nombre_regla: def.titulo || r.regla_id,
      dimension: def.dimension || 'general',
      peso: def.peso ?? 0,
      estado: r.estado,
      ratio: r.ratio,
      puntos: r.puntos,
    };
  });

  if (format === 'json' || req.headers.get('accept')?.includes('application/json')) {
    return new Response(JSON.stringify({ barrido, filas }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  // Formato CSV UTF-8 CON BOM (\uFEFF)
  const cabeceras = [
    'barrido_id', 'fecha', 'origen_place_id', 'origen_nombre',
    'place_id', 'nombre_competidor', 'distancia_m', 'anillo',
    'regla_id', 'nombre_regla', 'dimension', 'peso',
    'estado', 'ratio', 'puntos',
  ];

  const lineasCSV = [
    cabeceras.map(escapeCSV).join(','),
    ...filas.map(f => [
      escapeCSV(f.barrido_id),
      escapeCSV(f.fecha),
      escapeCSV(f.origen_place_id),
      escapeCSV(f.origen_nombre),
      escapeCSV(f.place_id),
      escapeCSV(f.nombre_competidor),
      f.distancia_m,
      escapeCSV(f.anillo),
      escapeCSV(f.regla_id),
      escapeCSV(f.nombre_regla),
      escapeCSV(f.dimension),
      f.peso,
      escapeCSV(f.estado),
      f.ratio ?? '',
      f.puntos ?? '',
    ].join(',')),
  ];

  // Prefijo BOM UTF-8 (\uFEFF) para compatibilidad con Excel / Power BI en español
  const csvConBOM = '\uFEFF' + lineasCSV.join('\r\n');

  return new Response(csvConBOM, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="barrido_${id}_reglas.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
