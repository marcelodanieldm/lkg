import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditar, compararConCompetencia } from '../lib/core/audit-engine.js';
import { generarPresupuestos, generarAlternativasReduccion, estimarRetorno } from '../lib/core/quote-engine.js';
import { generarInformeHTML, resumenCorto } from '../lib/core/report.js';
import { detectarObjecion, SECUENCIA_PROSPECCION, render } from '../lib/core/sequences.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';

test('el puntaje es determinista', () => {
  const a = auditar(PERFILES_DEMO.panaderia);
  const b = auditar(PERFILES_DEMO.panaderia);
  assert.equal(a.score, b.score);
});

test('un perfil bien trabajado puntúa por encima de uno abandonado', () => {
  const buena = auditar(PERFILES_DEMO.clinica).score;
  const mala = auditar(PERFILES_DEMO.panaderia).score;
  assert.ok(buena > mala + 25, `clinica=${buena} panaderia=${mala}`);
});

test('el puntaje siempre queda entre 0 y 100', () => {
  for (const p of Object.values(PERFILES_DEMO)) {
    const r = auditar(p);
    assert.ok(r.score >= 0 && r.score <= 100, `${p.nombre} => ${r.score}`);
    assert.ok(r.potencial >= r.score);
  }
});

test('los campos no verificables no penalizan: se excluyen del cálculo', () => {
  const base = { ...PERFILES_DEMO.clinica };
  const conNulls = { ...base, postsUltimos30Dias: null, ofertasActivas: null, mensajeriaActiva: null, reservasActivas: null, diasDesdeUltimaFoto: null, tiposDeFoto: null };
  const r = auditar(conNulls);
  assert.ok(r.noVerificados.length >= 5);
  assert.ok(r.meta.cobertura < 100);
  // Sin datos de actividad, el score no debería desplomarse.
  assert.ok(r.score > 70, `score con huecos = ${r.score}`);
});

test('un perfil cerrado permanentemente pierde el punto de estado operativo', () => {
  const r = auditar({ ...PERFILES_DEMO.clinica, estado: 'CLOSED_PERMANENTLY' });
  assert.ok(r.hallazgos.some(h => h.id === 'estado_operativo'));
});

test('los hallazgos vienen ordenados por impacto decreciente', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  for (let i = 1; i < r.hallazgos.length; i++) {
    assert.ok(r.hallazgos[i - 1].puntosPerdidos >= r.hallazgos[i].puntosPerdidos);
  }
});

test('se generan hasta 3 planes, todos rentables a la tarifa objetivo', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  const planes = generarPresupuestos(r, { tarifaHoraUSD: 22 });
  assert.ok(planes.length >= 1 && planes.length <= 3);
  for (const p of planes) {
    assert.ok(p.mensualUSD >= 0);
    assert.ok(p.servicios.length > 0);
    assert.ok(p.scoreProyectado >= r.score);
  }
});

test('la escalera de reducción da 3 alternativas más baratas que la base', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  const planes = generarPresupuestos(r);
  const base = planes.find(p => p.recomendado) || planes[0];
  const alts = generarAlternativasReduccion(base, r);
  assert.equal(alts.length, 3);
  for (const a of alts) {
    assert.ok(a.setupUSD + a.mensualUSD <= base.setupUSD + base.mensualUSD + 1, a.nombre);
    assert.ok(a.resigna && a.resigna.length > 10, 'cada alternativa dice qué resigna');
  }
});

test('la cotización en ARS exige tipo de cambio', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  assert.throws(() => generarPresupuestos(r, { moneda: 'ars' }), /tipoCambio/);
  const p = generarPresupuestos(r, { moneda: 'ars', tipoCambio: 1450 });
  assert.equal(p[0].moneda, 'ARS');
  assert.ok(p[0].mensualARS > 0);
});

test('la comparación con la competencia calcula posición y deltas', () => {
  const propia = auditar(PERFILES_DEMO.panaderia);
  const comp = [auditar(PERFILES_DEMO.clinica), auditar(PERFILES_DEMO.estudio)];
  const c = compararConCompetencia(propia, comp);
  assert.equal(c.total, 3);
  assert.equal(c.posicion, 3);
  assert.ok(c.delta < 0);
});

test('el informe HTML se genera y contiene lo esencial', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  const html = generarInformeHTML(r, { agencia: 'Demo' });
  assert.ok(html.includes('Panadería La Esquina de Oro'));
  assert.ok(html.includes(String(r.score)));
  assert.ok(html.includes('Fundamento'), 'cada hallazgo cita su fundamento');
  assert.ok(html.includes('BAJA'), 'el informe incluye mecanismo de baja');
  assert.ok(!html.includes('undefined'));
});

test('la baja gana a cualquier otra objeción en el mismo mensaje', () => {
  assert.equal(detectarObjecion('me parece caro, igual no me interesa').clave, 'no_interesa');
  assert.equal(detectarObjecion('está muy caro para mi presupuesto').clave, 'precio');
  assert.equal(detectarObjecion('me lo garantizás?').clave, 'resultados');
  assert.equal(detectarObjecion('buenas tardes'), null);
});

test('el retorno estimado se declara como proyección, no como promesa', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  const p = generarPresupuestos(r)[0];
  const ret = estimarRetorno(r, p);
  assert.ok(ret.advertencia.includes('no en una promesa'));
  assert.ok(ret.consultasExtraMes > 0);
});

test('resumenCorto elige un hallazgo evidente para la apertura del correo', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  const res = resumenCorto(r);
  const h = r.hallazgos.find(x => x.titulo === res.hallazgoTop);
  assert.ok(h, 'el hallazgo citado existe en los hallazgos');
  assert.equal(h.evidente, true, 'el hallazgo citado en el correo tiene evidente: true');
});

test('el asunto del primer paso mide menos de 40 caracteres e incluye el puntaje', () => {
  const paso1 = SECUENCIA_PROSPECCION.find(p => p.paso === 1);
  const asunto = render(paso1.asunto, { score: 56, negocio: 'Panadería La Esquina de Oro de Don José S.A.' });
  assert.ok(asunto.length < 40, `asunto mide ${asunto.length} caracteres: "${asunto}"`);
  assert.ok(asunto.includes('56/100'), 'el asunto incluye el puntaje');
});
