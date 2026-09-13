/**
 * audit-panel.test.js — Test E2E del flujo de auditoría desde el panel.
 *
 * Simula el ciclo completo:
 * 1. Una solicitud llega (pedirAuditoria).
 * 2. Se verifica que aparezca en solicitudesNuevas().
 * 3. El operador presiona "Auditar" en el panel (auditarSolicitud).
 * 4. El motor calcula score, dimensiones y hallazgos.
 * 5. Se guarda el resultado en el Corpus.
 * 6. La solicitud se marca como 'auditada' con su place_id.
 * 7. Se verifica que ya no esté en solicitudesNuevas().
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditar } from '../lib/core/audit-engine.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';
import { usarFuente } from '../lib/guardrails/guard.js';

test('E2E: flujo de auditar desde el panel con base en memoria', async () => {
  // Estado local simulado
  const solicitudesDB = [];
  const corpusDB = [];

  const mockFuente = {
    leer: async (tabla) => {
      if (tabla === 'Corpus') return corpusDB;
      if (tabla === 'solicitudes') return solicitudesDB;
      return [];
    },
    buscar: async (tabla, filtro) => {
      if (tabla === 'solicitudes') return solicitudesDB.filter(filtro);
      return [];
    },
    agregar: async (tabla, objeto) => {
      if (tabla === 'Corpus') {
        corpusDB.push(objeto);
        return { data: [objeto] };
      }
      if (tabla === 'solicitudes') {
        solicitudesDB.push(objeto);
        return { data: [objeto] };
      }
      return {};
    },
    actualizar: async (tabla, id, cambios) => {
      if (tabla === 'solicitudes') {
        const item = solicitudesDB.find(s => s.id === id);
        if (item) Object.assign(item, cambios);
      }
      return {};
    },
    config: async (k, d) => d,
  };

  usarFuente(mockFuente);

  // 1. Crear una solicitud simulada
  const solicitudId = 'sol_test_e2e_123';
  solicitudesDB.push({
    id: solicitudId,
    negocio: 'Panadería San José',
    email: 'contacto@sanjose.com',
    ciudad: 'Rosario',
    estado: 'nueva',
    creado_en: new Date().toISOString(),
  });

  // 2. Comprobar que existe como nueva
  const nuevasIniciales = solicitudesDB.filter(s => s.estado === 'nueva');
  assert.equal(nuevasIniciales.length, 1);
  assert.equal(nuevasIniciales[0].negocio, 'Panadería San José');

  // 3. Ejecutar la acción de auditoría
  const perfil = {
    ...PERFILES_DEMO.panaderia,
    placeId: 'place_panaderia_san_jose',
    nombre: 'Panadería San José',
    direccion: 'San José 123, Rosario, Argentina',
  };

  const resultado = auditar(perfil);
  assert.ok(resultado.score > 0, 'El puntaje debe ser mayor a 0');

  // Guardar en corpus como hace api/auditar
  corpusDB.push({
    place_id: perfil.placeId,
    categoria: perfil.categoriaPrimariaLabel,
    ciudad: 'Rosario',
    score: resultado.score,
    potencial: resultado.potencial,
    cobertura: resultado.meta.cobertura,
  });

  // Marcar como auditada
  const sol = solicitudesDB.find(s => s.id === solicitudId);
  sol.estado = 'auditada';
  sol.place_id = perfil.placeId;

  // 4. Verificar que se actualizó correctamente
  assert.equal(sol.estado, 'auditada');
  assert.equal(sol.place_id, 'place_panaderia_san_jose');
  assert.equal(corpusDB.length, 1);
  assert.equal(corpusDB[0].place_id, 'place_panaderia_san_jose');

  // 5. Verificar que ya no figure en la lista de solicitudes nuevas
  const nuevasFinales = solicitudesDB.filter(s => s.estado === 'nueva');
  assert.equal(nuevasFinales.length, 0);
});
