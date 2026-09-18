import test from 'node:test';
import assert from 'node:assert/strict';

import { obtenerMuestraBarrido } from '../lib/integrations/barrido-engine.js';
import { generarInformeHTML } from '../lib/core/report.js';
import { auditar } from '../lib/core/audit-engine.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';

test('muestra de barrido: gasta como máximo una llamada de búsqueda y ninguna de detalle', async () => {
  // Simular la ejecución sin caché
  const mockDb = {
    config: async () => true,
    gastoDelMes: async () => 0,
    obtenerBarridoReciente: async () => null,
  };

  const perfilTarget = {
    ...PERFILES_DEMO.panaderia,
    sitioWeb: 'https://panaderialaesquina.com',
    cantidadResenas: 12,
  };

  const res = await obtenerMuestraBarrido({
    placeId: 'target_1',
    lat: -31.42,
    lng: -64.18,
    categoria: 'Panadería',
    ciudad: 'Córdoba',
    perfil: perfilTarget,
    fuenteDatos: mockDb,
  });

  if (res) {
    assert.equal(res.llamadasGastadas, 1, 'Debe gastar como máximo 1 llamada de búsqueda');
    assert.equal(res.cache, false);
  }
});

test('muestra de barrido: con caché disponible gasta cero llamadas', async () => {
  const mockDb = {
    config: async () => true,
    gastoDelMes: async () => 0,
    obtenerBarridoReciente: async (celda, cat) => ({
      id: 'barr_cache_999',
      celda,
      categoria: cat,
      fecha: new Date().toISOString(),
    }),
    obtenerBarridoCompleto: async () => ({
      barrido: { id: 'barr_cache_999' },
      competidores: Array.from({ length: 10 }, (_, i) => ({
        place_id: `comp_${i + 1}`,
        nombre: `Panadería ${i + 1}`,
        auditado_json: {
          perfil: {
            sitioWeb: i % 2 === 0 ? 'https://sitio.com' : null,
            cantidadResenas: (i + 1) * 10,
          },
        },
      })),
    }),
  };

  const res = await obtenerMuestraBarrido({
    placeId: 'target_1',
    lat: -31.42,
    lng: -64.18,
    categoria: 'Panadería',
    ciudad: 'Córdoba',
    perfil: PERFILES_DEMO.panaderia,
    fuenteDatos: mockDb,
  });

  assert.ok(res, 'Debe retornar la muestra desde caché');
  assert.equal(res.cache, true);
  assert.equal(res.llamadasGastadas, 0, 'Con caché debe gastar 0 llamadas');
  assert.equal(res.total, 10);
});

test('muestra de barrido: el bloque renderizado no contiene la palabra "posición" ni ningún puesto', () => {
  const auditoria = auditar(PERFILES_DEMO.panaderia);
  const muestraBarrido = {
    total: 38,
    categoria: 'Veterinaria',
    pocoCompetida: false,
    hechos: [
      '31 de 38 declaran sitio web. Vos no.',
      '24 de 38 tienen más de 40 reseñas. Vos tenés 12.',
    ],
  };

  const html = generarInformeHTML(auditoria, { muestraBarrido });

  assert.ok(html.includes('Y cómo estás frente a tu cuadra'), 'Debe incluir el título del bloque');
  assert.ok(html.includes('38 veterinarias dentro de 4 km'), 'Debe incluir la densidad de competidores');
  assert.ok(html.includes('31 de 38 declaran sitio web. Vos no.'), 'Debe incluir el primer hecho');

  const bloqueHtml = html.slice(html.indexOf('Y cómo estás frente a tu cuadra'));

  // Reglas innegociables: NUNCA contiene palabra "posición" ni números de puesto en la comparación
  assert.equal(bloqueHtml.includes('posición'), false, 'El bloque NUNCA debe incluir la palabra posición');
  assert.equal(/puesto/i.test(bloqueHtml.split('Límite del relevamiento:')[0]), false, 'No debe publicar puestos en la comparación');
  assert.equal(/promedio/i.test(bloqueHtml), false, 'No debe incluir promedio del grupo');
});

test('muestra de barrido: con menos de ocho competidores sale el texto de zona poco competida', () => {
  const auditoria = auditar(PERFILES_DEMO.panaderia);
  const muestraPoca = {
    total: 5,
    categoria: 'Veterinaria',
    pocoCompetida: true,
    hechos: [],
  };

  const html = generarInformeHTML(auditoria, { muestraBarrido: muestraPoca });

  assert.ok(html.includes('Y cómo estás frente a tu cuadra'));
  assert.ok(html.includes('Hay pocos competidores directos en tu zona'), 'Debe indicar que hay pocos competidores directos');
  assert.ok(html.includes('encontramos solo 5 negocios'), 'Debe especificar la cifra reducida de competidores');
});

test('muestra de barrido: con el presupuesto agotado o deshabilitada en config el informe se genera igual sin el bloque', async () => {
  const mockDbExcedido = {
    config: async (clave, porDefecto) => {
      if (clave === 'muestra_barrido_activa') return true;
      if (clave === 'presupuesto_api_mes_usd') return 40;
      return porDefecto;
    },
    gastoDelMes: async () => 40.50, // Presupuesto agotado
  };

  const resExcedido = await obtenerMuestraBarrido({
    placeId: 'target_1',
    lat: -31.42,
    lng: -64.18,
    categoria: 'Panadería',
    fuenteDatos: mockDbExcedido,
  });

  assert.equal(resExcedido, null, 'Si el presupuesto está agotado debe retornar null');

  const auditoria = auditar(PERFILES_DEMO.panaderia);
  const html = generarInformeHTML(auditoria, { muestraBarrido: resExcedido });

  assert.ok(html.includes('Auditoría de'), 'El informe debe generarse completamente');
  assert.equal(html.includes('Y cómo estás frente a tu cuadra'), false, 'No debe contener el bloque si muestraBarrido es null');

  // Probar compuerta config deshabilitada
  const mockDbApagado = {
    config: async (clave) => {
      if (clave === 'muestra_barrido_activa') return false;
      return true;
    },
    gastoDelMes: async () => 0,
  };

  const resApagado = await obtenerMuestraBarrido({
    placeId: 'target_1',
    lat: -31.42,
    lng: -64.18,
    categoria: 'Panadería',
    fuenteDatos: mockDbApagado,
  });

  assert.equal(resApagado, null, 'Si config muestra_barrido_activa es false debe retornar null');
});
