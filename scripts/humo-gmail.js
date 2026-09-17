/**
 * humo-gmail.js — Prueba diagnóstica de credenciales y envío por Gmail API.
 *
 * Herramienta de diagnóstico aislada que únicamente corre una persona a mano.
 * Nadie la importa, ninguna ruta ni tarea la llama.
 *
 * Uso:
 *   npm run humo:email tu-correo@gmail.com
 */

import { enviar } from '../lib/integrations/gmail.js';
import { agregar } from '../lib/db/supabase.js';

const MI_CORREO = 'danielmarcelo1801@gmail.com';

function traducirError(e) {
  const msg = e.message || String(e);
  console.error(`\n❌ ERROR AL ENVIAR CORREO CON GMAIL API:`);
  console.error(`Detalle técnico: ${msg}`);

  if (/invalid_grant/i.test(msg)) {
    console.error(`
💡 DIAGNÓSTICO:
El error "invalid_grant" indica que el refresh token de Google caducó o fue revocado.
Causa más frecuente: La aplicación en Google Cloud Console sigue en estado "Prueba" (Testing).
En estado "Prueba", los refresh tokens caducan automáticamente a los 7 días.
Solución:
  1. Entrá a Google Cloud Console › Pantalla de consentimiento de OAuth y pasá la app a "En Producción".
  2. Ejecutá: npm run auth para generar un nuevo refresh token permanente.
`);
  } else if (/403|insufficient|scope|permission/i.test(msg)) {
    console.error(`
💡 DIAGNÓSTICO:
Error 403 / Permisos insuficientes. La cuenta de Google autorizada no otorgó los scopes requeridos de Gmail.
Solución:
  Ejecutá: npm run auth para reautorizar los permisos requeridos.
`);
  } else if (/GMAIL_FROM/i.test(msg)) {
    console.error(`
💡 DIAGNÓSTICO:
Falta la variable de entorno GMAIL_FROM en .env.local.
`);
  } else if (/GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN/i.test(msg)) {
    console.error(`
💡 DIAGNÓSTICO:
Faltan las credenciales de Google OAuth en .env.local.
Solución:
  Ejecutá: npm run auth
`);
  }
}

async function main() {
  const destinatario = process.argv[2]?.trim();

  // 1. Exige una dirección como argumento
  if (!destinatario) {
    console.error('❌ ERROR: Se requiere una dirección de correo como argumento.');
    console.error('Uso: npm run humo:email tu-correo@gmail.com');
    process.exit(1);
  }

  // 2. Rechaza cualquier dirección que no sea la del operador
  const correosValidos = new Set([
    MI_CORREO.toLowerCase(),
    (process.env.EMAIL_OPERADOR || '').toLowerCase(),
    (process.env.GMAIL_FROM || '').toLowerCase(),
  ].filter(Boolean));

  if (!correosValidos.has(destinatario.toLowerCase())) {
    console.error(`❌ ERROR: Este script de prueba solo se puede ejecutar contra la casilla propia.`);
    console.error(`Se intentó enviar a: "${destinatario}"`);
    console.error(`Casillas autorizadas: ${[...correosValidos].join(', ')}`);
    process.exit(1);
  }

  const asunto = 'Lokigi · prueba de credenciales';
  const textoPlano = 'Hola,\n\nEste es un correo de prueba de credenciales enviado desde Lokigi para verificar la conexión con Gmail API.';
  const html = '<p>Hola,</p><p>Este es un correo de prueba de credenciales enviado desde Lokigi para verificar la conexión con Gmail API.</p>';
  const urlBaja = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/baja`;

  console.log(`Enviando correo de prueba a ${destinatario}...`);

  try {
    // 3. Envío por Gmail API con cabeceras de baja incluidas
    const res = await enviar({
      para: destinatario,
      asunto,
      textoPlano,
      html,
      urlBaja,
    });

    // 4. Imprime el ID devuelto
    console.log('\n==================================================');
    console.log(`✓ CORREO ENVIADO CORRECTAMENTE`);
    console.log(`Gmail Message ID: ${res.id}`);
    if (res.threadId) console.log(`Gmail Thread ID:  ${res.threadId}`);
    console.log('==================================================\n');

    // Registro en la Bitácora con agente 'humo'
    await agregar('Bitacora', {
      agente: 'humo',
      accion: 'envio_prueba_credenciales',
      lead_id: 'prueba_credenciales',
      decision: 'enviado',
      razon: `Prueba de credenciales de Gmail enviada correctamente a ${destinatario}. Message ID: ${res.id}`,
    }).catch((err) => {
      console.warn('Nota: No se pudo registrar la acción en Bitacora:', err.message);
    });

  } catch (e) {
    traducirError(e);
    process.exit(1);
  }
}

main();
