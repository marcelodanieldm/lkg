/**
 * Tests de los guardrails. Son los tests que más importan del repositorio:
 * un fallo acá es un mensaje que no debió salir y salió.
 *
 * El cliente de Sheets se reemplaza por un doble en memoria para poder probar
 * las reglas sin credenciales y sin tocar la planilla real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Doble de Sheets ───────────────────────────────────────────────────
const DB = { Supresiones: [], Mensajes: [], Leads: [], Metricas: [], Aprobaciones: [], Bitacora: [] };
const CFG = {
  modo_autonomia: 'auto', envios_aprobados_para_auto: 50,
  cupo_diario_email: 25, cupo_diario_whatsapp: 20,
  horario_desde: 0, horario_hasta: 24, dias_habiles: '0,1,2,3,4,5,6',
  horas_min_entre_toques: 48, max_toques: 4, presupuesto_api_mes_usd: 40,
  zona_horaria: 'America/Argentina/Buenos_Aires', dia_inicio_calentamiento: '',
  pausa_general: false,
};

const FUENTE = {
  leer: async (p) => structuredClone(DB[p] || []),
  leerVarias: async (ps) => Object.fromEntries(ps.map(p => [p, structuredClone(DB[p] || [])])),
  uno: async (p, f) => (DB[p] || []).find(f) ?? null,
  buscar: async (p, f) => (DB[p] || []).filter(f),
  agregar: async (p, o) => { (DB[p] ||= []).push(...(Array.isArray(o) ? o : [o])); return { agregadas: 1 }; },
  actualizar: async (p, o) => {
    const i = (DB[p] || []).findIndex(x => x.id === o.id);
    if (i >= 0) DB[p][i] = { ...DB[p][i], ...o };
    return { actualizadas: i >= 0 ? 1 : 0 };
  },
  upsert: async () => ({}),
  config: async (k, d) => (CFG[k] !== undefined && CFG[k] !== '' ? CFG[k] : d),
  invalidarCache: () => {},
};

import { evaluar, lintear, huella, VEREDICTO, cupoDelDia, PROHIBIDO, usarFuente } from '../lib/guardrails/guard.js';
import { AGENTES, INVARIANTES, puedeUsar } from '../lib/registry.js';
usarFuente(FUENTE);

function reset() {
  for (const k of Object.keys(DB)) DB[k] = [];
  Object.assign(CFG, {
    modo_autonomia: 'auto', horario_desde: 0, horario_hasta: 24,
    dias_habiles: '0,1,2,3,4,5,6', pausa_general: false, max_toques: 4,
    cupo_diario_email: 25, presupuesto_api_mes_usd: 40, dia_inicio_calentamiento: '',
  });
}

const INTENTO = {
  tipo: 'prospeccion', canal: 'email', leadId: 'L1', negocio: 'Panadería La Esquina de Oro',
  destinatario: 'hola@panaderia.com.ar', paso: 1, agente: 'contacto',
  asunto: 'Panadería La Esquina de Oro: auditoría de su perfil en Google Maps',
  cuerpo: 'Hola, analicé el perfil de Panadería La Esquina de Oro en Google Maps y dio 26 sobre 100. ' +
          'Lo más relevante: no publica novedades hace más de un mes. El informe completo está en el enlace. ' +
          'Si preferís no recibir más mensajes, respondé BAJA y no vuelvo a escribir.',
};

// ── Camino feliz ──────────────────────────────────────────────────────
test('un intento limpio pasa las reglas', async () => {
  reset();
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.PERMITIDO, r.razon);
});

// ── Cumplimiento ──────────────────────────────────────────────────────
test('la supresión bloquea de forma permanente', async () => {
  reset();
  DB.Supresiones.push({ valor: 'hola@panaderia.com.ar', tipo: 'email', motivo: 'baja solicitada', fecha: '2026-01-01' });
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
  assert.equal(r.regla, 'supresion');
});

test('la supresión por dominio alcanza a cualquier casilla de ese dominio', async () => {
  reset();
  DB.Supresiones.push({ valor: 'panaderia.com.ar', tipo: 'dominio', motivo: 'pidió no ser contactada', fecha: '2026-01-01' });
  const r = await evaluar({ ...INTENTO, destinatario: 'otra.persona@panaderia.com.ar' });
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
});

test('un lead con opt_out no recibe nada aunque no esté en Supresiones', async () => {
  reset();
  DB.Leads.push({ id: 'L1', opt_out: true, etapa: 'contactado' });
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
});

test('los buzones de sistema y los dominios institucionales se descartan', async () => {
  reset();
  for (const d of ['no-reply@x.com', 'postmaster@x.com', 'info@municipio.gob.ar', 'x@uba.edu.ar']) {
    const r = await evaluar({ ...INTENTO, destinatario: d });
    assert.equal(r.veredicto, VEREDICTO.BLOQUEADO, `debería bloquear ${d}`);
  }
});

test('un email mal formado se bloquea', async () => {
  reset();
  const r = await evaluar({ ...INTENTO, destinatario: 'esto-no-es-un-mail' });
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
});

// ── Idempotencia ──────────────────────────────────────────────────────
test('el mismo mensaje no se envía dos veces', async () => {
  reset();
  DB.Mensajes.push({ id: huella(INTENTO), lead_id: 'L1', direccion: 'saliente', canal: 'email', paso: 1, fecha: new Date().toISOString() });
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
  assert.equal(r.regla, 'idempotencia');
});

test('un paso ya enviado no se repite aunque cambie el texto', async () => {
  reset();
  DB.Mensajes.push({ id: 'otro', lead_id: 'L1', direccion: 'saliente', canal: 'email', paso: 1,
                     fecha: new Date(Date.now() - 10 * 86400000).toISOString() });
  const r = await evaluar({ ...INTENTO, cuerpo: INTENTO.cuerpo + ' Un párrafo distinto pero el mismo paso, respondé BAJA.' });
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
  assert.equal(r.regla, 'idempotencia');
});

test('la huella es estable y distingue mensajes distintos', () => {
  assert.equal(huella(INTENTO), huella({ ...INTENTO }));
  assert.notEqual(huella(INTENTO), huella({ ...INTENTO, paso: 2 }));
});

// ── Tope de insistencia ───────────────────────────────────────────────
test('después de 4 toques se cierra el ciclo', async () => {
  reset();
  for (let p = 1; p <= 4; p++) {
    DB.Mensajes.push({ id: 'm' + p, lead_id: 'L1', direccion: 'saliente', canal: 'email', paso: p,
                       fecha: new Date(Date.now() - (10 - p) * 86400000).toISOString() });
  }
  const r = await evaluar({ ...INTENTO, paso: 5 });
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
  assert.equal(r.regla, 'tope_toques');
});

// ── Linter ────────────────────────────────────────────────────────────
test('el linter bloquea promesas de posición y de garantía', async () => {
  reset();
  const frases = [
    'Te garantizamos el primer puesto en Google.',
    'Vas a estar primero en Google en 30 días.',
    'Te aseguro que vas a duplicar tus ventas.',
    '100% de éxito garantizado, sin riesgo.',
  ];
  for (const f of frases) {
    const r = await evaluar({ ...INTENTO, cuerpo: INTENTO.cuerpo + ' ' + f });
    assert.equal(r.veredicto, VEREDICTO.BLOQUEADO, `debería bloquear: ${f}`);
    assert.equal(r.regla, 'linter');
  }
});

test('el linter bloquea variables de plantilla sin resolver', async () => {
  reset();
  const r = await evaluar({ ...INTENTO, cuerpo: 'Hola {{contacto}}, ' + INTENTO.cuerpo });
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
  assert.match(r.razon, /sin resolver/);
});

test('un email sin mecanismo de baja no sale', async () => {
  reset();
  const r = await evaluar({ ...INTENTO, cuerpo: 'Hola, analicé el perfil de Panadería La Esquina de Oro y quería mostrarte el informe que preparé.' });
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
  assert.match(r.razon, /mecanismo de baja/);
});

test('los avisos del linter piden aprobación, no bloquean', async () => {
  reset();
  const r = await evaluar({ ...INTENTO, cuerpo: INTENTO.cuerpo + ' ¡Aprovechá! ¡Es una gran oportunidad! ¡Escribime!' });
  assert.equal(r.veredicto, VEREDICTO.APROBACION);
});

test('el linter avisa si el mensaje no nombra al negocio', () => {
  const l = lintear({ canal: 'email', negocio: 'Panadería La Esquina de Oro', asunto: 'Auditoría de su perfil',
    cuerpo: 'Hola, revisé el perfil que figura en Maps y armé un informe con los puntos a mejorar. Respondé BAJA si no querés más mensajes.' });
  assert.ok(l.avisos.some(a => /no nombra al negocio/.test(a)));
});

// ── Ritmo ─────────────────────────────────────────────────────────────
test('fuera de la ventana horaria se difiere, no se bloquea', async () => {
  reset();
  CFG.horario_desde = 9; CFG.horario_hasta = 10;
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: CFG.zona_horaria })).getHours();
  if (h >= 9 && h < 10) return; // el test no aplica si justo estamos en la ventana
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.DIFERIDO);
});

test('no se manda dos veces al mismo lead antes de 48 horas', async () => {
  reset();
  DB.Mensajes.push({ id: 'x', lead_id: 'L1', direccion: 'saliente', canal: 'email', paso: 1,
                     fecha: new Date(Date.now() - 3 * 3600_000).toISOString() });
  const r = await evaluar({ ...INTENTO, paso: 2 });
  assert.equal(r.veredicto, VEREDICTO.DIFERIDO);
  assert.equal(r.regla, 'espaciado_lead');
});

test('el cupo diario difiere el resto de la cola', async () => {
  reset();
  CFG.cupo_diario_email = 3;
  const hoy = new Date().toISOString();
  for (let i = 0; i < 3; i++) {
    DB.Mensajes.push({ id: 'c' + i, lead_id: 'otro' + i, direccion: 'saliente', canal: 'email', paso: 1, fecha: hoy });
  }
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.DIFERIDO);
  assert.equal(r.regla, 'cupo_diario');
});

test('la rampa de calentamiento arranca en 10 por día', () => {
  const cfg = { cupoEmail: 40, cupoWhatsapp: 20 };
  assert.equal(cupoDelDia('email', { ...cfg, inicioCalentamiento: '' }), 10);
  const hace = d => new Date(Date.now() - d * 86400000).toISOString();
  assert.equal(cupoDelDia('email', { ...cfg, inicioCalentamiento: hace(3) }), 10);
  assert.equal(cupoDelDia('email', { ...cfg, inicioCalentamiento: hace(10) }), 18);
  assert.equal(cupoDelDia('email', { ...cfg, inicioCalentamiento: hace(17) }), 25);
  assert.equal(cupoDelDia('email', { ...cfg, inicioCalentamiento: hace(24) }), 35);
  assert.equal(cupoDelDia('email', { ...cfg, inicioCalentamiento: hace(40) }), 40);
});

// ── Presupuesto y freno de mano ───────────────────────────────────────
test('superar el presupuesto de API corta los envíos', async () => {
  reset();
  DB.Metricas.push({ fecha: new Date().toISOString().slice(0, 10), costo_api_usd: 45 });
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
  assert.equal(r.regla, 'presupuesto');
});

test('la pausa general frena todo antes que cualquier otra regla', async () => {
  reset();
  CFG.pausa_general = true;
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
  assert.equal(r.regla, 'pausa_general');
});

// ── Modo de autonomía ─────────────────────────────────────────────────
test('en modo aprobación todo va a la cola hasta llegar al umbral', async () => {
  reset();
  CFG.modo_autonomia = 'aprobacion';
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.APROBACION);
  assert.match(r.razon, /Falta rodaje/);
});

test('superado el umbral de envíos revisados, pasa a automático', async () => {
  reset();
  CFG.modo_autonomia = 'aprobacion';
  CFG.envios_aprobados_para_auto = 3;
  for (let i = 0; i < 3; i++) {
    DB.Mensajes.push({ id: 'a' + i, lead_id: 'z' + i, direccion: 'saliente', canal: 'email',
                       paso: 1, aprobado_por: 'humano', fecha: new Date(Date.now() - 5 * 86400000).toISOString() });
  }
  const r = await evaluar(INTENTO);
  assert.equal(r.veredicto, VEREDICTO.PERMITIDO);
});

test('con auto_con_excepciones, la baja confianza escala a humano', async () => {
  reset();
  CFG.modo_autonomia = 'auto_con_excepciones';
  const r = await evaluar({ ...INTENTO, confianza: 0.5 });
  assert.equal(r.veredicto, VEREDICTO.APROBACION);
});

// ── Falla cerrado ─────────────────────────────────────────────────────
test('si el contexto no se puede leer, bloquea en vez de dejar pasar', async () => {
  reset();
  usarFuente({ ...FUENTE, leerVarias: async () => { throw new Error('Sheets caído'); } });
  try {
    const r = await evaluar(INTENTO);
    assert.equal(r.veredicto, VEREDICTO.BLOQUEADO);
    assert.match(r.razon, /Ante la duda no se envía/);
  } finally { usarFuente(FUENTE); }
});

// ── Orden de las reglas ───────────────────────────────────────────────
test('la baja gana sobre el horario y sobre el cupo', async () => {
  reset();
  CFG.horario_desde = 3; CFG.horario_hasta = 4;   // casi seguro fuera de ventana
  CFG.cupo_diario_email = 0;
  DB.Supresiones.push({ valor: 'hola@panaderia.com.ar', tipo: 'email', motivo: 'baja', fecha: '2026-01-01' });
  const r = await evaluar(INTENTO);
  assert.equal(r.regla, 'supresion', 'la supresión tiene que evaluarse antes que el ritmo');
});

// ── Invariantes del diseño de agentes ─────────────────────────────────
test('los invariantes de la arquitectura de agentes se cumplen', () => {
  for (const inv of INVARIANTES) {
    assert.ok(inv.verificar(), `INVARIANTE ROTO — ${inv.id}: ${inv.describe}`);
  }
});

test('ningún agente puede enviar directamente', () => {
  for (const [clave, a] of Object.entries(AGENTES)) {
    assert.ok(!a.herramientas.some(h => /^(enviar|send)_/.test(h)),
      `${clave} tiene una herramienta de envío directo`);
  }
  assert.equal(puedeUsar('contacto', 'enviar_email'), false);
  assert.equal(puedeUsar('contacto', 'evaluar_guardian'), true);
});

test('el auditor y el cotizador no usan modelo de lenguaje', () => {
  assert.equal(AGENTES.auditor.modelo, 'ninguno');
  assert.equal(AGENTES.cotizador.modelo, 'ninguno');
});

test('cada frase prohibida del linter tiene una expresión que la detecta', () => {
  const ejemplos = {
    'promesa de garantía': 'te lo garantizamos',
    'promesa de posición': 'vas a salir primero en Google',
    'promesa de resultado': 'te aseguro resultados',
    'promesa absoluta': '100% de éxito',
    'urgencia falsa': 'última oportunidad',
  };
  for (const [que, frase] of Object.entries(ejemplos)) {
    assert.ok(PROHIBIDO.some(p => p.re.test(frase)), `nadie detecta "${frase}" (${que})`);
  }
});
