'use client';

/**
 * FichaCliente.jsx — Ficha expandible de un cliente activo.
 *
 * Muestra en tres pestañas:
 *   1. Evolución — sparkline de scores + historial mensual
 *   2. Informes  — lista de informes mensuales generados por el cron
 *   3. Tareas    — gestión CRUD de tareas con cambio de estado inline
 *
 * Interacción de baja: formulario con motivo obligatorio ≥ 20 chars.
 */

import { useState, useTransition } from 'react';
import {
  darDeBajaClienteAction,
  crearTareaAction,
  actualizarEstadoTareaAction,
  eliminarTareaAction,
} from './acciones.js';

const ESTADO_TAREA = {
  pendiente: { label: 'Pendiente', color: '#f59e0b' },
  en_curso:  { label: 'En curso',  color: '#3b82f6' },
  hecho:     { label: 'Hecho',     color: '#16a34a' },
  bloqueada: { label: 'Bloqueada', color: '#dc2626' },
};

const ESTADO_PAGO = {
  activo:    { label: 'Activo',    bg: '#dcfce7', color: '#166534' },
  pendiente: { label: 'Pendiente', bg: '#fef9c3', color: '#92400e' },
  pausado:   { label: 'Pausado',   bg: '#f3f4f6', color: '#6b7280' },
  cancelado: { label: 'Cancelado', bg: '#fef2f2', color: '#b91c1c' },
  vencido:   { label: 'Vencido',   bg: '#fef2f2', color: '#b91c1c' },
};

const moneda = (v, cur = 'ARS') =>
  v != null ? `${cur} ${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0 })}` : '—';

const fechaCorta = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

// ── Sparkline SVG inline ──────────────────────────────────────────────────────

function Sparkline({ datos }) {
  if (!datos || datos.length < 2) return <span style={{ color: '#94a3b8', fontSize: '12px' }}>Sin datos</span>;

  const scores = datos.map(d => d.score);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const rango = max - min || 1;
  const W = 120, H = 32, pad = 4;

  const puntos = scores.map((s, i) => {
    const x = pad + (i / (scores.length - 1)) * (W - pad * 2);
    const y = H - pad - ((s - min) / rango) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const ultimo = scores[0];
  const penultimo = scores[1];
  const sube = ultimo >= penultimo;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <svg width={W} height={H} style={{ verticalAlign: 'middle' }}>
        <polyline points={puntos} fill="none" stroke={sube ? '#16a34a' : '#dc2626'} strokeWidth="2" />
        <circle cx={puntos.split(' ').at(-1).split(',')[0]} cy={puntos.split(' ').at(-1).split(',')[1]} r="3" fill={sube ? '#16a34a' : '#dc2626'} />
      </svg>
      <strong style={{ color: sube ? '#16a34a' : '#dc2626', fontSize: '14px' }}>{ultimo}</strong>
      <span style={{ fontSize: '11px', color: '#94a3b8' }}>{sube ? '▲' : '▼'}</span>
    </span>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function FichaCliente({ leadId, negocio, cliente, historial, informes, tareas: tareasIni }) {
  const [abierta, setAbierta] = useState(false);
  const [pestana, setPestana] = useState('evolucion');
  const [tareas, setTareas] = useState(tareasIni || []);
  const [showBaja, setShowBaja] = useState(false);
  const [showNuevaTarea, setShowNuevaTarea] = useState(false);
  const [motivoBaja, setMotivoBaja] = useState('');
  const [nuevaTarea, setNuevaTarea] = useState({ titulo: '', servicio: '', venceEn: '', horasEst: '' });
  const [msg, setMsg] = useState(null);
  const [isPending, startTransition] = useTransition();

  const estadoPago = ESTADO_PAGO[cliente?.estado_pago] || ESTADO_PAGO.pendiente;

  // ── Baja ──────────────────────────────────────────────────────────────
  function handleBaja(e) {
    e.preventDefault();
    if (motivoBaja.trim().length < 20) {
      setMsg({ ok: false, txt: 'El motivo debe tener al menos 20 caracteres.' });
      return;
    }
    const fd = new FormData();
    fd.set('clienteId', cliente?.id || '');
    fd.set('leadId', leadId);
    fd.set('motivo', motivoBaja.trim());
    startTransition(async () => {
      const r = await darDeBajaClienteAction(fd);
      if (r.ok) {
        setMsg({ ok: true, txt: 'Baja registrada. Cancelá la suscripción en la pasarela si corresponde.' });
        setShowBaja(false);
      } else {
        setMsg({ ok: false, txt: r.error });
      }
    });
  }

  // ── Nueva tarea ───────────────────────────────────────────────────────
  function handleNuevaTarea(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('leadId', leadId);
    fd.set('titulo', nuevaTarea.titulo);
    fd.set('servicio', nuevaTarea.servicio);
    fd.set('venceEn', nuevaTarea.venceEn);
    fd.set('horasEst', nuevaTarea.horasEst);
    startTransition(async () => {
      const r = await crearTareaAction(fd);
      if (r.ok) {
        setShowNuevaTarea(false);
        setNuevaTarea({ titulo: '', servicio: '', venceEn: '', horasEst: '' });
        setMsg({ ok: true, txt: 'Tarea creada.' });
        // optimistic update
        setTareas(prev => [{ titulo: nuevaTarea.titulo, servicio: nuevaTarea.servicio, estado: 'pendiente', creado_en: new Date().toISOString() }, ...prev]);
      } else {
        setMsg({ ok: false, txt: r.error });
      }
    });
  }

  // ── Cambiar estado tarea ──────────────────────────────────────────────
  function handleEstadoTarea(tareaId, nuevoEstado) {
    const fd = new FormData();
    fd.set('id', tareaId);
    fd.set('estado', nuevoEstado);
    startTransition(async () => {
      await actualizarEstadoTareaAction(fd);
      setTareas(prev => prev.map(t => t.id === tareaId ? { ...t, estado: nuevoEstado } : t));
    });
  }

  // ── Eliminar tarea ────────────────────────────────────────────────────
  function handleEliminarTarea(tareaId) {
    if (!confirm('¿Eliminar esta tarea?')) return;
    const fd = new FormData();
    fd.set('id', tareaId);
    startTransition(async () => {
      await eliminarTareaAction(fd);
      setTareas(prev => prev.filter(t => t.id !== tareaId));
    });
  }

  const s = {
    fila: { borderBottom: '1px solid #e2e8f0', padding: '12px 16px' },
    pestBtn: (activa) => ({
      padding: '6px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer',
      fontWeight: activa ? '700' : '400', fontSize: '13px',
      background: activa ? '#1e40af' : '#f1f5f9', color: activa ? '#fff' : '#475569',
    }),
    input: { padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', width: '100%', boxSizing: 'border-box' },
    btn: (color = '#1e40af') => ({
      padding: '7px 14px', background: color, color: '#fff', border: 'none',
      borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
    }),
  };

  return (
    <div style={{ borderTop: abierta ? '2px solid #3b82f6' : undefined }}>
      {/* Cabecera clicable */}
      <div
        onClick={() => setAbierta(v => !v)}
        style={{ ...s.fila, display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', background: abierta ? '#eff6ff' : '#fff' }}
      >
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{abierta ? '▲' : '▼'}</span>
        <span style={{ fontWeight: '600', flex: 1 }}>{negocio}</span>
        <span style={{ fontSize: '12px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '999px' }}>
          {cliente?.plan || '—'}
        </span>
        <span style={{ fontSize: '12px', background: estadoPago.bg, color: estadoPago.color, padding: '2px 8px', borderRadius: '999px' }}>
          {estadoPago.label}
        </span>
        <span style={{ fontSize: '13px', color: '#334155', minWidth: '80px', textAlign: 'right' }}>
          {moneda(cliente?.mensual, cliente?.moneda)}
        </span>
        <span style={{ fontSize: '12px', color: '#94a3b8', minWidth: '90px', textAlign: 'right' }}>
          Próx. cobro: {fechaCorta(cliente?.proximo_cobro)}
        </span>
        <Sparkline datos={historial} />
      </div>

      {/* Contenido de la ficha */}
      {abierta && (
        <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>

          {msg && (
            <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', background: msg.ok ? '#dcfce7' : '#fef2f2', color: msg.ok ? '#166534' : '#b91c1c' }}>
              {msg.txt}
            </div>
          )}

          {/* Pestañas */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
            {[['evolucion', '📈 Evolución'], ['informes', '📄 Informes'], ['tareas', '✅ Tareas']].map(([id, label]) => (
              <button key={id} onClick={() => setPestana(id)} style={s.pestBtn(pestana === id)}>{label}</button>
            ))}
          </div>

          {/* ── Pestaña: Evolución ──────────────────────────────────────── */}
          {pestana === 'evolucion' && (
            <div>
              {historial.length === 0
                ? <p style={{ color: '#94a3b8', fontSize: '13px' }}>Sin mediciones aún. El cron del día 26 genera la primera.</p>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        {['Fecha', 'Score', 'Posición', 'Competidores', 'Diagnóstico'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '600', color: '#475569' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map((h, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '6px 10px' }}>{fechaCorta(h.creado_en)}</td>
                          <td style={{ padding: '6px 10px', fontWeight: '700' }}>{h.score}</td>
                          <td style={{ padding: '6px 10px' }}>{h.posicion ?? '—'}</td>
                          <td style={{ padding: '6px 10px' }}>{h.total_competidores ?? '—'}</td>
                          <td style={{ padding: '6px 10px', color: '#64748b' }}>{h.diagnostico_caida ?? 'sin_cambio'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          )}

          {/* ── Pestaña: Informes ───────────────────────────────────────── */}
          {pestana === 'informes' && (
            <div>
              {informes.length === 0
                ? <p style={{ color: '#94a3b8', fontSize: '13px' }}>Sin informes mensuales aún.</p>
                : informes.map((inf, i) => (
                  <div key={i} style={{ marginBottom: '10px', padding: '10px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: '600', fontSize: '13px' }}>{inf.asunto || 'Informe mensual'}</span>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{fechaCorta(inf.creado_en)}</span>
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{
                        fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
                        background: inf.decision === 'APROBADO' ? '#dcfce7' : inf.decision === 'PENDIENTE' ? '#fef9c3' : '#f3f4f6',
                        color: inf.decision === 'APROBADO' ? '#166534' : inf.decision === 'PENDIENTE' ? '#92400e' : '#6b7280',
                      }}>
                        {inf.decision}
                      </span>
                      {inf.enviado_en && <span style={{ fontSize: '12px', color: '#94a3b8' }}>Enviado: {fechaCorta(inf.enviado_en)}</span>}
                    </div>
                  </div>
                ))
              }
            </div>
          )}

          {/* ── Pestaña: Tareas ─────────────────────────────────────────── */}
          {pestana === 'tareas' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', color: '#475569' }}>{tareas.length} tarea(s)</span>
                <button onClick={() => setShowNuevaTarea(v => !v)} style={s.btn()}>+ Nueva tarea</button>
              </div>

              {showNuevaTarea && (
                <form onSubmit={handleNuevaTarea} style={{ marginBottom: '14px', padding: '12px', background: '#fff', border: '1px solid #bfdbfe', borderRadius: '8px', display: 'grid', gap: '8px' }}>
                  <input required placeholder="Título de la tarea *" value={nuevaTarea.titulo} onChange={e => setNuevaTarea(p => ({ ...p, titulo: e.target.value }))} style={s.input} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    <input placeholder="Servicio" value={nuevaTarea.servicio} onChange={e => setNuevaTarea(p => ({ ...p, servicio: e.target.value }))} style={s.input} />
                    <input type="date" value={nuevaTarea.venceEn} onChange={e => setNuevaTarea(p => ({ ...p, venceEn: e.target.value }))} style={s.input} />
                    <input type="number" placeholder="Horas est." min="0" step="0.5" value={nuevaTarea.horasEst} onChange={e => setNuevaTarea(p => ({ ...p, horasEst: e.target.value }))} style={s.input} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" disabled={isPending} style={s.btn('#16a34a')}>Crear</button>
                    <button type="button" onClick={() => setShowNuevaTarea(false)} style={s.btn('#64748b')}>Cancelar</button>
                  </div>
                </form>
              )}

              {tareas.length === 0
                ? <p style={{ color: '#94a3b8', fontSize: '13px' }}>Sin tareas aún.</p>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        {['Título', 'Servicio', 'Vence', 'Horas', 'Estado', ''].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '600', color: '#475569' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tareas.map((t, i) => {
                        const est = ESTADO_TAREA[t.estado] || ESTADO_TAREA.pendiente;
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', opacity: t.estado === 'hecho' ? 0.6 : 1 }}>
                            <td style={{ padding: '6px 10px' }}>{t.titulo}</td>
                            <td style={{ padding: '6px 10px', color: '#64748b' }}>{t.servicio || '—'}</td>
                            <td style={{ padding: '6px 10px' }}>{t.vence_en ? new Date(t.vence_en).toLocaleDateString('es-AR') : '—'}</td>
                            <td style={{ padding: '6px 10px' }}>{t.horas_est ?? '—'}</td>
                            <td style={{ padding: '6px 10px' }}>
                              <select
                                value={t.estado}
                                disabled={isPending}
                                onChange={e => t.id && handleEstadoTarea(t.id, e.target.value)}
                                style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px', color: est.color, fontWeight: '600' }}
                              >
                                {Object.entries(ESTADO_TAREA).map(([k, v]) => (
                                  <option key={k} value={k}>{v.label}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: '6px 10px' }}>
                              {t.estado === 'pendiente' && t.id && (
                                <button onClick={() => handleEliminarTarea(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '13px' }}>✕</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
            </div>
          )}

          {/* ── Baja ────────────────────────────────────────────────────── */}
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
            {!showBaja
              ? <button onClick={() => setShowBaja(true)} style={{ ...s.btn('#dc2626'), fontSize: '12px', padding: '5px 12px' }}>Dar de baja</button>
              : (
                <form onSubmit={handleBaja} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <textarea
                    placeholder="Motivo de baja (mínimo 20 caracteres) *"
                    value={motivoBaja}
                    onChange={e => setMotivoBaja(e.target.value)}
                    rows={2}
                    style={{ ...s.input, width: '340px', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button type="submit" disabled={isPending || motivoBaja.trim().length < 20} style={s.btn('#dc2626')}>Confirmar baja</button>
                    <button type="button" onClick={() => setShowBaja(false)} style={s.btn('#64748b')}>Cancelar</button>
                  </div>
                </form>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
