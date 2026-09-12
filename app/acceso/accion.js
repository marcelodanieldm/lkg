'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { crearToken, COOKIE, OPCIONES_COOKIE } from '../../lib/auth.js';
import { timingSafeEqual } from 'node:crypto';

export async function entrar(formData) {
  const dada = String(formData.get('clave') || '');
  const real = process.env.PANEL_PASSWORD || '';

  let ok = false;
  try {
    const a = Buffer.from(dada), b = Buffer.from(real);
    ok = a.length === b.length && timingSafeEqual(a, b);
  } catch { ok = false; }

  if (!ok) redirect('/acceso?error=1');

  (await cookies()).set(COOKIE, crearToken(), OPCIONES_COOKIE);
  redirect('/panel');
}
