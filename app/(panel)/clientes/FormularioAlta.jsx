'use client';

/**
 * FormularioAlta.jsx — Formulario inline para convertir un lead ganado en cliente.
 *
 * Moneda determina la pasarela automáticamente:
 *   ARS → MercadoPago  |  USD → dLocal
 *
 * Al confirmar, la server action crea la suscripción en la pasarela y
 * pre-carga en Aprobaciones el mail con el link de pago.
 * La URL de aprobación también se muestra aquí para que el operador
 * pueda copiarla y enviarla manualmente si lo prefiere.
 */

import { useState, useTransition } from 'react';
import { altaClienteAction } from './acciones.js';

const PLANES = [
  { id: 'esencial',    label: 'Esencial' },
  { id: 'crecimiento', label: 'Crecimiento' },
  { id: 'dominio',     label: 'Dominio' },
  { id: 'setup_unico', label: 'Setup único' },
];

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#fff', borderRadius: '12px', padding: '28px', width: '480px',
    maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  titulo: { fontSize: '18px', fontWeight: '700', color: '#1e3a5f', marginBottom: '20px' },
  campo: { marginBottom: '14px' },
  label: { display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' },
  input: { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px', width: '100%', boxSizing: 'border-box' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  pasarela: (activa) => ({
    padding: '6px 12px', border: `2px solid ${activa ? '#2563eb' : '#e2e8f0'}`,
    borderRadius: '6px', background: activa ? '#eff6ff' : '#f8fafc',
    color: activa ? '#1d4ed8' : '#64748b', fontWeight: activa ? '700' : '400',
    fontSize: '13px', cursor: 'default',
  }),
  btn: (color = '#2563eb', disabled = false) => ({
    padding: '10px 20px', background: disabled ? '#94a3b8' : color, color: '#fff',
    border: 'none', borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: '700', fontSize: '14px',
  }),
};

export default function FormularioAlta({ lead, onCerrar, onExito }) {
  const [plan, setPlan] = useState('esencial');
  const [moneda, setMoneda] = useState('ARS');
  const [setup, setSetup] = useState('');
  const [mensual, setMensual] = useState('');
  const [diaCobro, setDiaCobro] = useState('1');
  const [gbpAcceso, setGbpAcceso] = useState(false);
  const [resultado, setResultado] = useState(null); // { ok, urlAprobacion, error }
  const [isPending, startTransition] = useTransition();

  const pasarela = moneda === 'ARS' ? 'MercadoPago' : 'dLocal';

  function handleSubmit(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('leadId', lead.id);
    fd.set('negocio', lead.negocio);
    fd.set('email', lead.email || '');
    fd.set('plan', plan);
    fd.set('moneda', moneda);
    fd.set('setup', setup);
    fd.set('mensual', mensual);
    fd.set('diaCobro', diaCobro);
    if (gbpAcceso) fd.set('gbpAcceso', 'on');
    fd.set('scoreInicial', String(lead.score || 0));

    startTransition(async () => {
      const r = await altaClienteAction(fd);
      setResultado(r);
      if (r.ok) onExito?.(r);
    });
  }

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div style={s.modal}>
        <h2 style={s.titulo}>Alta de cliente — {lead.negocio}</h2>

        {resultado?.ok ? (
          // ── Estado: éxito ──────────────────────────────────────────────
          <div>
            <div style={{ padding: '12px', background: '#dcfce7', borderRadius: '8px', marginBottom: '16px', color: '#166534', fontSize: '14px' }}>
              ✅ Cliente creado. El mail con el link de pago quedó en{' '}
              <strong>/aprobaciones</strong> listo para aprobar.
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                URL de aprobación ({resultado.pasarela}) — también podés copiarla y enviarla manualmente:
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  readOnly
                  value={resultado.urlAprobacion || ''}
                  style={{ ...s.input, fontSize: '12px', color: '#2563eb' }}
                  onClick={e => e.target.select()}
                />
                <button
                  onClick={() => navigator.clipboard.writeText(resultado.urlAprobacion)}
                  style={{ ...s.btn('#64748b'), padding: '8px 12px', flexShrink: 0, fontSize: '12px' }}
                >
                  Copiar
                </button>
              </div>
            </div>

            <button onClick={onCerrar} style={s.btn()}>Cerrar</button>
          </div>
        ) : (
          // ── Formulario ─────────────────────────────────────────────────
          <form onSubmit={handleSubmit}>
            {resultado?.error && (
              <div style={{ padding: '10px 14px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', marginBottom: '14px', fontSize: '13px' }}>
                ❌ {resultado.error}
              </div>
            )}

            <div style={s.campo}>
              <label style={s.label}>Plan *</label>
              <select value={plan} onChange={e => setPlan(e.target.value)} style={s.input} required>
                {PLANES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>

            <div style={{ ...s.campo, ...s.row }}>
              <div>
                <label style={s.label}>Moneda *</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {['ARS', 'USD'].map(m => (
                    <button key={m} type="button" onClick={() => setMoneda(m)}
                      style={{ ...s.btn(m === moneda ? '#2563eb' : '#e2e8f0'), color: m === moneda ? '#fff' : '#475569', padding: '6px 16px', fontWeight: '600' }}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={s.label}>Pasarela (automática)</label>
                <div style={s.pasarela(true)}>{pasarela}</div>
              </div>
            </div>

            <div style={{ ...s.campo, ...s.row }}>
              <div>
                <label style={s.label}>Setup ({moneda})</label>
                <input type="number" min="0" step="0.01" value={setup} onChange={e => setSetup(e.target.value)} placeholder="0" style={s.input} />
              </div>
              <div>
                <label style={s.label}>Mensual ({moneda}) *</label>
                <input type="number" min="0" step="0.01" value={mensual} onChange={e => setMensual(e.target.value)} placeholder="0" required style={s.input} />
              </div>
            </div>

            <div style={{ ...s.campo, ...s.row }}>
              <div>
                <label style={s.label}>Día de cobro (1–28)</label>
                <input type="number" min="1" max="28" value={diaCobro} onChange={e => setDiaCobro(e.target.value)} style={s.input} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
                <input type="checkbox" id="gbp" checked={gbpAcceso} onChange={e => setGbpAcceso(e.target.checked)} style={{ width: '16px', height: '16px' }} />
                <label htmlFor="gbp" style={{ fontSize: '13px', color: '#475569', cursor: 'pointer' }}>Tiene acceso GBP</label>
              </div>
            </div>

            {!lead.email && (
              <div style={{ padding: '8px 12px', background: '#fef9c3', borderRadius: '6px', color: '#92400e', fontSize: '12px', marginBottom: '14px' }}>
                ⚠ Este lead no tiene email. La suscripción se crea pero no se podrá enviar el link automáticamente.
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button type="submit" disabled={isPending} style={s.btn('#16a34a', isPending)}>
                {isPending ? 'Creando suscripción...' : '✓ Crear cliente y suscripción'}
              </button>
              <button type="button" onClick={onCerrar} style={s.btn('#64748b')}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
