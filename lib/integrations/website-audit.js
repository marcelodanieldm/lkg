/**
 * website-audit.js — Análisis liviano del sitio web del negocio.
 * Sin dependencias externas: una sola descarga HTML + expresiones regulares.
 * No pretende ser Lighthouse; busca las señales que la rúbrica necesita.
 */

const TIMEOUT_MS = 9000;

/**
 * Direcciones de correo del sitio.
 *
 * Sin esto el sistema no tiene a quién escribirle: la API de Places devuelve
 * teléfono y sitio web, nunca el correo. El sitio del negocio es la única
 * fuente pública que lo tiene, y por eso esta función es la que decide si un
 * lead llega a recibir la auditoría o se queda en el corpus.
 *
 * Se descartan las direcciones de plataforma (wordpress, wixpress, sentry) y
 * las de ejemplo, que son las que más ensucian. El orden importa: se prefiere
 * una casilla de contacto real antes que la del estudio que hizo el sitio.
 */
const BASURA = /@(?:example|dominio|tudominio|tuempresa|sentry|wixpress|wordpress|godaddy|squarespace|sentry\.io)\b|\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/i;
const PREFERIDAS = /^(?:info|contacto|hola|consultas|ventas|comercial|turnos|reservas|atencion|administracion)@/i;

export function extraerEmails(html) {
  const crudos = new Set();

  // mailto: primero — es una declaración explícita, no una coincidencia suelta.
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) crudos.add(m[1]);
  // Ofuscación habitual en sitios chicos: "hola (arroba) negocio.com".
  const desofuscado = html
    .replace(/\s*(?:\(|\[)?\s*(?:arroba|at)\s*(?:\)|\])?\s*/gi, '@')
    .replace(/\s*(?:\(|\[)?\s*(?:punto|dot)\s*(?:\)|\])?\s*/gi, '.');
  for (const m of desofuscado.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) crudos.add(m[0]);

  const limpias = [...crudos]
    .map(e => decodeURIComponent(e).trim().toLowerCase().replace(/[.,;:]+$/, ''))
    .filter(e => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && !BASURA.test(e));

  return [...new Set(limpias)].sort((a, b) => {
    const pa = PREFERIDAS.test(a) ? 0 : 1, pb = PREFERIDAS.test(b) ? 0 : 1;
    return pa - pb || a.length - b.length;
  }).slice(0, 5);
}

/** Rutas donde casi siempre está el correo cuando no está en la portada. */
const RUTAS_CONTACTO = ['/contacto', '/contact', '/contactanos', '/nosotros'];

export async function analizarSitio(url) {
  if (!url) return null;
  const inicio = Date.now();
  let target = url.startsWith('http') ? url : `https://${url}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(target, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditorGBP/1.0; +auditoria de perfil)' },
    });
    clearTimeout(t);

    const html = await res.text();
    const ms = Date.now() - inicio;
    const texto = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                      .replace(/<[^>]+>/g, ' ')
                      .replace(/\s+/g, ' ');

    // Una sola página de contacto, y sólo si la portada no dio nada. Dos
    // descargas por sitio × 25 sitios por corrida sigue siendo barato; cuatro
    // ya empieza a costar tiempo de función serverless.
    let emails = extraerEmails(html);
    if (!emails.length) emails = await buscarEnContacto(res.url, html);

    return {
      url: res.url,
      ok: res.ok,
      emails,
      status: res.status,
      ms,
      https: res.url.startsWith('https://'),
      viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
      titulo: (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || null,
      pesoKB: Math.round(html.length / 1024),
      schemaLocalBusiness: /"@type"\s*:\s*"(LocalBusiness|Restaurant|Store|Dentist|MedicalBusiness|ProfessionalService|HealthAndBeautyBusiness|AutomotiveBusiness|FoodEstablishment)"/i.test(html),
      schemaCualquiera: /application\/ld\+json/i.test(html),
      telefonos: [...html.matchAll(/(?:tel:|whatsapp\.com\/send\?phone=)\+?([\d\s().-]{7,20})/gi)].map(m => m[1]),
      redes: {
        instagram: /instagram\.com\/[A-Za-z0-9._]{2,}/i.test(html) || null,
        facebook: /facebook\.com\/[A-Za-z0-9.]{2,}/i.test(html) || null,
        whatsapp: /(wa\.me\/|api\.whatsapp\.com|whatsapp\.com\/send)/i.test(html) || null,
        tiktok: /tiktok\.com\/@[A-Za-z0-9._]{2,}/i.test(html) || null,
        linkedin: /linkedin\.com\/(company|in)\//i.test(html) || null,
        youtube: /youtube\.com\/(@|channel|c)\//i.test(html) || null,
      },
      texto: texto.slice(0, 12000),
    };
  } catch (e) {
    return { url: target, ok: false, status: null, emails: [], error: e.name === 'AbortError' ? 'timeout' : e.message, https: target.startsWith('https'), redes: {} };
  }
}

/**
 * Segunda oportunidad: la página de contacto. Se prefiere el enlace que el
 * propio sitio declara; si no hay, se prueban las rutas convencionales.
 */
async function buscarEnContacto(base, html) {
  const declarado = [...html.matchAll(/href=["']([^"']*(?:contact|contacto)[^"']*)["']/gi)]
    .map(m => m[1]).filter(h => !h.startsWith('mailto:'))[0];

  const candidatas = declarado ? [declarado] : RUTAS_CONTACTO;

  for (const ruta of candidatas.slice(0, 2)) {
    try {
      const destino = new URL(ruta, base).href;
      if (destino === base) continue;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(destino, {
        signal: ctrl.signal, redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditorGBP/1.0; +auditoria de perfil)' },
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const e = extraerEmails(await r.text());
      if (e.length) return e;
    } catch { /* una página de contacto caída no invalida la auditoría */ }
  }
  return [];
}
