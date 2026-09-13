'use server';

import { revalidatePath } from 'next/cache';
import { atenderSolicitud } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { POST as auditarRoute } from '../../api/auditar/route.js';

/**
 * Acciones de servidor para la pantalla /solicitudes.
 *
 * Ninguna de estas acciones envía correos directos: solo actualiza el estado
 * de la solicitud en la base de datos o corre la auditoría sin contactar.
 */

export async function auditarSolicitud(formData) {
  await requerirSesion();

  const id = formData.get('id');
  const negocio = formData.get('negocio');
  const ciudad = formData.get('ciudad');

  if (!id) throw new Error('ID de solicitud requerido');

  // El manejador `auditarRoute` se invoca en memoria a propósito: evita una
  // vuelta HTTP contra la propia app y reutiliza toda la orquestación de
  // Places + normalize + auditar + Corpus. Al ser una invocación en memoria,
  // el tiempo límite de Vercel en producción lo dicta la página de origen;
  // por eso `app/(panel)/solicitudes/page.jsx` declara `maxDuration = 60`.
  const req = new Request('http://localhost/api/auditar', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.LOKIGI_API_KEY ? { 'x-api-key': process.env.LOKIGI_API_KEY } : {}),
    },
    body: JSON.stringify({
      consulta: ciudad ? `${negocio}, ${ciudad}` : negocio,
      guardar: true,
    }),
  });

  try {
    const res = await auditarRoute(req);
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.placeId) {
      await atenderSolicitud(id, 'auditada', `Place ID: ${data.placeId}`);
    } else {
      console.error(`Error auditando "${negocio}":`, data.error);
      await atenderSolicitud(id, 'auditada', `Error: ${data.error || 'No se pudo auditar'}`);
    }
  } catch (err) {
    console.error(`Excepción en auditarSolicitud "${negocio}":`, err);
    await atenderSolicitud(id, 'auditada', `Excepción: ${err.message}`).catch(() => {});
  }

  revalidatePath('/solicitudes');
  revalidatePath('/panel');
}

export async function descartarSolicitud(formData) {
  await requerirSesion();

  const id = formData.get('id');
  if (!id) throw new Error('ID de solicitud requerido');

  await atenderSolicitud(id, 'descartada');

  revalidatePath('/solicitudes');
  revalidatePath('/panel');
}

export async function contactarSolicitud(formData) {
  await requerirSesion();

  const id = formData.get('id');
  if (!id) throw new Error('ID de solicitud requerido');

  await atenderSolicitud(id, 'contactada');

  revalidatePath('/solicitudes');
  revalidatePath('/panel');
}
