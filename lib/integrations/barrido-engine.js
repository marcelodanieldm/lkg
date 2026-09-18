/**
 * barrido-engine.js — Orquestador del Barrido de Competidores por Cercanía (Bajo Costo).
 *
 * Arquitectura de Dos Anillos & Caché Geográfico:
 *   1. Anillo Cercano (Top 5 más próximos): Llama a detallePlace con reseñas.
 *   2. Anillo Amplio (puestos 6º al 40º): 0 llamadas de detalle, audita sobre búsqueda.
 *   3. Caché de 30 días agrupado por celda geográfica (~1 km) y categoría.
 *   4. Control previo de presupuesto mensual para no exceder cuotas.
 *   5. INNEGOCIABLE: Un competidor en un barrido NUNCA se escribe como lead.
 */

import { buscarNegocios, detallePlace } from './places.js';
import { desdePlacesApi } from '../core/normalize.js';
import { auditar } from '../core/audit-engine.js';
import { calcularDistancia, generarCeldaGeo, compararPorRegla } from '../core/competencia.js';

export async function ejecutarBarrido(origenPlaceId, {
  radioMetros = 4000,
  maxTotal = 40,
  forzarRefresco = false,
  fuenteDatos = null,
} = {}) {
  const db = fuenteDatos;

  // 1. Obtener perfil del negocio origen
  let origenRaw;
  try {
    origenRaw = await detallePlace(origenPlaceId, { conResenas: true });
  } catch (e) {
    throw new Error(`No se pudo obtener el detalle del origen (${origenPlaceId}): ${e.message}`);
  }

  const origenPerfil = desdePlacesApi(origenRaw);
  const auditoriaOrigen = auditar(origenPerfil);

  const lat = origenRaw.location?.latitude;
  const lng = origenRaw.location?.longitude;
  const categoria = origenPerfil.categoriaPrimariaLabel || origenPerfil.categoriaPrimaria || 'general';
  const ciudad = origenPerfil.zona || '';

  const celda = generarCeldaGeo(lat, lng);

  // 2. Control previo de presupuesto mensual
  if (db && typeof db.gastoDelMes === 'function' && typeof db.config === 'function') {
    const [gastoActual, maxPresupuesto] = await Promise.all([
      db.gastoDelMes().catch(() => 0),
      db.config('presupuesto_api_mes_usd', 40).then(Number).catch(() => 40),
    ]);

    const costoEstimadoMax = 0.19; // 2 búsquedas text ($0.064) + 5 detalles ($0.125)
    if (gastoActual + costoEstimadoMax > maxPresupuesto) {
      return {
        cancelado: true,
        motivo: 'presupuesto_excedido',
        gastoActualUSD: gastoActual,
        presupuestoUSD: maxPresupuesto,
        costoEstimadoUSD: costoEstimadoMax,
      };
    }
  }

  // 3. Verificación de Caché (< 30 días en la misma celda y categoría)
  if (!forzarRefresco && db && typeof db.obtenerBarridoReciente === 'function') {
    const reciente = await db.obtenerBarridoReciente(celda, categoria).catch(() => null);
    if (reciente && typeof db.obtenerBarridoCompleto === 'function') {
      const completo = await db.obtenerBarridoCompleto(reciente.id).catch(() => null);
      if (completo && completo.competidores && completo.competidores.length > 0) {
        const competidoresCheados = completo.competidores.map(c => ({
          placeId: c.place_id,
          nombre: c.nombre,
          distanciaMetros: c.distancia_m,
          anillo: c.anillo,
          auditoria: c.auditado_json,
        }));

        const comparacionCache = compararPorRegla(auditoriaOrigen, competidoresCheados);

        return {
          cache: true,
          barridoId: reciente.id,
          fechaRelevamiento: reciente.fecha,
          origen: { placeId: origenPlaceId, nombre: origenPerfil.nombre, score: auditoriaOrigen.score, celda },
          llamadasGastadas: 0,
          costoUSD: 0,
          comparacion: comparacionCache,
        };
      }
    }
  }

  // 4. Ejecución del Barrido con Búsqueda Ampliada
  const consulta = `${categoria} ${ciudad}`.trim();
  let llamadasSearch = 0;
  let paginasEncontradas = [];

  // Primera página (máximo 20)
  llamadasSearch++;
  const resPage1 = await buscarNegocios({
    consulta,
    lat,
    lng,
    radioMetros,
    max: 20,
    locationRestriction: true,
    ampliado: true,
  });
  paginasEncontradas.push(...resPage1);

  // Segunda página si hay nextPageToken y necesitamos más hasta maxTotal (40)
  if (resPage1.nextPageToken && paginasEncontradas.length < maxTotal) {
    llamadasSearch++;
    const resPage2 = await buscarNegocios({
      consulta,
      lat,
      lng,
      radioMetros,
      max: 20,
      locationRestriction: true,
      ampliado: true,
      pageToken: resPage1.nextPageToken,
    });
    paginasEncontradas.push(...resPage2);
  }

  // Filtrar el propio origen y calcular distancias reales
  const candidatos = paginasEncontradas
    .filter(p => p.id && p.id !== origenPlaceId)
    .map(p => {
      const d = calcularDistancia(lat, lng, p.location?.latitude, p.location?.longitude);
      return { raw: p, id: p.id, nombre: p.displayName?.text || p.name, distanciaMetros: d };
    })
    .sort((a, b) => a.distanciaMetros - b.distanciaMetros)
    .slice(0, maxTotal);

  // 5. Asignar los Dos Anillos (Top 5 Cercano, Restantes Amplio)
  let llamadasDetail = 0;
  const competidoresAuditados = [];

  for (let i = 0; i < candidatos.length; i++) {
    const cand = candidatos[i];
    const esCercano = i < 5;
    const anillo = esCercano ? 'cercano' : 'amplio';

    let perfilNormalizado;
    if (esCercano) {
      // Anillo CERCANO: Llama a detallePlace con reseñas
      llamadasDetail++;
      const detailRaw = await detallePlace(cand.id, { conResenas: true });
      perfilNormalizado = desdePlacesApi(detailRaw);
    } else {
      // Anillo AMPLIO: 0 llamadas de detalle, audita sobre el resultado de búsqueda
      perfilNormalizado = desdePlacesApi(cand.raw);
    }

    const auditRes = auditar(perfilNormalizado);

    competidoresAuditados.push({
      placeId: cand.id,
      nombre: cand.nombre,
      distanciaMetros: cand.distanciaMetros,
      anillo,
      auditoria: auditRes,
      perfil: perfilNormalizado,
    });
  }

  const llamadasGastadas = llamadasSearch + llamadasDetail;
  const costoUSD = +((llamadasSearch * 0.032) + (llamadasDetail * 0.025)).toFixed(4);
  const barridoId = `barr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const fechaNow = new Date().toISOString();

  const comparacion = compararPorRegla(auditoriaOrigen, competidoresAuditados);

  // 6. Persistir en Supabase (SIEMPRE en tablas barridos, NUNCA en leads)
  if (db && typeof db.guardarBarrido === 'function') {
    const registroBarrido = {
      id: barridoId,
      origen_place_id: origenPlaceId,
      celda,
      categoria,
      radio_m: radioMetros,
      fecha: fechaNow,
      encontrados: paginasEncontradas.length,
      auditados: competidoresAuditados.length,
      llamadas_gastadas: llamadasGastadas,
      costo_usd: costoUSD,
    };

    const registroCompetidores = competidoresAuditados.map(c => ({
      id: `${barridoId}_${c.placeId}`,
      barrido_id: barridoId,
      place_id: c.placeId,
      nombre: c.nombre,
      distancia_m: c.distanciaMetros,
      anillo: c.anillo,
      score: c.auditoria.score,
      auditado_json: c.auditoria,
    }));

    const registroReglas = [];
    for (const comp of competidoresAuditados) {
      for (const h of comp.auditoria.hallazgos || []) {
        registroReglas.push({
          id: `${barridoId}_${comp.placeId}_${h.id}`,
          barrido_id: barridoId,
          place_id: comp.placeId,
          regla_id: h.id,
          estado: h.puntos > 0 ? 'ok' : 'fallo',
          ratio: comp.auditoria.score,
          puntos: h.puntos,
        });
      }
    }

    await db.guardarBarrido({
      barrido: registroBarrido,
      competidores: registroCompetidores,
      reglas: registroReglas,
    }).catch(() => {});
  }

  return {
    cache: false,
    barridoId,
    fechaRelevamiento: fechaNow,
    origen: { placeId: origenPlaceId, nombre: origenPerfil.nombre, score: auditoriaOrigen.score, celda },
    llamadasGastadas,
    costoUSD,
    comparacion,
  };
}
