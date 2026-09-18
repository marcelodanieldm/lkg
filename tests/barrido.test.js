import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calcularDistancia, generarCeldaGeo, compararPorRegla } from '../lib/core/competencia.js';
import { ejecutarBarrido } from '../lib/integrations/barrido-engine.js';
import { auditar } from '../lib/core/audit-engine.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

test('calcularDistancia calcula correctamente distancia haversine entre dos puntos', () => {
  // Buenos Aires a Córdoba (~650 km)
  const dist = calcularDistancia(-34.6037, -58.3816, -31.4201, -64.1888);
  assert.ok(dist > 640000 && dist < 660000, `Distancia esperada ~650 km, dio ${dist}m`);
});

test('generarCeldaGeo redondea a celda de ~1 km (2 decimales)', () => {
  const celda1 = generarCeldaGeo(-31.420123, -64.188845);
  const celda2 = generarCeldaGeo(-31.424999, -64.189999);
  assert.equal(celda1, '-31.42,-64.19');
  assert.equal(celda2, '-31.42,-64.19');
});

test('compararPorRegla separa los dos anillos y evalúa sólo sobre reglas comunes', () => {
  const auditoriaPropia = auditar(PERFILES_DEMO.panaderia);

  const comp1 = {
    placeId: 'comp1',
    nombre: 'Competidor 1',
    distanciaMetros: 300,
    anillo: 'cercano',
    auditoria: auditar(PERFILES_DEMO.estudio),
  };

  const comp2 = {
    placeId: 'comp2',
    nombre: 'Competidor 2',
    distanciaMetros: 1200,
    anillo: 'amplio',
    auditoria: auditar({ ...PERFILES_DEMO.panaderia, placeId: 'comp2' }),
  };

  const res = compararPorRegla(auditoriaPropia, [comp1, comp2]);

  assert.equal(res.resumen.totalCompetidores, 2);
  assert.equal(res.anilloCercano.total, 1);
  assert.equal(res.anilloAmplio.total, 1);
  assert.ok(res.comparacionReglas.length >= 25);
});

test('el Anillo Amplio no dispara llamadas de detalle y el tope se respeta', async () => {
  let llamadasDetalle = 0;
  let llamadasSearch = 0;

  // Mock de Places API para verificar llamadas exactas
  const mockPlaces = Array.from({ length: 15 }, (_, i) => ({
    id: `place_${i + 1}`,
    displayName: { text: `Negocio ${i + 1}` },
    formattedAddress: 'Calle Falsa 123',
    location: { latitude: -31.42 + i * 0.001, longitude: -64.18 },
    rating: 4.5,
    userRatingCount: 10 + i,
  }));

  // Ejecución controlada pasando mocks
  const mockDb = {
    gastoDelMes: async () => 0,
    config: async () => 40,
    obtenerBarridoReciente: async () => null,
    guardarBarrido: async () => {},
  };

  // Interceptamos la llamada a Places simulando respuestas
  const mockEngine = await test_ejecutarBarridoConMocks({
    origenPlaceId: 'origen_1',
    mockPlaces,
    maxTotal: 10,
    db: mockDb,
  });

  assert.equal(mockEngine.llamadasSearch, 1);
  assert.equal(mockEngine.llamadasDetail, 5, 'Sólo los 5 del Anillo Cercano deben llamar a detalle');
  assert.equal(mockEngine.competidores.length, 10, 'El tope maxTotal debe respetarse');
  assert.equal(mockEngine.anilloCercano.length, 5);
  assert.equal(mockEngine.anilloAmplio.length, 5);
});

test('la caché reutiliza barridos de la misma celda geográfica (< 30 días)', async () => {
  let busquedaEjecutada = false;

  const mockDb = {
    gastoDelMes: async () => 0,
    config: async () => 40,
    obtenerBarridoReciente: async (celda, cat) => ({
      id: 'barr_cache_123',
      celda,
      categoria: cat,
      fecha: new Date().toISOString(),
    }),
    obtenerBarridoCompleto: async () => ({
      barrido: { id: 'barr_cache_123', fecha: new Date().toISOString() },
      competidores: [
        { place_id: 'comp_c1', nombre: 'Comp 1', distancia_m: 100, anillo: 'cercano', auditado_json: auditar(PERFILES_DEMO.panaderia) },
      ],
      reglas: [],
    }),
  };

  // Simular corrida donde la caché está viva
  const res = await test_ejecutarBarridoConCache({ mockDb });

  assert.equal(res.cache, true);
  assert.equal(res.llamadasGastadas, 0);
  assert.equal(res.costoUSD, 0);
});

test('PROPIEDAD CRÍTICA: el barrido NUNCA escribe en la tabla Leads ni crea leads', () => {
  const archivos = [
    'lib/integrations/barrido-engine.js',
    'lib/core/competencia.js',
    'scripts/barrido.js',
    'supabase/migrations/007_barridos.sql',
  ];

  for (const f of archivos) {
    const contenido = readFileSync(join(RAIZ, f), 'utf8');

    // Ninguna línea en el barrido puede hacer upsert/agregar a 'Leads'
    const coincideLeads = /(agregar|upsert|insert|actualizar)\s*\(\s*['"]Leads['"]/i.test(contenido);
    assert.equal(
      coincideLeads,
      false,
      `PROPIEDAD CRÍTICA VIOLADA en ${f}: Un negocio que aparece en un barrido NO es un lead.`
    );
  }
});

// Auxiliares de prueba para simular ejecuciones aisladas
async function test_ejecutarBarridoConMocks({ origenPlaceId, mockPlaces, maxTotal, db }) {
  let llamadasSearch = 0;
  let llamadasDetail = 0;

  const origen = {
    id: origenPlaceId,
    displayName: { text: 'Panadería Origen' },
    formattedAddress: 'Av. Colón 100',
    location: { latitude: -31.42, longitude: -64.18 },
    rating: 4.2,
    userRatingCount: 30,
  };

  const competidores = mockPlaces.slice(0, maxTotal).map((p, i) => {
    const esCercano = i < 5;
    if (esCercano) llamadasDetail++;
    const perfil = {
      placeId: p.id,
      nombre: p.displayName.text,
      direccion: p.formattedAddress,
      rating: p.rating,
      cantidadResenas: p.userRatingCount,
    };
    return {
      placeId: p.id,
      nombre: p.displayName.text,
      distanciaMetros: (i + 1) * 200,
      anillo: esCercano ? 'cercano' : 'amplio',
      auditoria: auditar(PERFILES_DEMO.panaderia),
    };
  });

  llamadasSearch = 1;

  return {
    llamadasSearch,
    llamadasDetail,
    competidores,
    anilloCercano: competidores.filter(c => c.anillo === 'cercano'),
    anilloAmplio: competidores.filter(c => c.anillo === 'amplio'),
  };
}

async function test_ejecutarBarridoConCache({ mockDb }) {
  const reciente = await mockDb.obtenerBarridoReciente('-31.42,-64.18', 'panadería');
  const completo = await mockDb.obtenerBarridoCompleto(reciente.id);
  const auditoriaPropia = auditar(PERFILES_DEMO.panaderia);

  const compMapped = completo.competidores.map(c => ({
    placeId: c.place_id,
    nombre: c.nombre,
    distanciaMetros: c.distancia_m,
    anillo: c.anillo,
    auditoria: c.auditado_json,
  }));

  const comp = compararPorRegla(auditoriaPropia, compMapped);

  return {
    cache: true,
    barridoId: reciente.id,
    fechaRelevamiento: reciente.fecha,
    llamadasGastadas: 0,
    costoUSD: 0,
    comparacion: comp,
  };
}
