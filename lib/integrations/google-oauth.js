/**
 * google-oauth.js — Un solo token para todo Workspace.
 *
 * Gmail, Sheets, Docs, Drive y Calendar son la misma cuenta y el mismo
 * proyecto de Google Cloud, así que comparten el refresh token. Tener un solo
 * lugar donde se renueva evita el problema clásico: cinco módulos pidiendo un
 * access token nuevo en la misma corrida y comiéndose la cuota de OAuth.
 *
 * ALCANCES. El refresh token guarda los permisos que se autorizaron cuando se
 * generó. Si más adelante agregás una integración (Calendar, por ejemplo) y no
 * estaba en la lista al autorizar, las llamadas fallan con 403 y el mensaje no
 * dice que falta el alcance. Por eso se autorizan todos de una, aunque al
 * principio no se usen todos: volver a pedir consentimiento es más molesto que
 * pedir de más la primera vez.
 *
 * `drive.file` en vez de `drive`: da acceso SOLO a los archivos que creó esta
 * aplicación. Lokigi no tiene por qué poder leer el resto de tu Drive, y ese
 * alcance además evita la verificación de Google que sí exige el alcance
 * completo.
 */

export const ALCANCES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events',
];

const OAUTH = 'https://oauth2.googleapis.com/token';

let _tok = null, _exp = 0, _enVuelo = null;

/**
 * El access token vigente. Si dos llamadas coinciden mientras se está
 * renovando, las dos esperan la misma promesa en lugar de disparar dos
 * renovaciones.
 */
export async function token() {
  if (_tok && Date.now() < _exp - 60_000) return _tok;
  if (_enVuelo) return _enVuelo;

  _enVuelo = (async () => {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
    const refresh = process.env.GOOGLE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !refresh) {
      throw new Error(
        'Faltan credenciales de Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN). ' +
        'Generá el refresh token con: node scripts/google-auth.js'
      );
    }
    const res = await fetch(OAUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refresh, grant_type: 'refresh_token',
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      // `invalid_grant` casi siempre significa una de tres cosas: revocaste el
      // acceso, la app sigue en modo "Prueba" en la pantalla de consentimiento
      // (los tokens caducan a los 7 días), o cambiaste la contraseña de Google.
      const pista = d.error === 'invalid_grant'
        ? ' — el refresh token dejó de servir. Si la app figura en modo "Prueba" en la pantalla de consentimiento de Google Cloud, publicala: en ese modo los tokens caducan cada 7 días.'
        : '';
      throw new Error(`OAuth Google ${res.status}: ${d.error_description || d.error || ''}${pista}`);
    }
    _tok = d.access_token;
    _exp = Date.now() + d.expires_in * 1000;
    return _tok;
  })();

  try { return await _enVuelo; } finally { _enVuelo = null; }
}

/** Cliente HTTP común: reintenta 429 y 5xx, y traduce el 403 de alcance. */
export async function llamar(url, opciones = {}, intento = 0) {
  const res = await fetch(url, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
      ...opciones.headers,
    },
  });

  if ((res.status === 429 || res.status >= 500) && intento < 4) {
    await new Promise(r => setTimeout(r, 2 ** intento * 500 + Math.random() * 400));
    return llamar(url, opciones, intento + 1);
  }

  const texto = await res.text();
  if (!res.ok) {
    if (res.status === 403 && /insufficient|scope/i.test(texto)) {
      throw new Error(
        `Google 403: al refresh token le falta un alcance para ${new URL(url).hostname}. ` +
        'Volvé a correr scripts/google-auth.js y autorizá de nuevo.'
      );
    }
    throw new Error(`Google ${res.status} (${new URL(url).hostname}): ${texto.slice(0, 400)}`);
  }
  return texto ? JSON.parse(texto) : {};
}

/** Solo para los tests: permite empezar de cero sin reiniciar el proceso. */
export function _olvidarToken() { _tok = null; _exp = 0; _enVuelo = null; }
