/**
 * guard.js — El guardián. La ÚNICA puerta de salida del sistema.
 *
 * Ningún agente, ninguna tarea programada y ningún script envía nada sin pasar
 * por `evaluar()`. No es una recomendación de arquitectura: es la diferencia
 * entre un sistema agéntico y un generador de spam con buena prosa.
 *
 * Principios:
 *
 *   1. FALLA CERRADO. Si una regla no puede evaluarse —se cayó la base, falta
 *      un dato— el resultado es BLOQUEADO, nunca PERMITIDO. Un error nunca
 *      debe abrir la puerta.
 *
 *   2. DETERMINISTA. Ninguna regla consulta un modelo de lenguaje. El modelo
 *      redacta el mensaje; el guardián decide si sale. Si el modelo pudiera
 *      influir en su propia autorización, no habría guardián.
 *
 *   3. EL ORDEN IMPORTA. Las reglas de cumplimiento van primero y son
 *      permanentes. Las de ritmo van después y solo difieren. Una baja nunca
 *      puede quedar tapada por un "todavía no es horario".
 *
 *   4. AUDITABLE. Cada decisión devuelve la regla que la tomó y una razón en
 *      castellano. Se escribe en la Bitácora. Cuando algo salga mal, la
 *      respuesta a "por qué mandó eso" está en una fila.
 */

/**
 * Fuente de datos inyectada. NO hay valor por defecto, y eso es deliberado.
 *
 * En la versión anterior el default era el cliente de Google Sheets. Al pasar
 * a Supabase, esa línea quedó apuntando a un archivo que ya no existe: el
 * módulo cargaba igual en los tests —que siempre inyectan un doble— y habría
 * explotado recién en producción, en el primer envío. Un test que lee el
 * código fuente lo encontró; conviene que no pueda volver a pasar.
 *
 * Sin fuente inyectada, `evaluar()` lanza, el catch de más abajo lo convierte
 * en BLOQUEADO y no sale nada. Falla cerrado, como todo lo demás acá.
 *
 * Que la fuente sea inyectable no es una comodidad de testing: es lo que
 * permitió cambiar de Sheets a Postgres sin tocar ninguna de las doce reglas.
 */
let datos = null;

export function usarFuente(nueva) {
  if (!nueva) throw new Error('usarFuente() necesita una fuente de datos.');
  datos = nueva;
}

const fuente = () => {
  if (!datos) {
    throw new Error(
      'El guardián no tiene fuente de datos. Llamá a usarFuente(db) antes de evaluar(). ' +
      'Sin esto no se puede verificar la lista de supresión, así que no se envía nada.'
    );
  }
  return datos;
};

export const VEREDICTO = {
  PERMITIDO: 'permitido',
  BLOQUEADO: 'bloqueado',        // no sale nunca, no reintentar
  DIFERIDO: 'diferido',          // podría salir más tarde
  APROBACION: 'requiere_aprobacion',
};

/** Hash estable de un intento: la misma intención da siempre el mismo id. */
export function huella(intento) {
  const base = `${intento.leadId}|${intento.canal}|${intento.paso ?? ''}|${(intento.cuerpo || '').slice(0, 200)}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) { h = ((h << 5) - h + base.charCodeAt(i)) | 0; }
  return 'g' + Math.abs(h).toString(36).padStart(7, '0');
}

// ─────────────────────────────────────────────────────────────────────
// LINTER DE CONTENIDO
// Lo único que revisa lo que el modelo escribió. No juzga estilo: busca
// las cosas que convierten un mensaje en un problema legal o comercial.
// ─────────────────────────────────────────────────────────────────────

// Ojo con \b y los acentos: en JavaScript, \b sólo reconoce [A-Za-z0-9_],
// así que /\búltima/ NUNCA coincide. Se usan lookarounds sobre una clase que
// incluye las vocales acentuadas y la ñ.
const L = 'A-Za-z0-9_áéíóúüñÁÉÍÓÚÜÑ';
const B = (cuerpo) => new RegExp(`(?<![${L}])(?:${cuerpo})(?![${L}])`, 'i');

export const PROHIBIDO = [
  { re: B('garantiz(?:o|amos|ado|ada|amos)'), que: 'promesa de garantía' },
  { re: B('(?:primer|1er|#\\s*1|número uno|nº\\s*1)\\s*(?:puesto|lugar|posición)'), que: 'promesa de posición' },
  { re: B('te\\s+asegur(?:o|amos)'), que: 'promesa de resultado' },
  { re: B('(?:100|cien)\\s*%\\s*(?:de\\s+)?(?:éxito|resultado|efectiv\\w*)'), que: 'promesa absoluta' },
  { re: B('(?:primero|primeros)\\s+en\\s+(?:google|maps)'), que: 'promesa de posición' },
  { re: B('top\\s*3\\s+(?:de|en)\\s+google'), que: 'promesa de posición' },
  { re: B('sin\\s+riesgo'), que: 'promesa absoluta' },
  { re: B('duplicar(?:é|e)?\\s+(?:tus|sus|las)\\s+(?:ventas|clientes|ingresos)'), que: 'promesa numérica de resultado' },
  { re: B('última\\s+oportunidad'), que: 'urgencia falsa' },
  { re: B('sólo\\s+por\\s+hoy|solo\\s+por\\s+hoy'), que: 'urgencia falsa' },
  { re: B('(?:haga|hacé|haz)\\s+clic\\s+aquí\\s+ahora'), que: 'patrón típico de spam' },
  { re: B('resultados\\s+garantizados'), que: 'promesa de garantía' },
];

const REQUERIDO_EMAIL = [
  { re: /\bBAJA\b|darse de baja|no recibir más|desuscribir/i, que: 'mecanismo de baja' },
];

/** Revisa el texto que va a salir. Devuelve errores (bloquean) y avisos (piden aprobación). */
export function lintear(intento) {
  const errores = [], avisos = [];
  const texto = `${intento.asunto || ''}\n${intento.cuerpo || ''}`;

  for (const p of PROHIBIDO) {
    const m = texto.match(p.re);
    if (m) errores.push(`${p.que}: "${m[0]}"`);
  }

  // Variables de plantilla sin resolver. Mandar "Hola {{contacto}}" es peor
  // que no mandar nada: demuestra que del otro lado no hay nadie.
  const sinResolver = texto.match(/\{\{\s*\w+\s*\}\}/g);
  if (sinResolver) errores.push(`variables sin resolver: ${[...new Set(sinResolver)].join(', ')}`);

  if (intento.canal === 'email') {
    for (const r of REQUERIDO_EMAIL) if (!r.re.test(texto)) errores.push(`falta ${r.que}`);
    if (!intento.asunto || intento.asunto.length < 8) errores.push('asunto vacío o demasiado corto');
    if ((intento.asunto || '').length > 90) avisos.push('asunto largo, se corta en el celular');
    if (/[A-ZÁÉÍÓÚÑ]{6,}/.test(intento.asunto || '')) avisos.push('mayúsculas sostenidas en el asunto');
  }

  if (!intento.cuerpo || intento.cuerpo.length < 60) errores.push('cuerpo vacío o demasiado corto');
  if ((intento.cuerpo || '').length > 2600) avisos.push('mensaje muy largo para un primer contacto');

  // El nombre del negocio tiene que aparecer: es la prueba de que no es masivo.
  if (intento.negocio && !texto.includes(intento.negocio)) {
    avisos.push('el mensaje no nombra al negocio');
  }

  const signos = (texto.match(/[!¡]/g) || []).length;
  if (signos > 2) avisos.push(`${signos} signos de exclamación`);

  return { errores, avisos, limpio: errores.length === 0 };
}

// ─────────────────────────────────────────────────────────────────────
// REGLAS
// Cada una recibe { intento, ctx } y devuelve null si pasa, o un veredicto.
// ─────────────────────────────────────────────────────────────────────

const REGLAS = [
  // ── Cumplimiento: permanente, nunca se reintenta ──────────────────
  {
    id: 'pausa_general',
    async check(_, ctx) {
      if (ctx.cfg.pausa) return { veredicto: VEREDICTO.BLOQUEADO, razon: 'Pausa general activada en Config. Nada sale hasta que se ponga en FALSE.' };
    },
  },
  {
    id: 'destinatario_valido',
    async check(i) {
      if (!i.destinatario) return { veredicto: VEREDICTO.BLOQUEADO, razon: 'Sin destinatario.' };
      if (i.canal === 'email') {
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(i.destinatario))
          return { veredicto: VEREDICTO.BLOQUEADO, razon: `Email con formato inválido: ${i.destinatario}` };
        // Buzones que no se contactan jamás: son roles, no personas.
        if (/^(no-?reply|postmaster|abuse|webmaster|spam|admin|root)@/i.test(i.destinatario))
          return { veredicto: VEREDICTO.BLOQUEADO, razon: `Buzón de sistema: ${i.destinatario}` };
        if (/\.(gob|gov|edu|mil)(\.[a-z]{2})?$/i.test(i.destinatario.split('@')[1] || ''))
          return { veredicto: VEREDICTO.BLOQUEADO, razon: 'Dominio institucional: fuera del público objetivo.' };
      }
    },
  },
  {
    id: 'supresion',
    async check(i, ctx) {
      const val = String(i.destinatario).toLowerCase().trim();
      const dom = val.includes('@') ? val.split('@')[1] : null;
      const hit = ctx.supresiones.find(s => {
        const v = String(s.valor).toLowerCase().trim();
        return v === val || (dom && s.tipo === 'dominio' && v === dom);
      });
      if (hit) return { veredicto: VEREDICTO.BLOQUEADO, razon: `En lista de supresión desde ${hit.fecha} (${hit.motivo}). Es definitivo.` };
      if (ctx.lead?.opt_out === true) return { veredicto: VEREDICTO.BLOQUEADO, razon: 'El lead pidió la baja. No se contacta nunca más.' };
    },
  },
  {
    id: 'etapa_terminal',
    async check(i, ctx) {
      const e = ctx.lead?.etapa;
      if (['baja', 'perdido'].includes(e))
        return { veredicto: VEREDICTO.BLOQUEADO, razon: `El lead está en etapa "${e}".` };
      if (e === 'ganado' && i.tipo === 'prospeccion')
        return { veredicto: VEREDICTO.BLOQUEADO, razon: 'Ya es cliente: no corresponde prospección.' };
    },
  },
  {
    id: 'idempotencia',
    async check(i, ctx) {
      const h = huella(i);
      if (ctx.mensajes.some(m => m.id === h))
        return { veredicto: VEREDICTO.BLOQUEADO, razon: 'Este mensaje exacto ya se envió. Duplicado evitado.' };
      if (i.paso && ctx.mensajes.some(m => m.lead_id === i.leadId && Number(m.paso) === Number(i.paso) && m.direccion === 'saliente'))
        return { veredicto: VEREDICTO.BLOQUEADO, razon: `El paso ${i.paso} ya se le envió a este lead.` };
    },
  },
  {
    id: 'tope_toques',
    async check(i, ctx) {
      const n = ctx.mensajes.filter(m => m.lead_id === i.leadId && m.direccion === 'saliente').length;
      if (n >= ctx.cfg.maxToques)
        return { veredicto: VEREDICTO.BLOQUEADO, razon: `Ya recibió ${n} mensajes (tope ${ctx.cfg.maxToques}). El ciclo se cierra: no se insiste.` };
    },
  },

  // ── Contenido ─────────────────────────────────────────────────────
  {
    id: 'linter',
    async check(i) {
      const l = lintear(i);
      if (!l.limpio) return { veredicto: VEREDICTO.BLOQUEADO, razon: `El contenido no pasa: ${l.errores.join('; ')}.`, detalle: l };
      if (l.avisos.length) return { veredicto: VEREDICTO.APROBACION, razon: `Avisos del linter: ${l.avisos.join('; ')}.`, detalle: l };
    },
  },

  // ── Ritmo: solo difiere, nunca bloquea para siempre ────────────────
  {
    id: 'ventana_horaria',
    async check(i, ctx) {
      if (i.forzarHorario) return;
      const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: ctx.cfg.zona }));
      const h = ahora.getHours(), d = ahora.getDay();
      if (!ctx.cfg.diasHabiles.includes(d))
        return { veredicto: VEREDICTO.DIFERIDO, razon: 'Fin de semana. Un mensaje comercial un domingo es la forma más rápida de que te marquen como spam.' };
      if (h < ctx.cfg.desde || h >= ctx.cfg.hasta)
        return { veredicto: VEREDICTO.DIFERIDO, razon: `Fuera de la ventana ${ctx.cfg.desde}-${ctx.cfg.hasta} hs (son las ${h}).` };
    },
  },
  {
    id: 'espaciado_lead',
    async check(i, ctx) {
      const previos = ctx.mensajes
        .filter(m => m.lead_id === i.leadId && m.direccion === 'saliente' && m.fecha)
        .map(m => new Date(m.fecha).getTime())
        .sort((a, b) => b - a);
      if (!previos.length) return;
      const horas = (Date.now() - previos[0]) / 3_600_000;
      if (horas < ctx.cfg.horasMin)
        return { veredicto: VEREDICTO.DIFERIDO, razon: `Último mensaje hace ${horas.toFixed(1)} h; el mínimo es ${ctx.cfg.horasMin} h.` };
    },
  },
  {
    id: 'cupo_diario',
    async check(i, ctx) {
      const hoy = new Date().toISOString().slice(0, 10);
      const enviadosHoy = ctx.mensajes.filter(m =>
        m.direccion === 'saliente' && m.canal === i.canal && String(m.fecha || '').startsWith(hoy)).length;
      const cupo = cupoDelDia(i.canal, ctx.cfg);
      if (enviadosHoy >= cupo)
        return { veredicto: VEREDICTO.DIFERIDO, razon: `Cupo diario de ${i.canal} agotado (${enviadosHoy}/${cupo}). Sigue mañana.` };
    },
  },
  {
    id: 'presupuesto',
    async check(_, ctx) {
      if (ctx.gastoMes > ctx.cfg.presupuesto)
        return { veredicto: VEREDICTO.BLOQUEADO, razon: `Presupuesto de API del mes superado (USD ${ctx.gastoMes.toFixed(2)} de ${ctx.cfg.presupuesto}).` };
    },
  },

  // ── Autonomía: la última puerta ───────────────────────────────────
  {
    id: 'modo_autonomia',
    async check(i, ctx) {
      const modo = ctx.cfg.modo;
      if (modo === 'auto') return;
      if (modo === 'aprobacion') {
        if (ctx.aprobadosHumano < ctx.cfg.umbralAuto)
          return { veredicto: VEREDICTO.APROBACION,
                   razon: `Modo aprobación: ${ctx.aprobadosHumano} de ${ctx.cfg.umbralAuto} envíos revisados a mano. Falta rodaje.` };
        return; // ya superó el umbral: pasa a automático solo
      }
      if (modo === 'auto_con_excepciones') {
        if (i.esExcepcion || i.confianza != null && i.confianza < 0.7)
          return { veredicto: VEREDICTO.APROBACION, razon: 'El agente no tuvo confianza suficiente para decidir solo.' };
      }
    },
  },
];

/**
 * Rampa de calentamiento del buzón. Google permite 2.000 diarios en Workspace,
 * pero un buzón nuevo que manda 200 correos en frío el primer día se quema.
 * La recomendación de la industria son unas pocas decenas por buzón calentado.
 */
export function cupoDelDia(canal, cfg) {
  const base = canal === 'email' ? cfg.cupoEmail : cfg.cupoWhatsapp;
  if (!cfg.inicioCalentamiento) return Math.min(base, 5);
  const dias = Math.floor((Date.now() - new Date(cfg.inicioCalentamiento).getTime()) / 86_400_000);
  if (dias < 7) return Math.min(base, 5);
  if (dias < 14) return Math.min(base, 10);
  if (dias < 21) return Math.min(base, 15);
  if (dias < 28) return Math.min(base, 20);
  return Math.min(base, 25);
}

// ─────────────────────────────────────────────────────────────────────

async function contexto(intento) {
  const [tablas, cfgVals] = await Promise.all([
    fuente().leerVarias(['Supresiones', 'Mensajes', 'Leads', 'Metricas']),
    Promise.all([
      fuente().config('modo_autonomia', 'aprobacion'),
      fuente().config('envios_aprobados_para_auto', 50),
      fuente().config('cupo_diario_email', 25),
      fuente().config('cupo_diario_whatsapp', 20),
      fuente().config('horario_desde', 9),
      fuente().config('horario_hasta', 18),
      fuente().config('dias_habiles', '1,2,3,4,5'),
      fuente().config('horas_min_entre_toques', 48),
      fuente().config('max_toques', 4),
      fuente().config('presupuesto_api_mes_usd', 40),
      fuente().config('zona_horaria', 'America/Argentina/Buenos_Aires'),
      fuente().config('dia_inicio_calentamiento', ''),
      fuente().config('pausa_general', false),
    ]),
  ]);

  const [modo, umbralAuto, cupoEmail, cupoWhatsapp, desde, hasta, diasStr, horasMin, maxToques,
         presupuesto, zona, inicioCalentamiento, pausa] = cfgVals;

  const mesActual = new Date().toISOString().slice(0, 7);
  const gastoMes = tablas.Metricas
    .filter(m => String(m.fecha || '').startsWith(mesActual))
    .reduce((a, m) => a + (Number(m.costo_api_usd) || 0), 0);

  return {
    supresiones: tablas.Supresiones,
    mensajes: tablas.Mensajes,
    lead: tablas.Leads.find(l => String(l.id) === String(intento.leadId)) || null,
    aprobadosHumano: tablas.Mensajes.filter(m => m.aprobado_por === 'humano').length,
    gastoMes,
    cfg: {
      modo, umbralAuto, cupoEmail, cupoWhatsapp, desde, hasta, horasMin, maxToques,
      presupuesto, zona, inicioCalentamiento, pausa: pausa === true || pausa === 'TRUE',
      diasHabiles: String(diasStr).split(',').map(Number),
    },
  };
}

/**
 * Evalúa un intento de envío. Es el único punto de entrada.
 *
 * @param intento {tipo, canal, leadId, negocio, destinatario, asunto, cuerpo, paso, agente, confianza}
 * @returns {veredicto, razon, regla, id, detalle}
 */
export async function evaluar(intento) {
  const id = huella(intento);
  let ctx;
  try {
    ctx = await contexto(intento);
  } catch (e) {
    // Falla cerrado: si no puedo verificar, no sale.
    return { id, veredicto: VEREDICTO.BLOQUEADO, regla: 'contexto',
             razon: `No se pudo verificar el contexto (${e.message}). Ante la duda no se envía.` };
  }

  for (const regla of REGLAS) {
    let r;
    try {
      r = await regla.check(intento, ctx);
    } catch (e) {
      return { id, veredicto: VEREDICTO.BLOQUEADO, regla: regla.id,
               razon: `La regla "${regla.id}" falló (${e.message}). Falla cerrado.` };
    }
    if (r) return { id, regla: regla.id, ...r };
  }

  return { id, veredicto: VEREDICTO.PERMITIDO, regla: null, razon: 'Pasó las 12 reglas.' };
}

/** Registra la decisión en la Bitácora. Se llama siempre, pase o no pase. */
export async function registrar(intento, resultado) {
  await fuente().agregar('Bitacora', {
    fecha: new Date().toISOString(),
    agente: intento.agente || 'desconocido',
    accion: `envio:${intento.canal}:paso${intento.paso ?? '-'}`,
    lead_id: intento.leadId,
    decision: resultado.veredicto,
    razon: `[${resultado.regla || 'ok'}] ${resultado.razon}`,
    confianza: intento.confianza ?? '',
    costo_usd: intento.costo ?? 0,
  });
}

/** Lista de identificadores de las 12 reglas del guardián determinista. */
export const REGLAS_IDS = REGLAS.map(r => r.id);
