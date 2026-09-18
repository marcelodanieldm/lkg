/**
 * competencia.js — Comparación determinista por regla entre perfiles auditados.
 *
 * Principio rector:
 *   NUNCA comparar puntaje crudo contra puntaje crudo. Cada perfil se mide sobre
 *   su propio subconjunto de reglas evaluadas (excluyendo lo que la API no expone,
 *   que queda en 'nd'). Comparar scores globales donde uno evaluó 15 reglas y otro 25
 *   arruinaría ambas mediciones.
 *
 * Estructura de dos anillos:
 *   - CERCANO: Top 5 más próximos por distancia real haversine (con llamadas de detalle y reseñas).
 *   - AMPLIO: Puestos 6º al 40º dentro de 4 km (sin llamadas de detalle, evaluado sobre búsqueda).
 */

import { REGLAS } from './rubric.js';

/** Distancia real sobre la superficie terrestre (fórmula Haversine en metros). */
export function calcularDistancia(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/** Redondeo geográfico a celda de ~1 km (lat/lng a 2 decimales). */
export function generarCeldaGeo(lat, lng) {
  if (lat == null || lng == null) return '0.00,0.00';
  return `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
}

/**
 * Compara el perfil propio contra un arreglo de competidores.
 * Devuelve los dos anillos SEPARADOS y la comparación regla por regla.
 */
export function compararPorRegla(auditoriaPropia, competidores = []) {
  if (!auditoriaPropia || !Array.isArray(competidores)) {
    return { baseSuficiente: false, razon: 'Datos insuficientes para la comparación' };
  }

  // Separar los dos anillos
  const cercano = competidores.filter(c => c.anillo === 'cercano');
  const amplio = competidores.filter(c => c.anillo === 'amplio');

  // Posicionamiento global por score (sólo entre perfiles donde se calculó score)
  const conScore = [
    { placeId: auditoriaPropia.meta?.placeId || 'propio', score: auditoriaPropia.score, esPropio: true },
    ...competidores.filter(c => c.auditoria?.score != null).map(c => ({ placeId: c.placeId, score: c.auditoria.score, esPropio: false })),
  ].sort((a, b) => b.score - a.score);

  const posicionGlobal = conScore.findIndex(c => c.esPropio) + 1;

  // Analizar comparación regla por regla
  const analisisReglas = [];
  let reglasComunesEvaluadas = 0;

  for (const reglaDef of REGLAS) {
    const idRegla = reglaDef.id;

    // Estado propio
    const hallazgoPropio = auditoriaPropia.hallazgos?.find(h => h.id === idRegla);
    const estadoPropio = hallazgoPropio ? (hallazgoPropio.puntos > 0 ? 'ok' : 'fallo') : 'nd';

    // Estados en competidores (tanto cercano como amplio)
    const evaluadosCompetencia = [];
    for (const comp of competidores) {
      const hComp = comp.auditoria?.hallazgos?.find(h => h.id === idRegla);
      if (hComp) {
        evaluadosCompetencia.push({
          placeId: comp.placeId,
          nombre: comp.nombre,
          anillo: comp.anillo,
          estado: hComp.puntos > 0 ? 'ok' : 'fallo',
          puntos: hComp.puntos,
        });
      }
    }

    const totalEvaluadosComp = evaluadosCompetencia.length;
    const cumplenComp = evaluadosCompetencia.filter(c => c.estado === 'ok').length;
    const ratioCumplimiento = totalEvaluadosComp > 0 ? Math.round((cumplenComp / totalEvaluadosComp) * 100) : null;

    if (estadoPropio !== 'nd' && totalEvaluadosComp > 0) {
      reglasComunesEvaluadas++;
    }

    analisisReglas.push({
      id: idRegla,
      nombre: reglaDef.titulo || idRegla,
      dimension: reglaDef.dimension,
      peso: reglaDef.peso,
      estadoPropio,
      evaluadosCompetencia: totalEvaluadosComp,
      cumplenCompetencia: cumplenComp,
      ratioCumplimientoCompetencia: ratioCumplimiento,
    });
  }

  const baseSuficiente = competidores.length >= 5 && reglasComunesEvaluadas >= 10;
  const resumenObj = {
    totalCompetidores: competidores.length,
    cercanos: cercano.length,
    amplios: amplio.length,
    posicionGlobal,
    totalEnTabla: conScore.length,
    scorePropio: auditoriaPropia.score,
    reglasComunesEvaluadas,
  };

  const parrafos = baseSuficiente
    ? generarParrafosAnalisis(auditoriaPropia, competidores, analisisReglas, resumenObj, conScore)
    : { parrafo1: '', parrafo2: '' };

  return {
    baseSuficiente,
    razon: baseSuficiente ? null : `Base de comparación insuficiente: ${competidores.length} competidores (mínimo 5) y ${reglasComunesEvaluadas} reglas comunes evaluables (mínimo 10). Poca competencia en la zona es en sí un hallazgo.`,
    resumen: resumenObj,
    parrafos,
    anilloCercano: {
      total: cercano.length,
      competidores: cercano.map(c => ({
        placeId: c.placeId,
        nombre: c.nombre,
        distanciaMetros: c.distanciaMetros,
        score: c.auditoria?.score ?? null,
        auditoria: c.auditoria,
      })),
    },
    anilloAmplio: {
      total: amplio.length,
      competidores: amplio.map(c => ({
        placeId: c.placeId,
        nombre: c.nombre,
        distanciaMetros: c.distanciaMetros,
        score: c.auditoria?.score ?? null,
        auditoria: c.auditoria,
      })),
    },
    comparacionReglas: analisisReglas,
  };
}

export function generarParrafosAnalisis(auditoriaPropia, competidores, analisisReglas, resumen, conScore = []) {
  const { totalEnTabla, posicionGlobal, scorePropio } = resumen;
  const cercanos = competidores.filter(c => c.anillo === 'cercano');

  const conScoreCercanos = [
    { placeId: 'propio', score: scorePropio, esPropio: true },
    ...cercanos.filter(c => c.auditoria?.score != null).map(c => ({ placeId: c.placeId, score: c.auditoria.score, esPropio: false }))
  ].sort((a, b) => b.score - a.score);

  const posicionCercana = conScoreCercanos.findIndex(c => c.esPropio) + 1;
  const cercanosPorDelante = posicionCercana - 1;

  // Evaluar si la diferencia es de reputación o de perfil
  const ratingPropio = auditoriaPropia.rating || 0;
  const resenasPropias = auditoriaPropia.cantidadResenas || 0;

  let textoReputacion = 'y la diferencia no es de reputación —la calificación y reseñas acompañan—, está en cómo se muestra el perfil.';
  if (ratingPropio < 4.2 || resenasPropias < 15) {
    textoReputacion = 'y se combinan factores de reputación y presentación del perfil.';
  }

  let p1Text = '';
  if (posicionCercana > 1) {
    p1Text = `Entre los ${totalEnTabla} locales que Google muestra en 4 km estás ${posicionGlobal}º. Pero la comparación que decide es más chica: de los 5 locales más cercanos al tuyo, ${cercanosPorDelante} están por delante. ${textoReputacion}`;
  } else {
    p1Text = `Entre los ${totalEnTabla} locales que Google muestra en 4 km estás ${posicionGlobal}º. En tu anillo más cercano de 5 vecinos liderás la posición, mostrando una base sólida frente a tus competidores inmediatos.`;
  }

  // Párrafo 2: Qué mueve la aguja y posición recalculada
  const fallosPropio = analisisReglas
    .filter(r => r.estadoPropio !== 'ok' && r.cumplenCompetencia > 0)
    .sort((a, b) => b.peso - a.peso);

  const top3Fallos = fallosPropio.slice(0, 3);
  const puntosRecuperables = top3Fallos.reduce((sum, r) => sum + (r.peso || 0), 0);
  const scoreProyectado = Math.min(100, scorePropio + puntosRecuperables);

  // Recalcular posición dentro del grupo
  const posicionProyectada = conScore.filter(c => !c.esPropio && c.score > scoreProyectado).length + 1;

  let p2Text = '';
  if (top3Fallos.length > 0) {
    p2Text = `La brecha está concentrada en las reglas de mayor peso. Aplicando la misma grilla, resueltos esos puntos el puntaje pasaría de ${scorePropio} a ${scoreProyectado} y quedarías ${posicionProyectada}º de este grupo en vez de ${posicionGlobal}º. Es una posición dentro de esta comparación; en Google nadie puede prometerte un puesto, y este informe tampoco lo hace.`;
  } else {
    p2Text = `Tu perfil se encuentra en un nivel óptimo dentro de las reglas evaluadas. Mantener la frescura de fotos y el ritmo de respuestas asegurará consolidar tu puesto actual. Es una posición dentro de esta comparación; en Google nadie puede prometerte un puesto, y este informe tampoco lo hace.`;
  }

  return {
    parrafo1: p1Text.trim(),
    parrafo2: p2Text.trim()
  };
}

