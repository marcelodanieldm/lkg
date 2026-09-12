/**
 * gemini.js — Los agentes que redactan y clasifican.
 *
 * Reemplaza los nodos de IA de n8n. Mismos prompts, mismos límites.
 *
 * Por qué Gemini y no Claude, siendo que tenés Claude Pro:
 *   Ni Claude Pro ni Google AI Pro dan acceso a la API para automatizar.
 *   Son suscripciones del chat. La documentación de Google lo dice textual:
 *   «los beneficios de los planes de Google AI para uso de desarrollo aplican
 *   únicamente dentro de la interfaz web de AI Studio».
 *   El nivel gratuito de la API de Gemini es otra cosa, existe, y no pide
 *   tarjeta: 15 pedidos por minuto y 1.500 por día con Flash. A 25 auditorías
 *   diarias eso sobra por un factor de treinta.
 *
 * ADVERTENCIA sobre el nivel gratuito: Google se reserva el derecho de usar
 * los prompts del nivel gratuito para entrenar sus modelos. Acá van nombres
 * de negocios reales y datos de sus perfiles. Activar facturación —unos 2 a 5
 * dólares al mes a este volumen— desactiva ese uso. La variable
 * GEMINI_FACTURADO=1 solo cambia el registro de la bitácora; el cambio real
 * se hace en la consola de Google.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Flash para todo. Pro solo si algún día hiciera falta razonamiento pesado. */
export const MODELOS = {
  rapido: 'gemini-2.5-flash-lite',  // 30 pedidos/min · clasificar, decidir zona
  bueno:  'gemini-2.5-flash',       // 15 pedidos/min · redactar
};

/** Costo aproximado por invocación, para el presupuesto del guardián. */
const COSTO_ESTIMADO = { rapido: 0.0002, bueno: 0.0006 };

class ErrorCuota extends Error {
  constructor(mensaje, reintentarEn) { super(mensaje); this.reintentarEn = reintentarEn; }
}

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Llama al modelo y devuelve JSON ya parseado.
 *
 * `esquema` no es opcional por comodidad: sin salida estructurada el modelo
 * devuelve markdown con bloques de código alrededor del JSON la mitad de las
 * veces, y el parseo se vuelve una fuente de errores silenciosos.
 */
export async function pedirJSON({
  prompt, sistema, esquema, nivel = 'bueno', temperatura = 0.4, maxIntentos = 3,
}) {
  const clave = process.env.GEMINI_API_KEY;
  if (!clave) throw new Error('Falta GEMINI_API_KEY. Se obtiene gratis en aistudio.google.com/apikey');

  const modelo = MODELOS[nivel] || MODELOS.bueno;
  const cuerpo = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(sistema ? { systemInstruction: { parts: [{ text: sistema }] } } : {}),
    generationConfig: {
      temperature: temperatura,
      responseMimeType: 'application/json',
      ...(esquema ? { responseSchema: esquema } : {}),
      maxOutputTokens: 2048,
    },
    // El contenido de Lokigi es comercial y sobrio; los filtros por defecto
    // a veces cortan textos que mencionan reseñas negativas.
    safetySettings: [
      'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT',
    ].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
  };

  for (let intento = 0; intento < maxIntentos; intento++) {
    const res = await fetch(`${API}/${modelo}:generateContent?key=${clave}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });

    if (res.status === 429) {
      // El nivel gratuito limita por minuto. Esperar y reintentar es correcto;
      // insistir sin pausa consume la cuota del día sin conseguir nada.
      const espera = 2 ** intento * 4000 + Math.random() * 1000;
      if (intento === maxIntentos - 1) {
        throw new ErrorCuota(`Cuota de Gemini agotada (429) tras ${maxIntentos} intentos`, espera);
      }
      await dormir(espera);
      continue;
    }

    if (res.status >= 500) {
      if (intento === maxIntentos - 1) throw new Error(`Gemini ${res.status}: el servicio no responde`);
      await dormir(2 ** intento * 1000);
      continue;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 300)}`);

    const cand = data.candidates?.[0];
    if (!cand) throw new Error('Gemini no devolvió candidatos');
    if (cand.finishReason === 'SAFETY') throw new Error('Gemini bloqueó la respuesta por filtros de seguridad');
    if (cand.finishReason === 'MAX_TOKENS') throw new Error('La respuesta se cortó por límite de tokens');

    const texto = cand.content?.parts?.map(p => p.text).join('') || '';
    try {
      return {
        salida: JSON.parse(texto),
        costo: COSTO_ESTIMADO[nivel] ?? 0.0005,
        tokens: data.usageMetadata?.totalTokenCount ?? null,
        modelo,
      };
    } catch {
      // Con responseMimeType JSON esto casi no pasa, pero si pasa conviene
      // saber qué devolvió en vez de un "unexpected token" pelado.
      throw new Error(`Gemini devolvió algo que no es JSON: ${texto.slice(0, 200)}`);
    }
  }
  throw new Error('Gemini: se agotaron los intentos');
}

// ─────────────────────────────────────────────────────────────────────
// Los agentes. Cada uno con su esquema de salida obligatorio.
// ─────────────────────────────────────────────────────────────────────

const ESQ_PROSPECTOR = {
  type: 'object',
  properties: {
    consulta: { type: 'string' }, categoria: { type: 'string' },
    ciudad: { type: 'string' }, razon: { type: 'string' },
  },
  required: ['consulta', 'categoria', 'ciudad', 'razon'],
};

export async function agenteProspector({ resumenZonas, nicho, pais = 'Argentina' }) {
  return pedirJSON({
    nivel: 'rapido',
    sistema: 'Devolvés únicamente JSON válido. Sin texto alrededor.',
    esquema: ESQ_PROSPECTOR,
    prompt: `Sos el agente Prospector de Lokigi. Elegís qué buscar hoy en Google Places.

Zonas ya trabajadas (categoría | ciudad: cantidad de leads):
${resumenZonas || 'todavía no hay leads'}

Nicho asignado: ${nicho}
País: ${pais}

Elegí UNA consulta de búsqueda para hoy. Criterios:
- Zona con menos de 40 leads: hay lugar para crecer.
- Si una combinación pasa de 60, está agotada: cambiá de barrio o de ciudad.
- Preferí barrios concretos antes que ciudades enteras: la búsqueda devuelve mejores resultados.

La razón, en menos de 20 palabras.`,
  });
}

const ESQ_REDACTOR = {
  type: 'object',
  properties: {
    asunto: { type: 'string' }, cuerpo: { type: 'string' },
    confianza: { type: 'number' },
  },
  required: ['asunto', 'cuerpo', 'confianza'],
};

export async function agenteRedactor({ auditoria, percentil, urlInforme, contacto }) {
  const h = auditoria.hallazgos[0];
  const f = auditoria.fortalezas[0];

  return pedirJSON({
    nivel: 'bueno',
    temperatura: 0.6,
    esquema: ESQ_REDACTOR,
    sistema: 'Sos un técnico que revisó algo y cuenta lo que encontró, no un vendedor. ' +
             'Español rioplatense, voseo, frases cortas. Cero emojis, cero signos de exclamación. ' +
             'Devolvés únicamente JSON válido.',
    prompt: `Escribís el primer contacto por email para Lokigi.

Datos de la auditoría. NO inventes nada que no esté acá:
Negocio: ${auditoria.meta.negocio}
Puntaje: ${auditoria.score}/100 (${auditoria.banda.etiqueta})
Techo alcanzable: ${auditoria.potencial}
Percentil en su rubro y ciudad: ${percentil != null ? percentil : 'todavía sin muestra suficiente'}
Hallazgo principal: ${h?.titulo} — ${h?.evidencia}
Qué hacer: ${h?.recomendacion}
Fundamento: ${h?.fuente?.texto || 'sin fuente citada'}
Fortaleza a reconocer: ${f?.titulo} — ${f?.evidencia}
Enlace al informe: ${urlInforme}
${contacto ? `Nombre del contacto: ${contacto}` : 'No sabemos el nombre del contacto: no lo inventes.'}

Reglas SIN EXCEPCIÓN:
1. Empezá reconociendo la fortaleza. Nadie escucha una crítica antes de un reconocimiento.
2. Un solo hallazgo, el principal. No una lista.
3. PROHIBIDO prometer posiciones, garantías o resultados numéricos. Un linter lo bloquea y el envío no sale.
4. Terminá con: si preferís no recibir más mensajes, respondé BAJA y no vuelvo a escribir.
5. Nombrá al negocio por su nombre al menos una vez.
6. Máximo 180 palabras.
${percentil != null ? '7. Usá el percentil: es el dato más persuasivo que tenemos.' : ''}

La confianza baja si los datos de la auditoría son pobres o el hallazgo es débil.`,
  });
}

const ESQ_CONVERSADOR = {
  type: 'object',
  properties: {
    intencion: {
      type: 'string',
      enum: ['interes', 'precio', 'tiempo', 'lo_hago_yo', 'desconfianza', 'resultados', 'pregunta', 'otro'],
    },
    urgencia: { type: 'string', enum: ['alta', 'media', 'baja'] },
    resumen: { type: 'string' },
    confianza: { type: 'number' },
    requiere_humano: { type: 'boolean' },
    // Cuál de los horarios ofrecidos eligió, si eligió alguno. Es un ÍNDICE de
    // la lista que se le mandó, no una fecha: pedirle al modelo que parsee
    // "el martes a las 10" y devuelva un timestamp es pedirle que invente una
    // zona horaria. El índice lo resuelve la lista, que es determinista.
    horario_elegido: { type: 'integer' },
  },
  required: ['intencion', 'urgencia', 'resumen', 'confianza', 'requiere_humano'],
};

/**
 * @param opciones.horarios  Horarios que se le ofrecieron, en orden. Si el
 *   prospecto eligió uno, el modelo devuelve su posición (1, 2, 3) en
 *   `horario_elegido`; 0 si no eligió ninguno.
 */
export async function agenteConversador({ texto, negocio, score, etapa, horarios = [] }) {
  return pedirJSON({
    nivel: 'bueno',
    temperatura: 0.2,
    esquema: ESQ_CONVERSADOR,
    sistema: 'Sos un clasificador. Devolvés únicamente JSON válido. ' +
             'No inventás intención cuando el mensaje es ambiguo: para eso está "otro".',
    prompt: `Clasificás la respuesta de un prospecto que recibió una auditoría gratuita de su perfil de Google Maps.

Negocio: ${negocio || 'desconocido'}
Puntaje de su auditoría: ${score ?? 's/d'}/100
Etapa actual: ${etapa || 'contactado'}
Mensaje recibido: """${texto}"""
${horarios.length ? `
Se le habían ofrecido estos horarios, en este orden:
${horarios.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}

Si el mensaje elige uno de forma inequívoca, poné su número en horario_elegido.
Si no elige, si propone otro, o si hay cualquier duda: poné 0. Agendar una
reunión que la persona no confirmó es peor que no agendar ninguna.
` : ''}
Poné requiere_humano en true si: hay una queja, una amenaza legal, una pregunta cuya
respuesta no está en la auditoría, o si tu confianza es menor a 0,7. Ante la duda, true.
No pasa nada si escalás de más; sí pasa si contestás cualquier cosa.

El resumen, en menos de 12 palabras.`,
  });
}

const ESQ_SUPERVISOR = {
  type: 'object',
  properties: {
    resumen: { type: 'string' },
    activar_pausa: { type: 'boolean' },
    razon_pausa: { type: 'string' },
  },
  required: ['resumen', 'activar_pausa'],
};

export async function agenteSupervisor({ metricas, alarmas }) {
  return pedirJSON({
    nivel: 'bueno',
    temperatura: 0.3,
    esquema: ESQ_SUPERVISOR,
    sistema: 'Devolvés únicamente JSON válido. Sos conservador: ante la duda sobre entregabilidad, frenás.',
    prompt: `Sos el agente Supervisor de Lokigi. Escribís el cierre del día para Marcelo, que lo lee en el celular.

Métricas de hoy: ${JSON.stringify(metricas)}
Alarmas: ${JSON.stringify(alarmas)}

Escribí un resumen de máximo 120 palabras que responda tres cosas:
1. Qué pasó hoy, en una línea.
2. Qué necesita su atención y por qué importa.
3. Qué hacer mañana, concreto.

Español rioplatense, voseo, directo, sin adulación, sin signos de exclamación.
Si no hay nada importante, decilo en una línea y terminá: no rellenes.

Poné activar_pausa en true SOLO si hay una alarma grave de entregabilidad
(rebotes o bajas por encima del tope, o 50 envíos sin respuesta).
Frenar un día cuesta poco; quemar el dominio no se revierte.`,
  });
}
