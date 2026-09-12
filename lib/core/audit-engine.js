/**
 * audit-engine.js — Motor de auditoría determinista.
 *
 * Toma un perfil normalizado y devuelve:
 *   { score, banda, dimensiones[], fortalezas[], hallazgos[], noVerificados[], meta }
 *
 * Regla de oro: el LLM nunca calcula el score. Este archivo lo hace.
 * El LLM sólo redacta encima de este objeto. Eso hace que dos auditorías
 * del mismo negocio den lo mismo, y que cualquier número del informe se
 * pueda defender ante el cliente señalando la regla que lo produjo.
 */

import { DIMENSIONES, BANDAS, SEVERIDAD, FUENTES, SERVICIOS } from './rubric.js';

function bandaDe(score) {
  return BANDAS.find(b => score >= b.min) || BANDAS[BANDAS.length - 1];
}

function severidadDe(regla, ratio) {
  // Severidad = cuánto puntaje se pierde, ponderado por el peso de la regla.
  const perdida = regla.peso * (1 - ratio);
  if (perdida >= 4) return 'critico';
  if (perdida >= 2.5) return 'alto';
  if (perdida >= 1.2) return 'medio';
  return 'bajo';
}

export function auditar(perfil, opciones = {}) {
  const dimensiones = [];
  const hallazgos = [];
  const fortalezas = [];
  const noVerificados = [];

  let puntosObtenidos = 0;
  let puntosPosibles = 0;

  for (const dim of DIMENSIONES) {
    let pesoEfectivo = 0;
    let ratioAcum = 0;
    const detalles = [];

    for (const regla of dim.reglas) {
      let res;
      try {
        res = regla.evaluar(perfil) || {};
      } catch (e) {
        res = { ratio: null, estado: 'nd', evidencia: `Error al evaluar: ${e.message}` };
      }

      const item = {
        id: regla.id,
        titulo: regla.titulo,
        peso: regla.peso,
        verificable: regla.verificable,
        evidente: Boolean(regla.evidente),
        estado: res.estado,
        ratio: res.ratio,
        evidencia: res.evidencia,
        recomendacion: regla.recomendacion,
        comoSeArregla: regla.comoSeArregla,
        servicio: regla.servicio,
        fuente: FUENTES[regla.fuente] || null,
        dimension: dim.id,
        dimensionNombre: dim.nombre,
      };
      detalles.push(item);

      if (res.ratio == null || res.estado === 'nd') {
        noVerificados.push(item);
        continue; // no entra al denominador: no penalizamos lo que no pudimos ver
      }

      pesoEfectivo += regla.peso;
      ratioAcum += regla.peso * res.ratio;

      if (res.ratio >= 0.85) {
        fortalezas.push({ ...item, severidad: null });
      } else {
        const sev = severidadDe(regla, res.ratio);
        hallazgos.push({
          ...item,
          severidad: sev,
          severidadPeso: SEVERIDAD[sev].peso,
          puntosPerdidos: +(regla.peso * (1 - res.ratio)).toFixed(2),
        });
      }
    }

    // El peso de la dimensión se reescala al peso efectivamente evaluable.
    const proporcionEvaluada = pesoEfectivo / dim.reglas.reduce((a, r) => a + r.peso, 0);
    const pesoDimEfectivo = dim.peso * (proporcionEvaluada || 0);
    const scoreDim = pesoEfectivo ? (ratioAcum / pesoEfectivo) : null;

    puntosObtenidos += (scoreDim ?? 0) * pesoDimEfectivo;
    puntosPosibles += pesoDimEfectivo;

    dimensiones.push({
      id: dim.id,
      nombre: dim.nombre,
      descripcion: dim.descripcion,
      peso: dim.peso,
      pesoEvaluado: +pesoDimEfectivo.toFixed(1),
      score: scoreDim == null ? null : Math.round(scoreDim * 100),
      cobertura: Math.round((proporcionEvaluada || 0) * 100),
      detalles,
    });
  }

  const score = puntosPosibles ? Math.round((puntosObtenidos / puntosPosibles) * 100) : 0;

  // Orden de hallazgos: impacto (puntos perdidos) primero, luego severidad.
  hallazgos.sort((a, b) => b.puntosPerdidos - a.puntosPerdidos || b.severidadPeso - a.severidadPeso);
  fortalezas.sort((a, b) => b.peso - a.peso);

  // Servicios implicados, con el impacto agregado que justifica su precio.
  const impactoPorServicio = {};
  for (const h of hallazgos) {
    if (!h.servicio) continue;
    impactoPorServicio[h.servicio] = impactoPorServicio[h.servicio] || {
      servicio: h.servicio, ...SERVICIOS[h.servicio], puntosRecuperables: 0, hallazgos: [],
    };
    impactoPorServicio[h.servicio].puntosRecuperables += h.puntosPerdidos;
    impactoPorServicio[h.servicio].hallazgos.push(h.id);
  }
  const serviciosRecomendados = Object.values(impactoPorServicio)
    .map(s => ({
      ...s,
      puntosRecuperables: +s.puntosRecuperables.toFixed(1),
      // ROI operativo: puntos que recupera por hora de trabajo mensual comprometida.
      eficiencia: +(s.puntosRecuperables / ((s.horasMes || 0) + (s.horasSetup || 0) / 6 + 0.1)).toFixed(2),
    }))
    .sort((a, b) => b.eficiencia - a.eficiencia);

  const potencial = Math.min(100, score + Math.round(serviciosRecomendados.reduce((a, s) => a + s.puntosRecuperables, 0)));

  return {
    score,
    potencial,
    brecha: potencial - score,
    banda: bandaDe(score),
    dimensiones,
    fortalezas,
    hallazgos,
    noVerificados,
    serviciosRecomendados,
    perfil,
    meta: {
      negocio: perfil.nombre,
      direccion: perfil.direccion,
      categoria: perfil.categoriaPrimariaLabel || perfil.categoriaPrimaria,
      placeId: perfil.placeId,
      mapsUrl: perfil.mapsUrl,
      auditadoEn: opciones.fecha || new Date().toISOString(),
      cobertura: Math.round(
        (puntosPosibles / DIMENSIONES.reduce((a, d) => a + d.peso, 0)) * 100
      ),
      version: '1.0.0',
    },
  };
}

/**
 * Comparación contra un conjunto de competidores auditados con la misma rúbrica.
 * Es el argumento más persuasivo del informe: no "estás mal", sino
 * "estás 18 puntos por debajo de los tres que aparecen arriba tuyo".
 */
export function compararConCompetencia(auditoriaPropia, auditoriasCompetencia = []) {
  if (!auditoriasCompetencia.length) return null;
  const scores = auditoriasCompetencia.map(a => a.score).sort((a, b) => b - a);
  const promedio = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const mejor = scores[0];
  const posicion = [...scores, auditoriaPropia.score].sort((a, b) => b - a)
    .indexOf(auditoriaPropia.score) + 1;

  const porDimension = {};
  for (const dim of auditoriaPropia.dimensiones) {
    const ajenos = auditoriasCompetencia
      .map(a => a.dimensiones.find(d => d.id === dim.id)?.score)
      .filter(v => v != null);
    if (!ajenos.length) continue;
    const prom = Math.round(ajenos.reduce((a, b) => a + b, 0) / ajenos.length);
    porDimension[dim.id] = {
      nombre: dim.nombre,
      propio: dim.score,
      competencia: prom,
      delta: (dim.score ?? 0) - prom,
    };
  }

  return {
    promedioCompetencia: promedio,
    mejorCompetencia: mejor,
    posicion,
    total: scores.length + 1,
    delta: auditoriaPropia.score - promedio,
    deltaMejor: auditoriaPropia.score - mejor,
    porDimension,
  };
}
