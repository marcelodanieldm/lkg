/**
 * registry.js — Los agentes, con sus límites escritos.
 *
 * La regla que ordena todo: NINGÚN agente envía nada. Los agentes producen
 * intenciones; el guardián decide. Un agente que pudiera enviar sería un
 * agente que puede equivocarse de forma irreversible.
 *
 * Cada agente declara:
 *   herramientas  — lo único que puede llamar. Lo que no está, no existe.
 *   escribeEn     — pestañas del CRM donde puede escribir. El resto es lectura.
 *   decide        — qué puede resolver solo.
 *   escala        — qué obliga a pasar a un humano, sin excepción.
 *   modelo        — nivel de modelo. Clasificar no necesita el modelo caro.
 *   costoMax      — tope de gasto por invocación, en USD.
 */

export const AGENTES = {

  prospector: {
    nombre: 'Prospector',
    proposito: 'Encuentra negocios que valen la pena auditar y descarta el resto antes de gastar una llamada de API.',
    modelo: 'rapido',
    costoMax: 0.02,
    herramientas: ['buscar_negocios', 'leer_crm', 'estimar_costo'],
    escribeEn: ['Leads', 'Bitacora'],
    decide: [
      'Si un negocio entra o no en la lista de auditoría',
      'Qué consulta de búsqueda usar para un rubro y zona',
    ],
    escala: [
      'Si el rubro devuelve menos de 10 resultados: puede estar mal definido el nicho',
      'Si más del 40% de los resultados ya está en el CRM: la zona está agotada',
    ],
    limites: [
      'Nunca supera el tope diario de auditorías de Config',
      'Nunca audita un place_id que ya esté en el corpus con menos de 90 días',
    ],
  },

  auditor: {
    nombre: 'Auditor',
    proposito: 'Corre el motor determinista y arma el resultado. No opina.',
    modelo: 'ninguno',
    costoMax: 0.04,
    herramientas: ['auditar_perfil', 'analizar_sitio', 'indice_ia', 'percentil', 'escribir_corpus'],
    escribeEn: ['Leads', 'Corpus', 'Bitacora'],
    decide: ['Nada. Ejecuta la rúbrica y guarda el resultado.'],
    escala: ['Si la cobertura de datos baja del 60%: el informe saldría demasiado incompleto para enviarlo'],
    limites: [
      'PROHIBIDO que un modelo de lenguaje modifique el puntaje. El puntaje sale de rubric.js y de ningún otro lado.',
      'Los campos no verificables quedan nulos. Jamás se estiman.',
    ],
    nota: 'Este "agente" es casi todo código. Está en el registro para que quede explícito ' +
          'que la parte que produce números NO es un modelo. Es la propiedad que hace ' +
          'defendible el informe frente al cliente.',
  },

  redactor: {
    nombre: 'Redactor',
    proposito: 'Convierte el JSON de la auditoría en el informe y en el mensaje que lee una persona.',
    modelo: 'bueno',
    costoMax: 0.06,
    herramientas: ['leer_auditoria', 'generar_informe', 'redactar_mensaje'],
    escribeEn: ['Bitacora'],
    decide: ['Cómo se dice', 'Qué hallazgo encabeza el mensaje', 'El tono según el rubro'],
    escala: ['Si el linter marca un error: no reintenta solo más de una vez, escala'],
    limites: [
      'No inventa datos que no estén en el JSON',
      'No convierte un "no verificado" en un hallazgo',
      'No promete posiciones ni resultados: el linter lo bloquea igual, pero la instrucción va primero',
      'Cada afirmación con número tiene que poder rastrearse a una regla de la rúbrica',
    ],
    prompt: 'prompts/redactor-informe.md',
  },

  contacto: {
    nombre: 'Contacto',
    proposito: 'Arma la intención de envío y la pasa al guardián. Nunca envía.',
    modelo: 'rapido',
    costoMax: 0.01,
    herramientas: ['leer_crm', 'redactar_mensaje', 'evaluar_guardian', 'encolar_aprobacion'],
    escribeEn: ['Aprobaciones', 'Bitacora'],
    decide: ['Qué paso de la secuencia corresponde', 'Qué canal usar'],
    escala: ['Cualquier veredicto del guardián que no sea PERMITIDO'],
    limites: [
      'No tiene acceso a la herramienta de envío. No es una convención: no está en su lista.',
      'No puede escribir en Supresiones ni en Config',
    ],
  },

  conversador: {
    nombre: 'Conversador',
    proposito: 'Lee las respuestas entrantes, clasifica la intención y propone la siguiente acción.',
    modelo: 'bueno',
    costoMax: 0.03,
    herramientas: ['leer_crm', 'clasificar_respuesta', 'generar_presupuestos', 'alternativas_por_objecion', 'evaluar_guardian'],
    escribeEn: ['Leads', 'Mensajes', 'Aprobaciones', 'Bitacora'],
    decide: ['La clasificación de la objeción', 'Qué guion corresponde', 'La etapa nueva del lead'],
    escala: [
      'Cualquier mensaje que no encuadre en las seis objeciones conocidas',
      'Quejas, amenazas de denuncia o menciones legales',
      'Preguntas técnicas cuya respuesta no está en la auditoría',
      'Confianza propia por debajo de 0,7',
    ],
    limites: [
      'La baja se detecta ANTES de clasificar y gana siempre. "Me parece caro, igual no me interesa" es una baja.',
      'No negocia precios por fuera de las alternativas que genera el motor',
      'No promete plazos ni resultados',
    ],
    prompt: 'prompts/agente-conversacion.md',
  },

  cotizador: {
    nombre: 'Cotizador',
    proposito: 'Genera los planes y la escalera de reducción desde la auditoría.',
    modelo: 'ninguno',
    costoMax: 0.01,
    herramientas: ['leer_auditoria', 'generar_presupuestos', 'alternativas_por_objecion'],
    escribeEn: ['Bitacora'],
    decide: ['Nada: los planes salen de quote-engine.js'],
    escala: ['Si un plan da margen negativo a la tarifa objetivo'],
    limites: ['Los precios NO los inventa un modelo. Salen del catálogo de servicios y del cálculo de eficiencia.'],
  },

  postventa: {
    nombre: 'Postventa',
    proposito: 'Re-audita clientes, arma el reporte mensual con el delta y alerta si el puntaje bajó.',
    modelo: 'bueno',
    costoMax: 0.05,
    herramientas: ['auditar_perfil', 'leer_crm', 'generar_informe', 'evaluar_guardian', 'crear_tareas'],
    escribeEn: ['Clientes', 'Tareas', 'Mensajes', 'Bitacora'],
    decide: ['Qué destacar del mes', 'Qué tareas genera el plan contratado'],
    escala: [
      'Si el puntaje del cliente bajó: avisa antes de que el cliente lo note',
      'Si un pago quedó vencido más de 5 días',
      'NPS menor o igual a 6',
    ],
    limites: ['Re-audita con la MISMA rúbrica con la que se vendió. Cambiar la vara después de firmar es lo que arruina una agencia.'],
  },

  supervisor: {
    nombre: 'Supervisor',
    proposito: 'Cierra el día: consolida métricas, detecta anomalías y arma el resumen para Marcelo.',
    modelo: 'bueno',
    costoMax: 0.04,
    herramientas: ['leer_crm', 'resumen_aprobaciones', 'metricas', 'notificar'],
    escribeEn: ['Metricas', 'Bitacora'],
    decide: ['Qué merece la atención de un humano hoy'],
    escala: [
      'Tasa de rebotes por encima del 3%: hay un problema de entregabilidad',
      'Tasa de bajas por encima del 5%: el mensaje está mal',
      'Más de 20 aprobaciones pendientes o alguna con más de 48 horas',
      'Gasto de API por encima del 80% del presupuesto del mes',
      'Cero respuestas en 50 envíos: algo está roto y no es el copy',
    ],
    limites: ['No corrige nada por su cuenta. Informa y, si hace falta, activa la pausa general.'],
  },
};

/** Los agentes con permiso de escritura sobre una pestaña. Sirve para auditar. */
export function quienEscribeEn(pestana) {
  return Object.entries(AGENTES).filter(([, a]) => a.escribeEn.includes(pestana)).map(([k]) => k);
}

/** Verifica que un agente no esté usando una herramienta que no le corresponde. */
export function puedeUsar(agente, herramienta) {
  return AGENTES[agente]?.herramientas.includes(herramienta) ?? false;
}

/**
 * Invariantes del sistema. Se testean: si alguno se rompe, el diseño se rompió.
 */
export const INVARIANTES = [
  {
    id: 'nadie_envia',
    describe: 'Ningún agente tiene una herramienta de envío directo',
    verificar: () => !Object.values(AGENTES).some(a =>
      a.herramientas.some(h => /^(enviar|send)_/.test(h))),
  },
  {
    id: 'solo_guardian_autoriza',
    describe: 'Todo agente que produce mensajes tiene evaluar_guardian entre sus herramientas',
    verificar: () => Object.values(AGENTES)
      .filter(a => a.herramientas.includes('redactar_mensaje') || a.herramientas.includes('clasificar_respuesta'))
      .every(a => a.herramientas.includes('evaluar_guardian') || a.nombre === 'Redactor'),
  },
  {
    id: 'supresiones_intocables',
    describe: 'Ningún agente puede escribir en Supresiones ni en Config',
    verificar: () => !Object.values(AGENTES).some(a =>
      a.escribeEn.includes('Supresiones') || a.escribeEn.includes('Config')),
  },
  {
    id: 'puntaje_sin_modelo',
    describe: 'El auditor y el cotizador no usan modelo de lenguaje',
    verificar: () => AGENTES.auditor.modelo === 'ninguno' && AGENTES.cotizador.modelo === 'ninguno',
  },
  {
    id: 'todos_registran',
    describe: 'Todos los agentes escriben en la Bitácora',
    verificar: () => Object.values(AGENTES).every(a => a.escribeEn.includes('Bitacora')),
  },
  {
    id: 'costo_acotado',
    describe: 'Todo agente declara un tope de costo por invocación',
    verificar: () => Object.values(AGENTES).every(a => typeof a.costoMax === 'number' && a.costoMax > 0),
  },
];
