/**
 * prospeccion.js — Armado de intentos de prospección y seguimiento.
 *
 * Módulo puro del núcleo (lib/core/): NO importa de db/ ni de integrations/.
 * Recibe datos y devuelve los intentos compuestos de forma determinista.
 */

import { SECUENCIA_PROSPECCION, render } from './sequences.js';

/**
 * Determina cuál es el siguiente paso para un lead dado el historial de mensajes salientes.
 */
export function obtenerSiguientePaso(leadId, mensajes) {
  const salientes = (mensajes || []).filter(m => String(m.lead_id) === String(leadId) && m.direccion === 'saliente');
  const pasosEnviados = salientes.map(m => Number(m.paso)).filter(p => !isNaN(p) && p > 0);
  const ultimoPaso = pasosEnviados.length ? Math.max(...pasosEnviados) : 0;
  return ultimoPaso + 1;
}

/**
 * Compone un objeto `intento` determinista a partir del paso de la secuencia y los datos del lead.
 * Sin llamadas a APIs externas ni modelos de lenguaje.
 */
export function armarIntentoSeguimiento({ lead, paso, appUrl, remitente, agencia }) {
  if (!lead) return null;

  const pasoDef = SECUENCIA_PROSPECCION.find(p => p.paso === paso);
  if (!pasoDef) {
    return {
      lead,
      incompleto: true,
      razonIncompleto: 'Secuencia agotada sin paso siguiente',
      intento: null,
    };
  }

  if (!lead.email) {
    return {
      lead,
      incompleto: true,
      razonIncompleto: 'Sin correo electrónico de contacto',
      intento: {
        tipo: 'prospeccion',
        canal: pasoDef.canal || 'email',
        leadId: lead.id,
        negocio: lead.negocio || 'Sin nombre',
        destinatario: null,
        asunto: render(pasoDef.asunto || '', { negocio: lead.negocio || '' }),
        cuerpo: '',
        paso,
        agente: 'redactor',
      },
    };
  }

  const baseAppUrl = appUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const remitenteNombre = remitente || process.env.AGENCIA_REMITENTE || 'Martín';
  const agenciaNombre = agencia || process.env.AGENCIA_NOMBRE || 'Lokigi';

  const vars = {
    negocio: lead.negocio || '',
    contacto: lead.contacto_nombre || '',
    score: lead.score ?? 50,
    banda: lead.score >= 70 ? 'bien posicionado' : lead.score >= 50 ? 'oportunidad de mejora' : 'atención urgente',
    hallazgoTop: lead.hallazgo_top || 'Optimización general del perfil',
    hallazgoTopDetalle: lead.hallazgo_top_detalle || 'Detalles clave a configurar en Google Maps',
    competenciaDelta: lead.percentil ? `Supera al ${lead.percentil}% de los competidores locales` : 'Perfiles competidores activos en la zona',
    urlInforme: lead.informe_url || `${baseAppUrl}/informe/${lead.id}`,
    agencia: agenciaNombre,
    remitente: remitenteNombre,
    saludoContacto: lead.contacto_nombre ? ` ${lead.contacto_nombre}` : '',
    zona: lead.ciudad || 'la zona',
  };

  const asunto = render(pasoDef.asunto || '', vars);
  const cuerpo = render(pasoDef.cuerpo || '', vars);

  return {
    lead,
    incompleto: false,
    intento: {
      tipo: 'prospeccion',
      canal: pasoDef.canal || 'email',
      leadId: lead.id,
      negocio: lead.negocio,
      destinatario: lead.email,
      asunto,
      cuerpo,
      paso,
      agente: 'redactor',
      confianza: 0.85,
      costo: 0,
    },
  };
}
