'use server';

import { revalidatePath } from 'next/cache';
import { actualizar, agregar, uno } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';

/**
 * Guarda la decisión de Marcelo. NO envía: el envío lo hace la tarea
 * /api/cron/aprobaciones, que corre cada quince minutos por pg_cron.
 *
 * Se separa a propósito. Si el envío ocurriera acá y Gmail tardara, la
 * pantalla quedaría colgada y Marcelo no sabría si aprobó o no. Y si el envío
 * fallara, habría que decidir si la fila queda aprobada o no — un estado a
 * medias que nadie sabe interpretar después.
 *
 * Así: aprobar es instantáneo y siempre funciona. Enviar es otra cosa, con sus
 * propios reintentos, y el guardián la vuelve a evaluar antes de que salga.
 */
export async function decidir(formData) {
  await requerirSesion();

  const id = formData.get('id');
  const decision = formData.get('decision');
  const cuerpo = formData.get('cuerpo');
  const asunto = formData.get('asunto');

  if (!['APROBADO', 'RECHAZADO'].includes(decision)) {
    throw new Error(`Decisión inválida: ${decision}`);
  }

  const fila = await uno('Aprobaciones', f => f.id === id, { sinCache: true });
  if (!fila) throw new Error(`No existe la aprobación ${id}`);
  if (fila.decision !== 'PENDIENTE') return;  // alguien ya decidió; no se pisa

  // El disparador de la base guarda `cuerpo_original` la primera vez que el
  // texto cambia, así que acá solo se escribe la versión final.
  await actualizar('Aprobaciones', {
    id,
    decision,
    cuerpo: cuerpo ?? fila.cuerpo,
    ...(asunto ? { asunto } : {}),
  });

  const edito = (cuerpo ?? fila.cuerpo) !== fila.cuerpo;

  await agregar('Bitacora', {
    agente: 'humano',
    accion: decision === 'APROBADO' ? 'aprobacion' : 'rechazo',
    lead_id: fila.lead_id,
    decision: decision.toLowerCase(),
    razon: decision === 'APROBADO'
      ? `Marcelo aprobó el paso ${fila.paso} para ${fila.negocio || fila.destinatario}${edito ? ' después de editarlo' : ' sin cambios'}.`
      : `Marcelo rechazó el paso ${fila.paso} para ${fila.negocio || fila.destinatario}. Señal para ajustar el prompt del Redactor.`,
  });

  revalidatePath('/aprobaciones');
  revalidatePath('/panel');
}

/**
 * Revierte una aprobación previa que aún no ha sido enviada (enviado_en === null).
 * Vuelve el estado a PENDIENTE y queda registrado en Bitácora.
 */
export async function deshacerAprobacion(formData) {
  await requerirSesion();

  const id = formData.get('id');
  const fila = await uno('Aprobaciones', f => f.id === id, { sinCache: true });
  if (!fila) throw new Error(`No existe la aprobación ${id}`);
  if (fila.enviado_en != null) {
    throw new Error('El mensaje ya fue enviado y no se puede deshacer.');
  }

  await actualizar('Aprobaciones', {
    id,
    decision: 'PENDIENTE',
  });

  await agregar('Bitacora', {
    agente: 'humano',
    accion: 'deshacer_aprobacion',
    lead_id: fila.lead_id,
    decision: 'pendiente',
    razon: `Marcelo revirtió la aprobación del paso ${fila.paso} para ${fila.negocio || fila.destinatario} antes de su envío.`,
  });

  revalidatePath('/aprobaciones');
  revalidatePath('/panel');
}
