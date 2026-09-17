/**
 * humo-places.js — Prueba de humo contra Google Places API (New).
 *
 * Audita un negocio REAL de Google Maps sin datos mockeados.
 *
 * Uso:
 *   npm run humo                          # Elige una categoría al azar y busca
 *   npm run humo -- "panadería Rosario"    # Usa la consulta indicada
 *   npm run humo -- ChIJ...               # Audita directamente el placeId indicado
 */

import { buscarNegocios, detallePlace, estimarCosto } from '../lib/integrations/places.js';
import { desdePlacesApi } from '../lib/core/normalize.js';
import { auditar } from '../lib/core/audit-engine.js';

const CATEGORIAS_RANDOM = [
  'panadería Rosario',
  'veterinaria Rosario',
  'taller mecánico Rosario',
  'farmacia Rosario',
  'cafetería Rosario',
  'heladería Rosario',
  'odontólogo Rosario',
  'ferretería Rosario',
];

function afirmar(condicion, mensaje) {
  if (!condicion) {
    console.error(`\n❌ AFIRMACIÓN FALLIDA: ${mensaje}`);
    process.exit(1);
  }
  console.log(`✓ ${mensaje}`);
}

async function main() {
  const arg = process.argv[2]?.trim();
  let placeId = null;
  let consulta = null;
  let fueBusqueda = false;

  if (arg) {
    if (arg.startsWith('ChI') || arg.startsWith('0x') || (!arg.includes(' ') && arg.length > 20)) {
      placeId = arg;
    } else {
      consulta = arg;
    }
  }

  if (!placeId) {
    if (!consulta) {
      consulta = CATEGORIAS_RANDOM[Math.floor(Math.random() * CATEGORIAS_RANDOM.length)];
    }
    fueBusqueda = true;
    console.log(`Buscando con consulta: "${consulta}" (máx 5 resultados)...`);
    const resultados = await buscarNegocios({ consulta, max: 5 });
    if (!resultados || resultados.length === 0) {
      console.error(`No se encontraron negocios en Google Places para la consulta "${consulta}".`);
      process.exit(1);
    }
    const elegido = resultados[Math.floor(Math.random() * resultados.length)];
    placeId = elegido.id;
  }

  console.log('\n==================================================');
  console.log(`PLACE ID ELEGIDO: ${placeId}`);
  console.log('==================================================\n');

  // 3. Llama a detallePlace con reseñas y normaliza con desdePlacesApi
  const rawPlace = await detallePlace(placeId, { conResenas: true });
  const perfil = desdePlacesApi(rawPlace);

  console.log('--- PERFIL NORMALIZADO ---');
  console.dir(perfil, { depth: null, colors: true });
  console.log('--------------------------\n');

  // 4. AFIRMACIONES DURAS
  console.log('--- EVALUANDO AFIRMACIONES ---');
  afirmar(
    (perfil.fuente === 'places' || perfil.fuente === 'places_api') && perfil.fuente !== 'asistido' && perfil.fuente !== 'demo',
    `perfil.fuente es de Places API ("${perfil.fuente}")`
  );

  afirmar(
    !placeId.startsWith('demo_') && !placeId.startsWith('inf_'),
    `placeId no empieza con demo_ ni inf_ ("${placeId}")`
  );

  if (consulta) {
    const primerSegmento = consulta.split(',')[0].trim().toLowerCase();
    const consultaMin = consulta.trim().toLowerCase();
    const nombreMin = (perfil.nombre || '').trim().toLowerCase();
    const direccionMin = (perfil.direccion || '').trim().toLowerCase();

    afirmar(
      nombreMin !== primerSegmento && nombreMin !== consultaMin,
      `perfil.nombre ("${perfil.nombre}") no es fabricado a partir de la consulta`
    );

    afirmar(
      direccionMin !== `${consultaMin}, argentina` && direccionMin !== `${primerSegmento}, argentina`,
      `perfil.direccion ("${perfil.direccion}") no es fabricado pegando ", Argentina"`
    );
  }

  const hasRating = perfil.rating !== null && perfil.rating !== undefined && perfil.rating > 0;
  const hasResenas = typeof perfil.cantidadResenas === 'number' && perfil.cantidadResenas > 0;
  const hasFotos = typeof perfil.cantidadFotos === 'number' && perfil.cantidadFotos > 0;
  const datosValidosCount = [hasRating, hasResenas, hasFotos].filter(Boolean).length;

  afirmar(
    datosValidosCount >= 2,
    `Al menos dos entre rating, cantidadResenas y cantidadFotos son reales y >0 (rating: ${perfil.rating}, reseñas: ${perfil.cantidadResenas}, fotos: ${perfil.cantidadFotos})`
  );

  if (perfil.cantidadResenas > 0) {
    afirmar(
      Array.isArray(perfil.resenasMuestra) && perfil.resenasMuestra.some(r => r.texto && r.texto.trim().length > 0),
      `cantidadResenas > 0 (${perfil.cantidadResenas}) y resenasMuestra trae al menos una reseña con texto no vacío`
    );
  }
  console.log('------------------------------\n');

  // 5. Corre auditar(perfil) DOS VECES y afirma determinismo
  const audit1 = auditar(perfil);
  const audit2 = auditar(perfil);

  afirmar(
    audit1.score === audit2.score,
    `El motor es determinista (primera corrida dio ${audit1.score} y segunda dio ${audit2.score})`
  );

  // 6. Imprime puntaje, banda y primeros 5 hallazgos
  console.log('\n--- RESULTADO DE AUDITORÍA ---');
  console.log(`Puntaje: ${audit1.score}/100`);
  console.log(`Banda: ${audit1.banda.etiqueta} (${audit1.banda.clave})`);
  console.log(`Resumen de banda: ${audit1.banda.resumen}`);
  console.log('\nPrimeros 5 hallazgos:');
  (audit1.hallazgos || []).slice(0, 5).forEach((h, idx) => {
    console.log(` ${idx + 1}. [Regla: ${h.id}] ${h.titulo}`);
    console.log(`    Severidad: ${h.severidad} (-${h.puntosPerdidos} pts)`);
    console.log(`    Evidencia: ${h.evidencia}`);
  });
  console.log('------------------------------\n');

  // 7. Costo estimado
  const costo = estimarCosto(1, { conResenas: true, incluirBusqueda: fueBusqueda });
  console.log('--- COSTO ESTIMADO DE LA CORRIDA ---');
  console.log(costo);
  console.log('------------------------------------');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
