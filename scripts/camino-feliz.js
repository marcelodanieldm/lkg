/**
 * camino-feliz.js — Flujo completo de auditoría y evaluación del guardián para un negocio real.
 *
 * Se detiene en la decisión del guardián. NO ENVÍA NADA A NINGÚN PROSPECTO.
 *
 * Uso:
 *   npm run camino                          # Elige una categoría al azar y busca
 *   npm run camino -- "panadería Rosario"    # Usa la consulta indicada
 *   npm run camino -- ChIJ...               # Audita directamente el placeId indicado
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buscarNegocios, detallePlace } from '../lib/integrations/places.js';
import { desdePlacesApi, aplicarAnalisisWeb } from '../lib/core/normalize.js';
import { analizarSitio } from '../lib/integrations/website-audit.js';
import { auditar } from '../lib/core/audit-engine.js';
import { generarInformeHTML, resumenCorto } from '../lib/core/report.js';
import { generarPresupuestos } from '../lib/core/quote-engine.js';
import { SECUENCIA_PROSPECCION, render } from '../lib/core/sequences.js';

import * as db from '../lib/db/supabase.js';
import { evaluar, usarFuente, huella } from '../lib/guardrails/guard.js';

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

// Destinatario de prueba constante (NUNCA un prospecto real)
const DESTINATARIO_PRUEBA = 'prueba-camino-feliz@lokigi.invalid';

const CADENAS_DEMO = ['Panadería La Esquina de Oro', 'La Esquina de Oro', 'demo_panaderia_01'];

async function main() {
  const pasosLog = [];

  const registrarPaso = (num, nombre, ok, motivo) => {
    pasosLog.push({ paso: num, nombre, ok, motivo });
    const tag = ok ? '✓ OK' : '❌ FALLA';
    console.log(`\n[Paso ${num}] ${nombre}: ${tag}`);
    console.log(`   Detalle: ${motivo}`);
  };

  const arg = process.argv[2]?.trim();
  let placeId = null;
  let consulta = null;

  if (arg) {
    if (arg.startsWith('ChI') || arg.startsWith('0x') || (!arg.includes(' ') && arg.length > 20)) {
      placeId = arg;
    } else {
      consulta = arg;
    }
  }

  // -------------------------------------------------------------------
  // PASO 1: Perfil real desde Places
  // -------------------------------------------------------------------
  let perfil = null;
  try {
    if (!placeId) {
      if (!consulta) {
        consulta = CATEGORIAS_RANDOM[Math.floor(Math.random() * CATEGORIAS_RANDOM.length)];
      }
      console.log(`\nBuscando en Google Places con consulta: "${consulta}"...`);
      const resultados = await buscarNegocios({ consulta, max: 5 });
      if (!resultados || resultados.length === 0) {
        throw new Error(`No se encontraron negocios para la consulta "${consulta}"`);
      }
      const elegido = resultados[Math.floor(Math.random() * resultados.length)];
      placeId = elegido.id;
    }

    console.log(`\n==================================================`);
    console.log(`PLACE ID ELEGIDO: ${placeId}`);
    console.log(`==================================================`);

    const rawPlace = await detallePlace(placeId, { conResenas: true });
    perfil = desdePlacesApi(rawPlace);

    // Afirmaciones duras (P13 / humo-places)
    if (!(perfil.fuente === 'places' || perfil.fuente === 'places_api')) {
      throw new Error(`perfil.fuente no es de Places API ("${perfil.fuente}")`);
    }
    if (placeId.startsWith('demo_') || placeId.startsWith('inf_')) {
      throw new Error(`placeId empieza con prefijo de demo ("${placeId}")`);
    }

    if (consulta) {
      const primerSeg = consulta.split(',')[0].trim().toLowerCase();
      const consMin = consulta.trim().toLowerCase();
      const nomMin = (perfil.nombre || '').trim().toLowerCase();
      const dirMin = (perfil.direccion || '').trim().toLowerCase();

      if (nomMin === primerSeg || nomMin === consMin) {
        throw new Error(`perfil.nombre ("${perfil.nombre}") coincide con la consulta fabricada`);
      }
      if (dirMin === `${consMin}, argentina` || dirMin === `${primerSeg}, argentina`) {
        throw new Error(`perfil.direccion ("${perfil.direccion}") coincide con la consulta + ", Argentina"`);
      }
    }

    const hasRating = perfil.rating !== null && perfil.rating !== undefined && perfil.rating > 0;
    const hasResenas = typeof perfil.cantidadResenas === 'number' && perfil.cantidadResenas > 0;
    const hasFotos = typeof perfil.cantidadFotos === 'number' && perfil.cantidadFotos > 0;
    const datosValidos = [hasRating, hasResenas, hasFotos].filter(Boolean).length;
    if (datosValidos < 2) {
      throw new Error(`Menos de dos datos reales > 0 entre rating (${perfil.rating}), reseñas (${perfil.cantidadResenas}), fotos (${perfil.cantidadFotos})`);
    }

    if (perfil.cantidadResenas > 0) {
      const tieneTexto = Array.isArray(perfil.resenasMuestra) && perfil.resenasMuestra.some(r => r.texto && r.texto.trim().length > 0);
      if (!tieneTexto) {
        throw new Error(`cantidadResenas > 0 (${perfil.cantidadResenas}) pero resenasMuestra no tiene ninguna reseña con texto`);
      }
    }

    registrarPaso(1, 'Perfil real desde Places', true, `Negocio: "${perfil.nombre}" | Direccion: "${perfil.direccion}" | PlaceID: ${placeId}`);
  } catch (e) {
    registrarPaso(1, 'Perfil real desde Places', false, e.message || e);
    imprimirResumen(pasosLog);
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // PASO 2: Análisis del sitio web
  // -------------------------------------------------------------------
  try {
    if (perfil.sitioWeb) {
      console.log(`\nAnalizando sitio web: ${perfil.sitioWeb}...`);
      const resWeb = await analizarSitio(perfil.sitioWeb);
      perfil = aplicarAnalisisWeb(perfil, resWeb);
      const emailsText = (perfil.web?.emails || []).join(', ') || 'ninguno';
      registrarPaso(2, 'Análisis del sitio web', true, `URL: ${perfil.sitioWeb} (emails encontrados: ${emailsText})`);
    } else {
      registrarPaso(2, 'Análisis del sitio web', true, 'El perfil no tiene sitio web declarado (hallazgo de auditoría, no es error)');
    }
  } catch (e) {
    registrarPaso(2, 'Análisis del sitio web', false, e.message || e);
  }

  // -------------------------------------------------------------------
  // PASO 3: Auditoría determinista (auditar)
  // -------------------------------------------------------------------
  let auditoria = null;
  try {
    auditoria = auditar(perfil);
    registrarPaso(
      3,
      'Auditoría determinista',
      true,
      `Puntaje: ${auditoria.score}/100 (${auditoria.banda.etiqueta}) | ${auditoria.hallazgos.length} hallazgos encontrados`
    );
  } catch (e) {
    registrarPaso(3, 'Auditoría determinista', false, e.message || e);
    imprimirResumen(pasosLog);
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // PASO 4: Generación de informe HTML (generarInformeHTML)
  // -------------------------------------------------------------------
  let rutaInforme = null;
  try {
    const html = generarInformeHTML(auditoria, { agencia: 'Lokigi', remitente: 'Marcelo' });

    // Afirmación: contiene el puntaje
    if (!html.includes(`${auditoria.score}/100`) && !html.includes(`>${auditoria.score}<`)) {
      throw new Error(`El HTML generado no contiene el puntaje auditado (${auditoria.score})`);
    }

    // Afirmación: NO contiene ninguna cadena de perfiles demo
    for (const demoStr of CADENAS_DEMO) {
      if (html.includes(demoStr)) {
        throw new Error(`El HTML contiene la cadena de perfil demo "${demoStr}"`);
      }
    }

    const tmpDir = resolve(process.cwd(), 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    rutaInforme = join(tmpDir, `informe-${placeId}.html`);
    writeFileSync(rutaInforme, html, 'utf8');

    registrarPaso(4, 'Generación de informe HTML', true, `Guardado en: ${rutaInforme}`);
  } catch (e) {
    registrarPaso(4, 'Generación de informe HTML', false, e.message || e);
  }

  // -------------------------------------------------------------------
  // PASO 5: Generación de presupuestos (generarPresupuestos)
  // -------------------------------------------------------------------
  let planes = null;
  try {
    planes = generarPresupuestos(auditoria);
    if (!Array.isArray(planes) || planes.length === 0) {
      throw new Error('generarPresupuestos() no devolvió planes válidos');
    }

    // Afirmar que los números provienen del motor de cotización
    for (const plan of planes) {
      if (typeof plan.setupUSD !== 'number' || typeof plan.mensualUSD !== 'number') {
        throw new Error(`El plan "${plan.nombre}" contiene valores no numéricos`);
      }
    }

    const resumenPlanes = planes.map(p => `${p.nombre}: Setup USD ${p.setupUSD} / Mensual USD ${p.mensualUSD}`).join(' | ');
    registrarPaso(5, 'Generación de presupuestos', true, `${planes.length} planes calculados: ${resumenPlanes}`);
  } catch (e) {
    registrarPaso(5, 'Generación de presupuestos', false, e.message || e);
  }

  // -------------------------------------------------------------------
  // PASO 6: Redacción y secuencia de prospección
  // -------------------------------------------------------------------
  let intencionMensaje = null;
  try {
    const resShort = resumenCorto(auditoria);
    const vars = {
      negocio: perfil.nombre,
      saludoContacto: perfil.contacto ? ` ${perfil.contacto}` : '',
      remitente: 'Marcelo',
      agencia: 'Lokigi',
      zona: perfil.zona || 'su zona',
      score: resShort.score,
      banda: resShort.banda,
      hallazgoTop: resShort.hallazgoTop,
      hallazgoTopDetalle: resShort.hallazgoTopDetalle,
      urlInforme: `http://localhost:3000/informe/${perfil.placeId}`,
      urlBaja: 'http://localhost:3000/baja',
    };

    const paso1Tpl = SECUENCIA_PROSPECCION[0];
    const asunto = render(paso1Tpl.asunto, vars);
    const cuerpo = render(paso1Tpl.cuerpo, vars);

    intencionMensaje = { asunto, cuerpo };

    console.log('\n--- MENSAJE DE PROSPECCIÓN RENDERIZADO (PASO 1) ---');
    console.log(`ASUNTO: ${asunto}`);
    console.log('--------------------------------------------------');
    console.log(cuerpo);
    console.log('--------------------------------------------------\n');

    registrarPaso(6, 'Redacción y secuencia de prospección', true, `Asunto: "${asunto}" (${cuerpo.length} caracteres)`);
  } catch (e) {
    registrarPaso(6, 'Redacción y secuencia de prospección', false, e.message || e);
  }

  // -------------------------------------------------------------------
  // PASO 7: Veredicto del guardián (SIN ENVIAR)
  // -------------------------------------------------------------------
  try {
    if (!intencionMensaje) throw new Error('No hay mensaje generado en el paso anterior');

    // Inyectar fuente de Supabase requerida por el guardián
    usarFuente(db);

    const intencion = {
      id: huella({ leadId: perfil.placeId, canal: 'email', paso: 1, cuerpo: intencionMensaje.cuerpo }),
      lead_id: perfil.placeId,
      negocio: perfil.nombre,
      canal: 'email',
      paso: 1,
      destinatario: DESTINATARIO_PRUEBA,
      asunto: intencionMensaje.asunto,
      cuerpo: intencionMensaje.cuerpo,
      creado_en: new Date().toISOString(),
    };

    const evaluacion = await evaluar(intencion);

    console.log('\n--- EVALUACIÓN DEL GUARDIÁN ---');
    console.log(`Veredicto: ${evaluacion.veredicto}`);
    console.log(`Regla: ${evaluacion.regla || 'Ninguna (Aprobado)'}`);
    console.log(`Motivo: ${evaluacion.motivo}`);
    console.log('-------------------------------\n');

    registrarPaso(
      7,
      'Veredicto del guardián',
      true,
      `Veredicto: ${evaluacion.veredicto} | Regla: ${evaluacion.regla || 'OK'} | Motivo: ${evaluacion.motivo}`
    );
  } catch (e) {
    registrarPaso(7, 'Veredicto del guardián', false, e.message || e);
  }

  // -------------------------------------------------------------------
  // PASO 8: Resumen final
  // -------------------------------------------------------------------
  imprimirResumen(pasosLog);

  const hayFalla = pasosLog.some(p => !p.ok);
  if (hayFalla) {
    process.exit(1);
  }
}

function imprimirResumen(pasos) {
  console.log('\n==================================================');
  console.log('TABLA RESUMEN DE PASOS (CAMINO FELIZ)');
  console.log('==================================================');
  console.table(
    pasos.map(p => ({
      Paso: p.paso,
      Etapa: p.nombre,
      Resultado: p.ok ? 'OK' : 'FALLA',
      Detalle: p.motivo,
    }))
  );
  console.log('==================================================\n');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
