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

import Link from 'next/link';

export default async function Solicitudes({ searchParams }) {
  await requerirSesion();
  const q = await searchParams;
  const orden = q?.orden || 'reciente';
  const pagina = Math.max(1, parseInt(q?.pagina || '1', 10));
  const TAMANO_PAGINA = 10;

  const resSol = await solicitudesNuevas().catch(() => []);
  const todas = Array.isArray(resSol) ? [...resSol] : [];

  todas.sort((a, b) => {
    const tA = new Date(a.creado_en || 0).getTime();
    const tB = new Date(b.creado_en || 0).getTime();
    return orden === 'viejo' ? tA - tB : tB - tA;
  });

  const totalPaginas = Math.ceil(todas.length / TAMANO_PAGINA) || 1;
  const paginaActual = Math.min(pagina, totalPaginas);
  const inicio = (paginaActual - 1) * TAMANO_PAGINA;
  const visibles = todas.slice(inicio, inicio + TAMANO_PAGINA);

  const buildUrl = (paramsObj) => {
    const p = new URLSearchParams();
    if (orden && orden !== 'reciente') p.set('orden', orden);
    if (paramsObj.pagina > 1) p.set('pagina', String(paramsObj.pagina));
    const str = p.toString();
    return str ? `/solicitudes?${str}` : '/solicitudes';
  };

  if (!todas.length) {
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
        {todas.length} solicitud{todas.length > 1 ? 'es' : ''} pendiente{todas.length > 1 ? 's' : ''} · mostrando {visibles.length}.
        Pedidos de auditoría ingresados desde el formulario público de la landing.
      </p>

      <form className="filtros" style={{ marginBottom: 20 }}>
        <select name="orden" defaultValue={orden} className="campo" aria-label="Ordenamiento">
          <option value="reciente">Más recientes primero</option>
          <option value="viejo">Más viejas primero</option>
        </select>
        <button type="submit" className="sec">Filtrar</button>
        {orden && orden !== 'reciente' && (
          <Link href="/solicitudes" className="boton sec" style={{ textDecoration: 'none' }}>Limpiar</Link>
        )}
      </form>

      {visibles.map(s => (
        <TarjetaSolicitud key={s.id} s={s} />
      ))}

      {totalPaginas > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>
            Página {paginaActual} de {totalPaginas} ({todas.length} solicitudes en total)
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
    </main>
  );
}
