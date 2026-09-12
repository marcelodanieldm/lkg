'use server';

import { headers } from 'next/headers';
import { pedirAuditoria, config, agregar } from '../lib/db/supabase.js';

/**
 * Alguien pidió su auditoría desde la landing.
 *
 * Lo que NO hace esta función, y es lo importante: no crea un lead, no manda
 * ningún correo automático y no toca la lista de supresión. Deja una solicitud
 * registrada y te avisa. Vos decidís.
 *
 * El motivo está explicado largo en la migración 004, pero el resumen es que
 * `leads.opt_out` es irreversible por diseño: si alguien se dio de baja y hoy
 * vuelve a golpear la puerta por su cuenta, eso es consentimiento nuevo, pero
 * el sistema no puede ni debe revertir una baja solo. Queda anotado, lo ves, y
 * le contestás vos desde tu casilla.
 *
 * La validación de verdad vive en Postgres (`pedir_auditoria`), no acá. Esta
 * función podría saltearse; la función de la base, no.
 */
export async function pedirAuditoriaWeb(_estadoPrevio, formData) {
  const negocio = String(formData.get('negocio') || '').trim();
  const email = String(formData.get('correo') || '').trim();
  const ciudad = String(formData.get('ciudad') || '').trim();

  // Trampa para bots: un campo que una persona nunca ve ni completa. Si viene
  // lleno, se responde "gracias" y no se guarda nada. Decirle a un bot que lo
  // detectaste solo le sirve a él.
  if (String(formData.get('sitio') || '').length > 0) {
    return { estado: 'listo' };
  }

  if (negocio.length < 2) {
    return { estado: 'error', mensaje: 'Falta el nombre del negocio.' };
  }
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
    return { estado: 'error', mensaje: 'Revisá la dirección de correo: no parece válida.' };
  }

  // La IP la pone Vercel. Sirve para cortar una ráfaga, nada más: no se
  // muestra en ninguna pantalla ni se usa para otra cosa.
  const h = await headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || null;

  let r;
  try {
    r = await pedirAuditoria({ negocio, email, ciudad, ip });
  } catch (e) {
    await agregar('Bitacora', {
      agente: 'landing', accion: 'solicitud', decision: 'error',
      razon: `No se pudo registrar un pedido de ${negocio} (${email}): ${String(e.message).slice(0, 300)}`,
    }).catch(() => {});
    return {
      estado: 'error',
      mensaje: 'No se pudo registrar el pedido. Escribime directo y lo hago a mano.',
    };
  }

  if (r && r.ok === false) {
    return {
      estado: 'error',
      mensaje: r.motivo === 'email'
        ? 'Revisá la dirección de correo: no parece válida.'
        : 'Revisá el nombre del negocio.',
    };
  }

  await avisar({ negocio, email, ciudad, dadoDeBaja: r?.dado_de_baja });

  return { estado: 'listo' };
}

/**
 * El aviso por correo. Va a tu casilla, no a la del prospecto, así que no pasa
 * por el guardián: el guardián existe para proteger a terceros de mensajes que
 * no pidieron, no para filtrar tus propias notificaciones.
 *
 * Si falla, el pedido ya quedó guardado igual y lo vas a ver en el panel. Por
 * eso no se propaga el error.
 */
async function avisar({ negocio, email, ciudad, dadoDeBaja }) {
  try {
    if (!(await config('avisar_solicitudes', true))) return;
    const para = process.env.EMAIL_OPERADOR;
    if (!para) return;

    const { enviar } = await import('../lib/integrations/gmail.js');
    const app = process.env.NEXT_PUBLIC_APP_URL || '';
    const texto =
      `${negocio}${ciudad ? ` (${ciudad})` : ''} pidió una auditoría desde la web.\n\n` +
      `Correo: ${email}\n\n` +
      (dadoDeBaja
        ? '⚠ ATENCIÓN: esa dirección figura en la lista de supresión. La baja NO se revirtió y el ' +
          'sistema no puede escribirle. Si querés responderle, hacelo a mano desde tu casilla.\n\n'
        : '') +
      `Lo tenés en ${app}/panel — levantó la mano solo, así que va primero en la cola.`;

    await enviar({
      para,
      asunto: `Lokigi · ${negocio} pidió su auditoría${dadoDeBaja ? ' — estaba dado de baja' : ''}`,
      textoPlano: texto,
      html: texto.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join(''),
    });
  } catch { /* el pedido ya está guardado; el aviso es comodidad */ }
}
