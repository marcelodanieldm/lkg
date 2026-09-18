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

  // Mapa de competidores por place_id para cruzar datos sin incluir datos de contacto
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

  // Armar lista plana de filas par (competidor - regla)
  const filas = reglas.map(r => {
    const comp = mapaComp.get(r.place_id) || {};
    return {
      barrido_id: barrido.id,
      origen_place_id: barrido.origen_place_id,
      celda: barrido.celda,
      categoria: barrido.categoria,
      fecha: barrido.fecha,
      place_id: r.place_id,
      nombre_competidor: comp.nombre || 'Desconocido',
      distancia_m: comp.distancia_m ?? 0,
      anillo: comp.anillo || 'amplio',
      origen_dato: comp.origen_dato || 'busqueda',
      score_competidor: comp.score ?? null,
      regla_id: r.regla_id,
      estado_regla: r.estado,
      ratio: r.ratio,
      puntos: r.puntos,
    };
  });

  if (format === 'json') {
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
    'barrido_id', 'origen_place_id', 'celda', 'categoria', 'fecha',
    'place_id', 'nombre_competidor', 'distancia_m', 'anillo', 'origen_dato',
    'score_competidor', 'regla_id', 'estado_regla', 'ratio', 'puntos',
  ];

  const lineasCSV = [
    cabeceras.map(escapeCSV).join(','),
    ...filas.map(f => [
      escapeCSV(f.barrido_id),
      escapeCSV(f.origen_place_id),
      escapeCSV(f.celda),
      escapeCSV(f.categoria),
      escapeCSV(f.fecha),
      escapeCSV(f.place_id),
      escapeCSV(f.nombre_competidor),
      f.distancia_m,
      escapeCSV(f.anillo),
      escapeCSV(f.origen_dato),
      f.score_competidor ?? '',
      escapeCSV(f.regla_id),
      escapeCSV(f.estado_regla),
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
