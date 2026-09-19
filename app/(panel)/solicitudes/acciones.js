'use server';

import { revalidatePath } from 'next/cache';
import * as db from '../../../lib/db/supabase.js';
import { atenderSolicitud, upsert, guardarInforme, agregar } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { POST as auditarRoute } from '../../api/auditar/route.js';
import { POST as cronRoute } from '../../api/cron/[tarea]/route.js';
import { agenteSugeridorMensaje } from '../../../lib/ia/gemini.js';
import { resumenCorto } from '../../../lib/core/report.js';
import { huella, evaluar, VEREDICTO, usarFuente } from '../../../lib/guardrails/guard.js';

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

  const req = new Request('https://lokigi.vercel.app/api/auditar', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-action': 'true',
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

      // 3. Si se solicita envío por mail, generar sugerencia de IA (si no hay manual) y registrar en Aprobaciones
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

        let intro = sugerido ? `${sugerido}\n\n` : '';
        if (!intro) {
          const resShort = resumenCorto(data);
          const hallazgoTxt = resShort.hallazgoTop ? `Un hallazgo clave para impulsar la visibilidad de tu negocio:\n\n${resShort.hallazgoTop}\n${resShort.hallazgoTopDetalle}\n\n` : '';
          intro = `Hola,\n\nAnalizamos el perfil de Google Maps de ${data.negocio || negocio}. Tu puntaje actual es de ${data.score}/100, con un potencial alcanzable de ${data.potencial}/100.\n\n${hallazgoTxt}`;
        }
        const urlPago = `${informeUrl}#presupuesto`;
        const cuerpoFinal = `${intro}Optimizando los puntos clave de tu perfil, podés captar más clientes locales todos los meses de manera directa y sostenida.\n\n` +
          `Podés consultar el informe de diagnóstico completo en:\n${informeUrl}\n\n` +
          `Y si querés activar el plan de optimización ahora mismo, podés revisar las alternativas de inversión y acceder a la pasarela de pago en:\n${urlPago}\n\n` +
          `Quedo a tu disposición para cualquier consulta.\n\nSi preferís no recibir más mensajes, respondé BAJA.`;

        const intentoId = huella({ leadId: data.placeId, canal: 'email', paso: 1, cuerpo: cuerpoFinal });

        await agregar('Aprobaciones', {
          id: intentoId,
          lead_id: data.placeId,
          negocio: data.negocio || negocio,
          canal: 'email',
          paso: 1,
          destinatario: email,
          asunto: `Lokigi · Auditoría de tu perfil de Google Maps (${data.negocio || negocio})`,
          cuerpo: cuerpoFinal,
          decision: 'APROBADO',
          decidido_en: new Date().toISOString(),
          motivo: 'Solicitud auditada desde el panel con envío por email activado',
        }).catch((e) => console.error('Error al agregar a Aprobaciones:', e));

        const cronReq = new Request('https://lokigi.vercel.app/api/cron/aprobaciones', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-action': 'true',
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
