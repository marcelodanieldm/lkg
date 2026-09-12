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
    rest('v_embudo?select=*'),
    rest('v_mrr?select=*'),
  ]);
  return { embudo: emb || [], mrr: mrr?.[0] ?? null };
}

export const colaDeHoy = (limite = 50) => rest(`v_cola_hoy?select=*&limit=${limite}`);

export const pendientesDeAprobacion = () =>
  rest('aprobaciones?select=*&decision=eq.PENDIENTE&order=creado_en.asc');

export const aprobadasSinEnviar = () =>
  rest('aprobaciones?select=*&decision=eq.APROBADO&enviado_en=is.null&order=decidido_en.asc');

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

export const pedirAuditoria = ({ negocio, email, ciudad, telefono, mensaje, ip }) =>
  rest('rpc/pedir_auditoria', {
    method: 'POST',
    body: JSON.stringify({
      p_negocio: negocio, p_email: email, p_ciudad: ciudad ?? null,
      p_telefono: telefono ?? null, p_mensaje: mensaje ?? null, p_ip: ip ?? null,
    }),
  });

export const solicitudesNuevas = () => rest('v_solicitudes_nuevas?select=*');

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
