'use client';

/**
 * app/(panel)/clientes/page.jsx — Gestión de suscripciones y clientes activos.
 *
 * Tres zonas:
 *   A. Resumen MRR (tarjeta fija)
 *   B. Leads ganados pendientes de convertir en clientes
 *   C. Clientes activos con ficha expandible (evolución, informes, tareas)
 *
 * Es 'use client' porque necesita manejar el estado del modal de alta,
 * que es un componente client (FormularioAlta). Los datos se cargan
 * al montar el componente via Server Actions.
 */

import { useState, useEffect, useTransition } from 'react';
import FichaCliente from './FichaCliente.jsx';
import FormularioAlta from './FormularioAlta.jsx';

// ── Data fetching vía Server Actions inline ───────────────────────────────────
// La página es client porque tiene modal; los datos se cargan por Server Actions.

import {
  obtenerLeadsGanadosAction,
  obtenerClientesConFichaAction,
  obtenerMRRAction,
} from './acciones.js';

export const dynamic = 'force-dynamic';

// ── Helpers de formato ────────────────────────────────────────────────────────

const ARS = (v) => v != null
  ? `ARS ${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0 })}`
  : '—';
const USD = (v) => v != null
  ? `USD ${Number(v).toFixed(2)}`
  : '—';
const fechaCorta = (iso) => iso
  ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
  : '—';

const ESTADO_PAGO_COLORES = {
  activo:    { bg: '#dcfce7', fg: '#166534' },
  pendiente: { bg: '#fef9c3', fg: '#92400e' },
  pausado:   { bg: '#f3f4f6', fg: '#6b7280' },
  cancelado: { bg: '#fef2f2', fg: '#b91c1c' },
  vencido:   { bg: '#fef2f2', fg: '#b91c1c' },
};

// ── Estilos ───────────────────────────────────────────────────────────────────

const S = {
  page: { maxWidth: '1100px', margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' },
  titulo: { fontSize: '22px', fontWeight: '800', color: '#1e3a5f', marginBottom: '6px' },
  bajada: { color: '#64748b', fontSize: '14px', marginBottom: '28px' },

  mrr: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px',
  },
  mrrCard: {
    padding: '20px', background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  mrrLabel: { fontSize: '12px', color: '#64748b', fontWeight: '600', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  mrrValor: { fontSize: '26px', fontWeight: '800', color: '#1e3a5f' },

  seccion: { marginBottom: '36px' },
  seccionTitulo: { fontSize: '16px', fontWeight: '700', color: '#334155', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' },

  tabla: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  th: { padding: '10px 14px', textAlign: 'left', fontSize: '12px', fontWeight: '700', color: '#475569', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
  td: { padding: '10px 14px', fontSize: '13px', color: '#334155', borderBottom: '1px solid #f1f5f9' },

  chip: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', background: bg, color: fg }),
  btn: (color = '#2563eb') => ({
    padding: '6px 14px', background: color, color: '#fff',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
  }),
  vacio: { padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '14px', background: '#fff', borderRadius: '10px', border: '1px dashed #e2e8f0' },
};

// ── Componente ────────────────────────────────────────────────────────────────

export default function ClientesPage() {
  const [mrr, setMrr] = useState(null);
  const [ganados, setGanados] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [leadAlta, setLeadAlta] = useState(null); // lead sobre el que se abre el modal de alta
  const [cargando, setCargando] = useState(true);
  const [, startTransition] = useTransition();

  // Cargar datos al montar
  useEffect(() => {
    Promise.all([
      obtenerMRRAction(),
      obtenerLeadsGanadosAction(),
      obtenerClientesConFichaAction(),
    ]).then(([mrrData, ganadosData, clientesData]) => {
      setMrr(mrrData);
      setGanados(ganadosData);
      setClientes(clientesData);
    }).catch(console.error).finally(() => setCargando(false));
  }, []);

  function recargar() {
    setCargando(true);
    Promise.all([
      obtenerMRRAction(),
      obtenerLeadsGanadosAction(),
      obtenerClientesConFichaAction(),
    ]).then(([mrrData, ganadosData, clientesData]) => {
      setMrr(mrrData);
      setGanados(ganadosData);
      setClientes(clientesData);
    }).finally(() => setCargando(false));
  }

  if (cargando) {
    return <div style={{ ...S.page, color: '#94a3b8' }}>Cargando clientes…</div>;
  }

  return (
    <div style={S.page}>
      <h1 style={S.titulo}>Clientes y Suscripciones</h1>
      <p style={S.bajada}>
        Convertí leads ganados en clientes, gestioná sus suscripciones y seguí su evolución mensual.
      </p>

      {/* ── A. Resumen MRR ─────────────────────────────────────────────── */}
      <div style={S.mrr}>
        <div style={S.mrrCard}>
          <div style={S.mrrLabel}>Clientes activos</div>
          <div style={S.mrrValor}>{mrr?.clientes_activos ?? 0}</div>
        </div>
        <div style={S.mrrCard}>
          <div style={S.mrrLabel}>MRR total</div>
          <div style={S.mrrValor}>{ARS(mrr?.mrr)}</div>
        </div>
        <div style={S.mrrCard}>
          <div style={S.mrrLabel}>Ticket promedio</div>
          <div style={S.mrrValor}>{ARS(mrr?.ticket_promedio)}</div>
        </div>
      </div>

      {/* ── B. Leads ganados → pendientes de convertir ─────────────────── */}
      <div style={S.seccion}>
        <div style={S.seccionTitulo}>
          <span>🏆 Leads ganados — pendientes de alta</span>
          <span style={{ fontSize: '13px', fontWeight: '400', color: '#94a3b8' }}>({ganados.length})</span>
        </div>

        {ganados.length === 0
          ? <div style={S.vacio}>No hay leads en etapa "ganado" sin suscripción activa.</div>
          : (
            <table style={S.tabla}>
              <thead>
                <tr>
                  {['Negocio', 'Ciudad', 'Email', 'Score', 'Desde', ''].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ganados.map(lead => (
                  <tr key={lead.id}>
                    <td style={S.td}><strong>{lead.negocio}</strong></td>
                    <td style={S.td}>{lead.ciudad || '—'}</td>
                    <td style={S.td}>{lead.email || <span style={{ color: '#f59e0b' }}>Sin email</span>}</td>
                    <td style={S.td}>{lead.score ?? '—'}</td>
                    <td style={S.td}>{fechaCorta(lead.actualizado_en)}</td>
                    <td style={S.td}>
                      <button onClick={() => setLeadAlta(lead)} style={S.btn('#16a34a')}>
                        + Dar de alta
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      {/* ── C. Clientes activos ─────────────────────────────────────────── */}
      <div style={S.seccion}>
        <div style={S.seccionTitulo}>
          <span>🟢 Clientes activos</span>
          <span style={{ fontSize: '13px', fontWeight: '400', color: '#94a3b8' }}>({clientes.length})</span>
        </div>

        {clientes.length === 0
          ? <div style={S.vacio}>Sin clientes activos todavía.</div>
          : (
            <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
              {/* Cabecera de la tabla */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 100px 120px 120px 130px 120px', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '700', color: '#475569' }}>
                <span>Negocio</span>
                <span>Plan</span>
                <span>Estado</span>
                <span>Mensual</span>
                <span>Próx. cobro</span>
                <span>Score actual</span>
                <span>Pasarela</span>
              </div>
              {clientes.map(c => (
                <FichaCliente
                  key={c.cliente?.id || c.lead?.id}
                  leadId={c.lead?.id}
                  negocio={c.lead?.negocio || '—'}
                  cliente={c.cliente}
                  historial={c.historial}
                  informes={c.informes}
                  tareas={c.tareas}
                />
              ))}
            </div>
          )
        }
      </div>

      {/* ── Modal de alta ──────────────────────────────────────────────── */}
      {leadAlta && (
        <FormularioAlta
          lead={leadAlta}
          onCerrar={() => setLeadAlta(null)}
          onExito={() => {
            setLeadAlta(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}
