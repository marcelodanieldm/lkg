'use server';

import { revalidatePath } from 'next/cache';
import { atenderSolicitud, upsert, guardarInforme, agregar } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { POST as auditarRoute } from '../../api/auditar/route.js';
import { POST as cronRoute } from '../../api/cron/[tarea]/route.js';
import { agenteSugeridorMensaje } from '../../../lib/ia/gemini.js';

/**
 * Acciones de servidor para la pantalla /solicitudes.
 *
 * Auditar una solicitud calcula el puntaje, genera el informe congelado,
 * crea el Lead en el CRM y (si se seleccionó el check de envío por correo)
 * procesa el envío con mensaje personalizado o sugerido por IA y enlace al informe.
 */

export async function auditarSolicitud(formData) {
  await requerirSesion();

  const id = formData.get('id');
  const negocio = formData.get('negocio');
  const ciudad = formData.get('ciudad');
  const email = formData.get('email');
  const enviarEmail = formData.get('enviarEmail') === 'on' || formData.get('enviarEmail') === 'true';
  const mensajePersonalizado = (formData.get('mensajePersonalizado') || '').trim();

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
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app').replace(/\/$/, '');
      const informeUrl = `${appUrl}/informe/${data.placeId}`;
      const debeEnviar = enviarEmail && Boolean(email);

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
        etapa: debeEnviar ? 'contactado' : 'auditado',
        informe_url: informeUrl,
        actualizado_en: new Date().toISOString(),
      }).catch(() => {});

      // 2. Congelar y guardar el informe HTML en la tabla informes para /informe/[id]
      if (data.informeHTML) {
        await guardarInforme(data.placeId, data.informeHTML, data.score, data.version || 'v1.0').catch(() => {});
      }

      // 3. Si se solicita envío por mail, generar sugerencia de IA (si no hay manual) y enviar
      let notaFinal = null;
      if (debeEnviar) {
        let sugerido = mensajePersonalizado;
        if (!sugerido) {
          sugerido = await agenteSugeridorMensaje({
            negocio: data.negocio || negocio,
            score: data.score,
            potencial: data.potencial,
            hallazgos: data.hallazgos,
            categoria: data.categoria,
            ciudad: data.ciudad || ciudad,
          }).catch(() => null);
        }

        const intro = sugerido
          ? `${sugerido}\n\n`
          : `Hola,\n\nYa está lista la auditoría de ${negocio}.\n\nTu puntaje obtenido fue de ${data.score}/100 (con un potencial estimado de ${data.potencial}/100).\n\n`;
        const cuerpoFinal = `${intro}Analizamos el perfil de Google Maps de ${negocio} y preparamos un informe detallado con hallazgos y recomendaciones.\n\nPodés consultar el informe completo en el siguiente enlace:\n${informeUrl}\n\nSi preferís no recibir más mensajes, respondé BAJA.`;

        await agregar('Aprobaciones', {
          lead_id: data.placeId,
          negocio,
          canal: 'email',
          paso: 1,
          destinatario: email,
          asunto: `Lokigi · Auditoría de tu perfil de Google Maps (${negocio})`,
          cuerpo: cuerpoFinal,
          decision: 'APROBADO',
          decidido_en: new Date().toISOString(),
          motivo: 'Solicitud auditada desde el panel con envío por email activado',
        }).catch(() => {});

        // Disparar la ejecución de aprobaciones para pasar por el guardián y enviar por Gmail
        const cronReq = new Request('http://localhost/api/cron/aprobaciones', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(process.env.LOKIGI_API_KEY ? { 'x-api-key': process.env.LOKIGI_API_KEY } : {}),
          },
        });
        const cRes = await cronRoute(cronReq, { params: Promise.resolve({ tarea: 'aprobaciones' }) }).catch((e) => {
          console.error('Error al disparar cron aprobaciones:', e);
          return null;
        });
        if (cRes) {
          const cData = await cRes.json().catch(() => ({}));
          console.log('Resultado envío aprobaciones:', cData);
        }

        notaFinal = `Auditada y enviada a ${email}`;
      }

      // 4. Marcar la solicitud como atendida enlazada con su lead_id
      await atenderSolicitud(id, 'auditada', notaFinal, data.placeId).catch(async () => {
        await atenderSolicitud(id, 'auditada', notaFinal || `Place ID: ${data.placeId}`);
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
  revalidatePath('/aprobaciones');
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
