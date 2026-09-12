/**
 * sequences.js — Secuencias de contacto, objeciones y postventa.
 *
 * Criterio de diseño: contacto en frío que no se lea como spam.
 *  - El primer mensaje entrega valor antes de pedir nada (el informe ya existe).
 *  - Se nombra el negocio y un hallazgo concreto: prueba de que no es un envío masivo.
 *  - Salida clara en cada mensaje ("si no te interesa, respondé BAJA").
 *  - Máximo 4 toques. Si no hay respuesta, se cierra el ciclo y se avisa que se cierra.
 *  - Sin promesas de posición ni de resultado numérico garantizado.
 *
 * Legal (Argentina, Ley 25.326): el dato de contacto es público y de uso
 * comercial, pero el titular tiene derecho a retiro. Todo mensaje incluye
 * mecanismo de baja y la baja se procesa de inmediato y para siempre.
 * WhatsApp además exige plantilla aprobada por Meta para iniciar conversación.
 */

/** Canales de contacto soportados por el motor de secuencias. */
export const CANALES = { email: 'email', whatsapp: 'whatsapp' };

/** Reemplaza {{variables}} de forma segura. */
export function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? `{{${k}}}`));
}

/**
 * Variables esperadas:
 *  negocio, contacto, score, banda, hallazgoTop, hallazgoTopDetalle,
 *  competenciaDelta, urlInforme, agencia, remitente, urlBaja
 */
export const SECUENCIA_PROSPECCION = [
  {
    paso: 1,
    diaRelativo: 0,
    canal: 'email',
    objetivo: 'Entregar el informe. Cero pedido.',
    asunto: '{{negocio}}: auditoría de su perfil en Google Maps ({{score}}/100)',
    cuerpo: `Hola{{saludoContacto}},

Soy {{remitente}}, de {{agencia}}. Trabajo optimizando perfiles de Google Maps para negocios de la zona.

Analicé el perfil de {{negocio}} con la misma grilla que uso con mis clientes: 25 puntos de control sobre datos del perfil, reseñas, fotos, actividad y conversión. El resultado dio {{score}} sobre 100 ({{banda}}).

Lo más relevante que encontré:

{{hallazgoTop}}
{{hallazgoTopDetalle}}

El informe completo, con los otros puntos y lo que ya está bien resuelto, está acá:
{{urlInforme}}

No hace falta que respondas ni que contrates nada. Lo hice porque es rápido de generar y porque, si algo de lo que marca te sirve, lo podés aplicar por tu cuenta.

Si preferís no recibir más mensajes míos, respondé "BAJA" y no vuelvo a escribir.

{{remitente}}
{{agencia}}`,
  },
  {
    paso: 2,
    diaRelativo: 3,
    canal: 'whatsapp',
    plantillaMeta: 'auditoria_seguimiento_v1', // categoría: MARKETING, requiere aprobación
    objetivo: 'Recordatorio breve, abrir conversación.',
    cuerpo: `Hola{{saludoContacto}}, soy {{remitente}} de {{agencia}}. Hace unos días te mandé por mail una auditoría del perfil de {{negocio}} en Google Maps (dio {{score}}/100).

Te dejo el link por las dudas: {{urlInforme}}

Si querés que te explique en 5 minutos los dos cambios que más mueven la aguja, decime y coordinamos. Y si no te interesa, respondé BAJA y listo.`,
  },
  {
    paso: 3,
    diaRelativo: 8,
    canal: 'email',
    objetivo: 'Aportar el dato comparativo: el argumento más fuerte.',
    asunto: 'Cómo está {{negocio}} frente a los perfiles que aparecen arriba',
    cuerpo: `Hola{{saludoContacto}},

Sumé un dato al informe de {{negocio}}: audité con la misma grilla los perfiles que hoy aparecen arriba tuyo cuando alguien busca tu categoría en la zona.

{{competenciaDelta}}

La diferencia no está en el presupuesto de publicidad. Está en cosas que se resuelven trabajando el perfil de forma constante.

El informe actualizado, con la comparación: {{urlInforme}}

Si querés que armemos un plan, tengo tres formatos según el nivel de trabajo que tenga sentido para el negocio. Y si no es el momento, respondé BAJA y no insisto.

{{remitente}}`,
  },
  {
    paso: 4,
    diaRelativo: 15,
    canal: 'email',
    objetivo: 'Cierre del ciclo. Se anuncia que se deja de escribir.',
    asunto: 'Cierro el seguimiento de {{negocio}}',
    cuerpo: `Hola{{saludoContacto}},

Este es el último mensaje que te mando sobre esto.

El informe de {{negocio}} queda disponible en el mismo link ({{urlInforme}}) por 90 días, lo puedas usar con quien quieras, conmigo o no.

Si en algún momento querés retomarlo, escribime y lo actualizo sin cargo: los perfiles cambian y el diagnóstico se vuelve viejo rápido.

Gracias por el tiempo.

{{remitente}}
{{agencia}}`,
  },
];

/**
 * Objeciones. Cada una define cómo la detecta el agente y qué acción dispara.
 * Pendiente de integración con el canal de respuesta a respuestas de prospectos.
 */
export const OBJECIONES = [
  {
    clave: 'precio',
    senales: ['caro', 'presupuesto', 'no me da', 'mucha plata', 'costoso', 'fuera de mi alcance'],
    accion: 'ofrecer_alternativas',
    respuesta: `Te entiendo, y prefiero decirte algo honesto: bajar el precio dejando el mismo alcance sería mentirte sobre el precio original.

Lo que sí puedo hacer es ajustar el alcance. Te armo tres opciones reales, con lo que cada una resigna dicho de frente:

{{alternativas}}

Cualquiera de las tres es mejor que no hacer nada, pero avanzan a velocidades distintas. ¿Cuál se acerca más a lo que tenías en mente?`,
  },
  {
    clave: 'tiempo',
    senales: ['más adelante', 'ahora no', 'el mes que viene', 'estamos con otras cosas', 'después de'],
    accion: 'agendar_recontacto',
    respuesta: `Sin problema. ¿Te parece si te escribo en {{mesesEspera}} con el informe actualizado, para que veas si algo cambió?

Mientras tanto, si querés avanzar por tu cuenta, lo que más rinde con menos esfuerzo es esto: {{quickWin}}. No necesitás contratar nada para hacerlo.`,
  },
  {
    clave: 'lo_hago_yo',
    senales: ['lo hago yo', 'me encargo', 'mi sobrino', 'tengo alguien', 'ya tengo agencia'],
    accion: 'ofrecer_setup_unico',
    respuesta: `Me parece bien, y si ya hay alguien encargado el informe le va a servir igual como checklist.

Si en algún momento querés una mano puntual, tengo un formato de puesta a punto de pago único: dejo el perfil optimizado y documentado, y la gestión sigue de tu lado. Sale {{precioSetup}} y son unos 10 días.

Te dejo el informe a mano igual: {{urlInforme}}`,
  },
  {
    clave: 'desconfianza',
    senales: ['no te conozco', 'estafa', 'quién sos', 'es spam', 'cómo conseguiste'],
    accion: 'enviar_credenciales',
    respuesta: `Pregunta justa. Te contesto los tres puntos:

Tu contacto lo saqué del perfil público de {{negocio}} en Google Maps, que es información abierta. Si preferís que no te escriba más, respondé BAJA y borro el dato.

Quién soy: {{credenciales}}

Y el informe no te pide datos ni tarjeta. Está entero en el link y lo podés leer sin contestarme nunca: {{urlInforme}}`,
  },
  {
    clave: 'resultados',
    senales: ['garantía', 'garantizás', 'cuánto voy a vender', 'me asegurás', 'primer puesto'],
    accion: 'aclarar_alcance',
    respuesta: `No garantizo posiciones. Nadie que trabaje en serio con Google puede hacerlo, porque el ranking no lo controlamos.

Lo que sí puedo comprometerme es a lo verificable: el score del perfil pasa de {{score}} a {{scoreProyectado}} en el plazo del plan, medido con la misma grilla del informe, y lo ves en el reporte mensual. Si a los 60 días no se movió, cortamos sin penalidad.

La proyección de consultas del informe es un modelo con supuestos declarados, no una promesa.`,
  },
  {
    clave: 'no_interesa',
    senales: ['no me interesa', 'baja', 'no gracias', 'dejá de escribir', 'stop', 'unsubscribe'],
    accion: 'baja_definitiva',
    respuesta: `Listo, te doy de baja ahora y no te escribo más. El informe de {{negocio}} queda disponible en {{urlInforme}} si alguna vez te sirve.

Gracias por avisar.`,
  },
];

/**
 * Detecta si la respuesta de un prospecto contiene una objeción conocida.
 * Pertenece al canal de respuesta a prospectos y se verifica en tests/motor.test.js.
 */
export function detectarObjecion(texto) {
  const t = (texto || '').toLowerCase();
  // La baja se evalúa primero: nunca puede quedar tapada por otra intención.
  const baja = OBJECIONES.find(o => o.clave === 'no_interesa');
  if (baja.senales.some(s => t.includes(s))) return baja;
  return OBJECIONES.find(o => o.clave !== 'no_interesa' && o.senales.some(s => t.includes(s))) || null;
}

/** Postventa: lo que sostiene la facturación recurrente. */
export const SECUENCIA_POSTVENTA = [
  { dia: 1,   canal: 'whatsapp', hito: 'bienvenida',        objetivo: 'Confirmar accesos y fijar expectativa de plazos.' },
  { dia: 7,   canal: 'email',    hito: 'primer_avance',     objetivo: 'Mostrar los primeros cambios aplicados con captura antes/después.' },
  { dia: 30,  canal: 'email',    hito: 'reporte_mes_1',     objetivo: 'Re-auditoría automática + delta de score + métricas de Maps.' },
  { dia: 35,  canal: 'whatsapp', hito: 'nps',               objetivo: 'Una sola pregunta de 0 a 10 y un campo abierto.' },
  { dia: 60,  canal: 'email',    hito: 'reporte_mes_2',     objetivo: 'Reporte + primer pedido de referido si NPS >= 9.' },
  { dia: 90,  canal: 'llamada',  hito: 'revision_trimestre',objetivo: 'Revisión de objetivos y propuesta de upsell si el score superó 80.' },
  { dia: 165, canal: 'email',    hito: 'prerenovacion',     objetivo: 'Resumen de 6 meses y renovación, 15 días antes del vencimiento.' },
];

/** Plantillas registradas en WhatsApp Business API para iniciar conversaciones proactivas. */
export const PLANTILLAS_META_WHATSAPP = [
  {
    nombre: 'auditoria_seguimiento_v1',
    categoria: 'MARKETING',
    idioma: 'es_AR',
    cuerpo: 'Hola {{1}}, soy {{2}} de {{3}}. Te envié por mail una auditoría gratuita del perfil de {{4}} en Google Maps (puntaje {{5}}/100). Te dejo el enlace: {{6}}',
    botones: [{ tipo: 'QUICK_REPLY', texto: 'Contame más' }, { tipo: 'QUICK_REPLY', texto: 'No me interesa' }],
    nota: 'Categoría MARKETING: se factura siempre. Requiere aprobación previa de Meta y opt-out visible.',
  },
  {
    nombre: 'reporte_mensual_v1',
    categoria: 'UTILITY',
    idioma: 'es_AR',
    cuerpo: 'Hola {{1}}, ya está el reporte de {{2}} correspondiente a {{3}}. El puntaje del perfil pasó de {{4}} a {{5}}. Lo podés ver acá: {{6}}',
    nota: 'Categoría UTILITY: más barata que marketing, y gratis si cae dentro de una ventana de servicio abierta.',
  },
  {
    nombre: 'recordatorio_pago_v1',
    categoria: 'UTILITY',
    idioma: 'es_AR',
    cuerpo: 'Hola {{1}}, te recordamos que el abono de {{2}} vence el {{3}}. Podés abonarlo desde este enlace: {{4}}',
  },
];
