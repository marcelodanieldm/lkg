import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditar, compararConCompetencia } from '../lib/core/audit-engine.js';
import { generarPresupuestos, generarAlternativasReduccion, estimarRetorno } from '../lib/core/quote-engine.js';
import { generarInformeHTML, resumenCorto } from '../lib/core/report.js';
import { detectarObjecion, SECUENCIA_PROSPECCION, render } from '../lib/core/sequences.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';
import { DIMENSIONES } from '../lib/core/rubric.js';
import { contradicciones, temasRecurrentes } from '../lib/core/resenas.js';
import fs from 'node:fs';
import path from 'node:path';

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
});

test('el asunto del primer paso mide menos de 40 caracteres e incluye el puntaje', () => {
  const paso1 = SECUENCIA_PROSPECCION.find(p => p.paso === 1);
  const asunto = render(paso1.asunto, { score: 56, negocio: 'Panadería La Esquina de Oro de Don José S.A.' });
  assert.ok(asunto.length < 40, `asunto mide ${asunto.length} caracteres: "${asunto}"`);
  assert.ok(asunto.includes('56/100'), 'el asunto incluye el puntaje');
});

test('contradicciones detecta la reseña del domingo en la panadería y la asocia al campo horarios', () => {
  const c = contradicciones(PERFILES_DEMO.panaderia);
  assert.ok(c.length >= 1, 'detectó al menos una contradicción');
  const h = c.find(x => x.campo === 'horarios');
  assert.ok(h, 'asoció la contradicción al campo de horarios');
  assert.ok(h.cita.includes('domingo'), 'incluye la cita del domingo');
});

test('contradicciones y temasRecurrentes con resenasMuestra vacío devuelven arrays vacíos sin romper', () => {
  assert.deepEqual(contradicciones(PERFILES_DEMO.estudio), []);
  assert.deepEqual(temasRecurrentes(PERFILES_DEMO.estudio), []);
  assert.deepEqual(contradicciones(null), []);
  assert.deepEqual(temasRecurrentes(null), []);
});

test('temasRecurrentes identifica palabras repetidas en 2 o más reseñas distintas', () => {
  const p = {
    resenasMuestra: [
      { texto: 'Las medialunas son riquísimas.' },
      { texto: 'Compré medialunas de manteca.' },
    ],
  };
  const t = temasRecurrentes(p);
  assert.ok(t.some(x => x.tema === 'medialunas' && x.repeticiones === 2));
});

test('el informe HTML incluye la sección de observaciones en reseñas cuando existen contradicciones', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  const html = generarInformeHTML(r, { agencia: 'Demo' });
  assert.ok(html.includes('Observaciones en las reseñas de los clientes'), 'el informe incluye la sección de reseñas');
  assert.ok(html.includes('Fui un domingo y estaba cerrado'), 'cita la reseña textual en el informe');
  assert.ok(html.includes('Análisis cruzado realizado sobre las 2 reseña(s) de muestra'), 'menciona la cantidad de reseñas analizadas');
});

test('PROPIEDAD CRÍTICA: ni rubric.js ni audit-engine.js importan resenas.js', () => {
  const rubricPath = path.resolve('lib/core/rubric.js');
  const enginePath = path.resolve('lib/core/audit-engine.js');
  const rubricContent = fs.readFileSync(rubricPath, 'utf8');
  const engineContent = fs.readFileSync(enginePath, 'utf8');

  assert.ok(!/resenas\.js/.test(rubricContent), 'rubric.js NO puede importar resenas.js (el puntaje es independiente de las reseñas)');
  assert.ok(!/resenas\.js/.test(engineContent), 'audit-engine.js NO puede importar resenas.js (el motor de auditoría es independiente de las reseñas)');
});

test('toda regla de rubric.js declara comoSeArregla con donde, pasos (al menos 1) y minutos', () => {
  for (const dim of DIMENSIONES) {
    for (const regla of dim.reglas) {
      assert.ok(regla.comoSeArregla, `regla ${regla.id} en ${dim.id} no tiene comoSeArregla`);
      assert.ok(typeof regla.comoSeArregla.donde === 'string' && regla.comoSeArregla.donde.length > 0,
        `regla ${regla.id} en ${dim.id} no tiene 'donde' válido`);
      assert.ok(Array.isArray(regla.comoSeArregla.pasos) && regla.comoSeArregla.pasos.length >= 1,
        `regla ${regla.id} en ${dim.id} no tiene pasos (mínimo 1)`);
      assert.ok(typeof regla.comoSeArregla.minutos === 'number' && regla.comoSeArregla.minutos > 0,
        `regla ${regla.id} en ${dim.id} no tiene minutos > 0`);
    }
  }
});

test('el informe HTML de panaderia contiene una casilla por cada hallazgo', () => {
  const r = auditar(PERFILES_DEMO.panaderia);
  const html = generarInformeHTML(r, { agencia: 'Demo' });
  const topHallazgos = r.hallazgos.slice(0, 8);
  const matches = [...html.matchAll(/class="chk-tarea"/g)];
  assert.equal(matches.length, topHallazgos.length,
    `el informe renderizado tiene ${matches.length} casillas y se esperaban ${topHallazgos.length}`);
});


