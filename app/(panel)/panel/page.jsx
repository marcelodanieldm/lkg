import Link from 'next/link';
import { embudo, pendientesDeAprobacion, colaDeHoy, leer, solicitudesNuevas } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import FormularioReanudar from './FormularioReanudar.jsx';

export const dynamic = 'force-dynamic';

const ETAPAS = ['nuevo','auditado','contactado','respondio','interesado','presupuestado','negociando','ganado'];

/**
 * El color de un puntaje sale de una clase, no de un literal: los tokens
 * cambian entre tema claro y oscuro y un `#c2410c` escrito a mano queda
 * ilegible sobre fondo negro.
 */
const tono = (s) => s == null ? 's-nd'
  : s >= 85 ? 's-go' : s >= 70 ? 's-bien' : s >= 50 ? 's-warn' : s >= 30 ? 's-alto' : 's-stop';

export default async function Panel() {
  await requerirSesion();

  const [{ embudo: emb, mrr }, pendientesRaw, colaRaw, configRaw, metricasRaw, solicitudesRaw] = await Promise.all([
    embudo().catch(() => ({ embudo: [], mrr: null })),
    pendientesDeAprobacion().catch(() => []),
    colaDeHoy(12).catch(() => []),
    leer('Config').catch(() => []),
    leer('Metricas').catch(() => []),
    solicitudesNuevas().catch(() => []),
  ]);

  const config = Array.isArray(configRaw) ? configRaw : [];
  const metricas = Array.isArray(metricasRaw) ? metricasRaw : [];
  const pendientes = Array.isArray(pendientesRaw) ? pendientesRaw : [];
  const cola = Array.isArray(colaRaw) ? colaRaw : [];
  const solicitudes = Array.isArray(solicitudesRaw) ? solicitudesRaw : [];
  const embList = Array.isArray(emb) ? emb : [];

  const cfg = Object.fromEntries(config.map(c => [c.clave, c.valor]));
  const porEtapa = Object.fromEntries(embList.map(e => [e.etapa, Number(e.cantidad)]));
  const total = embList.reduce((a, e) => a + Number(e.cantidad), 0);
  const hoy = new Date().toISOString().slice(0, 10);
  const m = metricas.find(x => x.fecha === hoy);
  const viejas = pendientes.filter(p => Date.now() - new Date(p.creado_en).getTime() > 24 * 3600e3);
  const pausado = cfg.pausa_general === 'TRUE';

  return (
    <main>
      <h1>Panel</h1>
      <p className="sub">
        Modo <b>{cfg.modo_autonomia}</b> · cupo diario {cfg.cupo_diario_email} correos ·
        {' '}nicho {cfg.nicho}
      </p>

      {pausado && (
        <div className="aviso stop">
          <span className="lab">Sistema pausado</span>
          <p>
            <b>No está saliendo ningún mensaje.</b>
          </p>
          <div style={{ margin: '8px 0', fontSize: 13, lineHeight: 1.5 }}>
            <div><b>Activado por:</b> {cfg.pausa_general_autor === 'supervisor' ? 'Supervisor (automático)' : 'Humano (panel)'}</div>
            <div><b>Fecha:</b> {cfg.pausa_general_fecha ? new Date(cfg.pausa_general_fecha).toLocaleString('es-AR') : '—'}</div>
            <div><b>Motivo:</b> {cfg.pausa_general_motivo || config.find(c => c.clave === 'pausa_general')?.nota || 'Sin motivo registrado'}</div>
          </div>
          <FormularioReanudar />
        </div>
      )}

      {viejas.length > 0 && !pausado && (
        <div className="aviso">
          <span className="lab">Cola frenada</span>
          <p>
            Hay <b>{viejas.length}</b> mensaje{viejas.length > 1 ? 's' : ''} esperando hace más de 24 horas.
            La cola frenada frena todo el embudo. <Link href="/aprobaciones">Revisar ahora →</Link>
          </p>
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <span>Esperando tu visto bueno</span>
          <b style={{ color: pendientes.length ? 'var(--warn)' : 'var(--ink)' }}>{pendientes.length}</b>
          {pendientes.length > 0 && <div className="pie"><Link href="/aprobaciones">Revisar</Link></div>}
        </div>
        <div className="kpi"><span>Leads en base</span><b>{total}</b></div>
        <div className="kpi"><span>A contactar hoy</span><b>{cola.length}</b></div>
        <div className="kpi">
          <span>Enviados hoy</span>
          <b>{m?.enviados_email ?? 0}</b>
          <div className="pie">de {cfg.cupo_diario_email} permitidos</div>
        </div>
        <div className="kpi">
          <span>Clientes</span><b>{mrr?.clientes_activos ?? 0}</b>
          {mrr?.mrr > 0 && <div className="pie">${Number(mrr.mrr).toLocaleString('es-AR')} de MRR</div>}
        </div>
        <div className="kpi">
          <span>Gasto del mes</span>
          <b>${Number(metricas.filter(x => String(x.fecha).startsWith(hoy.slice(0,7)))
            .reduce((a, x) => a + Number(x.costo_api_usd || 0), 0)).toFixed(2)}</b>
          <div className="pie">de USD {cfg.presupuesto_api_mes_usd}</div>
        </div>
      </div>

      <h2>Embudo</h2>
      <div className="scroller">
        <table>
          <thead><tr><th>Etapa</th><th className="n">Leads</th><th className="n">Puntaje medio</th><th>Proporción</th></tr></thead>
          <tbody>
            {ETAPAS.map(e => {
              const n = porEtapa[e] || 0;
              const prom = emb.find(x => x.etapa === e)?.score_promedio;
              return (
                <tr key={e}>
                  <td style={{ textTransform: 'capitalize' }}>{e}</td>
                  <td className="n">{n}</td>
                  <td className={`n ${tono(prom)}`}>{prom ?? '—'}</td>
                  <td>
                    <div className="barraPuntaje" style={{ maxWidth: 180 }}>
                      <i style={{ width: `${total ? (n / total) * 100 : 0}%`, background: 'var(--accent)' }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td style={{ color: 'var(--muted)' }}>perdido · baja</td>
              <td className="n" style={{ color: 'var(--muted)' }}>
                {(porEtapa.perdido || 0) + (porEtapa.baja || 0)}
              </td>
              <td className="n">—</td><td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {solicitudes.length > 0 && (
        <>
          <h2>Pidieron su auditoría</h2>
          <p className="sub" style={{ marginBottom: 12 }}>
            Llegaron por la web. Levantaron la mano solos, así que van antes que cualquier lead frío.
          </p>
          <div className="scroller">
            <table style={{ minWidth: 720 }}>
              <thead><tr>
                <th>Negocio</th><th>Ciudad</th><th>Contacto</th><th className="n">Cuándo</th>
              </tr></thead>
              <tbody>
                {solicitudes.map(s => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.negocio}</b>
                      {s.nota && (
                        <div className="sub2" style={{ color: 'var(--stop)', maxWidth: '46ch' }}>{s.nota}</div>
                      )}
                    </td>
                    <td>{s.ciudad || <span className="s-nd">—</span>}</td>
                    <td style={{ fontSize: 13 }}>{s.email}</td>
                    <td className="n s-nd">{s.cuando}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Cola de hoy</h2>
      {cola.length === 0 ? (
        <div className="vacio"><b>Nada pendiente</b>Los toques del día ya salieron o todavía no vencieron.</div>
      ) : (
        <div className="scroller">
          <table>
            <thead><tr><th>Negocio</th><th>Etapa</th><th className="n">Puntaje</th><th className="n">Percentil</th><th className="n">Toques</th></tr></thead>
            <tbody>
              {cola.map(l => (
                <tr key={l.id}>
                  <td><Link href={`/informe/${l.id}`}>{l.negocio}</Link></td>
                  <td><span className="chip n">{l.etapa}</span></td>
                  <td className={`n ${tono(l.score)}`}>{l.score ?? '—'}</td>
                  <td className="n">{l.percentil != null ? `p${l.percentil}` : '—'}</td>
                  <td className="n">{l.toques}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
