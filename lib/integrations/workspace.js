/**
 * workspace.js — Sheets, Docs, Drive y Calendar.
 *
 * Regla que ordena todo el archivo: **acá se escribe, nunca se lee para
 * decidir.** Ninguna función de este módulo devuelve algo de lo que dependa el
 * estado del sistema. El guardián no consulta la planilla, el motor de
 * auditoría no consulta Drive, la secuencia no consulta Calendar.
 *
 * Por qué importa: Workspace es una superficie que vos tocás a mano. Si el
 * sistema leyera de ahí para decidir, un filtro mal aplicado en la planilla un
 * domingo a la noche podría hacer que el lunes se le escriba a alguien que
 * pidió la baja. Escribiendo en un solo sentido, lo peor que puede pasar es
 * que la planilla quede desactualizada un día.
 *
 * La única excepción declarada es `leerNotas()`, y está aislada al final con
 * su propia explicación.
 */

import { llamar } from './google-oauth.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DOCS   = 'https://docs.googleapis.com/v1/documents';
const DRIVE  = 'https://www.googleapis.com/drive/v3';
const CAL    = 'https://www.googleapis.com/calendar/v3';

const TZ = 'America/Argentina/Buenos_Aires';

export const configurado = () => Boolean(
  (process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN) && process.env.GOOGLE_CLIENT_ID
);

// ═══════════════════════════════════════════════════════════════════════
// Sheets — el tablero espejo
// ═══════════════════════════════════════════════════════════════════════

/**
 * Vuelca una grilla en una hoja, reemplazando lo que había.
 *
 * Se limpia y se reescribe entero en lugar de actualizar fila por fila. Es más
 * bruto, pero es lo correcto acá: la planilla no es la fuente de verdad, así
 * que no hay nada que conservar, y un reemplazo total no puede dejar filas
 * huérfanas de una corrida anterior (que es el error que más confunde después,
 * porque son datos que parecen vigentes y no lo son).
 */
export async function volcarHoja(idPlanilla, hoja, filas) {
  if (!filas.length) return { filas: 0 };

  await asegurarHoja(idPlanilla, hoja);

  // El rango de limpieza va hasta la columna ZZ a propósito: si una corrida
  // anterior escribió más columnas que esta, hay que barrerlas también.
  await llamar(`${SHEETS}/${idPlanilla}/values/${encodeURIComponent(`${hoja}!A1:ZZ`)}:clear`,
               { method: 'POST', body: '{}' });

  await llamar(
    `${SHEETS}/${idPlanilla}/values/${encodeURIComponent(`${hoja}!A1`)}?valueInputOption=RAW`,
    // `celda` se aplica también acá y no solo en `aGrilla`, por si alguien
    // llama a esta función con una grilla armada a mano. Es idempotente.
    { method: 'PUT', body: JSON.stringify({ values: filas.map(f => f.map(celda)) }) }
  );

  await formatearEncabezado(idPlanilla, hoja);
  return { filas: filas.length - 1 };
}

/**
 * Sheets tipa según lo que ve. Una hora como "09:00" se convierte en hora, un
 * place_id que empieza con "+" se toma como fórmula y rompe. Se normaliza a
 * texto salvo los números, que sí queremos que sean números para poder
 * ordenar y graficar.
 */
function celda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'SÍ' : '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

async function asegurarHoja(idPlanilla, hoja) {
  const meta = await llamar(`${SHEETS}/${idPlanilla}?fields=sheets.properties`);
  if ((meta.sheets || []).some(s => s.properties.title === hoja)) return;
  await llamar(`${SHEETS}/${idPlanilla}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: hoja } } }] }),
  });
}

async function idDeHoja(idPlanilla, hoja) {
  const meta = await llamar(`${SHEETS}/${idPlanilla}?fields=sheets.properties`);
  return (meta.sheets || []).find(s => s.properties.title === hoja)?.properties.sheetId ?? null;
}

/** Encabezado fijo y en negrita. Sin esto la planilla es ilegible al scrollear. */
async function formatearEncabezado(idPlanilla, hoja) {
  const sheetId = await idDeHoja(idPlanilla, hoja);
  if (sheetId === null) return;
  await llamar(`${SHEETS}/${idPlanilla}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount' } },
        { repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.91, green: 0.93, blue: 0.96 },
            } },
            fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
        { autoResizeDimensions: {
            dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 20 } } },
      ],
    }),
  }).catch(() => { /* el formato es cosmético: que falle no invalida el volcado */ });
}

/**
 * Convierte filas de PostgREST en la grilla que espera `volcarHoja`.
 * Ya deja cada valor neutralizado: un place_id que empieza con "+" o un texto
 * que empieza con "=" no puede quedar como fórmula en la planilla.
 */
export function aGrilla(filas, columnas) {
  const cols = columnas || (filas.length ? Object.keys(filas[0]) : []);
  return [cols.map(titulo), ...filas.map(f => cols.map(c => celda(f[c])))];
}

const titulo = (c) => c.replace(/_/g, ' ').replace(/^./, m => m.toUpperCase());

/**
 * Crea la planilla espejo la primera vez y devuelve su id.
 * Se guarda en `config` para no volver a crearla en cada corrida.
 */
export async function crearPlanillaEspejo(nombre = 'Lokigi — tablero') {
  const r = await llamar(SHEETS, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: nombre, locale: 'es_AR', timeZone: TZ },
      sheets: [{ properties: { title: 'Leads' } }],
    }),
  });
  return { id: r.spreadsheetId, url: r.spreadsheetUrl };
}

// ═══════════════════════════════════════════════════════════════════════
// Docs — la propuesta comercial
// ═══════════════════════════════════════════════════════════════════════

/**
 * Arma el documento de propuesta y devuelve su enlace.
 *
 * Por qué un Doc y no un PDF adjunto: un adjunto en un correo en frío empeora
 * la entregabilidad y muchos filtros lo miran con lupa. Un enlace no pesa, se
 * abre en el celular sin descargar nada, y —lo que más sirve— deja ver cuándo
 * lo abrieron y permite corregir una línea después de mandado sin reenviar.
 *
 * Los números NO los escribe un modelo. Vienen del motor de cotización, que es
 * determinista. Acá solo se maqueta.
 */
export async function crearPropuesta({ negocio, plan, alternativas = [], auditoria, carpetaId }) {
  const bloques = redactarPropuesta({ negocio, plan, alternativas, auditoria });

  const doc = await llamar(DOCS, {
    method: 'POST',
    body: JSON.stringify({ title: `Propuesta — ${negocio}` }),
  });
  const id = doc.documentId;

  await llamar(`${DOCS}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: aPeticionesDocs(bloques) }),
  });

  if (carpetaId) await moverA(id, carpetaId).catch(() => {});

  // Cualquiera con el enlace puede leer, nadie puede editar. Pedirle a un
  // prospecto que inicie sesión en Google para ver un presupuesto pierde
  // clientes.
  await compartirPorEnlace(id, 'reader');

  return { id, url: `https://docs.google.com/document/d/${id}/edit` };
}

/**
 * El texto de la propuesta, como lista de bloques.
 *
 * Se separa de la llamada a la API por dos razones. La primera es poder
 * testearla sin credenciales de Google: un test puede afirmar que ningún
 * precio del documento difiere del que devolvió el motor de cotización. La
 * segunda es que deja evidente lo que importa — que acá NO interviene un
 * modelo de lenguaje. Cada cifra sale de `quote-engine.js` y cada argumento
 * sale del campo `resigna`/`razon` que el propio motor produjo.
 */
export function redactarPropuesta({ negocio, plan, alternativas = [], auditoria }) {
  const ars = plan.moneda === 'ARS';
  const m = (usd, arsVal) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: plan.moneda || 'USD', maximumFractionDigits: 0,
  }).format(ars ? (arsVal ?? usd) : usd);

  const setup   = m(plan.setupUSD, plan.setupARS);
  const mensual = m(plan.mensualUSD, plan.mensualARS);

  const b = [];
  const H = (t) => b.push({ t, estilo: 'HEADING_1' });
  const S = (t) => b.push({ t, estilo: 'HEADING_2' });
  const P = (t) => b.push({ t, estilo: 'NORMAL_TEXT' });

  H(`Propuesta para ${negocio}`);
  P(`Preparada el ${new Date().toLocaleDateString('es-AR', { timeZone: TZ, dateStyle: 'long' })}.`);

  S('De dónde sale este número');
  P(`El perfil de ${negocio} en Google Maps puntúa ${auditoria.score} sobre 100. ` +
    `Corrigiendo lo que se puede corregir, el techo alcanzable es ${auditoria.potencial}. ` +
    `Esa diferencia de ${auditoria.brecha} puntos es lo que este plan busca recuperar.`);
  P(`La auditoría revisó ${auditoria.meta?.reglasEvaluadas ?? auditoria.meta?.totalReglas ?? ''} puntos de control ` +
    `sobre información pública del perfil. Cada servicio de acá abajo responde a un hallazgo concreto: ` +
    `no es un paquete armado de antemano.`);
  if (auditoria.meta?.cobertura != null && auditoria.meta.cobertura < 100) {
    P(`Cobertura de la auditoría: ${auditoria.meta.cobertura}%. ` +
      `Lo que no se pudo verificar desde afuera quedó fuera del cálculo en vez de estimarse.`);
  }

  S(`${plan.nombre}`);
  P(plan.lema || '');
  P(`Puesta en marcha: ${setup}  ·  Abono mensual: ${mensual}` +
    (plan.compromisoMeses ? `  ·  Compromiso: ${plan.compromisoMeses} meses` : ''));
  if (plan.descuentoPaquete > 0) {
    P(`La puesta en marcha ya tiene ${plan.descuentoPaquete}% de descuento por hacer varios trabajos juntos: ` +
      `comparten relevamiento, accesos y reuniones.`);
  }
  P('');
  for (const s of plan.servicios || []) {
    P(`• ${s.nombre}${s.puntos ? ` (+${s.puntos} pts)` : ''} — ${s.detalle || ''}`);
  }
  P('');
  P(`Proyección: de ${auditoria.score} a ${plan.scoreProyectado} puntos, ` +
    `es decir ${plan.puntosProyectados} de los ${auditoria.brecha} recuperables.`);

  if (alternativas.length) {
    S('Si el presupuesto no da');
    P('Tres formas de empezar más chico. En cada una está dicho qué se resigna, porque resignar algo es inevitable:');
    P('');
    for (const a of alternativas) {
      P(`• ${a.nombre} — ${m(a.setupUSD, a.setupARS)}` +
        (a.mensualUSD ? ` + ${m(a.mensualUSD, a.mensualARS)}/mes` : ' (pago único, sin abono)'));
      P(`   ${a.razon}`);
      P(`   Se resigna: ${a.resigna}`);
    }
  }

  S('Cómo seguimos');
  P('Si algo de esto te cierra, respondé este correo y coordinamos veinte minutos para repasarlo. ' +
    'Si no, avisame y no te escribo más — no hace falta que des explicaciones.');

  return b;
}

/**
 * Traduce los bloques a peticiones de la API de Docs.
 *
 * Se inserta TODO el texto de una sola vez y recién después se aplican los
 * estilos por posición. Intercalar inserción y estilo obliga a recalcular los
 * índices en cada paso, y es exactamente ahí donde estos documentos salen con
 * los títulos corridos media línea.
 */
export function aPeticionesDocs(bloques) {
  const texto = bloques.map(x => x.t).join('\n') + '\n';
  const requests = [{ insertText: { location: { index: 1 }, text: texto } }];

  let cursor = 1;
  for (const x of bloques) {
    const largo = x.t.length + 1;
    if (x.estilo !== 'NORMAL_TEXT' && x.t) {
      requests.push({ updateParagraphStyle: {
        range: { startIndex: cursor, endIndex: cursor + largo },
        paragraphStyle: { namedStyleType: x.estilo },
        fields: 'namedStyleType',
      } });
    }
    cursor += largo;
  }
  return requests;
}

// ═══════════════════════════════════════════════════════════════════════
// Drive — el archivo de informes
// ═══════════════════════════════════════════════════════════════════════

export async function carpeta(nombre, padreId = null) {
  const q = [
    `name='${nombre.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    padreId ? `'${padreId}' in parents` : null,
  ].filter(Boolean).join(' and ');

  const ya = await llamar(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`);
  if (ya.files?.length) return ya.files[0].id;

  const r = await llamar(`${DRIVE}/files?fields=id`, {
    method: 'POST',
    body: JSON.stringify({
      name: nombre,
      mimeType: 'application/vnd.google-apps.folder',
      ...(padreId ? { parents: [padreId] } : {}),
    }),
  });
  return r.id;
}

/**
 * Guarda el informe HTML en Drive, ordenado por mes.
 *
 * Se sube como HTML y no como PDF: pesa menos, se indexa en la búsqueda de
 * Drive (podés buscar "veterinaria Córdoba" y encontrar el informe) y Drive lo
 * previsualiza igual. Convertirlo a PDF requeriría un navegador headless, que
 * no entra en una función serverless del plan gratuito.
 */
export async function archivarInforme({ negocio, html, carpetaRaizId }) {
  const mes = new Date().toISOString().slice(0, 7);
  const raiz = carpetaRaizId || await carpeta('Lokigi — informes');
  const destino = await carpeta(mes, raiz);

  const limite = `lok${Date.now().toString(36)}`;
  const meta = JSON.stringify({
    name: `${negocio} — ${new Date().toISOString().slice(0, 10)}.html`,
    parents: [destino],
  });

  const cuerpo =
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${limite}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n` +
    `--${limite}--`;

  const r = await llamar(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${limite}` }, body: cuerpo }
  );
  return { id: r.id, url: r.webViewLink };
}

export const moverA = (fileId, carpetaId) =>
  llamar(`${DRIVE}/files/${fileId}?addParents=${carpetaId}&removeParents=root&fields=id`, { method: 'PATCH', body: '{}' });

export const compartirPorEnlace = (fileId, rol = 'reader') =>
  llamar(`${DRIVE}/files/${fileId}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ role: rol, type: 'anyone' }),
  });

// ═══════════════════════════════════════════════════════════════════════
// Calendar — la llamada
// ═══════════════════════════════════════════════════════════════════════

/**
 * Propone tres horarios concretos en vez de mandar un enlace de agenda.
 *
 * Es deliberado. "Agendá cuando quieras" traslada el trabajo al prospecto y
 * baja la tasa de reuniones; tres opciones cerradas ("martes 10, martes 15,
 * miércoles 11") se responden con una palabra. El evento se crea recién cuando
 * eligen una.
 */
export function proponerHorarios({ desde = new Date(), cantidad = 3, duracionMin = 20 } = {}) {
  const opciones = [];
  const d = new Date(desde);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);

  const horas = [10, 15, 11];
  let i = 0;
  while (opciones.length < cantidad && i < 40) {
    i++;
    const dia = d.getDay();
    if (dia === 0 || dia === 6) { d.setDate(d.getDate() + 1); continue; }
    const h = horas[opciones.length % horas.length];
    const inicio = new Date(d);
    inicio.setHours(h, 0, 0, 0);
    opciones.push({
      inicio: inicio.toISOString(),
      fin: new Date(inicio.getTime() + duracionMin * 60000).toISOString(),
      etiqueta: inicio.toLocaleString('es-AR', {
        timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      }),
    });
    d.setDate(d.getDate() + 1);
  }
  return opciones;
}

/**
 * Crea el evento con su enlace de Meet.
 *
 * `avisar` viene en false a propósito, y es la decisión importante de esta
 * función: con `sendUpdates=all`, Google le manda la invitación al invitado
 * por su cuenta. Eso es un mensaje que llega a la casilla de un tercero sin
 * haber pasado por el guardián — exactamente lo que el sistema entero existe
 * para impedir.
 *
 * Así, el evento queda en TU calendario con el enlace de Meet, y el mensaje
 * que se lo comunica al prospecto lo redacta el agente y lo autoriza el
 * guardián, igual que todos los demás. Si el modelo se equivocó al interpretar
 * que alguien eligió un horario, lo peor que pasa es un evento de más en tu
 * agenda; nadie recibe nada.
 */
export async function agendarLlamada({ negocio, email, inicio, fin, notas, avisar = false, calendarId = 'primary' }) {
  const r = await llamar(
    `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=${avisar ? 'all' : 'none'}`,
    {
      method: 'POST',
      body: JSON.stringify({
        summary: `Lokigi · ${negocio}`,
        description: notas || 'Repaso de la auditoría del perfil de Google Maps.',
        start: { dateTime: inicio, timeZone: TZ },
        end:   { dateTime: fin,    timeZone: TZ },
        attendees: email ? [{ email }] : [],
        // Meet automático: mandar un horario sin enlace obliga a un segundo
        // correo, y cada correo extra es una oportunidad de que se caiga.
        conferenceData: {
          createRequest: { requestId: `lok-${Date.now().toString(36)}`,
                           conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      }),
    }
  );
  return { id: r.id, url: r.htmlLink, meet: r.hangoutLink || null };
}

// ═══════════════════════════════════════════════════════════════════════
// La única lectura
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lee una columna de notas que escribas a mano en la planilla espejo.
 *
 * Es la excepción a la regla de arriba y por eso está sola. Lo que devuelve
 * NO cambia el estado del sistema: se muestra en el panel junto al lead y nada
 * más. No decide envíos, no altera etapas, no toca la lista de supresión.
 *
 * Si alguna vez se te ocurre hacer que una nota de la planilla frene un envío,
 * no lo hagas acá: poné el correo en la tabla `supresiones`, que es
 * irreversible y sí la consulta el guardián.
 */
export async function leerNotas(idPlanilla, hoja = 'Leads', columnaId = 'A', columnaNota = 'Z') {
  const rango = `${hoja}!${columnaId}2:${columnaId}`;
  const rangoNota = `${hoja}!${columnaNota}2:${columnaNota}`;
  const r = await llamar(
    `${SHEETS}/${idPlanilla}/values:batchGet?ranges=${encodeURIComponent(rango)}&ranges=${encodeURIComponent(rangoNota)}`
  );
  const ids = r.valueRanges?.[0]?.values || [];
  const notas = r.valueRanges?.[1]?.values || [];
  const out = {};
  ids.forEach((fila, i) => {
    const nota = notas[i]?.[0];
    if (fila?.[0] && nota) out[fila[0]] = String(nota).slice(0, 500);
  });
  return out;
}
