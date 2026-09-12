/**
 * auth.js — Acceso al panel.
 *
 * Una sola persona lo usa, así que una contraseña en una cookie firmada
 * alcanza y evita montar Supabase Auth para un único usuario.
 *
 * Lo que SÍ importa: sin esto, el panel queda público en internet con el CRM
 * adentro. Vercel despliega en un dominio adivinable y los rastreadores lo
 * encuentran solo.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHmac, timingSafeEqual } from 'node:crypto';

const NOMBRE = 'lokigi_sesion';
const DIAS = 30;

function firmar(valor) {
  const clave = process.env.PANEL_PASSWORD;
  if (!clave) throw new Error('Falta PANEL_PASSWORD');
  return createHmac('sha256', clave).update(valor).digest('hex');
}

export function crearToken() {
  const vence = Date.now() + DIAS * 86400e3;
  return `${vence}.${firmar(String(vence))}`;
}

export function tokenValido(token) {
  if (!token || !token.includes('.')) return false;
  const [vence, firma] = token.split('.');
  if (Number(vence) < Date.now()) return false;
  const esperada = firmar(vence);
  // Comparación de tiempo constante: comparar con === filtra la firma
  // carácter por carácter y filtra información por el tiempo de respuesta.
  try {
    return timingSafeEqual(Buffer.from(firma, 'hex'), Buffer.from(esperada, 'hex'));
  } catch { return false; }
}

/** Llamala al principio de toda página privada. */
export async function requerirSesion() {
  const store = await cookies();
  if (!tokenValido(store.get(NOMBRE)?.value)) redirect('/acceso');
}

export const COOKIE = NOMBRE;
export const OPCIONES_COOKIE = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax', path: '/', maxAge: DIAS * 86400,
};
