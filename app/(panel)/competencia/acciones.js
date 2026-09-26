'use server';

/**
 * app/(panel)/competencia/acciones.js — Server Actions para el módulo de Competencia.
 */

import * as db from '../../../lib/db/supabase.js';
import { ejecutarBarrido } from '../../../lib/integrations/barrido-engine.js';
import { detallePlace } from '../../../lib/integrations/places.js';
import { desdePlacesApi } from '../../../lib/core/normalize.js';
import { generarCeldaGeo, compararPorRegla } from '../../../lib/core/competencia.js';
import { evaluar, usarFuente, huella, VEREDICTO } from '../../../lib/guardrails/guard.js';
import { requerirSesion } from '../../../lib/auth.js';

usarFuente(db);

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

  // 2. Verificación de Caché de 30 días y Corpus propio
  const [reciente, vecinosCorpus] = await Promise.all([
    db.obtenerBarridoReciente(celda, categoria).catch(() => null),
    db.buscar('Corpus', c => c.categoria === categoria || c.ciudad === origenPerfil.zona).catch(() => []),
  ]);
  const tieneCache = !!reciente;
  const vecinosEnCorpusCount = (vecinosCorpus || []).length;

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
    vecinosEnCorpusCount,
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
 * Orden por defecto: los 'nuevo' con peor puntaje (score ascendente) primero.
 */
export async function obtenerEstadoProspeccionCompetidoresAction(barridoId) {
  const completo = await db.obtenerBarridoCompleto(barridoId);
  if (!completo || !completo.competidores) return [];

  // Traer conjuntos de control en paralelo
  const [leadsRes, solicitudesRes, setSupresiones] = await Promise.all([
    db.obtenerPlaceIdsLeads().catch(() => ({ setPlaceIds: new Set(), setEmail: new Set() })),
    db.obtenerPlaceIdsSolicitudes().catch(() => ({ setPlaceIds: new Set(), setEmail: new Set() })),
    db.obtenerSupresiones().catch(() => new Set()),
  ]);

  const listaMapped = completo.competidores.map(c => {
    const auditMeta = c.auditado_json?.meta || {};
    const perfil = c.auditado_json?.perfil || {};
    const sitioWeb = auditMeta.sitioWeb || perfil.sitioWeb || null;
    const dominio = sitioWeb ? sitioWeb.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() : null;

    const enSupresion = setSupresiones.has(c.place_id) || (dominio && setSupresiones.has(dominio));
    const yaEsLead = leadsRes.setPlaceIds.has(c.place_id);
    const yaTeEscribio = solicitudesRes.setPlaceIds.has(c.place_id);

    let estado = 'nuevo';
    let estadoLabel = 'nuevo';
    let disponible = true;

    if (enSupresion) {
      estado = 'en_supresion';
      estadoLabel = 'en supresión';
      disponible = false;
    } else if (yaEsLead) {
      estado = 'ya_es_lead';
      estadoLabel = 'ya es lead';
      disponible = false;
    } else if (yaTeEscribio) {
      estado = 'ya_te_escribio';
      estadoLabel = 'ya te escribió';
      disponible = false;
    }

    return {
      placeId: c.place_id,
      nombre: c.nombre,
      distanciaMetros: c.distancia_m,
      anillo: c.anillo,
      score: c.score ?? null,
      sitioWeb,
      dominio,
      estado,
      estadoLabel,
      yaEsLead,
      enSupresion,
      yaTeEscribio,
      disponible,
    };
  });

  // ORDEN POR DEFECTO: 'nuevo' primero, ordenados por peor puntaje (score ASC: 0..100)
  return listaMapped.sort((a, b) => {
    if (a.estado === 'nuevo' && b.estado !== 'nuevo') return -1;
    if (a.estado !== 'nuevo' && b.estado === 'nuevo') return 1;
    if (a.estado === 'nuevo' && b.estado === 'nuevo') {
      const scoreA = a.score ?? 999;
      const scoreB = b.score ?? 999;
      return scoreA - scoreB;
    }
    return a.distanciaMetros - b.distanciaMetros;
  });
}

/**
 * Encola MANUALMENTE y de forma explícita los competidores tildados a la cola de solicitudes.
 * AL MOMENTO DE ENCOLAR: Re-revisa supresión, no duplica leads/solicitudes y registra en Bitacora.
 * NUNCA AUTOMÁTICO.
 */
export async function encolarCompetidoresSeleccionadosAction(seleccionados = [], barridoId = null) {
  if (!Array.isArray(seleccionados) || seleccionados.length === 0) {
    throw new Error('Debe seleccionar al menos un competidor para agregar a la cola.');
  }

  // Re-evaluar supresiones y duplicados en el momento exacto del envío
  const [leadsRes, solicitudesRes, setSupresiones] = await Promise.all([
    db.obtenerPlaceIdsLeads().catch(() => ({ setPlaceIds: new Set(), setEmail: new Set() })),
    db.obtenerPlaceIdsSolicitudes().catch(() => ({ setPlaceIds: new Set(), setEmail: new Set() })),
    db.obtenerSupresiones().catch(() => new Set()),
  ]);

  let agregados = 0;
  for (const item of seleccionados) {
    if (!item.placeId || !item.nombre) continue;

    const sitioWeb = item.sitioWeb || null;
    const dominio = sitioWeb ? sitioWeb.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() : null;

    // Verificar supresión
    if (setSupresiones.has(item.placeId) || (dominio && setSupresiones.has(dominio))) {
      continue;
    }

    // Verificar si ya existe en leads o solicitudes
    if (leadsRes.setPlaceIds.has(item.placeId) || solicitudesRes.setPlaceIds.has(item.placeId)) {
      continue;
    }

    // Se agrega a solicitudes (no a leads directo, manteniendo la invariante de migración 004)
    await db.pedirAuditoria({
      negocio: item.nombre,
      email: item.email || `${item.placeId}@prospeccion.local`,
      ciudad: item.ciudad || null,
      telefono: item.telefono || null,
      mensaje: `Origen: Barrido de competidores (${barridoId || 'Manual por Operador'})`,
      placeId: item.placeId,
    }).catch(() => {});
    agregados++;
  }

  // Registrar en Bitacora
  if (agregados > 0) {
    await db.agregar('Bitacora', {
      agente: 'operador',
      accion: 'encolar_prospeccion_barrido',
      nota: `Encolados ${agregados} competidor(es) desde el barrido ${barridoId || 'manual'}`,
      motivo: 'Selección manual en mapa de prospección',
    }).catch(() => {});
  }

  return { agregados };
}

/**
 * Lista las solicitudes que ya tienen auditoría y email para el selector
 * rápido de la pantalla de competencia.
 */
export async function obtenerSolicitudesParaBarridoAction() {
  await requerirSesion();
  return db.obtenerSolicitudesAuditadas().catch(() => []);
}

/**
 * Genera el cuerpo del mail de competencia a partir del barrido ya completado
 * y lo encola en Aprobaciones. NUNCA envía directamente: el operador aprueba
 * en /aprobaciones y el cron ejecuta.
 *
 * Asunto fijo: "Informe de estudio de mercado de la competencia próxima"
 */
export async function enviarInformeCompetenciaAction({ placeId, email, negocio, urlInforme }) {
  await requerirSesion();

  if (!placeId || !email) {
    return { ok: false, error: 'Faltan placeId o email del destinatario.' };
  }

  // 1. Recuperar el barrido más reciente de este lead
  const barridoCompleto = await db.obtenerBarridoPorLeadId(placeId).catch(() => null);
  if (!barridoCompleto || !barridoCompleto.competidores?.length) {
    return { ok: false, error: 'No hay barrido de competidores disponible para este negocio. Ejecutá el barrido primero.' };
  }

  // 2. Reconstruir el array de competidores que necesita compararPorRegla()
  //    barrido_competidores tiene auditado_json con el objeto de auditoría completo
  const competidores = barridoCompleto.competidores
    .filter(c => c.auditado_json)
    .map(c => ({
      placeId: c.place_id,
      nombre: c.nombre,
      distanciaMetros: c.distancia_m,
      anillo: c.anillo,
      auditoria: c.auditado_json,
    }));

  if (competidores.length < 3) {
    return { ok: false, error: `El barrido tiene solo ${competidores.length} competidor(es) auditado(s). Se necesitan al menos 3 para el análisis.` };
  }

  // 3. Reconstruir auditoría propia desde la tabla leads
  const leads = await db.buscar('Leads', l => l.id === placeId || l.place_id === placeId).catch(() => []);
  const lead = leads[0] ?? null;
  // La auditoría propia se reconstruye mínimamente desde los campos del lead
  // que el motor guardó. Para compararPorRegla() necesitamos al menos score y hallazgos.
  // Si el lead tiene auditoria_json lo usamos; si no, usamos la del primer competidor
  // con el mismo placeId si existiera, o construimos un objeto mínimo con score.
  const auditoriaPropia = lead?.auditoria_json
    ?? { score: lead?.score ?? 0, hallazgos: [], meta: { placeId }, rating: lead?.rating, cantidadResenas: lead?.cantidad_resenas };

  // 4. Ejecutar comparación
  const comparacion = compararPorRegla(auditoriaPropia, competidores);

  // 5. Armar el cuerpo del mail
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app';
  const linkInforme = urlInforme || `${appUrl}/informe/${placeId}`;

  const parrafo1 = comparacion.parrafos?.parrafo1 || '';
  const parrafo2 = comparacion.parrafos?.parrafo2 || '';

  // Huecos de mercado (hasta 3 hallazgos)
  const huecos = (comparacion.huecoMercado?.huecos || []).map(h => `• ${h.texto}`).join('\n');

  // Cobertura horaria si aplica
  const franjas = (comparacion.coberturaHoraria?.franjasDestacadas || []).map(f => `• ${f.texto}`).join('\n');

  const parteHuecos = huecos
    ? `\nPuntos donde tu zona tiene una brecha:\n${huecos}\n`
    : '';
  const parteFranjas = franjas
    ? `\nCobertura horaria:\n${franjas}\n`
    : '';

  const cuerpo = [
    `Hola,`,
    ``,
    `Completamos el análisis de la competencia cercana para ${negocio}.`,
    ``,
    parrafo1,
    ``,
    parrafo2,
    parteHuecos,
    parteFranjas,
    `El informe completo con los datos de tu zona está disponible acá:`,
    linkInforme,
    ``,
    `Si preferís no recibir más mensajes de este tipo, respondé "BAJA".`,
    ``,
    `Marcelo`,
    `Lokigi`,
    `${appUrl}/baja`,
  ].join('\n').trim();

  const asunto = 'Informe de estudio de mercado de la competencia próxima';

  // 6. Pasar por el guardián
  const intencion = {
    id: huella({ leadId: placeId, canal: 'email', paso: 3, cuerpo }),
    lead_id: placeId,
    negocio,
    canal: 'email',
    paso: 3,
    destinatario: email,
    asunto,
    cuerpo,
    creado_en: new Date().toISOString(),
  };

  const evaluacion = await evaluar(intencion).catch(e => ({ veredicto: 'BLOQUEADO', motivo: e.message }));

  if (evaluacion.veredicto === VEREDICTO.BLOQUEADO) {
    await db.agregar('Bitacora', {
      agente: 'operador',
      accion: 'informe_competencia_bloqueado',
      lead_id: placeId,
      decision: 'BLOQUEADO',
      razon: `${evaluacion.regla}: ${evaluacion.motivo}`,
    }).catch(() => {});
    return { ok: false, error: `El guardián bloqueó el envío: ${evaluacion.regla} — ${evaluacion.motivo}` };
  }

  // 7. Encolar en Aprobaciones (el operador aprueba; el cron lo envía)
  await db.agregar('Aprobaciones', {
    id: `aprob_competencia_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    lead_id: placeId,
    canal: 'email',
    tipo: 'informe_competencia',
    destinatario: email,
    asunto,
    cuerpo,
    decision: 'PENDIENTE',
    regla_bloqueante: null,
    huella: huella(intencion),
  });

  await db.agregar('Bitacora', {
    agente: 'operador',
    accion: 'informe_competencia_encolado',
    lead_id: placeId,
    decision: 'PENDIENTE',
    razon: `Encolado en Aprobaciones. Destinatario: ${email}`,
  }).catch(() => {});

  return { ok: true, pendienteAprobacion: true, destinatario: email };
}
