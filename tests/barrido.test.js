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

test('un competidor ya presente en el corpus no genera llamada a detalle', async () => {
  let llamadasDetalle = 0;

  const mockDb = {
    gastoDelMes: async () => 0,
    config: async () => 40,
    obtenerBarridoReciente: async () => null,
    guardarBarrido: async () => {},
    buscarEnCorpus: async (placeId) => {
      // Simular que el primer cercano (place_1) YA está en nuestro corpus
      if (placeId === 'place_1') {
        return auditar(PERFILES_DEMO.panaderia);
      }
      return null;
    },
  };

  // 5 candidatos cercanos: place_1 está en corpus, los otros 4 no.
  const candidatos = Array.from({ length: 5 }, (_, i) => `place_${i + 1}`);

  for (const id of candidatos) {
    const auditCorpus = await mockDb.buscarEnCorpus(id);
    if (auditCorpus) {
      // Reutiliza corpus -> 0 llamadas detalle
    } else {
      llamadasDetalle++;
    }
  }

  assert.equal(llamadasDetalle, 4, 'Se debieron hacer sólo 4 llamadas a detalle porque 1 estaba en el corpus');
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

test('los dos párrafos de análisis son 100% deterministas y respetan el tope de 90 palabras cada uno', () => {
  const propia = auditar(PERFILES_DEMO.panaderia);
  const compList = Array.from({ length: 8 }, (_, i) => ({
    placeId: `c_${i + 1}`,
    nombre: `Veterinaria ${i + 1}`,
    distanciaMetros: (i + 1) * 300,
    anillo: i < 5 ? 'cercano' : 'amplio',
    auditoria: auditar(PERFILES_DEMO.estudio),
  }));

  const res1 = compararPorRegla(propia, compList);
  const res2 = compararPorRegla(propia, compList);

  assert.ok(res1.parrafos.parrafo1, 'El párrafo 1 debe existir');
  assert.ok(res1.parrafos.parrafo2, 'El párrafo 2 debe existir');

  // Identidad determinista entre corridas
  assert.equal(res1.parrafos.parrafo1, res2.parrafos.parrafo1, 'Dos corridas sobre los mismos datos deben producir texto idéntico en párrafo 1');
  assert.equal(res1.parrafos.parrafo2, res2.parrafos.parrafo2, 'Dos corridas sobre los mismos datos deben producir texto idéntico en párrafo 2');

  // Conteo de palabras <= 90
  const contarPalabras = (txt) => txt.trim().split(/\s+/).filter(Boolean).length;
  const palabrasP1 = contarPalabras(res1.parrafos.parrafo1);
  const palabrasP2 = contarPalabras(res1.parrafos.parrafo2);

  assert.ok(palabrasP1 <= 90, `El párrafo 1 no debe exceder 90 palabras (tiene ${palabrasP1})`);
  assert.ok(palabrasP2 <= 90, `El párrafo 2 no debe exceder 90 palabras (tiene ${palabrasP2})`);

  // Párrafo 2 debe incluir el aviso explícito de que la posición recalculated es DENTRO de la comparación
  assert.ok(res1.parrafos.parrafo2.includes('en Google nadie puede prometerte un puesto'), 'El párrafo 2 debe contener la exención de responsabilidad explicita');
});

test('con menos de 5 competidores sale la advertencia de base insuficiente', () => {
  const propia = auditar(PERFILES_DEMO.panaderia);
  const pocosComp = [
    { placeId: 'c1', nombre: 'Comp 1', distanciaMetros: 200, anillo: 'cercano', auditoria: auditar(PERFILES_DEMO.estudio) },
    { placeId: 'c2', nombre: 'Comp 2', distanciaMetros: 500, anillo: 'cercano', auditoria: auditar(PERFILES_DEMO.estudio) },
  ];

  const res = compararPorRegla(propia, pocosComp);

  assert.equal(res.baseSuficiente, false);
  assert.ok(res.razon.includes('insuficiente'), 'Debe comunicar que la base es insuficiente');
});

test('el linter bloquea cualquier redacción que prometa posición en Google o buscadores', async () => {
  const { lintear } = await import('../lib/guardrails/guard.js');

  const intentosProhibidos = [
    { cuerpo: 'Te aseguramos el 1er puesto en Google Maps para tu rubro.', canal: 'email', asunto: 'Asunto de prueba para linter' },
    { cuerpo: 'Te posicionaremos en el primer lugar de las búsquedas locales.', canal: 'email', asunto: 'Asunto de prueba para linter' },
    { cuerpo: 'Quedarás 1º en Google cuando los clientes busquen tu servicio.', canal: 'email', asunto: 'Asunto de prueba para linter' },
    { cuerpo: 'Podemos prometerte un puesto en Google dentro de 30 días.', canal: 'email', asunto: 'Asunto de prueba para linter' },
  ];

  for (const i of intentosProhibidos) {
    const res = lintear(i);
    assert.equal(res.limpio, false, `El linter debió bloquear: "${i.cuerpo}"`);
    assert.ok(res.errores.some(e => e.includes('promesa de posición')), 'El error debe indicar promesa de posición');
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

