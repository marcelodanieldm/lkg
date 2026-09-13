'use server';

import { revalidatePath } from 'next/cache';
import { atenderSolicitud, upsert, guardarInforme } from '../../../lib/db/supabase.js';
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
  const email = formData.get('email');

  if (!id) throw new Error('ID de solicitud requerido');

  const req = new Request('http://localhost/api/auditar', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.LOKIGI_API_KEY ? { 'x-api-key': process.env.LOKIGI_API_KEY } : {}),
    },
    body: JSON.stringify({
      consulta: ciudad ? `${negocio}, ${ciudad}` : negocio,
      guardar: true,
      conInforme: true,
      conPresupuesto: true,
    }),
  });

  try {
    const res = await auditarRoute(req);
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.placeId) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
      const informeUrl = `${appUrl}/informe/${data.placeId}`;

      // 1. Guardar el Lead en la tabla leads para que aparezca en /leads
      await upsert('Leads', {
        id: data.placeId,
        negocio: data.negocio || negocio,
        categoria: data.categoria || null,
        ciudad: data.ciudad || ciudad || null,
        email: email || null,
        score: data.score ?? null,
        potencial: data.potencial ?? null,
        percentil: data.percentil?.percentil ?? (typeof data.percentil === 'number' ? data.percentil : null),
        etapa: 'auditado',
        informe_url: informeUrl,
        actualizado_en: new Date().toISOString(),
      }).catch(() => {});

      // 2. Congelar y guardar el informe HTML en la tabla informes para /informe/[id]
      if (data.informeHTML) {
        await guardarInforme(data.placeId, data.informeHTML, data.score, data.version || 'v1.0').catch(() => {});
      }

      // 3. Marcar la solicitud como atendida enlazada con su lead_id
      await atenderSolicitud(id, 'auditada', null, data.placeId).catch(async () => {
        await atenderSolicitud(id, 'auditada', `Place ID: ${data.placeId}`);
      });
    } else {
      console.error(`Error auditando "${negocio}":`, data.error);
      await atenderSolicitud(id, 'auditada', `Error: ${data.error || 'No se pudo auditar'}`);
    }
  } catch (err) {
    console.error(`Excepción en auditarSolicitud "${negocio}":`, err);
    await atenderSolicitud(id, 'auditada', `Excepción: ${err.message}`).catch(() => {});
  }

  revalidatePath('/solicitudes');
  revalidatePath('/leads');
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
