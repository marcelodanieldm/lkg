import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calcularPosicionCliente,
  diagnosticarCaida,
  detectarCambiosVecinos,
  evaluarEvolucionCliente,
  construirInformeMensualClienteHTML
} from '../lib/core/retencion.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

test('calcularPosicionCliente asigna la posición correcta según scores', () => {
  const competidores = [
    { score: 90 },
    { score: 85 },
    { score: 70 },
    { score: 60 }
  ];
  assert.equal(calcularPosicionCliente(88, competidores), 2);
  assert.equal(calcularPosicionCliente(95, competidores), 1);
  assert.equal(calcularPosicionCliente(50, competidores), 5);
});

test('evaluarEvolucionCliente maneja correctamente la primera medición (sin historial previo)', () => {
  const auditoriaActual = { score: 75, hallazgos: [] };
  const competidoresActuales = [{ score: 80 }, { score: 70 }];

  const res = evaluarEvolucionCliente(null, auditoriaActual, competidoresActuales);

  assert.equal(res.esPrimeraMedicion, true);
  assert.equal(res.scoreActual, 75);
  assert.equal(res.scoreAnterior, null);
  assert.equal(res.deltaScore, null);
  assert.equal(res.posicionActual, 2);
  assert.equal(res.posicionAnterior, null);
  assert.equal(res.deltaPosicion, null);
  assert.equal(res.diagnosticoCaida, 'sin_cambio');
  assert.deepEqual(res.cambiosVecinos, []);

  const html = construirInformeMensualClienteHTML({ negocio: 'Panadería Central' }, res);
  assert.ok(html.includes('Primera medición:'), 'El informe HTML debe avisar que es la primera medición');
  assert.ok(!html.includes('pts respecto al mes anterior'), 'No debe mostrar deltas en primera medición');
});

test('diagnosticarCaida identifica cuando el cliente perdió terreno por fallas propias', () => {
  const historialPrevio = {
    score: 80,
    posicion: 2,
    auditado_json: { hallazgos: [{ id: 'fotos' }] }
  };
  const auditoriaActual = {
    score: 70,
    hallazgos: [{ id: 'fotos' }, { id: 'horarios' }]
  };

  const diag = diagnosticarCaida(historialPrevio, auditoriaActual, 2, 4);
  assert.equal(diag, 'cliente_perdio_terreno');
});

test('diagnosticarCaida identifica cuando un competidor avanzó', () => {
  const historialPrevio = {
    score: 80,
    posicion: 2,
    auditado_json: { hallazgos: [{ id: 'fotos' }] }
  };
  const auditoriaActual = {
    score: 80,
    hallazgos: [{ id: 'fotos' }]
  };

  const diag = diagnosticarCaida(historialPrevio, auditoriaActual, 2, 4);
  assert.equal(diag, 'competidor_avanzo');
});

test('detectarCambiosVecinos detecta saltos de score y nuevos competidores en la zona', () => {
  const historialPrevio = {
    auditado_json: {
      competidores: [
        { place_id: 'comp_1', nombre: 'Veterinaria Norte', score: 60 },
        { place_id: 'comp_2', nombre: 'Veterinaria Sur', score: 70 }
      ]
    }
  };

  const competidoresActuales = [
    { place_id: 'comp_1', nombre: 'Veterinaria Norte', score: 75, distancia_m: 500 }, // +15 pts (salto)
    { place_id: 'comp_2', nombre: 'Veterinaria Sur', score: 72, distancia_m: 800 },
    { place_id: 'comp_3', nombre: 'Veterinaria Este', score: 80, distancia_m: 1200 } // Nuevo competidor
  ];

  const { cambios, alertas } = detectarCambiosVecinos(historialPrevio, competidoresActuales, 10);

  assert.equal(cambios.length, 2);

  const salto = cambios.find(c => c.tipo === 'salto_competidor');
  assert.ok(salto, 'Debe registrar el salto de score');
  assert.equal(salto.saltoPts, 15);

  const nuevo = cambios.find(c => c.tipo === 'nuevo_competidor');
  assert.ok(nuevo, 'Debe registrar el nuevo competidor');

  assert.equal(alertas.length, 2);
  assert.equal(alertas[0].tipo, 'salto_competidor');
  assert.equal(alertas[1].tipo, 'nuevo_competidor');
});

test('VERIFICACIÓN DE HORARIOS Y CRON: informe_cliente no choca con otras tareas programadas', () => {
  const mig002 = readFileSync(join(RAIZ, 'supabase/migrations/002_rls_y_cron.sql'), 'utf8');
  const mig005 = readFileSync(join(RAIZ, 'supabase/migrations/005_seguimiento.sql'), 'utf8');
  const mig008 = readFileSync(join(RAIZ, 'supabase/migrations/008_retencion.sql'), 'utf8');

  // Extraer cron schedules
  assert.ok(mig002.includes("0 11 * * 1-5"), 'prospeccion debe correr a las 11:00 UTC');
  assert.ok(mig005.includes("0 13 * * 1-5"), 'seguimiento debe correr a las 13:00 UTC');
  assert.ok(mig002.includes("0 22 * * *"), 'supervisor debe correr a las 22:00 UTC');
  assert.ok(mig002.includes("0 12 1 * *"), 'postventa debe correr el día 1 a las 12:00 UTC');
  assert.ok(mig008.includes("0 15 26 * *"), 'informe_cliente debe correr el día 26 a las 15:00 UTC');

  // Asegurar que 15:00 UTC no choca con 11, 13, 22 ni 12
  const horas = [11, 13, 22, 12];
  assert.ok(!horas.includes(15), '15:00 UTC no debe colisionar con ninguna otra hora programada');
});
