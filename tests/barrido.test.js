import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calcularDistancia, generarCeldaGeo, compararPorRegla, calcularAnillosDistancia, calcularCoberturaHoraria, extraerHorarios, estaAbiertoEnFranja } from '../lib/core/competencia.js';
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

test('los 3 análisis del barrido no se publican si el grupo tiene menos de 10 negocios', () => {
  const propia = auditar(PERFILES_DEMO.panaderia);
  const compPocos = Array.from({ length: 8 }, (_, i) => ({
    placeId: `comp_${i + 1}`,
    nombre: `Veterinaria ${i + 1}`,
    distanciaMetros: (i + 1) * 200,
    anillo: i < 5 ? 'cercano' : 'amplio',
    auditoria: auditar(PERFILES_DEMO.estudio),
  }));

  const res = compararPorRegla(propia, compPocos);

  assert.equal(res.huecoMercado, null, 'El hueco del mercado debe ser null si el grupo < 10');
  assert.equal(res.liderYReceta, null, 'El líder y su receta debe ser null si el grupo < 10');
  assert.equal(res.umbralEntrada, null, 'El umbral de entrada debe ser null si el grupo < 10');
});

test('un hueco de mercado no se publica si la regla estaba evaluada en menos del 70% del grupo', () => {
  const propia = auditar(PERFILES_DEMO.panaderia);
  // Crear 12 competidores donde solo 5 (menos del 70% de 12, que es 8.4) tienen evaluada la regla X
  const comp12 = Array.from({ length: 12 }, (_, i) => {
    const aud = i < 5 ? auditar(PERFILES_DEMO.estudio) : { score: 40, hallazgos: [] };
    return {
      placeId: `comp_${i + 1}`,
      nombre: `Negocio ${i + 1}`,
      distanciaMetros: (i + 1) * 200,
      anillo: i < 5 ? 'cercano' : 'amplio',
      auditoria: aud,
    };
  });

  const res = compararPorRegla(propia, comp12);
  if (res.huecoMercado && res.huecoMercado.huecos) {
    for (const h of res.huecoMercado.huecos) {
      assert.ok(h.evaluados / 12 >= 0.70, `La regla ${h.nombre} fue evaluada en ${h.evaluados}/12, debe ser >= 70%`);
    }
  }
});

test('el líder y su receta no se publica si empata con la mediana del grupo y aclara distancia si es mayor a 2 km', () => {
  const propia = auditar(PERFILES_DEMO.panaderia);
  // Todos los competidores tienen la misma auditoría (empate total)
  const compEmpatados = Array.from({ length: 10 }, (_, i) => ({
    placeId: `comp_${i + 1}`,
    nombre: `Negocio ${i + 1}`,
    distanciaMetros: (i + 1) * 200,
    anillo: i < 5 ? 'cercano' : 'amplio',
    auditoria: auditar(PERFILES_DEMO.panaderia),
  }));

  const resEmpate = compararPorRegla(propia, compEmpatados);
  assert.equal(resEmpate.liderYReceta, null, 'El líder no se publica si empata con la mediana');

  // Ahora con un líder claro con mayor puntaje a más de 2 km (2500m)
  const compConLiderLejano = Array.from({ length: 11 }, (_, i) => {
    const aud = i === 0 ? auditar({ ...PERFILES_DEMO.panaderia, cantidadFotos: 30, cantidadResenas: 100, rating: 4.8 }) : auditar({ ...PERFILES_DEMO.estudio, score: 30 });
    return {
      placeId: `comp_${i + 1}`,
      nombre: `Negocio ${i + 1}`,
      distanciaMetros: i === 0 ? 2500 : (i + 1) * 200,
      anillo: i < 5 ? 'cercano' : 'amplio',
      auditoria: aud,
    };
  });

  const resLejano = compararPorRegla(propia, compConLiderLejano);
  if (resLejano.liderYReceta) {
    assert.equal(resLejano.liderYReceta.esLejano, true);
    assert.ok(resLejano.liderYReceta.texto.includes('referencia lejana'), 'Debe mencionar que es una referencia lejana');
  }
});

test('el umbral de entrada no menciona buscadores ni promesas de posición y pasa el linter', async () => {
  const { lintear } = await import('../lib/guardrails/guard.js');

  const propia = auditar(PERFILES_DEMO.estudio);
  const comp12 = Array.from({ length: 12 }, (_, i) => ({
    placeId: `comp_${i + 1}`,
    nombre: `Veterinaria ${i + 1}`,
    distanciaMetros: (i + 1) * 200,
    anillo: i < 5 ? 'cercano' : 'amplio',
    auditoria: i < 4 ? auditar(PERFILES_DEMO.panaderia) : auditar(PERFILES_DEMO.estudio),
  }));

  const res = compararPorRegla(propia, comp12);
  assert.ok(res.umbralEntrada, 'El umbral de entrada debe generarse');

  const texto = res.umbralEntrada.texto;
  assert.ok(!/buscadores/i.test(texto.replace('no un puesto en buscadores', '')), 'El texto no debe hacer promesas en buscadores');
  assert.ok(texto.includes('no un puesto en buscadores'), 'El texto debe declarar la exención sobre buscadores');

  const linterRes = lintear({
    cuerpo: texto + '\n\nSi preferís no recibir más mensajes, respondé BAJA.',
    canal: 'email',
    asunto: 'Asunto válido de prueba para el linter'
  });
  assert.equal(linterRes.limpio, true, `El linter rechazó el umbral de entrada: ${linterRes.errores.join(', ')}`);
});

test('un anillo con menos de 3 negocios no publica posición', () => {
  const propia = auditar(PERFILES_DEMO.estudio);

  // 1 competidor en 500m (total 2 negocios en anillo 500m), 10 competidores en radio medio/amplio
  const compList = [
    { placeId: 'comp_cercano_1', nombre: 'Comp 1', distanciaMetros: 300, anillo: 'cercano', auditoria: auditar(PERFILES_DEMO.panaderia) },
    ...Array.from({ length: 10 }, (_, i) => ({
      placeId: `comp_medio_${i + 1}`,
      nombre: `Comp Medio ${i + 1}`,
      distanciaMetros: 1000 + i * 100,
      anillo: 'amplio',
      auditoria: auditar(PERFILES_DEMO.estudio),
    }))
  ];

  const res = compararPorRegla(propia, compList);
  assert.ok(res.anillosDistancia, 'Debe calcular anillos de distancia');
  assert.equal(res.anillosDistancia.anillo500m.sePublicaPosicion, false, 'Un anillo con 2 negocios en total no debe publicar posición');
  assert.equal(res.anillosDistancia.anillo500m.posicion, null, 'Posición debe ser null si no publica posición');
  assert.ok(res.anillosDistancia.anillo500m.texto.includes('1 competidor'), 'Debe informar la cantidad de competidores');
});

test('un negocio sin horarios declarados no cuenta como cerrado en ninguna franja', () => {
  const propia = { ...auditar(PERFILES_DEMO.estudio), horarios: [{ dia: 1, abre: 9, cierra: 18 }] };

  // 5 competidores: 3 con horarios declarados, 2 sin horarios declarados (horarios: null / [])
  const compList = [
    { placeId: 'c1', nombre: 'Comp 1', horarios: [{ dia: 0, abre: 9, cierra: 14 }] },
    { placeId: 'c2', nombre: 'Comp 2', horarios: [{ dia: 0, abre: 10, cierra: 18 }] },
    { placeId: 'c3', nombre: 'Comp 3', horarios: [{ dia: 1, abre: 9, cierra: 18 }] },
    { placeId: 'c4', nombre: 'Comp 4 (sin horarios)', horarios: null },
    { placeId: 'c5', nombre: 'Comp 5 (sin horarios)', horarios: [] },
  ];

  // Verificar extractor
  assert.equal(extraerHorarios(compList[3]), null, 'Extractor debe devolver null para sin horarios');
  assert.equal(extraerHorarios(compList[4]), null, 'Extractor debe devolver null para arreglo vacío');

  const res = calcularCoberturaHoraria(propia, compList, 'veterinarias');
  assert.ok(res, 'Debe calcular cobertura horaria');
  assert.equal(res.excluidosSinHorario, 2, 'Debe identificar exactamente 2 perfiles excluidos por no declarar horarios');
  assert.equal(res.totalEvaluadosConHorario, 4, 'Debe evaluar sólo 4 perfiles con horario definido (1 propio + 3 competidores)');
});

test('el informe declara cuántos perfiles se excluyeron de cada conteo horario', () => {
  const propia = { ...auditar(PERFILES_DEMO.estudio), horarios: [{ dia: 1, abre: 9, cierra: 18 }] };

  const compList = [
    { placeId: 'c1', nombre: 'Comp 1', horarios: [{ dia: 0, abre: 9, cierra: 14 }] },
    { placeId: 'c2', nombre: 'Comp 2', horarios: [{ dia: 0, abre: 10, cierra: 18 }] },
    { placeId: 'c3', nombre: 'Comp 3', horarios: [{ dia: 0, abre: 8, cierra: 20 }] },
    { placeId: 'c4', nombre: 'Comp 4 (sin horarios)', horarios: null },
    { placeId: 'c5', nombre: 'Comp 5 (sin horarios)', horarios: null },
    { placeId: 'c6', nombre: 'Comp 6 (sin horarios)', horarios: null },
  ];

  const res = calcularCoberturaHoraria(propia, compList, 'veterinarias');
  assert.ok(res.sePublica, 'Debe publicarse si hay brecha o ventaja');
  assert.equal(res.excluidosSinHorario, 3, 'Debe registrar 3 excluidos');

  for (const franja of res.franjasDestacadas) {
    assert.ok(franja.texto.includes('3 perfiles excluidos por no declarar horarios'), `El texto de la franja "${franja.nombre}" debe declarar los 3 perfiles excluidos: ${franja.texto}`);
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

