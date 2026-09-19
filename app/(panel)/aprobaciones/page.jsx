import { pendientesDeAprobacion, aprobadasSinEnviar } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { deshacerAprobacion } from './acciones.js';
import TarjetaAprobacion from './TarjetaAprobacion.jsx';

export const dynamic = 'force-dynamic';

const hace = (iso) => {
  if (!iso) return 'hace momentos';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 'hace momentos';
  const h = (Date.now() - t) / 3_600_000;
  if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
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
import Link from 'next/link';

export default async function Aprobaciones({ searchParams }) {
  await requerirSesion();
  const q = await searchParams;
  const orden = q?.orden || 'reciente';
  const pagina = Math.max(1, parseInt(q?.pagina || '1', 10));
  const TAMANO_PAGINA = 10;

  const [resPend, resAprob] = await Promise.all([
    pendientesDeAprobacion().catch(() => []),
    aprobadasSinEnviar().catch(() => []),
  ]);
  const pendientesRaw = Array.isArray(resPend) ? [...resPend] : [];
  const aprobadas = Array.isArray(resAprob) ? resAprob : [];

  pendientesRaw.sort((a, b) => {
    const tA = new Date(a.creado_en || 0).getTime();
    const tB = new Date(b.creado_en || 0).getTime();
    return orden === 'viejo' ? tA - tB : tB - tA;
  });

  const totalPaginas = Math.ceil(pendientesRaw.length / TAMANO_PAGINA) || 1;
  const paginaActual = Math.min(pagina, totalPaginas);
  const inicio = (paginaActual - 1) * TAMANO_PAGINA;
  const pendientes = pendientesRaw.slice(inicio, inicio + TAMANO_PAGINA);

  const minRestantesCron = 15 - (new Date().getMinutes() % 15);

  const buildUrl = (paramsObj) => {
    const p = new URLSearchParams();
    if (orden && orden !== 'reciente') p.set('orden', orden);
    if (paramsObj.pagina > 1) p.set('pagina', String(paramsObj.pagina));
    const str = p.toString();
    return str ? `/aprobaciones?${str}` : '/aprobaciones';
  };

  return (
    <main>
      <h1>Aprobaciones</h1>
      <p className="sub">
        {pendientesRaw.length} mensaje{pendientesRaw.length !== 1 ? 's' : ''} esperando revisión
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

      <h2>Esperando revisión ({pendientesRaw.length})</h2>

      {pendientesRaw.length > 0 && (
        <form className="filtros" style={{ marginBottom: 20 }}>
          <select name="orden" defaultValue={orden} className="campo" aria-label="Ordenamiento">
            <option value="reciente">Más recientes primero</option>
            <option value="viejo">Más viejos primero</option>
          </select>
          <button type="submit" className="sec">Filtrar</button>
          {orden && orden !== 'reciente' && (
            <Link href="/aprobaciones" className="boton sec" style={{ textDecoration: 'none' }}>Limpiar</Link>
          )}
        </form>
      )}

      {pendientesRaw.length === 0 ? (
        <div className="vacio">
          <b>No hay nada esperando</b>
          Cuando el guardián marque un mensaje para revisión, aparecerá acá.
        </div>
      ) : (
        <>
          {pendientesRaw.filter(p => Date.now() - new Date(p.creado_en).getTime() > 24 * 3600e3).length > 0 && (
            <div className="aviso stop" style={{ marginBottom: 18 }}>
              <span className="lab">Atención</span>
              <p>
                Hay mensajes esperando hace más de 24 horas. Un prospecto que recibe la auditoría tarde pierde el contexto.
              </p>
            </div>
          )}

          {pendientes.map(a => (
            <TarjetaAprobacion key={a.id} a={a} haceTexto={hace(a.creado_en)} />
          ))}

          {totalPaginas > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, flexWrap: 'wrap', gap: 12 }}>
              <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                Página {paginaActual} de {totalPaginas} ({pendientesRaw.length} pendientes en total)
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {paginaActual > 1 ? (
                  <Link href={buildUrl({ pagina: paginaActual - 1 })} className="boton sec" style={{ textDecoration: 'none', padding: '6px 14px' }}>
                    ◄ Anterior
                  </Link>
                ) : (
                  <span className="boton sec" style={{ opacity: 0.4, cursor: 'not-allowed', padding: '6px 14px' }}>◄ Anterior</span>
                )}
                {paginaActual < totalPaginas ? (
                  <Link href={buildUrl({ pagina: paginaActual + 1 })} className="boton sec" style={{ textDecoration: 'none', padding: '6px 14px' }}>
                    Siguiente ►
                  </Link>
                ) : (
                  <span className="boton sec" style={{ opacity: 0.4, cursor: 'not-allowed', padding: '6px 14px' }}>Siguiente ►</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
