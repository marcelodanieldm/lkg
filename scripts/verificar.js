#!/usr/bin/env node
/**
 * verificar.js — La prueba que hay que pasar ANTES de encender nada.
 *
 *   npm run verificar
 *
 * Los tests prueban la lógica con dobles en memoria. Esto prueba la
 * INSTALACIÓN: que las variables estén, que las migraciones estén cargadas,
 * que Google conteste, que el guardián siga bloqueando lo que tiene que
 * bloquear con la configuración real que vas a usar.
 *
 * Termina con código 1 si algo está mal. Los avisos no frenan, pero si vas a
 * producción conviene no tener ninguno.
 *
 * Se puede correr contra Supabase de verdad (si están las variables) o en
 * seco. Lo que se verifica en seco igual sirve: el guardián es determinista.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluar, huella, VEREDICTO, usarFuente } from '../lib/guardrails/guard.js';
import { AGENTES, INVARIANTES } from '../lib/registry.js';
import { auditar } from '../lib/core/audit-engine.js';
import { generarPresupuestos } from '../lib/core/quote-engine.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const ok = (t, d) => console.log(`  ${C.g}✓${C.x} ${t}${d ? C.d + '  ' + d + C.x : ''}`);
const mal = (t, d) => { console.log(`  ${C.r}✗${C.x} ${C.b}${t}${C.x}${d ? '\n      ' + C.r + d + C.x : ''}`); fallos++; };
const aviso = (t, d) => { console.log(`  ${C.y}!${C.x} ${t}${d ? C.d + '  ' + d + C.x : ''}`); avisos++; };
const nota = (t) => console.log(`  ${C.d}·  ${t}${C.x}`);
const titulo = (t) => console.log(`\n${C.b}${t}${C.x}`);

let fallos = 0, avisos = 0;

// ─────────────────────────────────────────────────────────────────────
titulo('1 · Entorno');

const [may] = process.versions.node.split('.').map(Number);
may >= 20
  ? ok('Node', `v${process.versions.node}`)
  : mal('Node demasiado viejo', `Vercel corre 20 o 22; tenés ${process.versions.node}`);

for (const f of [
  'package.json',
  'lib/guardrails/guard.js',
  'lib/db/supabase.js',
  'app/api/cron/[tarea]/route.js',
  'app/page.jsx',
  'app/(panel)/panel/page.jsx',
  'supabase/migrations/001_esquema.sql',
  'supabase/migrations/002_rls_y_cron.sql',
  'supabase/migrations/003_workspace.sql',
  'supabase/migrations/004_solicitudes.sql',
  'supabase/migrations/005_seguimiento.sql',
  'supabase/migrations/006_place_id.sql',
]) {
  existsSync(join(RAIZ, f)) ? ok(f) : mal(`falta ${f}`);
}

// ─────────────────────────────────────────────────────────────────────
titulo('2 · Variables de entorno');

const REQUERIDAS = {
  SUPABASE_URL: 'la URL del proyecto — Settings › API en Supabase',
  SUPABASE_SERVICE_ROLE_KEY: 'clave de servicio. NUNCA con prefijo NEXT_PUBLIC_',
  PANEL_PASSWORD: 'sin esto el panel queda abierto en internet',
  LOKIGI_API_KEY: 'lo único que separa a /api/cron de un botón público',
  GOOGLE_CLIENT_ID: 'OAuth de Google — corré: node scripts/google-auth.js',
  GOOGLE_CLIENT_SECRET: 'OAuth de Google',
  GOOGLE_REFRESH_TOKEN: 'OAuth de Google — corré: node scripts/google-auth.js',
  GMAIL_FROM: 'buzón de envío, en un dominio DEDICADO',
  GEMINI_API_KEY: 'nivel gratuito en aistudio.google.com/apikey',
};

const OPCIONALES = {
  AGENCIA_CIUDAD: 'aparece en la landing; sin esto dice [TU CIUDAD]',
  AGENCIA_PERSONA: 'quién firma, en la landing y en los informes',
  GOOGLE_MAPS_API_KEY: 'sin esto el sistema corre en modo demo',
  EMAIL_OPERADOR: 'a dónde llegan los avisos del Supervisor',
  NEXT_PUBLIC_APP_URL: 'hace falta para los enlaces del informe y de la baja',
  CRON_SECRET: 'lo pone Vercel solo si usás su cron',
  PUBSUB_TOKEN: 'solo si conectás el webhook de Gmail',
};

const esProd = process.env.NODE_ENV === 'production';
const CRITICAS_PROD = new Set(['EMAIL_OPERADOR', 'AGENCIA_CIUDAD', 'AGENCIA_PERSONA']);

for (const [k, ayuda] of Object.entries(REQUERIDAS)) {
  process.env[k] ? ok(k) : aviso(`${k} sin definir`, ayuda);
}
for (const [k, ayuda] of Object.entries(OPCIONALES)) {
  if (process.env[k]) {
    ok(k);
  } else if (esProd && CRITICAS_PROD.has(k)) {
    mal(`${k} sin definir en producción`, ayuda);
  } else {
    nota(`${k} sin definir — ${ayuda}`);
  }
}

// El error que más caro sale: prospectar desde el dominio principal.
const from = process.env.GMAIL_FROM || '';
if (/@gmail\.com/i.test(from)) {
  mal('GMAIL_FROM apunta a una cuenta @gmail.com personal',
      'Google restringe cuentas personales que hacen envío comercial. Usá Workspace con un dominio DEDICADO: ' +
      'si la prospección junta quejas, se quema ese dominio y no con el que le escribís a tus clientes.');
} else if (from) {
  ok('GMAIL_FROM', from);
}

// El error de seguridad que más caro sale.
for (const k of Object.keys(process.env)) {
  if (/^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|PASSWORD|REFRESH_TOKEN)/i.test(k)) {
    mal(`${k} es una variable PÚBLICA con un secreto adentro`,
        'todo lo que empieza con NEXT_PUBLIC_ se compila dentro del JavaScript que baja el navegador. ' +
        'Rotá esa credencial ahora y volvé a definirla sin el prefijo.');
  }
}

// ─────────────────────────────────────────────────────────────────────
titulo('3 · Invariantes de la arquitectura');

for (const inv of INVARIANTES) {
  inv.verificar() ? ok(inv.id, inv.describe) : mal(`INVARIANTE ROTO: ${inv.id}`, inv.describe);
}

const conEnvio = Object.entries(AGENTES)
  .filter(([, a]) => a.herramientas.some(h => /^(enviar|send)_/.test(h)))
  .map(([k]) => k);
conEnvio.length
  ? mal('hay agentes con herramienta de envío directo', conEnvio.join(', '))
  : ok('ningún agente puede enviar', `${Object.keys(AGENTES).length} agentes revisados`);

// ─────────────────────────────────────────────────────────────────────
titulo('4 · El motor es determinista');

const corridas = new Set();
for (let i = 0; i < 20; i++) corridas.add(auditar(PERFILES_DEMO.estudio).score);
corridas.size === 1
  ? ok('20 corridas del mismo perfil dan el mismo puntaje', `= ${[...corridas][0]}`)
  : mal('el puntaje NO es determinista', `dio ${[...corridas].join(', ')}`);

const auditoriaDemo = auditar(PERFILES_DEMO.panaderia);
const planes = generarPresupuestos(auditoriaDemo, { tarifaHoraUSD: 22 });
const flojos = planes.filter(p => !p.rentable).map(p => `${p.nombre} (margen ${p.margenEstimado}%)`);
flojos.length
  ? aviso('hay planes que no cubren tu costo/hora', flojos.join(', ') + ' — revisá SERVICIOS en rubric.js')
  : ok('todos los planes son rentables a la tarifa objetivo', `${planes.length} planes`);

// ─────────────────────────────────────────────────────────────────────
titulo('5 · Los cuatro casos que TIENEN que bloquearse');

const DB = {
  Supresiones: [{ valor: 'suprimido@ejemplo.com', tipo: 'email', motivo: 'baja solicitada', fecha: '2026-01-01' }],
  Mensajes: [], Leads: [], Metricas: [], Aprobaciones: [], Bitacora: [],
};
const CFG = {
  modo_autonomia: 'auto', cupo_diario_email: 25, horario_desde: 0, horario_hasta: 24,
  dias_habiles: '0,1,2,3,4,5,6', horas_min_entre_toques: 48, max_toques: 4,
  presupuesto_api_mes_usd: 40, pausa_general: false, dia_inicio_calentamiento: '',
  zona_horaria: 'America/Argentina/Buenos_Aires', envios_aprobados_para_auto: 50,
};
const EN_MEMORIA = {
  leer: async (p) => structuredClone(DB[p] || []),
  leerVarias: async (ps) => Object.fromEntries(ps.map(p => [p, structuredClone(DB[p] || [])])),
  uno: async (p, f) => (DB[p] || []).find(f) ?? null,
  buscar: async (p, f) => (DB[p] || []).filter(f),
  agregar: async (p, o) => { (DB[p] ||= []).push(...(Array.isArray(o) ? o : [o])); return {}; },
  actualizar: async () => ({}), upsert: async () => ({}),
  config: async (k, d) => (CFG[k] !== undefined && CFG[k] !== '' ? CFG[k] : d),
  invalidarCache: () => {},
};
usarFuente(EN_MEMORIA);

const BASE = {
  tipo: 'prospeccion', canal: 'email', leadId: 'VERIF', negocio: 'Panadería de Prueba',
  destinatario: 'contacto@ejemplo.com', paso: 1, agente: 'verificar',
  asunto: 'Panadería de Prueba: auditoría de su perfil en Google Maps',
  cuerpo: 'Hola, analicé el perfil de Panadería de Prueba en Google Maps y dio 26 sobre 100. ' +
          'Lo más relevante: no publica novedades hace más de un mes. El informe completo está en el enlace. ' +
          'Si preferís no recibir más mensajes, respondé BAJA y no vuelvo a escribir.',
};

const casos = [
  { que: 'destinatario en lista de supresión',
    intento: { ...BASE, destinatario: 'suprimido@ejemplo.com' }, regla: 'supresion' },
  { que: 'promesa de posición en el cuerpo',
    intento: { ...BASE, cuerpo: BASE.cuerpo + ' Te garantizamos el primer puesto en Google.' }, regla: 'linter' },
  { que: 'variable de plantilla sin resolver',
    intento: { ...BASE, cuerpo: 'Hola {{contacto}}, ' + BASE.cuerpo }, regla: 'linter' },
  { que: 'el mismo mensaje por segunda vez', intento: BASE, regla: 'idempotencia', preparar: true },
];

for (const c of casos) {
  if (c.preparar) DB.Mensajes.push({ id: huella(c.intento), lead_id: c.intento.leadId,
    direccion: 'saliente', canal: 'email', paso: 1, fecha: new Date().toISOString() });
  const r = await evaluar(c.intento);
  if (r.veredicto === VEREDICTO.BLOQUEADO && r.regla === c.regla) ok(c.que, `→ bloqueado por "${r.regla}"`);
  else mal(`NO SE BLOQUEÓ: ${c.que}`, `dio "${r.veredicto}" por "${r.regla}" — ${r.razon}`);
}

titulo('6 · Y el caso limpio TIENE que pasar');
DB.Mensajes.length = 0;
const limpio = await evaluar({ ...BASE, leadId: 'OTRO' });
limpio.veredicto === VEREDICTO.PERMITIDO
  ? ok('un mensaje correcto pasa las 12 reglas')
  : mal('un mensaje correcto NO pasa', `${limpio.veredicto} por "${limpio.regla}" — ${limpio.razon}`);

titulo('7 · Falla cerrado');
usarFuente({ leerVarias: async () => { throw new Error('caída simulada de la base'); }, config: async (k, d) => d });
const caido = await evaluar(BASE);
caido.veredicto === VEREDICTO.BLOQUEADO
  ? ok('con la base caída, bloquea', 'nunca deja pasar ante un error')
  : mal('con la base caída NO bloquea', `dio "${caido.veredicto}" — un error abre la puerta`);
usarFuente(EN_MEMORIA);

// ─────────────────────────────────────────────────────────────────────
titulo('8 · Supabase');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  nota('sin credenciales: no se puede verificar la base. Cargá SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
} else {
  const db = await import('../lib/db/supabase.js');

  // Que las tablas existan es lo mismo que decir que las migraciones corrieron.
  for (const t of ['Leads', 'Aprobaciones', 'Mensajes', 'Supresiones', 'Corpus', 'Config']) {
    try { await db.leer(t, { limite: 1, sinCache: true }); ok(`tabla ${t}`); }
    catch (e) { mal(`no se puede leer ${t}`, `${e.message} — ¿corriste las migraciones? supabase db push`); }
  }

  // Lo que debe existir de la migración 003.
  for (const [nombre, probar] of [
    ['propuestas', () => db.propuestasDe('__inexistente__')],
    ['informes', () => db.informeHTML('__inexistente__')],
    ['v_espejo_leads', () => db.espejoLeads(1)],
    ['registrar_toque', () => db.registrarToque('__inexistente__', null)],
    ['solicitudes', () => db.solicitudesNuevas()],
  ]) {
    try { await probar(); ok(nombre); }
    catch (e) { mal(`falta ${nombre}`, `${e.message} — faltan migraciones (003 o 004)`); }
  }

  // La verificación de seguridad que más importa: la clave anónima no puede
  // leer el CRM. Si esto falla, el CRM está público.
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!anon) {
    nota('sin la clave anónima no se puede comprobar que RLS esté cerrado. Cargala para verificarlo.');
  } else {
    const res = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/leads?select=id&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const cuerpo = await res.json().catch(() => null);
    if (Array.isArray(cuerpo) && cuerpo.length > 0) {
      mal('LA CLAVE ANÓNIMA PUEDE LEER LOS LEADS',
          'el CRM está expuesto en internet. Corré 002_rls_y_cron.sql, que activa seguridad de filas sin políticas.');
    } else {
      ok('la clave anónima no puede leer los leads', 'seguridad de filas activa');
    }
  }

  // Que los cron estén programados.
  try {
    const cfg = await db.leer('Config', { sinCache: true });
    const espejo = cfg.find(c => c.clave === 'sheets_espejo_id');
    if (espejo?.valor) ok('planilla espejo creada', espejo.valor);
    else nota('la planilla espejo todavía no se creó — se crea sola en la primera corrida de /api/cron/espejo');

    const tc = cfg.find(c => c.clave === 'tipo_cambio');
    const moneda = cfg.find(c => c.clave === 'moneda')?.valor;
    if (moneda === 'ars' && !tc?.valor) {
      mal('cotizás en pesos pero no hay tipo de cambio cargado',
          'sin esto, generar una propuesta lanza un error. Cargá `tipo_cambio` en la tabla config.');
    }
  } catch { /* ya se reportó arriba */ }
}

// ─────────────────────────────────────────────────────────────────────
titulo('9 · Google Workspace');

if (!process.env.GOOGLE_REFRESH_TOKEN && !process.env.GMAIL_REFRESH_TOKEN) {
  nota('sin refresh token: Gmail, Sheets, Docs, Drive y Calendar quedan apagados.');
  nota('el sistema arranca igual, pero no manda ni un correo. Corré: node scripts/google-auth.js');
} else {
  try {
    const { token } = await import('../lib/integrations/google-oauth.js');
    await token();
    ok('el refresh token de Google funciona');

    // Se prueba cada API por separado: el token puede servir para Gmail y no
    // para Calendar si el alcance faltaba cuando lo autorizaste.
    const { llamar } = await import('../lib/integrations/google-oauth.js');
    const pruebas = [
      ['Gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/profile'],
      ['Drive', 'https://www.googleapis.com/drive/v3/about?fields=user'],
      ['Calendar', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1'],
    ];
    for (const [nombre, url] of pruebas) {
      try { await llamar(url); ok(`alcance de ${nombre}`); }
      catch (e) { mal(`sin alcance de ${nombre}`, `${e.message.slice(0, 160)}`); }
    }
  } catch (e) {
    mal('el refresh token de Google no sirve', e.message.slice(0, 240));
  }
}

// ─────────────────────────────────────────────────────────────────────
titulo('10 · Las migraciones');

const dir = join(RAIZ, 'supabase/migrations');
const migraciones = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
for (const f of migraciones) {
  const sql = readFileSync(join(dir, f), 'utf8');
  ok(f, `${sql.split('\n').length} líneas`);
}

// Las protecciones que no se pueden perder en un refactor de la base.
const todo = migraciones.map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
const protecciones = [
  [/create rule mensajes_no_update/, 'los mensajes enviados no se pueden editar'],
  [/create rule mensajes_no_delete/, 'los mensajes enviados no se pueden borrar'],
  [/create rule supresiones_no_delete/, 'la lista de supresión no se puede borrar'],
  [/La baja es irreversible/, 'opt_out no puede volver a false'],
  [/enable row level security/, 'seguridad de filas activada'],
];
for (const [re, que] of protecciones) {
  re.test(todo) ? ok(que) : mal(`PROTECCIÓN AUSENTE: ${que}`, 'alguien la sacó de las migraciones');
}

// ─────────────────────────────────────────────────────────────────────
console.log('');
if (fallos) {
  console.log(`${C.r}${C.b}  ${fallos} fallo(s). NO ENCIENDAS NADA hasta resolverlos.${C.x}\n`);
  process.exit(1);
}
console.log(`${C.g}${C.b}  Todo en orden.${C.x}${avisos ? C.y + ` ${avisos} aviso(s) — revisalos antes de producción.` + C.x : ''}\n`);
console.log(`${C.d}  Siguiente: arrancá con modo_autonomia en "aprobacion" y cupo_diario_email en 10.`);
console.log(`  Revisá a mano los primeros 50 mensajes antes de subir cualquiera de los dos.${C.x}\n`);
