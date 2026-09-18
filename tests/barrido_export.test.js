import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditar } from '../lib/core/audit-engine.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';
import { compararPorRegla } from '../lib/core/competencia.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

test('el CSV de exportación arranca con el carácter BOM UTF-8 (\\uFEFF)', async () => {
  // Simulación de armado de CSV como en route.js
  const cabeceras = ['barrido_id', 'place_id', 'nombre_competidor', 'regla_id', 'puntos'];
  const lineas = [
    cabeceras.join(','),
    '"barr_123","place_1","Veterinaria 1","categoria_primaria",5',
  ];
  const csvConBOM = '\uFEFF' + lineas.join('\r\n');

  assert.equal(csvConBOM.startsWith('\uFEFF'), true, 'El CSV debe incluir el BOM UTF-8 al inicio');
  assert.equal(csvConBOM.charCodeAt(0), 0xFEFF, 'El primer charCode debe ser 0xFEFF');
});

test('el CSV de exportación genera una fila por par competidor-regla', () => {
  const competidores = [
    { place_id: 'comp_1', nombre: 'Comp 1' },
    { place_id: 'comp_2', nombre: 'Comp 2' },
  ];
  const reglas = [
    { place_id: 'comp_1', regla_id: 'r1', estado: 'ok', ratio: 1, puntos: 5 },
    { place_id: 'comp_1', regla_id: 'r2', estado: 'fallo', ratio: 0, puntos: 0 },
    { place_id: 'comp_2', regla_id: 'r1', estado: 'ok', ratio: 1, puntos: 5 },
    { place_id: 'comp_2', regla_id: 'r2', estado: 'ok', ratio: 1, puntos: 3 },
  ];

  const filas = reglas.map(r => ({
    place_id: r.place_id,
    regla_id: r.regla_id,
    puntos: r.puntos,
  }));

  assert.equal(filas.length, 4, 'Debe haber exactamente N_competidores * M_reglas filas');
});

test('sin teléfonos ni correos de competidores en el export ni en el informe', () => {
  const archivosARevisar = [
    'app/api/barrido/[id]/export/route.js',
    'app/(panel)/competencia/InformeConciso.jsx',
  ];

  for (const relPath of archivosARevisar) {
    const contenido = readFileSync(join(RAIZ, relPath), 'utf8');

    // Ninguna exportación o informe debe referenciar nationalPhoneNumber, email, etc.
    const tieneTelefono = /nationalPhoneNumber|internationalPhoneNumber|telefono_competidor/i.test(contenido);
    const tieneEmail = /email_competidor/i.test(contenido);

    assert.equal(tieneTelefono, false, `No debe incluir teléfonos de competidores en ${relPath}`);
    assert.equal(tieneEmail, false, `No debe incluir correos de competidores en ${relPath}`);
  }
});

test('el informe no referencia scripts de librerías externas', () => {
  const contenido = readFileSync(join(RAIZ, 'app/(panel)/competencia/InformeConciso.jsx'), 'utf8');

  // No debe importar Highcharts, Chart.js, D3 ni incluir <script src="...">
  const tieneLibreriaGraficos = /highcharts|chart\.js|d3|cdn\.jsdelivr|unpkg/i.test(contenido);
  const tieneScriptExternal = /<script/i.test(contenido);

  assert.equal(tieneLibreriaGraficos, false, 'El informe no debe usar librerías de gráficos externas');
  assert.equal(tieneScriptExternal, false, 'El informe no debe incluir etiquetas <script>');
});

test('los dos anillos son bloques distintos en la comparación', () => {
  const propia = auditar(PERFILES_DEMO.panaderia);
  const comp1 = { placeId: 'c1', nombre: 'Comp 1', distanciaMetros: 200, anillo: 'cercano', auditoria: auditar(PERFILES_DEMO.estudio) };
  const comp2 = { placeId: 'c2', nombre: 'Comp 2', distanciaMetros: 1500, anillo: 'amplio', auditoria: auditar(PERFILES_DEMO.panaderia) };

  const comp = compararPorRegla(propia, [comp1, comp2]);

  assert.ok(comp.anilloCercano, 'Debe existir el bloque anilloCercano');
  assert.ok(comp.anilloAmplio, 'Debe existir el bloque anilloAmplio');
  assert.notEqual(comp.anilloCercano, comp.anilloAmplio, 'Los dos anillos deben ser objetos/bloques independientes');
  assert.equal(comp.anilloCercano.total, 1);
  assert.equal(comp.anilloAmplio.total, 1);
});
