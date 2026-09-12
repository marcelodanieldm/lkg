import { pendientesDeAprobacion } from '../../../lib/db/supabase.js';
import { requerirSesion } from '../../../lib/auth.js';
import { decidir } from './acciones.js';

export const dynamic = 'force-dynamic';

const hace = (iso) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `hace ${Math.round(h * 60)} min`;
  if (h < 24) return `hace ${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
};

/**
 * La pantalla que reemplaza a la pestaña de Google Sheets.
 *
 * Gana dos cosas sobre la planilla: el cuerpo se edita en un campo grande y
 * cómodo, y la decisión se toma con un botón en vez de un desplegable. La
 * diferencia que importa es la misma que antes: si editás el texto y aprobás,
 * se envía TU versión, y la original queda guardada para poder comparar
 * después qué corregís siempre — que es la señal para ajustar el prompt del
 * agente Redactor.
 */
export default async function Aprobaciones() {
  await requerirSesion();
  const pendientes = await pendientesDeAprobacion();

  if (!pendientes.length) {
    return (
      <main>
        <h1>Aprobaciones</h1>
        <div className="vacio">
          <b>No hay nada esperando</b>
          Cuando el guardián marque un mensaje para revisión, aparece acá.
        </div>
      </main>
    );
  }

  const viejas = pendientes.filter(p => Date.now() - new Date(p.creado_en).getTime() > 24 * 3600e3);

  return (
    <main>
      <h1>Aprobaciones</h1>
      <p className="sub">
        {pendientes.length} mensaje{pendientes.length > 1 ? 's' : ''} esperando.
        Si editás el cuerpo antes de aprobar, se envía tu versión — y la original queda
        guardada para poder ver qué corregís siempre.
      </p>

      {viejas.length > 0 && (
        <div className="aviso stop">
          <span className="lab">Atención</span>
          <p>
            <b>{viejas.length}</b> lleva{viejas.length > 1 ? 'n' : ''} más de 24 horas acá.
            Un prospecto que recibe la auditoría tres días tarde ya no la asocia con nada.
          </p>
        </div>
      )}

      {pendientes.map(a => (
        <article className="aprob" key={a.id}>
          <header>
            <h3>{a.negocio || a.destinatario}</h3>
            <span className="meta">
              {a.canal} · paso {a.paso} · {hace(a.creado_en)}
            </span>
          </header>
          <div className="meta" style={{ marginBottom: 4 }}>{a.destinatario}</div>

          <div className="motivo">
            <b>Por qué pide revisión:</b> {a.motivo}
            {a.advertencias && <><br /><b>Linter:</b> {a.advertencias}</>}
          </div>

          <form action={decidir}>
            <input type="hidden" name="id" value={a.id} />

            {a.asunto && (
              <div className="asunto">
                <b>Asunto:</b>{' '}
                <input
                  name="asunto"
                  defaultValue={a.asunto}
                  style={{
                    font: 'inherit', border: 0, background: 'transparent',
                    color: 'var(--ink)', width: '70%', padding: 0,
                  }}
                />
              </div>
            )}

            <textarea name="cuerpo" defaultValue={a.cuerpo} spellCheck="true" />

            <div className="acciones">
              <button className="aprobar" name="decision" value="APROBADO" type="submit">
                Aprobar y enviar
              </button>
              <button className="rechazar" name="decision" value="RECHAZADO" type="submit">
                Rechazar
              </button>
              <span className="nota">
                {a.cuerpo_original ? 'editado' : 'sin editar'} · {a.cuerpo.length} caracteres
              </span>
            </div>
          </form>
        </article>
      ))}
    </main>
  );
}
