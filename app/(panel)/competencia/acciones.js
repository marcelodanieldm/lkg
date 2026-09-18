'use server';

/**
 * app/(panel)/competencia/acciones.js — Server Actions para el módulo de Competencia.
 */

import * as db from '../../../lib/db/supabase.js';
import { ejecutarBarrido } from '../../../lib/integrations/barrido-engine.js';
import { detallePlace } from '../../../lib/integrations/places.js';
import { desdePlacesApi } from '../../../lib/core/normalize.js';
import { generarCeldaGeo } from '../../../lib/core/competencia.js';

/**
 * Pre-flight: Estima las llamadas API, costo en USD y verificación de corpus/caché
 * ANTES de ejecutar el barrido real.
 */
export async function estimarBarridoAction(placeId, radioMetros = 4000) {
  if (!placeId || typeof placeId !== 'string') {
    throw new Error('Debe especificar un Place ID válido');
  }

  // 1. Obtener datos mínimos del origen
  let origenRaw;
  try {
    origenRaw = await detallePlace(placeId, { conResenas: false });
  } catch (e) {
    throw new Error(`No se pudo verificar el Place ID (${placeId}): ${e.message}`);
  }

  const origenPerfil = desdePlacesApi(origenRaw);
  const lat = origenRaw.location?.latitude || 0;
  const lng = origenRaw.location?.longitude || 0;
  const celda = generarCeldaGeo(lat, lng);
  const categoria = origenPerfil.categoriaPrimariaLabel || origenPerfil.categoriaPrimaria || 'general';

  // 2. Verificación de Caché de 30 días
  const reciente = await db.obtenerBarridoReciente(celda, categoria).catch(() => null);
  const tieneCache = !!reciente;

  // 3. Estimación de consumo
  // Búsqueda (1 a 2 llamadas Text Search Pro)
  const estimacionSearch = 2;
  // Detalle (máximo 5 vecinos del Anillo Cercano)
  const estimacionDetail = 5;

  const costoSearchUSD = estimacionSearch * 0.032;
  const costoDetailUSD = estimacionDetail * 0.025;
  const estimacionCostoUSD = +(costoSearchUSD + costoDetailUSD).toFixed(3);

  // 4. Consultar consumo del mes actual vs tope
  const [gastoActual, maxPresupuesto] = await Promise.all([
    db.gastoDelMes().catch(() => 0),
    db.config('presupuesto_api_mes_usd', 40).then(Number).catch(() => 40),
  ]);

  return {
    placeId,
    nombre: origenPerfil.nombre,
    ciudad: origenPerfil.zona,
    celda,
    categoria,
    tieneCache,
    barridoCacheId: reciente?.id || null,
    fechaCache: reciente?.fecha || null,
    estimacion: {
      llamadasSearch: estimacionSearch,
      llamadasDetail: estimacionDetail,
      llamadasTotal: estimacionSearch + estimacionDetail,
      costoUSD: estimacionCostoUSD,
      gastoActualUSD: gastoActual,
      presupuestoMaxUSD: maxPresupuesto,
      superaPresupuesto: gastoActual + estimacionCostoUSD > maxPresupuesto,
    },
  };
}

/**
 * Ejecuta el barrido real (o recupera de caché) mediante la arquitectura de 3 capas.
 */
export async function ejecutarBarridoAction(placeId, { radioMetros = 4000, forzarRefresco = false } = {}) {
  const res = await ejecutarBarrido(placeId, {
    radioMetros,
    forzarRefresco,
    fuenteDatos: db,
  });
  return res;
}

/**
 * Obtiene la lista de competidores de un barrido con sus estados de supresión y leads existentes.
 */
export async function obtenerEstadoProspeccionCompetidoresAction(barridoId) {
  const completo = await db.obtenerBarridoCompleto(barridoId);
  if (!completo || !completo.competidores) return [];

  // Traer leads y supresiones existentes para comparar
  const [leads, supresiones] = await Promise.all([
    db.rest('leads?select=place_id,email').catch(() => []),
    db.rest('supresiones?select=email').catch(() => []),
  ]);

  const setLeads = new Set((leads || []).map(l => l.place_id).filter(Boolean));
  const setSupresiones = new Set((supresiones || []).map(s => s.email?.toLowerCase()).filter(Boolean));

  return completo.competidores.map(c => {
    const yaEsLead = setLeads.has(c.place_id);
    return {
      placeId: c.place_id,
      nombre: c.nombre,
      distanciaMetros: c.distancia_m,
      anillo: c.anillo,
      score: c.score,
      yaEsLead,
      enSupresion: false, // Los competidores no tienen email público hasta ser prospectados
      disponible: !yaEsLead,
    };
  });
}

/**
 * Encola MANUALMENTE y de forma explícita los competidores tildados a la cola de solicitudes.
 * NUNCA AUTOMÁTICO: sólo procesa el array de placeIds seleccionados por el usuario.
 */
export async function encolarCompetidoresSeleccionadosAction(seleccionados = []) {
  if (!Array.isArray(seleccionados) || seleccionados.length === 0) {
    throw new Error('Debe seleccionar al menos un competidor para agregar a la cola.');
  }

  let agregados = 0;
  for (const item of seleccionados) {
    if (!item.placeId || !item.nombre) continue;

    // Se agrega a solicitudes (no a leads directo, manteniendo la invariante)
    await db.pedirAuditoria({
      negocio: item.nombre,
      email: item.email || `${item.placeId}@prospeccion.local`,
      ciudad: item.ciudad || null,
      telefono: item.telefono || null,
      mensaje: `Origen: Barrido de competidores (Manual por Operador)`,
      placeId: item.placeId,
    }).catch(() => {});
    agregados++;
  }

  return { agregados };
}
