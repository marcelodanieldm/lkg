/**
 * retencion.js — Módulo de evaluación de evolución de clientes y diagnóstico de retención.
 *
 * Módulo determinista que compara la auditoría y posición actual del cliente
 * contra su historial previo, calcula deltas, realiza diagnósticos de caídas,
 * identifica cambios en competidores vecinos y genera alertas para el operador.
 */

export function calcularPosicionCliente(scoreCliente, competidores = []) {
  if (scoreCliente === null || scoreCliente === undefined) return null;
  let superiores = 0;
  for (const c of competidores) {
    if (typeof c.score === 'number' && c.score > scoreCliente) {
      superiores++;
    }
  }
  return superiores + 1;
}

export function diagnosticarCaida(historialPrevio, auditoriaActual, posicionAnterior, posicionActual) {
  const auditPrevio = historialPrevio?.auditado_json || {};
  const scorePrevio = historialPrevio?.score ?? null;
  const scoreActual = auditoriaActual?.score ?? null;

  const caidaScore = scorePrevio !== null && scoreActual !== null && scoreActual < scorePrevio;
  const caidaPosicion = posicionAnterior !== null && posicionActual !== null && posicionActual > posicionAnterior;

  if (!caidaScore && !caidaPosicion) {
    return 'sin_cambio';
  }

  // 1. Si el score del propio cliente bajó (reglas que antes pasaban y ahora fallan)
  if (caidaScore) {
    const hallazgosActuales = new Set((auditoriaActual?.hallazgos || []).map(h => h.id));
    const hallazgosPrevios = new Set((auditPrevio?.hallazgos || []).map(h => h.id));

    let fallasPropias = 0;
    for (const hId of hallazgosActuales) {
      if (!hallazgosPrevios.has(hId)) fallasPropias++;
    }
    if (fallasPropias > 0 || scoreActual < scorePrevio) {
      return 'cliente_perdio_terreno';
    }
  }

  // 2. Si el score del cliente se mantuvo o subió pero su posición empeoró (competidores avanzaron)
  if (caidaPosicion && (!caidaScore || scoreActual >= scorePrevio)) {
    return 'competidor_avanzo';
  }

  // 3. De lo contrario, cambio de perfil/categoría/radio
  return 'cambio_perfil';
}

export function detectarCambiosVecinos(historialPrevio, competidoresActuales = [], umbralSaltoScore = 10) {
  const cambios = [];
  const alertas = [];

  const competidoresPrevios = historialPrevio?.auditado_json?.competidores || historialPrevio?.competidores || [];
  const prevMap = new Map();
  for (const cp of competidoresPrevios) {
    const pId = cp.place_id || cp.placeId;
    if (pId) {
      prevMap.set(pId, cp);
    }
  }

  for (const ca of competidoresActuales) {
    const placeId = ca.place_id || ca.placeId;
    const nombre = ca.nombre || ca.negocio || 'Competidor';
    const prev = prevMap.get(placeId);

    if (!prev) {
      cambios.push({
        tipo: 'nuevo_competidor',
        placeId,
        nombre,
        distanciaM: ca.distancia_m || ca.distanciaM || null,
        descripcion: `Nuevo competidor detectado en el radio: ${nombre}`
      });
      alertas.push({
        tipo: 'nuevo_competidor',
        detalle: {
          place_id: placeId,
          nombre,
          distancia_m: ca.distancia_m || ca.distanciaM || null,
          descripcion: `Nuevo competidor detectado en el radio (${ca.distancia_m || '?'}m)`
        }
      });
    } else {
      const scorePrev = prev.score;
      const scoreAct = ca.score;
      if (typeof scorePrev === 'number' && typeof scoreAct === 'number') {
        const diff = scoreAct - scorePrev;
        if (diff >= umbralSaltoScore) {
          const explicacion = `Subió ${diff} pts (de ${scorePrev} a ${scoreAct})`;
          cambios.push({
            tipo: 'salto_competidor',
            placeId,
            nombre,
            scoreAnterior: scorePrev,
            scoreActual: scoreAct,
            saltoPts: diff,
            descripcion: `${nombre} subió ${diff} pts (${scorePrev} → ${scoreAct})`
          });
          alertas.push({
            tipo: 'salto_competidor',
            detalle: {
              place_id: placeId,
              nombre,
              score_anterior: scorePrev,
              score_actual: scoreAct,
              salto_pts: diff,
              explicacion
            }
          });
        }
      }
    }
  }

  return { cambios, alertas };
}

export function evaluarEvolucionCliente(historialPrevio, auditoriaActual, competidoresActuales = [], opciones = {}) {
  const umbralSaltoScore = opciones.umbralSaltoScore ?? 10;
  const totalCompetidores = competidoresActuales.length;

  if (!historialPrevio || historialPrevio.score === undefined || historialPrevio.score === null) {
    const posicionActual = calcularPosicionCliente(auditoriaActual?.score ?? null, competidoresActuales);
    return {
      esPrimeraMedicion: true,
      scoreActual: auditoriaActual?.score ?? null,
      scoreAnterior: null,
      deltaScore: null,
      posicionActual,
      posicionAnterior: null,
      deltaPosicion: null,
      totalCompetidores,
      diagnosticoCaida: 'sin_cambio',
      cambiosVecinos: [],
      alertas: []
    };
  }

  const scoreAnterior = historialPrevio.score;
  const posicionAnterior = historialPrevio.posicion ?? null;

  const scoreActual = auditoriaActual?.score ?? null;
  const posicionActual = calcularPosicionCliente(scoreActual, competidoresActuales);

  const deltaScore = (scoreActual !== null && scoreAnterior !== null) ? (scoreActual - scoreAnterior) : null;
  const deltaPosicion = (posicionAnterior !== null && posicionActual !== null)
    ? (posicionAnterior - posicionActual)
    : null;

  const diagnosticoCaida = diagnosticarCaida(historialPrevio, auditoriaActual, posicionAnterior, posicionActual);
  const { cambios: cambiosVecinos, alertas } = detectarCambiosVecinos(historialPrevio, competidoresActuales, umbralSaltoScore);

  const ratingPrevio = historialPrevio.auditado_json?.rating;
  const ratingActual = auditoriaActual?.rating;
  if (typeof ratingPrevio === 'number' && typeof ratingActual === 'number' && ratingActual < ratingPrevio) {
    alertas.push({
      tipo: 'caida_rating_cliente',
      detalle: {
        rating_anterior: ratingPrevio,
        rating_actual: ratingActual,
        explicacion: `El rating del cliente cayó de ${ratingPrevio} a ${ratingActual}`
      }
    });
  }

  return {
    esPrimeraMedicion: false,
    scoreActual,
    scoreAnterior,
    deltaScore,
    posicionActual,
    posicionAnterior,
    deltaPosicion,
    totalCompetidores,
    diagnosticoCaida,
    cambiosVecinos,
    alertas
  };
}

export function construirInformeMensualClienteHTML(lead, evolucion) {
  const negocio = lead.negocio || 'tu negocio';

  if (evolucion.esPrimeraMedicion) {
    return `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a202c;">Informe de Evolución Mensual — ${negocio}</h2>
  <div style="background-color: #ebf8ff; border-left: 4px solid #3182ce; padding: 12px 16px; margin: 16px 0;">
    <strong>Primera medición:</strong> Este es el informe inicial de control. A partir del próximo mes verás la comparación de tu score, posición y movimientos de tus competidores.
  </div>
  <p><strong>Puntaje actual:</strong> ${evolucion.scoreActual} / 100</p>
  <p><strong>Posición en tu zona:</strong> #${evolucion.posicionActual} de ${evolucion.totalCompetidores} competidores</p>
</div>
    `.trim();
  }

  const signScore = evolucion.deltaScore >= 0 ? `+${evolucion.deltaScore}` : `${evolucion.deltaScore}`;
  const signPos = evolucion.deltaPosicion >= 0 ? `+${evolucion.deltaPosicion}` : `${evolucion.deltaPosicion}`;

  let textoDiagnostico = '';
  if (evolucion.diagnosticoCaida === 'cliente_perdio_terreno') {
    textoDiagnostico = '<p style="color: #c53030;"><strong>Diagnóstico:</strong> Hubo algunos aspectos en la ficha que requieren atención para recuperar puntaje.</p>';
  } else if (evolucion.diagnosticoCaida === 'competidor_avanzo') {
    textoDiagnostico = '<p style="color: #dd6b20;"><strong>Diagnóstico:</strong> Tus competidores cercanos mejoraron sus fichas y ganaron terreno en el ranking local.</p>';
  } else if (evolucion.diagnosticoCaida === 'cambio_perfil') {
    textoDiagnostico = '<p style="color: #4a5568;"><strong>Diagnóstico:</strong> Se registraron cambios de configuración o categorización en la zona.</p>';
  }

  let listaMovimientos = '';
  if (evolucion.cambiosVecinos && evolucion.cambiosVecinos.length > 0) {
    listaMovimientos = '<h4>Movimientos destacados en tu zona:</h4><ul>' +
      evolucion.cambiosVecinos.map(c => `<li>${c.descripcion}</li>`).join('') +
      '</ul>';
  }

  return `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a202c;">Informe Mensual de Evolución — ${negocio}</h2>
  <div style="background-color: #f7fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <p><strong>Puntaje:</strong> ${evolucion.scoreActual} / 100 (${signScore} pts respecto al mes anterior)</p>
    <p><strong>Posición:</strong> #${evolucion.posicionActual} de ${evolucion.totalCompetidores} (${signPos} puestos)</p>
  </div>
  ${textoDiagnostico}
  ${listaMovimientos}
</div>
  `.trim();
}
