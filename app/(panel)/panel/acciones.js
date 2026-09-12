'use server';

import { revalidatePath } from 'next/cache';
import { guardarConfig, agregar } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';

/**
 * Acciones de servidor para la gestión de la pausa general del sistema.
 *
 * Invariante de diseño: Un agente o rutina puede pausar (poner pausa_general
 * en 'TRUE'), pero SOLO una persona desde esta server action del panel puede
 * reanudar el sistema (poner pausa_general en 'FALSE').
 */

export async function pausarSistema() {
  await requerirSesion();

  const fecha = new Date().toISOString();
  const motivo = 'Detención manual desde el panel';

  await guardarConfig('pausa_general', 'TRUE', motivo);
  await guardarConfig('pausa_general_autor', 'humano');
  await guardarConfig('pausa_general_fecha', fecha);
  await guardarConfig('pausa_general_motivo', motivo);

  await agregar('Bitacora', {
    fecha,
    agente: 'humano',
    accion: 'pausar_sistema',
    lead_id: null,
    decision: 'PAUSADO',
    razon: motivo,
    confianza: 1,
    costo_usd: 0,
  });

  revalidatePath('/panel');
}

export async function reanudarSistema(formData) {
  await requerirSesion();

  const motivo = formData.get('motivo')?.toString()?.trim();
  if (!motivo || motivo.length < 20) {
    throw new Error('El motivo para reanudar el sistema debe tener al menos 20 caracteres.');
  }

  const fecha = new Date().toISOString();

  await guardarConfig('pausa_general', 'FALSE', motivo);
  await guardarConfig('pausa_general_autor', 'humano');
  await guardarConfig('pausa_general_fecha', fecha);
  await guardarConfig('pausa_general_motivo', motivo);

  await agregar('Bitacora', {
    fecha,
    agente: 'humano',
    accion: 'reanudar_sistema',
    lead_id: null,
    decision: 'REANUDADO',
    razon: motivo,
    confianza: 1,
    costo_usd: 0,
  });

  revalidatePath('/panel');
}
