#!/usr/bin/env node
/**
 * google-auth.js — Obtiene el refresh token de Google, una sola vez.
 *
 *   node scripts/google-auth.js
 *
 * Antes de correrlo, en console.cloud.google.com:
 *   1. Crear un proyecto.
 *   2. Habilitar estas APIs: Gmail, Google Sheets, Google Docs, Google Drive,
 *      Google Calendar y Places API (New).
 *   3. Pantalla de consentimiento OAuth → tipo Externo.
 *   4. Credenciales → ID de cliente OAuth → tipo "Aplicación de escritorio".
 *   5. Exportar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET antes de correr esto.
 *
 * ATENCIÓN con el paso 3, porque es la causa número uno de que Lokigi deje de
 * mandar correos a la semana de haberlo encendido: mientras la app figure en
 * estado "Prueba", Google CADUCA el refresh token cada 7 días. Para un sistema
 * que corre solo, eso significa que un lunes deja de funcionar sin avisar.
 * Hay que tocar "Publicar aplicación". Como la app la usa una sola persona con
 * su propia cuenta, queda en estado "En producción / no verificada": Google
 * muestra una pantalla de advertencia al autorizar, se entra por "Configuración
 * avanzada", y el token pasa a durar indefinidamente.
 *
 * Los alcances se piden TODOS de una, aunque al principio no uses Calendar ni
 * Docs. El refresh token guarda los permisos del momento en que se autorizó:
 * si después agregás una integración, las llamadas fallan con 403 y hay que
 * repetir todo esto.
 */

import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const PUERTO = 8484;
const REDIR = `http://localhost:${PUERTO}/callback`;
import { ALCANCES as LISTA } from '../lib/integrations/google-oauth.js';

// La lista vive en google-oauth.js para que no pueda desincronizarse de lo que
// el sistema realmente usa. Si agregás una integración nueva, agregá el alcance
// allá y volvé a correr este script.
const ALCANCES = LISTA.join(' ');

const { GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: SECRETO } = process.env;
if (!ID || !SECRETO) {
  console.error('\nFaltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el entorno.\n' +
    'Exportalos y volvé a correr:\n' +
    '  export GOOGLE_CLIENT_ID="...apps.googleusercontent.com"\n' +
    '  export GOOGLE_CLIENT_SECRET="GOCSPX-..."\n');
  process.exit(1);
}

const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: ID, redirect_uri: REDIR, response_type: 'code', scope: ALCANCES,
  access_type: 'offline',
  prompt: 'consent', // fuerza que devuelva refresh_token aunque ya hayas autorizado antes
});

console.log('\nAbrí este enlace en el navegador y autorizá con la cuenta que va a enviar:\n');
console.log('  ' + url + '\n');
console.log('Esperando la respuesta en ' + REDIR + ' ...\n');

const servidor = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PUERTO}`);
  if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }

  const code = u.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<meta charset="utf-8"><p>No llegó el código. Volvé a intentar.</p>');
  }

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: ID, client_secret: SECRETO,
        redirect_uri: REDIR, grant_type: 'authorization_code' }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || JSON.stringify(d));

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><body style="font:16px system-ui;padding:60px;max-width:520px;margin:auto">' +
            '<h2>Listo.</h2><p>Ya podés cerrar esta pestaña y volver a la terminal.</p></body>');

    console.log('✓ Autorización obtenida. Agregá esto a .env.local y, además, a las variables de entorno de Vercel:\n');
    console.log(`GOOGLE_CLIENT_ID=${ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${SECRETO}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${d.refresh_token}`);
    if (!d.refresh_token) {
      console.log('\n⚠ Google no devolvió refresh_token. Suele pasar cuando ya autorizaste antes:');
      console.log('  entrá a myaccount.google.com/permissions, quitá el acceso y repetí.\n');
    }
    console.log('\nAlcances autorizados:');
    for (const a of LISTA) console.log('  · ' + a.replace('https://www.googleapis.com/auth/', ''));
    console.log('\nDespués: node scripts/verificar.js — comprueba que cada API conteste.');
    console.log('La planilla espejo NO hay que crearla: se crea sola en la primera corrida de /api/cron/espejo.\n');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<meta charset="utf-8"><p>Error: ${e.message}</p>`);
    console.error('\n✗ ' + e.message + '\n');
  }
  servidor.close();
  process.exit(0);
});

servidor.listen(PUERTO);
createInterface({ input: process.stdin, output: process.stdout })
  .on('SIGINT', () => { servidor.close(); process.exit(0); });
