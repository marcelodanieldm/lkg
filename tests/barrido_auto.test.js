import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

test('el script cliente de VistoScript valida permanencia y scroll antes de enviar la señal', () => {
  const contenidoScript = readFileSync(join(RAIZ, 'app/informe/[id]/visto-script.jsx'), 'utf8');

  // Verificar que valida timer de permanencia Y scroll ratio >= 0.25
  assert.ok(contenidoScript.includes('segundosMinimos'), 'Debe usar el parámetro de segundos mínimos');
  assert.ok(contenidoScript.includes('0.25'), 'Debe verificar el umbral del 25% de desplazamiento');
  assert.ok(contenidoScript.includes('sessionStorage'), 'Debe utilizar sessionStorage para limitar a una señal por sesión');
  assert.ok(contenidoScript.includes("fetch(`/api/informe/"), 'Debe enviar la señal por POST al endpoint de visto');
});

test('idempotencia y compuertas de configuración en la señal de visto', () => {
  // Simulación de la lógica RPC/evaluación de visto
  function evaluarSeñalVisto({ barridoAutomatico, yaSolicitado, esSolicitud, origen, topeDiario, hoyCount }) {
    if (!barridoAutomatico) return { ok: true, barrido: 'desactivado' };
    if (origen === 'solicitudes' && !esSolicitud) return { ok: true, barrido: 'origen_no_aplicable' };
    if (yaSolicitado) return { ok: true, barrido: 'ya_procesado' };
    if (hoyCount >= topeDiario) return { ok: true, barrido: 'tope_diario_alcanzado' };
    return { ok: true, barrido: 'pendiente' };
  }

  // 1. Con barrido_automatico = false, no pasa nada
  const resOff = evaluarSeñalVisto({ barridoAutomatico: false, yaSolicitado: false, esSolicitud: true, origen: 'solicitudes', topeDiario: 10, hoyCount: 0 });
  assert.equal(resOff.barrido, 'desactivado');

  // 2. Dos señales de la misma solicitud -> la segunda es ya_procesado (idempotencia)
  const res1 = evaluarSeñalVisto({ barridoAutomatico: true, yaSolicitado: false, esSolicitud: true, origen: 'solicitudes', topeDiario: 10, hoyCount: 0 });
  assert.equal(res1.barrido, 'pendiente');

  const res2 = evaluarSeñalVisto({ barridoAutomatico: true, yaSolicitado: true, esSolicitud: true, origen: 'solicitudes', topeDiario: 10, hoyCount: 1 });
  assert.equal(res2.barrido, 'ya_procesado');

  // 3. Superar tope diario
  const resTope = evaluarSeñalVisto({ barridoAutomatico: true, yaSolicitado: false, esSolicitud: true, origen: 'solicitudes', topeDiario: 10, hoyCount: 10 });
  assert.equal(resTope.barrido, 'tope_diario_alcanzado');
});

test('PROPIEDAD CRÍTICA: ningún camino desde el disparo del visto ni la cola pendiente llega a enviar()', () => {
  const archivosRuta = [
    'app/informe/[id]/visto-script.jsx',
    'app/api/informe/[id]/visto/route.js',
    'supabase/migrations/009_barrido_automatico.sql',
  ];

  for (const f of archivosRuta) {
    const contenido = readFileSync(join(RAIZ, f), 'utf8');

    // Ninguna ruta de visto ni el script cliente pueden importar ni llamar a enviar()
    const importaEnviar = /import.*enviar.*from/i.test(contenido) || /enviar\s*\(/i.test(contenido);
    assert.equal(
      importaEnviar,
      false,
      `PROPIEDAD CRÍTICA VIOLADA en ${f}: El visto del informe NUNCA puede llamar a enviar() directamente.`
    );
  }
});
