'use server';

import { revalidatePath } from 'next/cache';
import { actualizar, agregar, uno } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { POST as cronRoute } from '../../api/cron/[tarea]/route.js';

/**
 * Guarda la decisión de Marcelo y dispara la tarea de envío inmediato si se aprobó.
 */
export async function decidir(formData) {
  await requerirSesion();

  const id = formData.get('id');
  const decision = formData.get('decision');
  const cuerpo = formData.get('cuerpo');
  const asunto = formData.get('asunto');

  if (!['APROBADO', 'RECHAZADO'].includes(decision)) {
    return { ok: false, error: `Decisión inválida: ${decision}` };
  }

  try {
    const fila = await uno('Aprobaciones', f => f.id === id, { sinCache: true });
    if (!fila) return { ok: false, error: `No existe la aprobación ${id}` };
    if (fila.decision !== 'PENDIENTE') return { ok: true };  // alguien ya decidió; no se pisa

    // El disparador de la base guarda `cuerpo_original` la primera vez que el
    // texto cambia, así que acá solo se escribe la versión final.
    await actualizar('Aprobaciones', {
      id,
      decision,
      cuerpo: cuerpo ?? fila.cuerpo,
      ...(asunto ? { asunto } : {}),
      decidido_en: new Date().toISOString(),
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

    // Si fue APROBADO, procesar el envío de inmediato a través del circuito del guardián
    if (decision === 'APROBADO') {
      const cronReq = new Request('https://lokigi.vercel.app/api/cron/aprobaciones', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-action': 'true',
          ...(process.env.LOKIGI_API_KEY ? { 'x-api-key': process.env.LOKIGI_API_KEY } : {}),
        },
      });
      await cronRoute(cronReq, { params: Promise.resolve({ tarea: 'aprobaciones' }) }).catch((e) => {
        console.error('Error al disparar tarea de aprobaciones:', e);
      });
    }

    return { ok: true };
  } catch (err) {
    console.error(`Error en decidir aprobacion ${id}:`, err);
    return { ok: false, error: err.message || String(err) };
  } finally {
    revalidatePath('/aprobaciones');
    revalidatePath('/panel');
  }
}

/**
 * Revierte una aprobación previa que aún no ha sido enviada (enviado_en === null).
 * Vuelve el estado a PENDIENTE y queda registrado en Bitácora.
 */
export async function deshacerAprobacion(formData) {
  await requerirSesion();

  const id = formData.get('id');
  if (!id) return { ok: false, error: 'ID de aprobación requerido' };

  try {
    const fila = await uno('Aprobaciones', f => f.id === id, { sinCache: true });
    if (!fila) return { ok: false, error: `No existe la aprobación ${id}` };
    if (fila.enviado_en != null) {
      return { ok: false, error: 'El mensaje ya fue enviado y no se puede deshacer.' };
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

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    revalidatePath('/aprobaciones');
    revalidatePath('/panel');
  }
}
