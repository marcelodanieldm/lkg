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

  const categoria = auditoriaPropia.meta?.categoria || auditoriaPropia.categoriaPrimariaLabel || auditoriaPropia.categoria || 'negocios';
  const totalGrupo = competidores.length;

  const huecoMercado = baseSuficiente ? calcularHuecoMercado(auditoriaPropia, competidores, analisisReglas, totalGrupo, categoria) : null;
  const liderYReceta = baseSuficiente ? calcularLiderYReceta(auditoriaPropia, competidores, analisisReglas, conScore, totalGrupo) : null;
  const umbralEntrada = baseSuficiente ? calcularUmbralEntrada(auditoriaPropia, competidores, analisisReglas, conScore, totalGrupo) : null;

  const parrafos = baseSuficiente
    ? generarParrafosAnalisis(auditoriaPropia, competidores, analisisReglas, resumenObj, conScore)
    : { parrafo1: '', parrafo2: '' };

  return {
    baseSuficiente,
    razon: baseSuficiente ? null : `Base de comparación insuficiente: ${competidores.length} competidores (mínimo 5) y ${reglasComunesEvaluadas} reglas comunes evaluables (mínimo 10). Poca competencia en la zona es en sí un hallazgo.`,
    resumen: resumenObj,
    parrafos,
    huecoMercado,
    liderYReceta,
    umbralEntrada,
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

/**
 * 1. EL HUECO DEL MERCADO — lo que casi nadie hace.
 * Reglas que cumple menos del 20% del grupo, con cobertura de evaluación >= 70%.
 */
export function calcularHuecoMercado(auditoriaPropia, competidores, analisisReglas, totalGrupo, categoria = 'negocios') {
  if (!totalGrupo || totalGrupo < 10) return null;

  const catNom = (categoria || 'negocios').toLowerCase();
  const pluralCat = catNom.endsWith('s') ? catNom : (/[aeiouáéíóú]$/i.test(catNom) ? `${catNom}s` : `${catNom}es`);

  const candidatos = [];

  for (const r of analisisReglas) {
    const evaluados = r.evaluadosCompetencia || 0;
    if (evaluados === 0) continue;

    // Test: un hueco no se publica si la regla no estaba evaluada en al menos el 70 % del grupo
    if ((evaluados / totalGrupo) < 0.70) continue;

    const cumplen = r.cumplenCompetencia || 0;
    const ratioCumplimiento = cumplen / evaluados;

    // Cumple menos del 20% del grupo
    if (ratioCumplimiento < 0.20) {
      candidatos.push({
        id: r.id,
        nombre: r.nombre,
        peso: r.peso,
        evaluados,
        cumplen,
        ignoran: evaluados - cumplen,
        estadoPropio: r.estadoPropio,
        esVentajaPropia: r.estadoPropio === 'ok',
      });
    }
  }

  if (!candidatos.length) return null;

  // Hasta tres huecos, ordenados por peso de la regla descendente
  candidatos.sort((a, b) => b.peso - a.peso);
  const seleccionados = candidatos.slice(0, 3);

  const huecos = seleccionados.map(h => {
    if (h.esVentajaPropia) {
      return {
        ...h,
        texto: `Cumplís con "${h.nombre}", algo que sólo ${h.cumplen} de ${h.evaluados} ${pluralCat} en tu zona están haciendo. Es una ventaja propia que tenés frente a la mayoría.`
      };
    } else {
      return {
        ...h,
        texto: `Sólo ${h.cumplen} de ${h.evaluados} ${pluralCat} de la zona tienen resuelto "${h.nombre}". Hay algo que ${h.ignoran} de tus competidores están ignorando.`
      };
    }
  });

  return {
    sePublica: true,
    totalGrupo,
    huecos,
  };
}

/**
 * 2. EL LÍDER Y SU RECETA.
 * El competidor de mejor puntaje del grupo y qué hace distinto de la mediana.
 */
export function calcularLiderYReceta(auditoriaPropia, competidores, analisisReglas, conScore, totalGrupo) {
  if (!totalGrupo || totalGrupo < 10) return null;
  if (!Array.isArray(competidores) || !competidores.length) return null;

  // Competidores ordenados por puntaje (excluyendo propio)
  const compConScore = competidores
    .filter(c => c.auditoria?.score != null)
    .sort((a, b) => b.auditoria.score - a.auditoria.score);

  if (!compConScore.length) return null;

  const lider = compConScore[0];
  const scoreLider = lider.auditoria.score;

  // Mediana del grupo comparativo completo (incluyendo todos los perfiles conScore)
  const todosScores = (conScore || []).map(s => s.score).sort((a, b) => a - b);
  if (!todosScores.length) return null;

  const midIdx = Math.floor(todosScores.length / 2);
  const scoreMediana = todosScores.length % 2 !== 0
    ? todosScores[midIdx]
    : Math.round((todosScores[midIdx - 1] + todosScores[midIdx]) / 2);

  // Test: el líder no se publica si empata con la mediana
  if (scoreLider <= scoreMediana) return null;

  // Reglas que el líder cumple ('ok') y menos del 50% del grupo cumple
  const hallazgosLider = lider.auditoria.hallazgos || [];
  const reglasLiderOk = new Set(hallazgosLider.filter(h => h.puntos > 0).map(h => h.id));

  const diferenciaReceta = [];
  for (const r of analisisReglas) {
    if (!reglasLiderOk.has(r.id)) continue;

    const ratioCumplimiento = r.evaluadosCompetencia > 0 ? (r.cumplenCompetencia / r.evaluadosCompetencia) : 1;
    if (ratioCumplimiento < 0.50) {
      diferenciaReceta.push({
        id: r.id,
        nombre: r.nombre,
        peso: r.peso,
        cumplen: r.cumplenCompetencia,
        evaluados: r.evaluadosCompetencia,
      });
    }
  }

  if (!diferenciaReceta.length) return null;

  diferenciaReceta.sort((a, b) => b.peso - a.peso);

  const distM = lider.distanciaMetros ?? 0;
  const esLejano = distM > 2000;
  const distTexto = esLejano
    ? ` (a ${(distM / 1000).toFixed(1)} km, una referencia lejana más que una amenaza directa)`
    : (distM > 0 ? ` (a ${distM} m)` : '');

  const nombresReceta = diferenciaReceta.map(d => d.nombre);
  const textoReceta = `El primero de tu zona (${lider.nombre}${distTexto}) hace ${nombresReceta.length} ${nombresReceta.length === 1 ? 'cosa' : 'cosas'} que más de la mitad del grupo no hace: ${nombresReceta.join(', ')}.`;

  return {
    sePublica: true,
    liderNombre: lider.nombre,
    liderScore: scoreLider,
    scoreMediana,
    distanciaMetros: distM,
    esLejano,
    receta: diferenciaReceta,
    texto: textoReceta,
  };
}

/**
 * 3. EL UMBRAL DE ENTRADA.
 * Qué reglas alcanzan para ingresar al tercio superior de esta comparación.
 */
export function calcularUmbralEntrada(auditoriaPropia, competidores, analisisReglas, conScore, totalGrupo) {
  if (!totalGrupo || totalGrupo < 10) return null;
  if (!Array.isArray(conScore) || !conScore.length) return null;

  const tercioSuperiorIndex = Math.max(1, Math.ceil(conScore.length / 3));
  const scoreObjetivo = conScore[tercioSuperiorIndex - 1].score;
  const scorePropio = auditoriaPropia.score;
  const posicionPropia = conScore.findIndex(c => c.esPropio) + 1;

  if (posicionPropia <= tercioSuperiorIndex) {
    return {
      sePublica: true,
      yaEnTercio: true,
      tercioSuperiorIndex,
      scoreObjetivo,
      reglasAjustar: [],
      texto: `Tu perfil ya forma parte del tercio superior de esta comparación (puesto ${posicionPropia}º de ${conScore.length}). Mantener fresca la información te consolidará en esta franja. Es una posición dentro de este grupo comparativo, no un puesto en buscadores.`
    };
  }

  const brechaPuntos = scoreObjetivo - scorePropio;
  const noCumplidas = analisisReglas
    .filter(r => r.estadoPropio !== 'ok')
    .sort((a, b) => b.peso - a.peso);

  if (!noCumplidas.length) return null;

  const seleccionadas = [];
  let acumulado = 0;

  for (const r of noCumplidas) {
    seleccionadas.push(r);
    acumulado += r.peso;
    if (acumulado >= brechaPuntos) break;
  }

  const nombresReglas = seleccionadas.map(r => r.nombre.toLowerCase());
  const listaReglasTexto = nombresReglas.length === 1
    ? nombresReglas[0]
    : nombresReglas.slice(0, -1).join(', ') + ' y ' + nombresReglas.slice(-1);

  // Test: el umbral no menciona buscadores ni promesas de posición en Google.
  const texto = `Para entrar entre los ${tercioSuperiorIndex} primeros de tu zona en esta comparación alcanza con ${listaReglasTexto}. Nada más. Es una posición dentro de este grupo comparativo, no un puesto en buscadores.`;

  return {
    sePublica: true,
    yaEnTercio: false,
    tercioSuperiorIndex,
    scoreObjetivo,
    brechaPuntos,
    reglasAjustar: seleccionadas,
    texto,
  };
}


