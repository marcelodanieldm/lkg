#!/usr/bin/env node
/**
 * scripts/barrido.js — Ejecuta un barrido de competidores por cercanía para un placeId.
 *
 *   npm run barrido ChIJCSLssnKrt5URWyFhlKOAwm0
 */

import { ejecutarBarrido } from '../lib/integrations/barrido-engine.js';
import * as db from '../lib/db/supabase.js';

const placeId = process.argv[2] || 'ChIJCSLssnKrt5URWyFhlKOAwm0';

console.log(`\n🔍 Iniciando Barrido de Competidores para Place ID: ${placeId}\n`);

try {
  const res = await ejecutarBarrido(placeId, { fuenteDatos: db });

  if (res.cancelado) {
    console.log(`\x1b[31m⚠ Barrido cancelado por presupuesto excedido:\x1b[0m`);
    console.log(`  Gasto actual del mes: USD $${res.gastoActualUSD}`);
    console.log(`  Tope mensual: USD $${res.presupuestoUSD}`);
    console.log(`  Costo estimado del barrido: USD $${res.costoEstimadoUSD}\n`);
    process.exit(1);
  }

  console.log(`\x1b[1m=== RESULTADO DEL BARRIDO ===\x1b[0m`);
  console.log(`Origen: ${res.origen.nombre} (${res.origen.placeId})`);
  console.log(`Score Origen: ${res.origen.score}/100 | Celda Geo: ${res.origen.celda}`);
  console.log(`Fecha Relevamiento: ${res.fechaRelevamiento} ${res.cache ? '(REUTILIZADO DESDE CACHÉ 30 DÍAS)' : '(NUEVO)'}`);
  console.log(`\n\x1b[36mLLAMADAS GASTADAS PLACES API:\x1b[0m ${res.llamadasGastadas}`);
  console.log(`\x1b[32mAHORRADAS POR CORPUS O CACHÉ:\x1b[0m ${res.llamadasAhorradas || 0}`);
  console.log(`\x1b[36mCOSTO ESTIMADO:\x1b[0m USD $${res.costoUSD}`);

  const comp = res.comparacion;
  if (!comp.baseSuficiente) {
    console.log(`\n\x1b[33m! Base insuficiente:\x1b[0m ${comp.razon}`);
  } else {
    console.log(`\n\x1b[1m--- ANILLO CERCANO (Top 5 más próximos - Con detalle y reseñas) ---\x1b[0m`);
    for (const c of comp.anilloCercano.competidores) {
      console.log(`  • [${c.distanciaMetros}m] ${c.nombre} (${c.placeId}) -> Score: ${c.score ?? 'nd'}/100`);
    }

    console.log(`\n\x1b[1m--- ANILLO AMPLIO (Puestos 6º al ${comp.resumen.totalCompetidores} - Auditado sobre búsqueda) ---\x1b[0m`);
    for (const c of comp.anilloAmplio.competidores) {
      console.log(`  • [${c.distanciaMetros}m] ${c.nombre} (${c.placeId}) -> Score: ${c.score ?? 'nd'}/100`);
    }

    console.log(`\n\x1b[1m--- TABLA DE POSICIONES CONSOLIDADA ---\x1b[0m`);
    console.log(`Posición del origen: \x1b[32m${comp.resumen.posicionGlobal}º de ${comp.resumen.totalEnTabla}\x1b[0m negocios en 4 km.`);

    console.log(`\n\x1b[1m--- REGLAS EVALUADAS MÁS RELEVANTES ---\x1b[0m`);
    const relevantes = comp.comparacionReglas
      .filter(r => r.evaluadosCompetencia > 0)
      .slice(0, 10);

    for (const r of relevantes) {
      console.log(`  ${r.estadoPropio === 'ok' ? '✓' : '✗'} ${r.nombre}: Propio=${r.estadoPropio.toUpperCase()} | Competencia=${r.cumplenCompetencia}/${r.evaluadosCompetencia} cumplen (${r.ratioCumplimientoCompetencia}%)`);
    }
  }

  console.log('\n✅ Barrido completado con éxito.\n');
} catch (e) {
  console.error(`\x1b[31mError ejecutando barrido:\x1b[0m`, e.message);
  process.exit(1);
}
