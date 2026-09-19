import { solicitudesNuevas } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { auditarSolicitud, descartarSolicitud, contactarSolicitud } from './acciones.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Gestión de solicitudes recibidas desde la landing pública.
 *
 * Muestra las solicitudes en estado 'nueva'. Permite auditarlas directo
 * o marcarlas como contactadas/descartadas. Si el correo de la solicitud
 * está en la lista de supresión (nota presente), se marca con aviso stop y
 * NO se ofrece la acción de auditar para evitar contactos no deseados.
 */
import TarjetaSolicitud from './TarjetaSolicitud.jsx';

export default async function Solicitudes() {
  await requerirSesion();
  const resSol = await solicitudesNuevas().catch(() => []);
  const solicitudes = Array.isArray(resSol) ? resSol : [];

  if (!solicitudes.length) {
    return (
      <main>
        <h1>Solicitudes</h1>
        <div className="vacio">
          <b>No hay solicitudes pendientes</b>
          Las nuevas solicitudes enviadas desde la landing aparecerán acá.
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Solicitudes</h1>
      <p className="sub">
        {solicitudes.length} solicitud{solicitudes.length > 1 ? 'es' : ''} pendiente{solicitudes.length > 1 ? 's' : ''}.
        Pedidos de auditoría ingresados desde el formulario público de la landing.
      </p>

      {solicitudes.map(s => (
        <TarjetaSolicitud key={s.id} s={s} />
      ))}
    </main>
  );
}
