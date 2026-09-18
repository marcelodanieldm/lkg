import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { generarInformeHTML, upgradeInformeHTML } from '../lib/core/report.js';
import { auditar } from '../lib/core/audit-engine.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';
import { recongelarInformeConBarrido } from '../lib/integrations/barrido-engine.js';

test('PROPIEDAD CRÍTICA: al recongelar un informe con el barrido completo, las cifras de la auditoría no cambian', () => {
  const auditoria = auditar(PERFILES_DEMO.panaderia);
  const muestraBarrido = {
    total: 38,
    categoria: 'Panadería',
    pocoCompetida: false,
    hechos: [
      '31 de 38 declaran sitio web. Vos no.',
      '24 de 38 tienen más de 40 reseñas. Vos tenés 12.',
    ],
  };

  const htmlOriginal = generarInformeHTML(auditoria, { muestraBarrido });

  const comparacionCompleta = {
    posicion: 4,
    total: 38,
    resumen: { totalCompetidores: 38 },
    porDimension: {
      fundamentos: { nombre: 'Fundamentos', propio: 70, competencia: 85, delta: -15 },
      reputacion: { nombre: 'Reputación', propio: 60, competencia: 75, delta: -15 },
    },
    anilloCercano: {
      competidores: [
        { nombre: 'Panadería El Sol', distanciaMetros: 120, auditoria: { score: 88 } },
        { nombre: 'Panadería Centro', distanciaMetros: 340, auditoria: { score: 82 } },
      ],
    },
    parrafos: {
      parrafo1: 'En tu zona cercana hay competidores consolidados.',
      parrafo2: 'Mejorar el tiempo de respuesta subirá 12 puntos.',
    },
  };

  const htmlRecongelado = upgradeInformeHTML(htmlOriginal, comparacionCompleta);

  // 1. El HTML recongelado incluye el nuevo bloque completo
  assert.ok(htmlRecongelado.includes('Posición en el grupo analizado'), 'Debe incluir la posición en el grupo');
  assert.ok(htmlRecongelado.includes('Panadería El Sol'), 'Debe listar los vecinos del anillo cercano');
  assert.ok(htmlRecongelado.includes('En tu zona cercana hay competidores consolidados.'), 'Debe incluir los párrafos de análisis');

  // 2. INVARIANTE CRÍTICO: Las cifras de auditoría, título, puntaje y hallazgos NO cambiaron
  assert.equal(htmlRecongelado.includes(`<div class="num">${auditoria.score}<small>/100</small></div>`), true, 'El score debe ser idéntico');
  
  const partesOriginales = htmlOriginal.split('<h2>Y cómo estás frente a tu cuadra</h2>');
  const partesRecongeladas = htmlRecongelado.split('<h2><span class="n">00</span>Frente a la competencia directa</h2>');

  assert.equal(partesOriginales[0].trim(), partesRecongeladas[0].trim(), 'Todo el HTML antes del bloque de competencia debe ser 100% idéntico byte a byte');

  // El final después del bloque (CTA y footer) también debe ser idéntico
  const ctaOriginal = htmlOriginal.slice(htmlOriginal.indexOf('<div class="cta">'));
  const ctaRecongelado = htmlRecongelado.slice(htmlRecongelado.indexOf('<div class="cta">'));
  assert.equal(ctaOriginal.trim(), ctaRecongelado.trim(), 'El footer y CTA después del bloque deben ser 100% idénticos byte a byte');
});

test('recongelarInformeConBarrido: actualiza el informe resguardando las cifras deterministas', async () => {
  let informeActualizado = null;

  const htmlOriginal = generarInformeHTML(auditar(PERFILES_DEMO.panaderia), {
    muestraBarrido: { total: 15, categoria: 'Panadería', hechos: ['10 de 15 tienen sitio'] },
  });

  const mockDb = {
    informeHTML: async (leadId) => (leadId === 'lead_test_1' ? htmlOriginal : null),
    recongelarInforme: async (leadId, nuevoHtml) => {
      informeActualizado = { leadId, nuevoHtml };
      return { ok: true };
    },
  };

  const comparacion = {
    posicion: 2,
    total: 15,
    porDimension: {},
    anilloCercano: { competidores: [] },
  };

  const res = await recongelarInformeConBarrido('lead_test_1', comparacion, { fuenteDatos: mockDb });

  assert.equal(res.ok, true);
  assert.equal(res.leadId, 'lead_test_1');
  assert.ok(informeActualizado);
  assert.equal(informeActualizado.leadId, 'lead_test_1');
  assert.ok(informeActualizado.nuevoHtml.includes('Posición en el grupo analizado'));
});

test('PROPIEDAD CRÍTICA: barrido_pendientes en tareas no llama a enviar() ni gmail.js directo', () => {
  const rutaRoute = path.join(process.cwd(), 'app', 'api', 'cron', '[tarea]', 'route.js');
  const codigoRoute = fs.readFileSync(rutaRoute, 'utf-8');

  // Extraer la función barrido_pendientes
  const inicioBarrido = codigoRoute.indexOf('async barrido_pendientes()');
  assert.ok(inicioBarrido !== -1, 'Debe existir la tarea barrido_pendientes');

  const finBarrido = codigoRoute.indexOf('async informe_cliente()', inicioBarrido);
  assert.ok(finBarrido !== -1, 'Debe haber un delimitador de fin de función');

  const codigoBarrido = codigoRoute.slice(inicioBarrido, finBarrido);

  assert.equal(codigoBarrido.includes('enviar('), false, 'PROPIEDAD CRÍTICA: barrido_pendientes NUNCA llama a enviar()');
  assert.equal(codigoBarrido.includes('gmail.js'), false, 'PROPIEDAD CRÍTICA: barrido_pendientes NUNCA importa ni llama gmail.js');
  assert.ok(codigoBarrido.includes('Aprobaciones'), 'Las intenciones de envío deben ir a la tabla Aprobaciones');
  assert.ok(codigoBarrido.includes("decision: 'PENDIENTE'"), 'La decisión en Aprobaciones debe quedar en PENDIENTE');
});
