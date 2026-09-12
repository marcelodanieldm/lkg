'use server';

import { redirect } from 'next/navigation';
import { darDeBaja, agregar } from '../../lib/db/supabase.js';

/**
 * Ejecuta la baja. Sin sesión, a propósito: el que la pide es el prospecto.
 *
 * El trabajo real lo hace `darse_de_baja` en Postgres, que es una función
 * `security definer` y solo puede ir en una dirección: marca `opt_out` y mete
 * el correo y el teléfono en la lista de supresión. Un disparador de la base
 * impide que `opt_out` vuelva a false, así que ni un error de programación ni
 * un `update` a mano pueden deshacerlo.
 *
 * Si algo falla, igual se redirige a la pantalla de confirmación. Es
 * deliberado: mostrarle un error a alguien que está pidiendo que no le
 * escribas más es la peor respuesta posible. El error queda en la bitácora
 * para que lo veas vos, que sí podés arreglarlo.
 */
export async function confirmarBaja(formData) {
  const lead = formData.get('lead');
  if (!lead) redirect('/baja');

  try {
    await darDeBaja(lead, 'email');
  } catch (e) {
    await agregar('Bitacora', {
      agente: 'sistema', accion: 'baja', lead_id: lead, decision: 'error',
      razon: `FALLÓ una baja pedida por el prospecto: ${String(e.message).slice(0, 300)}. Resolvela a mano YA.`,
    }).catch(() => {});
  }

  redirect(`/baja?lead=${encodeURIComponent(lead)}&hecho=1`);
}
