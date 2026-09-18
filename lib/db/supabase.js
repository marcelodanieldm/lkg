/**
 * supabase.js — Adaptador de datos sobre Supabase.
 *
 * Implementa EXACTAMENTE la misma interfaz que tenía el cliente de Google
 * Sheets: `leer`, `leerVarias`, `uno`, `buscar`, `agregar`, `actualizar`,
 * `upsert`, `config`. Por eso `guard.js` se copió de la versión anterior sin
 * tocarle una línea: ya recibía la fuente por inyección.
 *
 * Esa decisión —que en su momento se tomó para poder testear sin credenciales—
 * es la que hoy permite cambiar de base de datos sin reescribir las doce
 * reglas del guardián ni sus tests.
 *
 * Se usa la API REST de PostgREST directamente, sin `@supabase/supabase-js`:
 * son cuatro verbos HTTP y evita 2 MB de dependencia en cada función
 * serverless, lo que se nota en el arranque en frío.
 */

const URL_BASE = () => {
  const u = process.env.SUPABASE_URL;
  if (!u) throw new Error('Falta SUPABASE_URL');
  return u.replace(/\/$/, '');
};

/**
 * La clave de servicio ignora la seguridad de filas y NUNCA debe llegar al
 * navegador. Solo se usa en rutas de servidor. Si algún día ves este archivo
 * importado desde un componente de cliente, es un incidente de seguridad.
 */
const CLAVE = () => {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY');
  return k;
};

/** El código del núcleo habla en nombres de pestaña; la base, en tablas. */
const TABLA = {
  Leads: 'leads', Aprobaciones: 'aprobaciones', Mensajes: 'mensajes',
  Supresiones: 'supresiones', Corpus: 'corpus', Clientes: 'clientes',
  Tareas: 'tareas', Config: 'config', Metricas: 'metricas', Bitacora: 'bitacora',
  HistorialClientes: 'historial_clientes', AlertasOperador: 'alertas_operador',
};

/**
 * `guard.js` lee `m.fecha` en Mensajes y `m.fecha` en Métricas. En Postgres
 * esas columnas se llaman `creado_en` y `fecha`. Se normaliza acá para no
 * tocar el guardián.
 */
function normalizar(pestana, fila) {
  if (!fila) return fila;
  if (pestana === 'Mensajes' || pestana === 'Bitacora') {
    return { ...fila, fecha: fila.creado_en };
  }
  if (pestana === 'Supresiones') {
    return { ...fila, fecha: fila.creado_en };
  }
  return fila;
}

function desnormalizar(pestana, obj) {
  const o = { ...obj };
  if ((pestana === 'Mensajes' || pestana === 'Bitacora' || pestana === 'Supresiones') && o.fecha) {
    o.creado_en = o.fecha;
    delete o.fecha;
  }
  // El núcleo manda cadenas vacías donde Postgres espera null.
  for (const k of Object.keys(o)) if (o[k] === '') o[k] = null;
  return o;
}

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function rest(ruta, opciones = {}, intento = 0) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${ruta}`, {
    ...opciones,
    headers: {
      apikey: CLAVE(),
      Authorization: `Bearer ${CLAVE()}`,
      'Content-Type': 'application/json',
      ...opciones.headers,
    },
    cache: 'no-store',
  });

  if (res.status === 429 || res.status >= 500) {
    if (intento >= 4) throw new Error(`Supabase ${res.status} tras 4 intentos: ${await res.text()}`);
    await dormir(2 ** intento * 400 + Math.random() * 300);
    return rest(ruta, opciones, intento + 1);
  }

  const texto = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${texto.slice(0, 400)}`);
  return texto ? JSON.parse(texto) : null;
}

// ── Caché de proceso ──────────────────────────────────────────────────
// En serverless cada invocación puede ser un proceso nuevo, así que esta caché
// sirve dentro de una misma request (el guardián lee Mensajes varias veces por
// evaluación) y no entre requests. Alcanza y evita sorpresas de datos viejos.
const _cache = new Map();
const TTL = 5_000;

export function invalidarCache() { _cache.clear(); }

// ── Interfaz que consume el núcleo ────────────────────────────────────

export async function leer(pestana, { sinCache = false, limite = 5000 } = {}) {
  const tabla = TABLA[pestana];
  if (!tabla) throw new Error(`Pestaña desconocida: ${pestana}`);

  const hit = _cache.get(pestana);
  if (!sinCache && hit && Date.now() - hit.t < TTL) return hit.v;

  const filas = await rest(`${tabla}?select=*&limit=${limite}`);
  const v = (filas || []).map(f => normalizar(pestana, f));
  _cache.set(pestana, { t: Date.now(), v });
  return v;
}

/** Varias tablas en paralelo. PostgREST no tiene batch, pero sí HTTP/2. */
export async function leerVarias(pestanas) {
  const res = await Promise.all(pestanas.map(p => leer(p)));
  return Object.fromEntries(pestanas.map((p, i) => [p, res[i]]));
}

export async function uno(pestana, predicado, opts) {
  return (await leer(pestana, opts)).find(predicado) ?? null;
}

export async function buscar(pestana, predicado, opts) {
  return (await leer(pestana, opts)).filter(predicado);
}

export async function agregar(pestana, objetos) {
  const lista = (Array.isArray(objetos) ? objetos : [objetos]).map(o => desnormalizar(pestana, o));
  if (!lista.length) return { agregadas: 0 };
  await rest(TABLA[pestana], {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(lista),
  });
  _cache.delete(pestana);
  return { agregadas: lista.length };
}

export async function actualizar(pestana, cambios, clave = 'id') {
  const lista = Array.isArray(cambios) ? cambios : [cambios];
  for (const c of lista) {
    const o = desnormalizar(pestana, c);
    const valor = o[clave];
    delete o[clave];
    if (!Object.keys(o).length) continue;
    await rest(`${TABLA[pestana]}?${clave}=eq.${encodeURIComponent(valor)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(o),
    });
  }
  _cache.delete(pestana);
  return { actualizadas: lista.length };
}

/** Inserta o actualiza en una sola llamada. Postgres resuelve el conflicto. */
export async function upsert(pestana, obj, clave = 'id') {
  const o = desnormalizar(pestana, obj);
  await rest(`${TABLA[pestana]}?on_conflict=${clave}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([o]),
  });
  _cache.delete(pestana);
  return { upsert: o[clave] };
}

// ── Config ────────────────────────────────────────────────────────────

let _cfg = null, _cfgT = 0;

export async function config(clave, def = null) {
  if (!_cfg || Date.now() - _cfgT > 15_000) {
    const filas = await rest('config?select=clave,valor');
    _cfg = Object.fromEntries((filas || []).map(f => [f.clave, f.valor]));
    _cfgT = Date.now();
  }
  const v = _cfg[clave];
  if (v === undefined || v === null || v === '') return def;
  if (v === 'TRUE' || v === 'true') return true;
  if (v === 'FALSE' || v === 'false') return false;
  return isNaN(Number(v)) ? v : Number(v);
}

export async function guardarConfig(clave, valor, nota) {
  await rest('config?on_conflict=clave', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ clave, valor: String(valor), ...(nota ? { nota } : {}) }]),
  });
  _cfg = null;
}

// ── Consultas que aprovechan que ahora hay SQL de verdad ──────────────

/** El percentil lo calcula Postgres. Una ida y vuelta en vez de traer el corpus. */
export async function percentil(score, categoria, ciudad) {
  const r = await rest('rpc/percentil_rubro', {
    method: 'POST',
    body: JSON.stringify({ p_score: score, p_categoria: categoria, p_ciudad: ciudad ?? null }),
  });
  return r?.[0] ?? null;
}

export async function embudo() {
  const [emb, mrr] = await Promise.all([
    rest('v_embudo?select=*').catch(() => []),
    rest('v_mrr?select=*').catch(() => []),
  ]);
  return { embudo: Array.isArray(emb) ? emb : [], mrr: mrr?.[0] ?? null };
}

export const colaDeHoy = (limite = 50) =>
  rest(`v_cola_hoy?select=*&limit=${limite}`).then(r => (Array.isArray(r) ? r : [])).catch(() => []);

export const pendientesDeAprobacion = () =>
  rest('aprobaciones?select=*&decision=eq.PENDIENTE&order=creado_en.asc').then(r => (Array.isArray(r) ? r : [])).catch(() => []);

export const aprobadasSinEnviar = () =>
  rest('aprobaciones?select=*&decision=eq.APROBADO&enviado_en=is.null&order=decidido_en.asc').then(r => (Array.isArray(r) ? r : [])).catch(() => []);

export const registrarApertura = (leadId) =>
  rest('rpc/registrar_apertura', { method: 'POST', body: JSON.stringify({ p_lead_id: leadId }) });

export const darDeBaja = (leadId, canal = 'email') =>
  rest('rpc/darse_de_baja', { method: 'POST', body: JSON.stringify({ p_lead_id: leadId, p_canal: canal }) });

export const informePublico = (leadId) =>
  rest('rpc/informe_publico', { method: 'POST', body: JSON.stringify({ p_lead_id: leadId }) })
    .then(r => r?.[0] ?? null);

/** El HTML del informe tal como se generó el día que se mandó el correo. */
export const informeHTML = (leadId) =>
  rest('rpc/informe_html', { method: 'POST', body: JSON.stringify({ p_lead_id: leadId }) })
    .then(r => (typeof r === 'string' ? r : null));

export const guardarInforme = (leadId, html, score, version) =>
  rest('informes?on_conflict=lead_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ lead_id: leadId, html, score, version_rubrica: version }]),
  });

/**
 * Incrementa el contador de toques dentro de Postgres.
 *
 * Devuelve el número nuevo, o `null` si el lead pidió la baja en el ínterin —
 * en cuyo caso la fila no se tocó. Quien llame debe tratar ese `null` como una
 * señal, no como un error silencioso.
 */
export const registrarToque = (leadId, proximo = null) =>
  rest('rpc/registrar_toque', {
    method: 'POST',
    body: JSON.stringify({ p_lead_id: leadId, p_proximo: proximo }),
  }).then(r => (typeof r === 'number' ? r : r?.[0] ?? null));

// ── Espejo en Workspace ───────────────────────────────────────────────
// Vistas ya formateadas para volcar en una planilla (ver migración 003).

export const espejoLeads      = (limite = 5000) => rest(`v_espejo_leads?select=*&limit=${limite}`);
export const espejoActividad  = ()              => rest('v_espejo_actividad?select=*');
export const espejoBenchmarks = ()              => rest('v_espejo_benchmarks?select=*');
export const espejoMetricas   = (dias = 120)    =>
  rest(`metricas?select=*&order=fecha.desc&limit=${dias}`);

// ── Propuestas ────────────────────────────────────────────────────────

export const propuestasDe = (leadId) =>
  rest(`propuestas?select=*&lead_id=eq.${encodeURIComponent(leadId)}&order=creado_en.desc`);

export async function guardarPropuesta(p) {
  const r = await rest('propuestas?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([p]),
  });
  return r?.[0]?.id ?? null;
}

// ── Solicitudes que llegan por la landing ─────────────────────────────
// Una solicitud no es un lead. La explicación larga está en la migración 004.

export const pedirAuditoria = ({ negocio, email, ciudad, telefono, mensaje, ip, placeId }) =>
  rest('rpc/pedir_auditoria', {
    method: 'POST',
    body: JSON.stringify({
      p_negocio: negocio, p_email: email, p_ciudad: ciudad ?? null,
      p_telefono: telefono ?? null, p_mensaje: mensaje ?? null, p_ip: ip ?? null,
      p_place_id: placeId ?? null,
    }),
  }).catch(err => {
    // Si la función RPC en Postgres aún no fue actualizada con la migración 006 (p_place_id),
    // reintentar con los 6 parámetros originales para que la solicitud se registre de todos modos.
    if (placeId || (err?.message && (err.message.includes('place_id') || err.message.includes('404') || err.message.includes('PGRST202')))) {
      return rest('rpc/pedir_auditoria', {
        method: 'POST',
        body: JSON.stringify({
          p_negocio: negocio, p_email: email, p_ciudad: ciudad ?? null,
          p_telefono: telefono ?? null, p_mensaje: mensaje ?? null, p_ip: ip ?? null,
        }),
      });
    }
    throw err;
  });

export const solicitudesNuevas = () =>
  rest('v_solicitudes_nuevas?select=*').then(r => (Array.isArray(r) ? r : [])).catch(() => []);

export const atenderSolicitud = (id, estado, nota, leadId) =>
  rest(`solicitudes?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      estado,
      atendida_en: new Date().toISOString(),
      ...(nota ? { nota } : {}),
      ...(leadId ? { lead_id: leadId } : {}),
    }),
  });

/** Gasto de API del mes, para la regla de presupuesto del guardián. */
export async function gastoDelMes() {
  const desde = new Date().toISOString().slice(0, 7) + '-01';
  const filas = await rest(`metricas?select=costo_api_usd&fecha=gte.${desde}`);
  return (filas || []).reduce((a, m) => a + Number(m.costo_api_usd || 0), 0);
}

/** Busca un barrido reciente (< 30 días) para la misma celda geográfica y categoría. */
export async function obtenerBarridoReciente(celda, categoria) {
  const hace30 = new Date(Date.now() - 30 * 86400e3).toISOString();
  const filas = await rest(`barridos?select=*&celda=eq.${encodeURIComponent(celda)}&categoria=eq.${encodeURIComponent(categoria)}&fecha=gte.${hace30}&order=fecha.desc&limit=1`).catch(() => []);
  return Array.isArray(filas) && filas.length ? filas[0] : null;
}

/** Busca si existe una auditoría previa (< 30 días) en el corpus propio para un placeId. */
export async function buscarEnCorpus(placeId, maxDias = 30) {
  const hace = new Date(Date.now() - maxDias * 86400e3).toISOString();
  const comp = await rest(`barrido_competidores?select=*&place_id=eq.${encodeURIComponent(placeId)}&creado_en=gte.${hace}&order=creado_en.desc&limit=1`).catch(() => []);
  if (Array.isArray(comp) && comp.length && comp[0].auditado_json) {
    return comp[0].auditado_json;
  }
  return null;
}

/** Obtiene competidores y desglose de reglas de un barrido cacheado. */
export async function obtenerBarridoCompleto(barridoId) {
  const [b, comp, reg] = await Promise.all([
    rest(`barridos?select=*&id=eq.${encodeURIComponent(barridoId)}`).then(r => r?.[0] ?? null).catch(() => null),
    rest(`barrido_competidores?select=*&barrido_id=eq.${encodeURIComponent(barridoId)}`).catch(() => []),
    rest(`barrido_reglas?select=*&barrido_id=eq.${encodeURIComponent(barridoId)}`).catch(() => []),
  ]);
  return { barrido: b, competidores: Array.isArray(comp) ? comp : [], reglas: Array.isArray(reg) ? reg : [] };
}

/** Guarda un nuevo barrido con sus competidores y reglas desglosadas. */
export async function guardarBarrido({ barrido, competidores = [], reglas = [] }) {
  await rest('barridos', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([barrido]),
  });
  if (competidores.length) {
    await rest('barrido_competidores', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(competidores),
    });
  }
  if (reglas.length) {
    await rest('barrido_reglas', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(reglas),
    });
  }
  return barrido;
}

/** Obtiene el conjunto de place_ids que ya son leads en el sistema. */
export async function obtenerPlaceIdsLeads() {
  const filas = await rest('leads?select=place_id,email').catch(() => []);
  const setPlaceIds = new Set();
  const setEmail = new Set();
  for (const l of filas || []) {
    if (l.place_id) setPlaceIds.add(l.place_id);
    if (l.email) setEmail.add(String(l.email).toLowerCase().trim());
  }
  return { setPlaceIds, setEmail, has: id => setPlaceIds.has(id) };
}

/** Obtiene el conjunto de place_ids y emails que ya están en solicitudes. */
export async function obtenerPlaceIdsSolicitudes() {
  const filas = await rest('solicitudes?select=place_id,email').catch(() => []);
  const setPlaceIds = new Set();
  const setEmail = new Set();
  for (const s of filas || []) {
    if (s.place_id) setPlaceIds.add(s.place_id);
    if (s.email) setEmail.add(String(s.email).toLowerCase().trim());
  }
  return { setPlaceIds, setEmail };
}

/** Obtiene la lista de valores suprimidos (emails, dominios y place_ids). */
export async function obtenerSupresiones() {
  const filas = await rest('supresiones?select=valor,tipo').catch(() => []);
  const set = new Set();
  for (const f of filas || []) {
    if (f.valor) {
      set.add(String(f.valor).toLowerCase().trim());
    }
  }
  return set;
}

/** Guarda el motivo de búsqueda opcional respondido en la landing post-envío. */
export async function guardarMotivoBusqueda(solicitudId, motivo) {
  if (!solicitudId) return { ok: false, error: 'id_nulo' };
  return rest('rpc/guardar_motivo_busqueda', {
    method: 'POST',
    body: JSON.stringify({ p_solicitud_id: solicitudId, p_motivo: motivo }),
  }).catch(async () => {
    return rest(`solicitudes?id=eq.${encodeURIComponent(solicitudId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        motivo_busqueda: motivo,
        motivo_busqueda_at: new Date().toISOString(),
      }),
    }).then(() => ({ ok: true })).catch(() => ({ ok: false }));
  });
}

// ── Retención e Historial de Clientes ─────────────────────────────────

export async function guardarHistorialCliente(registro) {
  const r = await rest('historial_clientes', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([registro]),
  });
  return r?.[0] ?? null;
}

export async function obtenerUltimoHistorialCliente(leadId) {
  const r = await rest(`historial_clientes?select=*&lead_id=eq.${encodeURIComponent(leadId)}&order=creado_en.desc&limit=1`).catch(() => []);
  return Array.isArray(r) && r.length ? r[0] : null;
}

export async function obtenerClientesActivos() {
  const r = await rest('leads?select=*&etapa=eq.cliente&opt_out=eq.false').catch(() => []);
  return Array.isArray(r) ? r : [];
}

export async function registrarAlertaOperador(alerta) {
  const r = await rest('alertas_operador', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([alerta]),
  });
  return r?.[0] ?? null;
}

export async function obtenerAlertasOperadorSinEnviar() {
  const r = await rest('alertas_operador?select=*&enviado=eq.false&order=creado_en.asc').catch(() => []);
  return Array.isArray(r) ? r : [];
}

export async function marcarAlertasOperadorEnviadas(ids = []) {
  if (!ids.length) return { actualizadas: 0 };
  const inClause = ids.map(id => encodeURIComponent(id)).join(',');
  await rest(`alertas_operador?id=in.(${inClause})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ enviado: true }),
  });
  return { actualizadas: ids.length };
}

export const registrarVistoInforme = (leadId) =>
  rest('rpc/registrar_visto_informe', {
    method: 'POST',
    body: JSON.stringify({ p_lead_id: leadId }),
  }).catch(() => ({ ok: false }));

export async function obtenerBarridosPendientes() {
  const [sol, lead] = await Promise.all([
    rest('solicitudes?select=*&barrido_estado=eq.pendiente').catch(() => []),
    rest('leads?select=*&barrido_estado=eq.pendiente').catch(() => []),
  ]);
  const ids = new Set();
  const res = [];
  for (const item of [...(Array.isArray(sol) ? sol : []), ...(Array.isArray(lead) ? lead : [])]) {
    const id = item.lead_id || item.id;
    if (id && !ids.has(id)) {
      ids.add(id);
      res.push({ id, negocio: item.negocio || item.nombre || 'Lead', email: item.email });
    }
  }
  return res;
}

export async function marcarBarridoCompletado(leadId, barridoId, estado = 'completado') {
  await Promise.all([
    rest(`solicitudes?or=(lead_id.eq.${encodeURIComponent(leadId)},id.eq.${encodeURIComponent(leadId)})`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ barrido_estado: estado, ...(barridoId ? { barrido_id: barridoId } : {}) }),
    }).catch(() => null),
    rest(`leads?id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ barrido_estado: estado, ...(barridoId ? { barrido_id: barridoId } : {}) }),
    }).catch(() => null),
  ]);
  return { ok: true };
}


