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
  let llamadasAhorradas = 0;

  // 1. CAPA 1: CORPUS PROPIO — Revisar si el origen ya está en el corpus
  let origenPerfil;
  let auditoriaOrigen;
  let origenEnCorpus = null;

  if (db && typeof db.buscarEnCorpus === 'function') {
    origenEnCorpus = await db.buscarEnCorpus(origenPlaceId).catch(() => null);
  }

  let origenRaw;
  if (origenEnCorpus) {
    auditoriaOrigen = origenEnCorpus;
    origenPerfil = {
      nombre: auditoriaOrigen.nombre || 'Origen',
      zona: auditoriaOrigen.zona || '',
      categoriaPrimariaLabel: auditoriaOrigen.categoriaPrimariaLabel,
      categoriaPrimaria: auditoriaOrigen.categoriaPrimaria,
      latitud: auditoriaOrigen.latitud,
      longitud: auditoriaOrigen.longitud,
    };
    llamadasAhorradas++;
  } else {
    try {
      origenRaw = await detallePlace(origenPlaceId, { conResenas: true });
    } catch (e) {
      throw new Error(`No se pudo obtener el detalle del origen (${origenPlaceId}): ${e.message}`);
    }
    origenPerfil = desdePlacesApi(origenRaw);
    auditoriaOrigen = auditar(origenPerfil);
  }

  const lat = origenRaw?.location?.latitude ?? auditoriaOrigen.latitud ?? origenPerfil.latitud ?? 0;
  const lng = origenRaw?.location?.longitude ?? auditoriaOrigen.longitud ?? origenPerfil.longitud ?? 0;
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
          origenDato: c.origen_dato || 'busqueda',
          auditoria: c.auditado_json,
        }));

        const comparacionCache = compararPorRegla(auditoriaOrigen, competidoresCheados);

        return {
          cache: true,
          barridoId: reciente.id,
          fechaRelevamiento: reciente.fecha,
          origen: { placeId: origenPlaceId, nombre: origenPerfil.nombre, score: auditoriaOrigen.score, celda },
          llamadasGastadas: 0,
          llamadasAhorradas: completo.competidores.length,
          costoUSD: 0,
          comparacion: comparacionCache,
        };
      }
    }
  }

  // 4. CAPA 2: BÚSQUEDA — Relevamiento por Búsqueda Ampliada (Text Search Pro)
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

  // 5. CAPA 3: DETALLE & CORPUS — Asignar los Dos Anillos
  let llamadasDetail = 0;
  const competidoresAuditados = [];

  for (let i = 0; i < candidatos.length; i++) {
    const cand = candidatos[i];
    const esCercano = i < 5;
    const anillo = esCercano ? 'cercano' : 'amplio';

    let auditRes;
    let origenDato;
    let perfilNormalizado;

    if (esCercano) {
      // Revisa si ya está en el corpus antes de pedir detalle a la API
      let auditEnCorpus = null;
      if (db && typeof db.buscarEnCorpus === 'function') {
        auditEnCorpus = await db.buscarEnCorpus(cand.id).catch(() => null);
      }

      if (auditEnCorpus) {
        // Capa 1: CORPUS PROPIO (0 llamadas API)
        auditRes = auditEnCorpus;
        origenDato = 'corpus';
        llamadasAhorradas++;
        perfilNormalizado = desdePlacesApi(cand.raw);
      } else {
        // Capa 3: DETALLE (1 llamada Place Details Pro)
        llamadasDetail++;
        origenDato = 'detalle';
        const detailRaw = await detallePlace(cand.id, { conResenas: true });
        perfilNormalizado = desdePlacesApi(detailRaw);
        auditRes = auditar(perfilNormalizado);
      }
    } else {
      // Capa 2: BÚSQUEDA (0 llamadas de detalle)
      origenDato = 'busqueda';
      perfilNormalizado = desdePlacesApi(cand.raw);
      auditRes = auditar(perfilNormalizado);
    }

    competidoresAuditados.push({
      placeId: cand.id,
      nombre: cand.nombre,
      distanciaMetros: cand.distanciaMetros,
      anillo,
      origenDato,
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
      llamadas_ahorradas: llamadasAhorradas,
      costo_usd: costoUSD,
    };

    const registroCompetidores = competidoresAuditados.map(c => ({
      id: `${barridoId}_${c.placeId}`,
      barrido_id: barridoId,
      place_id: c.placeId,
      nombre: c.nombre,
      distancia_m: c.distanciaMetros,
      anillo: c.anillo,
      origen_dato: c.origenDato,
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
    llamadasAhorradas,
    costoUSD,
    comparacion,
  };
}

/**
 * Muestra ligera del barrido para el informe de auditoría ("Y cómo estás frente a tu cuadra").
 * 
 * Reglas innegociables:
 * - 1 sola llamada a Places API Search (sin paginar, sin llamadas a detalle)
 * - Si hay caché < 30 días en la celda (~1 km) y categoría, gasta 0 llamadas.
 * - Compuerta de presupuesto y config ('muestra_barrido_activa'). Si se supera, retorna null.
 * - Sin palabra "posición" ni puesto en el grupo. Sin promedios ni competidores nombrados.
 * - Si hay < 8 competidores en 4 km, emite el aviso de zona poco competida.
 */
export async function obtenerMuestraBarrido({
  placeId = null,
  lat = null,
  lng = null,
  categoria = 'comercio local',
  ciudad = '',
  perfil = null,
  fuenteDatos = null,
} = {}) {
  const db = fuenteDatos;

  // 1. Compuertas: config y presupuesto
  if (db && typeof db.config === 'function') {
    const activa = await db.config('muestra_barrido_activa', true).catch(() => true);
    if (!activa) return null;
  }

  if (db && typeof db.gastoDelMes === 'function' && typeof db.config === 'function') {
    const [gastoActual, maxPresupuesto] = await Promise.all([
      db.gastoDelMes().catch(() => 0),
      db.config('presupuesto_api_mes_usd', 40).then(Number).catch(() => 40),
    ]);
    const costoEstimado = 0.032; // 1 llamada de Text Search Pro
    if (gastoActual + costoEstimado > maxPresupuesto) {
      return null;
    }
  }

  if (lat == null || lng == null) {
    return null; // Sin coordenadas no se puede delimitar el radio de 4 km
  }

  const celda = generarCeldaGeo(lat, lng);
  const radioMetros = 4000;
  let competidoresRaw = [];
  let llamadasGastadas = 0;
  let cache = false;

  // 2. Verificación de Caché (< 30 días)
  if (db && typeof db.obtenerBarridoReciente === 'function') {
    const reciente = await db.obtenerBarridoReciente(celda, categoria).catch(() => null);
    if (reciente && typeof db.obtenerBarridoCompleto === 'function') {
      const completo = await db.obtenerBarridoCompleto(reciente.id).catch(() => null);
      if (completo && completo.competidores && completo.competidores.length > 0) {
        competidoresRaw = completo.competidores.map(c => ({
          id: c.place_id,
          websiteUri: c.auditado_json?.perfil?.sitioWeb || c.perfil?.sitioWeb || null,
          userRatingCount: c.auditado_json?.perfil?.cantidadResenas ?? c.perfil?.cantidadResenas ?? 0,
        }));
        cache = true;
        llamadasGastadas = 0;
      }
    }
  }

  // 3. Búsqueda ligera si no había en caché (1 sola llamada API, max 20, ampliado: true)
  if (!cache) {
    const consulta = `${categoria} ${ciudad}`.trim();
    try {
      const resSearch = await buscarNegocios({
        consulta,
        lat,
        lng,
        radioMetros,
        max: 20,
        locationRestriction: true,
        ampliado: true,
      });
      llamadasGastadas = 1;
      competidoresRaw = (resSearch || [])
        .filter(p => p.id && p.id !== placeId)
        .map(p => ({
          id: p.id,
          websiteUri: p.websiteUri || null,
          userRatingCount: p.userRatingCount || 0,
        }));
    } catch {
      return null;
    }
  }

  const total = competidoresRaw.length;
  if (total === 0) return null;

  // 4. Si hay menos de 8 competidores en 4 km: aviso de zona poco competida
  if (total < 8) {
    return {
      total,
      categoria,
      pocoCompetida: true,
      llamadasGastadas,
      cache,
      hechos: [],
    };
  }

  // 5. Evaluar 2 hechos cuantitativos sobre los campos de la búsqueda
  const conSitio = competidoresRaw.filter(c => Boolean(c.websiteUri)).length;
  const tieneSitioPropio = Boolean(perfil?.sitioWeb);
  const hechoSitio = `${conSitio} de ${total} declaran sitio web. Vos ${tieneSitioPropio ? 'también' : 'no'}.`;

  const umbralResenas = 40;
  const conMuchasResenas = competidoresRaw.filter(c => (c.userRatingCount || 0) > umbralResenas).length;
  const resenasPropio = perfil?.cantidadResenas ?? 0;
  const hechoResenas = `${conMuchasResenas} de ${total} tienen más de ${umbralResenas} reseñas. Vos tenés ${resenasPropio}.`;

  return {
    total,
    categoria,
    pocoCompetida: false,
    llamadasGastadas,
    cache,
    hechos: [hechoSitio, hechoResenas],
  };
}

