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
  const direccion = String(formData.get('direccion') || '').trim();
  const ciudad = String(formData.get('ciudad') || '').trim();
  const pais = String(formData.get('pais') || 'Argentina').trim();

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

  const rawPlaceId = String(formData.get('placeId') || '').trim();
  const placeId = (rawPlaceId && !rawPlaceId.startsWith('asistido-') && rawPlaceId.length > 5) ? rawPlaceId : null;

  const locInfo = [direccion, ciudad, pais].filter(Boolean).join(', ');

  let r;
  try {
    r = await pedirAuditoria({ negocio, email, ciudad: locInfo || ciudad, ip, placeId });
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

  await avisar({ negocio, email, ciudad: locInfo || ciudad, dadoDeBaja: r?.dado_de_baja });

  return { estado: 'listo', email };
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

/**
 * Busca y detecta el negocio o servicio en Google Maps para brindar confirmación visual en la landing.
 * Incluye coordenadas y URL embebida del mapa con zoom 17 (200m a la redonda).
 */
export async function buscarNegocioWeb({ negocio, direccion, ciudad, pais = 'Argentina' }) {
  const qNegocio = String(negocio || '').trim();
  const qDireccion = String(direccion || '').trim();
  const qCiudad = String(ciudad || '').trim();
  const qPais = String(pais || 'Argentina').trim();

  if (qNegocio.length < 2) {
    return { ok: false, resultados: [] };
  }

  const partes = [qNegocio, qDireccion, qCiudad, qPais].filter(Boolean);
  const consulta = partes.join(', ');
  const catInferida = inferirCategoriaTexto(qNegocio);

  try {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      const { buscarNegocios } = await import('../lib/integrations/places.js');
      const places = await buscarNegocios({ consulta, max: 3 });
      if (places && places.length > 0) {
        return {
          ok: true,
          fuente: 'maps',
          resultados: places.map(p => {
            const lat = p.location?.latitude;
            const lng = p.location?.longitude;
            const embedQuery = lat && lng ? `${lat},${lng}` : encodeURIComponent(p.formattedAddress || consulta);
            return {
              id: p.id,
              nombre: p.displayName?.text || qNegocio,
              direccion: p.formattedAddress || consulta,
              categoria: p.primaryTypeDisplayName?.text || catInferida,
              rating: p.rating ?? null,
              resenas: p.userRatingCount ?? null,
              mapsUrl: p.googleMapsUri ?? null,
              lat,
              lng,
              mapEmbedUrl: `https://maps.google.com/maps?q=${embedQuery}&z=17&output=embed`,
            };
          }),
        };
      }
    }
  } catch (e) {
    await agregar('Bitacora', {
      agente: 'landing', accion: 'buscar_negocio', decision: 'error',
      razon: `Error buscando negocio "${consulta}" en Places API: ${String(e.message || e).slice(0, 300)}`,
    }).catch(() => {});
  }

  return { ok: false, resultados: [] };
}

function inferirCategoriaTexto(texto) {
  const t = String(texto || '').toLowerCase();
  if (t.includes('panad') || t.includes('bakery') || t.includes('factura')) return 'Panadería / Confitería';
  if (t.includes('farmac') || t.includes('botic')) return 'Farmacia';
  if (t.includes('odont') || t.includes('dental') || t.includes('denta')) return 'Odontólogo / Clínica Dental';
  if (t.includes('contab') || t.includes('estudio contable') || t.includes('contador')) return 'Estudio Contable';
  if (t.includes('abogad') || t.includes('jurid') || t.includes('estudio juridico')) return 'Estudio Jurídico';
  if (t.includes('taller') || t.includes('mecanic') || t.includes('auto')) return 'Taller Mecánico';
  if (t.includes('pizz') || t.includes('restauran') || t.includes('bar') || t.includes('cafeter')) return 'Gastronomía / Restaurante';
  if (t.includes('peluquer') || t.includes('barber') || t.includes('estetic')) return 'Peluquería / Estética';
  if (t.includes('gimnas') || t.includes('crossfit') || t.includes('fit')) return 'Gimnasio';
  if (t.includes('veterin') || t.includes('pet')) return 'Veterinaria';
  if (t.includes('inmobil') || t.includes('propied')) return 'Inmobiliaria';
  if (t.includes('hotel') || t.includes('hosped')) return 'Hotel / Alojamiento';
  if (t.includes('clinica') || t.includes('medic') || t.includes('consultor')) return 'Centro Médico / Salud';
  return 'Comercio / Servicio Local';
}
