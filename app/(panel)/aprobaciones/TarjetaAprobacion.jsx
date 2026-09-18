'use client';

import { useState } from 'react';
import { decidir } from './acciones.js';

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

export default function TarjetaAprobacion({ a, haceTexto }) {
  const [paso, setPaso] = useState(null);
  const [asunto, setAsunto] = useState(a.asunto || '');
  const [cuerpo, setCuerpo] = useState(a.cuerpo || '');
  const [cargando, setCargando] = useState(false);

  return (
    <article className="aprob">
      <header>
        <h3>{a.negocio || a.destinatario}</h3>
        <span className="meta">
          {a.canal} · paso {a.paso} · {haceTexto || hace(a.creado_en)}
        </span>
      </header>
      <div className="meta" style={{ marginBottom: 6 }}>
        <b>Destinatario:</b> {a.destinatario}
      </div>

      <div className="motivo">
        <b>Por qué pide revisión:</b> {a.motivo}
        {a.advertencias && <><br /><b>Linter:</b> {a.advertencias}</>}
      </div>

      <form action={decidir} onSubmit={() => setCargando(true)}>
        <input type="hidden" name="id" value={a.id} />
        {paso && <input type="hidden" name="decision" value={paso} />}

        {a.asunto !== undefined && (
          <div className="asunto">
            <b>Asunto:</b>{' '}
            <input
              name="asunto"
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              disabled={cargando}
              style={{
                font: 'inherit',
                border: '1px solid var(--line-2)',
                borderRadius: 6,
                background: 'var(--ground)',
                color: 'var(--ink)',
                width: '75%',
                padding: '4px 8px',
              }}
            />
          </div>
        )}

        <textarea
          name="cuerpo"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          disabled={cargando}
          spellCheck="true"
        />

        {paso === 'APROBADO' && (
          <div className="aviso go" style={{ margin: '14px 0', borderLeftWidth: 4 }}>
            <span className="lab">Paso 2 de 2 · Confirmar destinatario y envío</span>
            <p style={{ margin: '8px 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
              Estás por autorizar el envío del correo a: <span style={{ color: 'var(--accent)' }}>{a.destinatario}</span>
            </p>
            <p style={{ margin: '4px 0 14px', fontSize: 14, color: 'var(--ink-2)' }}>
              <b>Asunto a enviar:</b> {asunto || 'Sin asunto'}
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className="aprobar"
                type="submit"
                disabled={cargando}
                style={{ minHeight: 44, padding: '10px 20px', fontWeight: 700 }}
              >
                {cargando ? 'Guardando...' : `✓ Sí, confirmar envío a ${a.destinatario}`}
              </button>
              <button
                type="button"
                className="sec"
                disabled={cargando}
                style={{ minHeight: 44, padding: '10px 16px' }}
                onClick={() => setPaso(null)}
              >
                Cancelar / Volver a editar
              </button>
            </div>
          </div>
        )}

        {paso === 'RECHAZADO' && (
          <div className="aviso stop" style={{ margin: '14px 0', borderLeftWidth: 4 }}>
            <span className="lab">Confirmar rechazo</span>
            <p style={{ margin: '8px 0 14px', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
              ¿Estás seguro de que querés descartar este mensaje para <span style={{ color: 'var(--accent)' }}>{a.destinatario}</span>?
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className="rechazar"
                type="submit"
                disabled={cargando}
                style={{ minHeight: 44, padding: '10px 20px', fontWeight: 700 }}
              >
                {cargando ? 'Guardando...' : 'Sí, rechazar este mensaje'}
              </button>
              <button
                type="button"
                className="sec"
                disabled={cargando}
                style={{ minHeight: 44, padding: '10px 16px' }}
                onClick={() => setPaso(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {paso === null && (
          <div className="acciones" style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
            <button
              type="button"
              className="aprobar"
              style={{ minHeight: 44, padding: '10px 20px', fontWeight: 600 }}
              onClick={() => setPaso('APROBADO')}
            >
              Aprobar y revisar envío →
            </button>

            <button
              type="button"
              className="rechazar"
              style={{ minHeight: 44, padding: '10px 18px', marginLeft: 'auto' }}
              onClick={() => setPaso('RECHAZADO')}
            >
              Rechazar
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <span className="nota">
            {cuerpo !== (a.cuerpo_original || a.cuerpo) ? 'editado' : 'sin editar'} · {cuerpo.length} caracteres
          </span>
        </div>
      </form>
    </article>
  );
}
