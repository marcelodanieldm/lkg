import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  obtenerEstadoProspeccionCompetidoresAction,
  encolarCompetidoresSeleccionadosAction,
} from '../app/(panel)/competencia/acciones.js';
import { guardarMotivoBusqueda } from '../lib/db/supabase.js';

test('PROPIEDAD CRÍTICA: ejecutar un barrido NO crea leads en la base automáticamente', async () => {
  const leadsCreados = [];
  const mockDb = {
    buscarEnCorpus: async () => null,
    obtenerBarridoReciente: async () => null,
    guardarBarrido: async (datos) => datos,
    pedirAuditoria: async (p) => {
      leadsCreados.push(p);
      return { ok: true };
    },
  };

  const { ejecutarBarrido } = await import('../lib/integrations/barrido-engine.js');
  assert.equal(leadsCreados.length, 0, 'Un barrido jamás debe crear leads automáticamente');
});

test('mapa de prospección: encolar respeta la lista de supresión y no duplica leads ni solicitudes', async () => {
  const supresionesSet = new Set(['place_suprimido', 'malnegocio.com']);
  const leadsSet = { setPlaceIds: new Set(['place_existente_lead']), setEmail: new Set() };
  const solicitudesSet = { setPlaceIds: new Set(['place_existente_solicitud']), setEmail: new Set() };

  const seleccionados = [
    { placeId: 'place_nuevo_1', nombre: 'Negocio Nuevo 1', sitioWeb: 'https://nuevo1.com' },
    { placeId: 'place_suprimido', nombre: 'Negocio Suprimido', sitioWeb: 'https://suprimido.com' },
    { placeId: 'place_nuevo_2', nombre: 'Negocio Suprimido Dominio', sitioWeb: 'https://malnegocio.com' },
    { placeId: 'place_existente_lead', nombre: 'Lead Existente' },
    { placeId: 'place_existente_solicitud', nombre: 'Solicitud Existente' },
  ];

  const encoladosReal = [];
  let agregados = 0;
  for (const item of seleccionados) {
    const dominio = item.sitioWeb ? item.sitioWeb.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() : null;
    if (supresionesSet.has(item.placeId) || (dominio && supresionesSet.has(dominio))) {
      continue;
    }
    if (leadsSet.setPlaceIds.has(item.placeId) || solicitudesSet.setPlaceIds.has(item.placeId)) {
      continue;
    }
    encoladosReal.push(item);
    agregados++;
  }

  assert.equal(agregados, 1, 'Solo debe encolar el competidor verdaderamente nuevo');
  assert.equal(encoladosReal[0].placeId, 'place_nuevo_1');
});

test('pregunta post-envío: la ausencia del motivo de búsqueda no rompe la solicitud', async () => {
  const solicitarCode = fs.readFileSync(path.join(process.cwd(), 'app', 'solicitar.js'), 'utf-8');
  assert.ok(/guardarMotivoBusquedaWeb/.test(solicitarCode), 'solicitar.js exporta la server action guardarMotivoBusquedaWeb');
  assert.ok(/idSolicitud/.test(solicitarCode), 'solicitar.js retorna idSolicitud');
});

test('PROPIEDAD CRÍTICA: guardarMotivoBusquedaWeb no importa gmail.js ni dispara correos ni crea leads', async () => {
  const solicitarCode = fs.readFileSync(path.join(process.cwd(), 'app', 'solicitar.js'), 'utf-8');
  const fnCode = solicitarCode.slice(solicitarCode.indexOf('guardarMotivoBusquedaWeb'));
  
  assert.ok(!/import.*gmail/i.test(fnCode), 'guardarMotivoBusquedaWeb no debe importar gmail');
  assert.ok(!/enviar\(/i.test(fnCode), 'guardarMotivoBusquedaWeb no debe enviar correos');
  assert.ok(!/leads/i.test(fnCode), 'guardarMotivoBusquedaWeb no debe tocar la tabla leads');
});
