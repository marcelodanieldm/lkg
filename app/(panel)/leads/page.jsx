import Link from 'next/link';
import { leer, config } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { leerNotas } from '../../../lib/integrations/workspace.js';

export const dynamic = 'force-dynamic';

const ETAPAS = ['auditado', 'contactado', 'leyo', 'conversando', 'propuesta',
                'cliente', 'perdido', 'baja'];

const TONO = {
  cliente: 'go', conversando: 'go', propuesta: 'a',
  leyo: 'a', contactado: 'warn', auditado: 'n', perdido: 'n', baja: 'stop',
};

/** Clase y no literal: los tokens cambian entre claro y oscuro. */
const tono = (s) => s == null ? 's-nd'
  : s >= 85 ? 's-go' : s >= 70 ? 's-bien' : s >= 50 ? 's-warn'
  : s >= 30 ? 's-alto' : 's-stop';

const fecha = (iso) => iso
  ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
  : '—';

export default async function Leads({ searchParams }) {
  await requerirSesion();
  const q = await searchParams;
  const filtro = q?.etapa || '';
  const buscar = (q?.q || '').toLowerCase();
  const orden = q?.orden || 'reciente';
  const pagina = Math.max(1, parseInt(q?.pagina || '1', 10));
  const TAMANO_PAGINA = 25;

  const todos = await leer('Leads');

  const idPlanilla = await config('sheets_espejo_id', null);
  const notas = idPlanilla
    ? await leerNotas(idPlanilla).catch(() => ({}))
    : {};

  const filtrados = todos
    .filter(l => !filtro || l.etapa === filtro)
    .filter(l => !buscar ||
      `${l.negocio} ${l.categoria} ${l.ciudad} ${l.email || ''}`.toLowerCase().includes(buscar));

  filtrados.sort((a, b) => {
    if (orden === 'viejo') {
      return new Date(a.creado_en || 0).getTime() - new Date(b.creado_en || 0).getTime();
    }
    if (orden === 'prioridad') {
      return (b.prioridad ?? 0) - (a.prioridad ?? 0);
    }
    if (orden === 'score_desc') {
      return (b.score ?? -1) - (a.score ?? -1);
    }
    if (orden === 'score_asc') {
      return (a.score ?? 999) - (b.score ?? 999);
    }
    // Default: 'reciente' (más recientes primero)
    return new Date(b.creado_en || 0).getTime() - new Date(a.creado_en || 0).getTime();
  });

  const totalPaginas = Math.ceil(filtrados.length / TAMANO_PAGINA) || 1;
  const paginaActual = Math.min(pagina, totalPaginas);
  const inicio = (paginaActual - 1) * TAMANO_PAGINA;
  const visibles = filtrados.slice(inicio, inicio + TAMANO_PAGINA);

  const porEtapa = todos.reduce((a, l) => ({ ...a, [l.etapa]: (a[l.etapa] || 0) + 1 }), {});
  const conNota = Object.keys(notas).length;

  const buildUrl = (paramsObj) => {
    const p = new URLSearchParams();
    if (buscar) p.set('q', buscar);
    if (filtro) p.set('etapa', filtro);
    if (orden && orden !== 'reciente') p.set('orden', orden);
    if (paramsObj.pagina > 1) p.set('pagina', String(paramsObj.pagina));
    const str = p.toString();
    return str ? `/leads?${str}` : '/leads';
  };

  return (
    <main>
      <h1>Leads</h1>
      <p className="sub">
        {todos.length} en base · mostrando {visibles.length} de {filtrados.length} filtrados
        {conNota > 0 && ` · ${conNota} con nota en la planilla`}
      </p>

      <form className="filtros">
        <input name="q" defaultValue={q?.q || ''} className="campo"
               placeholder="Buscar negocio, rubro, ciudad…" aria-label="Buscar" />
        <select name="etapa" defaultValue={filtro} className="campo" aria-label="Etapa">
          <option value="">Todas las etapas</option>
          {ETAPAS.map(e => (
            <option key={e} value={e}>
              {e} ({porEtapa[e] || 0})
            </option>
          ))}
        </select>
        <select name="orden" defaultValue={orden} className="campo" aria-label="Ordenamiento">
          <option value="reciente">Más recientes primero</option>
          <option value="viejo">Más viejos primero</option>
          <option value="prioridad">Mayor prioridad comercial</option>
          <option value="score_desc">Mayor puntaje</option>
          <option value="score_asc">Menor puntaje</option>
        </select>
        <button type="submit" className="sec">Filtrar</button>
        {(filtro || buscar || (orden && orden !== 'reciente')) && (
          <Link href="/leads" className="boton sec" style={{ textDecoration: 'none' }}>Limpiar</Link>
        )}
      </form>

      {visibles.length === 0 ? (
        <div className="vacio">
          <b>Ningún lead coincide</b>
          {todos.length === 0
            ? 'Todavía no corrió la prospección. Arranca a las 8 de la mañana en días hábiles.'
            : 'Probá con otro filtro.'}
        </div>
      ) : (
        <>
          <div className="scroller">
            <table>
              <thead>
                <tr>
                  <th>Negocio</th>
                  <th>Etapa</th>
                  <th className="n">Etapa desde</th>
                  <th className="n">Puntaje</th>
                  <th className="n">Brecha</th>
                  <th className="n">Pctil</th>
                  <th className="n">Toques</th>
                  <th className="n">Próximo</th>
                  <th className="n">Visto</th>
                  <th>Contacto</th>
                  {conNota > 0 && <th>Nota</th>}
                </tr>
              </thead>
              <tbody>
                {visibles.map(l => (
                  <tr key={l.id} style={l.opt_out ? { opacity: 0.5 } : undefined}>
                    <td>
                      <Link href={`/informe/${l.id}`}>{l.negocio}</Link>
                      <div className="sub2">
                        {[l.categoria, l.ciudad].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td><span className={`chip ${TONO[l.etapa] || 'n'}`}>{l.etapa}</span></td>
                    <td className="n s-nd">{fecha(l[`${l.etapa}_en`] || l.creado_en)}</td>
                    <td className={`n ${tono(l.score)}`}>{l.score ?? '—'}</td>
                    <td className="n s-nd">
                      {l.score != null && l.potencial != null ? `+${l.potencial - l.score}` : '—'}
                    </td>
                    <td className="n">{l.percentil != null ? `p${l.percentil}` : '—'}</td>
                    <td className="n">{l.toques ?? 0}</td>
                    <td className="n s-nd">{fecha(l.proximo_toque)}</td>
                    <td className={`n ${l.informe_visto ? 's-go' : 's-nd'}`}>
                      {l.informe_visto || '—'}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {l.opt_out
                        ? <span className="chip stop">baja</span>
                        : l.email || <span className="s-nd">sin correo</span>}
                      {l.doc_propuesta_url && (
                        <> · <a href={l.doc_propuesta_url} target="_blank" rel="noreferrer">propuesta</a></>
                      )}
                    </td>
                    {conNota > 0 && (
                      <td className="s-nd" style={{ fontSize: 13, maxWidth: 240 }}>
                        {notas[l.id] || ''}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap', gap: 12 }}>
              <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                Página {paginaActual} de {totalPaginas} ({filtrados.length} leads en total)
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

      <p className="sub" style={{ marginTop: 18, fontSize: 13.5 }}>
        La columna <b>Visto</b> cuenta cuántas veces se abrió el informe. Es la señal de interés más
        fuerte que produce el sistema: alguien que abre la auditoría de su propio negocio está
        evaluando, aunque todavía no haya contestado.
      </p>
    </main>
  );
}
