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
        <article className="aprob" key={s.id}>
          <header>
            <h3>{s.negocio}</h3>
            <span className="meta">
              {s.ciudad || 'Sin ciudad'} · {s.cuando}
            </span>
          </header>

          <div className="meta" style={{ marginBottom: 4 }}>
            <b>Contacto:</b> {s.email}{s.telefono ? ` · Tel: ${s.telefono}` : ''}
          </div>

          {s.mensaje && (
            <div className="motivo">
              <b>Mensaje:</b> {s.mensaje}
            </div>
          )}

          {s.nota && (
            <div className="aviso stop" style={{ marginTop: 12 }}>
              <span className="lab">Atención</span>
              <p>
                <b>Dirección en lista de supresión:</b> {s.nota}
              </p>
            </div>
          )}

          <div className="acciones">
            {!s.nota && (
              <form action={auditarSolicitud} style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginBottom: 12 }}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="negocio" value={s.negocio} />
                <input type="hidden" name="ciudad" value={s.ciudad || ''} />
                <input type="hidden" name="email" value={s.email || ''} />

                <div style={{ background: 'var(--sub-bg, rgba(255,255,255,0.03))', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--borde, #e5e7eb)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5, fontWeight: 500 }}>
                    <input type="checkbox" name="enviarEmail" defaultChecked style={{ width: 16, height: 16 }} />
                    Enviar informe por email a <b>{s.email}</b> al terminar de auditar
                  </label>

                  <textarea
                    name="mensajePersonalizado"
                    placeholder="Mensaje personalizado opcional (ej: Hola! Analicé tu perfil y te adjunto la auditoría completa con recomendaciones)..."
                    rows={2}
                    className="campo"
                    style={{ marginTop: 8, width: '100%', fontSize: 13, resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="aprobar" type="submit">
                    Auditar y procesar
                  </button>
                </div>
              </form>
            )}

            <form action={descartarSolicitud}>
              <input type="hidden" name="id" value={s.id} />
              <button className="rechazar" type="submit">
                Descartar
              </button>
            </form>

            <form action={contactarSolicitud}>
              <input type="hidden" name="id" value={s.id} />
              <button className="sec" type="submit">
                Ya la contacté
              </button>
            </form>
          </div>
        </article>
      ))}
    </main>
  );
}
