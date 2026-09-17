import { pendientesDeAprobacion, aprobadasSinEnviar } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { deshacerAprobacion } from './acciones.js';
import TarjetaAprobacion from './TarjetaAprobacion.jsx';

export const dynamic = 'force-dynamic';

const hace = (iso) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `hace ${Math.round(h * 60)} min`;
  if (h < 24) return `hace ${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
};

/**
 * La pantalla de gestión de aprobaciones.
 *
 * Los mensajes aprobados no salen inmediatamente: se encolan para la tarea
 * /api/cron/aprobaciones que ejecuta cada 15 minutos vía pg_cron. Mientras el
 * campo `enviado_en` permanezca en nulo, la aprobación se puede revertir con el
 * botón "Deshacer".
 */
export default async function Aprobaciones() {
  await requerirSesion();
  const [pendientes, aprobadas] = await Promise.all([
    pendientesDeAprobacion(),
    aprobadasSinEnviar(),
  ]);

  const minRestantesCron = 15 - (new Date().getMinutes() % 15);

  return (
    <main>
      <h1>Aprobaciones</h1>
      <p className="sub">
        {pendientes.length} mensaje{pendientes.length !== 1 ? 's' : ''} esperando revisión
        {aprobadas.length > 0 ? ` · ${aprobadas.length} aprobado(s) pendiente(s) de salida` : ''}.
      </p>

      {/* Cron schedule aviso */}
      <div className="aviso" style={{ marginBottom: 20 }}>
        <span className="lab">Programación de envíos</span>
        <p>
          Las aprobaciones se encolan y se procesan cada 15 minutos (a los minutos :00, :15, :30 y :45 de cada hora).
          {' '}<b>Próxima salida automática en aproximadamente {minRestantesCron} min.</b>
        </p>
      </div>

      {/* Sección de Aprobadas sin enviar (con opción de Deshacer) */}
      {aprobadas.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2>Aprobadas pendientes de salida ({aprobadas.length})</h2>
          <p className="sub" style={{ marginBottom: 12 }}>
            Mensajes autorizados que saldrán en la próxima corrida del cron. Podés revertir la aprobación mientras no hayan salido.
          </p>
          <div className="scroller">
            <table style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>Negocio / Destinatario</th>
                  <th>Asunto</th>
                  <th className="n">Paso</th>
                  <th className="n">Aprobado hace</th>
                  <th className="n">Acción</th>
                </tr>
              </thead>
              <tbody>
                {aprobadas.map(a => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.negocio || a.destinatario}</b>
                      <div className="sub2">{a.destinatario}</div>
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 280 }}>{a.asunto || '—'}</td>
                    <td className="n">{a.paso}</td>
                    <td className="n s-nd">{hace(a.decidido_en || a.creado_en)}</td>
                    <td className="n">
                      <form action={deshacerAprobacion}>
                        <input type="hidden" name="id" value={a.id} />
                        <button type="submit" className="sec" style={{ minHeight: 44, padding: '6px 14px' }}>
                          Deshacer aprobación
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <h2>Esperando revisión ({pendientes.length})</h2>

      {pendientes.length === 0 ? (
        <div className="vacio">
          <b>No hay nada esperando</b>
          Cuando el guardián marque un mensaje para revisión, aparecerá acá.
        </div>
      ) : (
        <>
          {pendientes.filter(p => Date.now() - new Date(p.creado_en).getTime() > 24 * 3600e3).length > 0 && (
            <div className="aviso stop" style={{ marginBottom: 18 }}>
              <span className="lab">Atención</span>
              <p>
                Hay mensajes esperando hace más de 24 horas. Un prospecto que recibe la auditoría tarde pierde el contexto.
              </p>
            </div>
          )}

          {pendientes.map(a => (
            <TarjetaAprobacion key={a.id} a={a} hace={hace} />
          ))}
        </>
      )}
    </main>
  );
}
