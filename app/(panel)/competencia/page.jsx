'use client';

/**
 * app/(panel)/competencia/page.jsx — Módulo de Barrido de Competidores por Proximidad.
 *
 * REGLAS E INVARIANTES:
 * 1. maxDuration = 60 en la página y en vercel.json.
 * 2. Pre-flight obligatorio: muestra llamadas a gastar, costo USD y caché antes de correr nada.
 * 3. Enrolamiento a prospección explícito e individual por checkboxes (NUNCA automático).
 * 4. Botón de exportación de CSV con instruccional para Power BI / Excel.
 */

import React, { useState } from 'react';
import InformeConciso from './InformeConciso.jsx';
import {
  estimarBarridoAction,
  ejecutarBarridoAction,
  obtenerEstadoProspeccionCompetidoresAction,
  encolarCompetidoresSeleccionadosAction,
} from './acciones.js';

export const maxDuration = 60;

export default function CompetenciaPage() {
  const [placeIdInput, setPlaceIdInput] = useState('ChIJCSLssnKrt5URWyFhlKOAwm0');
  const [radioMetros, setRadioMetros] = useState(4000);
  const [estimacion, setEstimacion] = useState(null);
  const [barridoRes, setBarridoRes] = useState(null);
  const [competidoresProspeccion, setCompetidoresProspeccion] = useState([]);
  const [seleccionados, setSeleccionados] = useState({});
  const [cargandoEst, setCargandoEst] = useState(false);
  const [cargandoBarrido, setCargandoBarrido] = useState(false);
  const [mensajeEnc, setMensajeEnc] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // 1. Estimar barrido (Pre-flight de costos sin gastar llamadas de búsqueda)
  async function handleEstimar(e) {
    e.preventDefault();
    if (!placeIdInput.trim()) return;
    setErrorMsg(null);
    setCargandoEst(true);
    setBarridoRes(null);
    setEstimacion(null);
    try {
      const est = await estimarBarridoAction(placeIdInput.trim(), Number(radioMetros));
      setEstimacion(est);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setCargandoEst(false);
    }
  }

  // 2. Ejecutar barrido real (o recuperar de caché)
  async function handleEjecutar(forzarRefresco = false) {
    if (!placeIdInput.trim()) return;
    setErrorMsg(null);
    setCargandoBarrido(true);
    try {
      const res = await ejecutarBarridoAction(placeIdInput.trim(), {
        radioMetros: Number(radioMetros),
        forzarRefresco,
      });

      if (res.cancelado) {
        setErrorMsg(`Barrido cancelado: Presupuesto API excedido (Gasto actual USD $${res.gastoActualUSD} / Límite USD $${res.presupuestoUSD})`);
        return;
      }

      setBarridoRes(res);

      // Cargar lista para prospección manual si hay ID de barrido
      if (res.barridoId) {
        const compList = await obtenerEstadoProspeccionCompetidoresAction(res.barridoId).catch(() => []);
        setCompetidoresProspeccion(compList);
        setSeleccionados({});
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setCargandoBarrido(false);
    }
  }

  // Toggle de selección manual de checkboxes
  function toggleSeleccion(placeId) {
    setSeleccionados(prev => ({ ...prev, [placeId]: !prev[placeId] }));
  }

  // Encolar competidores seleccionados manualmente
  async function handleEncolarSeleccionados() {
    const aEncolar = competidoresProspeccion.filter(c => seleccionados[c.placeId] && c.disponible);
    if (aEncolar.length === 0) return;

    setMensajeEnc(null);
    try {
      const r = await encolarCompetidoresSeleccionadosAction(aEncolar, barridoRes?.barridoId);
      setMensajeEnc(`✅ ${r.agregados} competidor(es) agregados a la cola de prospección.`);
      // Desmarcar seleccionados
      setSeleccionados({});
    } catch (err) {
      setErrorMsg(err.message);
    }
  }

  // Copiar URL del CSV con BOM al portapapeles
  function handleCopiarExportURL() {
    if (!barridoRes || !barridoRes.barridoId) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const exportUrl = `${origin}/api/barrido/${barridoRes.barridoId}/export`;
    navigator.clipboard.writeText(exportUrl);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 3000);
  }

  const exportUrlAbs = barridoRes?.barridoId
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/barrido/${barridoRes.barridoId}/export`
    : '';

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.titulo}>Barrido de Competidores por Proximidad (4 km)</h1>
        <p style={styles.bajada}>
          Relevamiento de bajo costo en 3 capas. Estima costos antes de ejecutar y genera informes concisos sin dependencias externas.
        </p>
      </header>

      {errorMsg && <div style={styles.errorBox}>⚠ {errorMsg}</div>}

      {/* Formulario de Entrada */}
      <form onSubmit={handleEstimar} style={styles.formCard}>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Place ID del Negocio Cliente:</label>
          <input
            type="text"
            value={placeIdInput}
            onChange={e => setPlaceIdInput(e.target.value)}
            placeholder="Ej: ChIJCSLssnKrt5URWyFhlKOAwm0"
            style={styles.input}
            required
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Radio de Búsqueda (Metros):</label>
          <input
            type="number"
            value={radioMetros}
            onChange={e => setRadioMetros(e.target.value)}
            style={styles.inputNum}
            min={500}
            max={10000}
            step={500}
          />
        </div>

        <button type="submit" disabled={cargandoEst || cargandoBarrido} style={styles.btnEstimar}>
          {cargandoEst ? 'Calculando Estimación...' : '1. Estimar Barrido (Pre-flight)'}
        </button>
      </form>

      {/* Panel de Pre-flight de Costos */}
      {estimacion && (
        <div style={styles.preflightCard}>
          <h2 style={styles.preflightTitulo}>📋 Estimación Previa del Barrido (Pre-flight Obligatorio)</h2>
          <div style={styles.preflightGrid}>
            <div><strong>Negocio Origen:</strong> {estimacion.nombre} ({estimacion.ciudad})</div>
            <div><strong>Vecinos en Corpus Propio:</strong> {estimacion.vecinosEnCorpusCount} auditorías almacenadas previamente</div>
            <div><strong>Celda Geográfica:</strong> {estimacion.celda}</div>
            <div><strong>Categoría Primaria:</strong> {estimacion.categoria}</div>
            <div>
              <strong>Estado de Caché (30 días):</strong>{' '}
              {estimacion.tieneCache ? (
                <span style={styles.badgeSuccess}>DISPONIBLE ($0 USD)</span>
              ) : (
                <span style={styles.badgeInfo}>No existe caché reciente</span>
              )}
            </div>
            <div><strong>Llamadas API Estimadas:</strong> {estimacion.estimacion.llamadasTotal} ({estimacion.estimacion.llamadasSearch} búsqueda + {estimacion.estimacion.llamadasDetail} detalle)</div>
            <div><strong>Costo Estimado:</strong> USD ${estimacion.estimacion.costoUSD}</div>
            <div><strong>Gasto API Acumulado Mes:</strong> USD ${estimacion.estimacion.gastoActualUSD} / ${estimacion.estimacion.presupuestoMaxUSD}</div>
          </div>

          <div style={styles.btnGroup}>
            <button
              onClick={() => handleEjecutar(false)}
              disabled={cargandoBarrido || estimacion.estimacion.superaPresupuesto}
              style={styles.btnEjecutar}
            >
              {cargandoBarrido ? 'Ejecutando Barrido...' : '2. Ejecutar Barrido'}
            </button>

            {estimacion.tieneCache && (
              <button
                onClick={() => handleEjecutar(true)}
                disabled={cargandoBarrido}
                style={styles.btnRefrescar}
              >
                Forzar Refresco de Caché
              </button>
            )}
          </div>
        </div>
      )}

      {/* Renderizado del Informe Conciso */}
      {barridoRes && <InformeConciso barridoRes={barridoRes} />}

      {/* Sección de Exportación Power BI / Excel */}
      {barridoRes && barridoRes.barridoId && (
        <div style={styles.exportCard}>
          <h3 style={styles.exportTitulo}>📊 Exportar Datos a Power BI / Excel (UTF-8 con BOM)</h3>
          <p style={styles.exportDesc}>
            Instrucciones para Power BI: <strong>Obtener datos › Web › Pegar URL del CSV</strong>. Formato analítico largo (1 fila por competidor y por regla). Preservación total de acentos y caracteres en español.
          </p>
          <div style={styles.exportInputRow}>
            <input type="text" readOnly value={exportUrlAbs} style={styles.exportInput} />
            <button onClick={handleCopiarExportURL} style={styles.btnCopiar}>
              {copiado ? '✓ Copiado!' : 'Copiar URL Export'}
            </button>
          </div>
          <div style={styles.instruccionesPowerBI}>
            💡 <strong>Instrucción para Power BI / Excel:</strong> Abrir Excel/Power BI › <em>Obtener datos</em> › <em>Desde la Web</em> › Pegar esta URL.
          </div>
        </div>
      )}

      {/* Sección de Enrolamiento Manual a Prospección (NUNCA Automático) */}
      {barridoRes && competidoresProspeccion.length > 0 && (
        <div style={styles.prospeccionCard}>
          <h3 style={styles.prospeccionTitulo}>➕ Agregar Competidores a la Cola de Prospección (Selección Manual)</h3>
          <p style={styles.prospeccionDesc}>
            Selecciona manualmente los negocios no clientes que deseas agregar a la cola de contacto. Ningún competidor se agrega de forma automática.
          </p>

          {mensajeEnc && <div style={styles.mensajeSuccess}>{mensajeEnc}</div>}

          <table style={styles.tabla}>
            <thead>
              <tr>
                <th style={styles.th}>Seleccionar</th>
                <th style={styles.th}>Nombre del Competidor</th>
                <th style={styles.th}>Distancia</th>
                <th style={styles.th}>Sitio Web</th>
                <th style={styles.th}>Puntaje</th>
                <th style={styles.th}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {competidoresProspeccion.map(c => (
                <tr key={c.placeId} style={styles.tr}>
                  <td style={styles.tdCenter}>
                    <input
                      type="checkbox"
                      disabled={!c.disponible}
                      checked={!!seleccionados[c.placeId]}
                      onChange={() => toggleSeleccion(c.placeId)}
                    />
                  </td>
                  <td style={styles.td}><strong>{c.nombre}</strong></td>
                  <td style={styles.td}>{c.distanciaMetros}m</td>
                  <td style={styles.td}>
                    {c.dominio || c.sitioWeb ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#334155' }}>
                        {c.dominio || c.sitioWeb}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>Sin sitio</span>
                    )}
                  </td>
                  <td style={styles.td}>{c.score ?? 'nd'} pts</td>
                  <td style={styles.td}>
                    {c.estado === 'nuevo' && <span style={styles.badgeNuevo}>NUEVO</span>}
                    {c.estado === 'ya_es_lead' && <span style={styles.badgeLead}>YA ES LEAD</span>}
                    {c.estado === 'en_supresion' && <span style={styles.badgeSupresion}>EN SUPRESIÓN</span>}
                    {c.estado === 'ya_te_escribio' && <span style={styles.badgeEscribio}>YA TE ESCRIBIÓ</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={handleEncolarSeleccionados}
            disabled={Object.values(seleccionados).filter(Boolean).length === 0}
            style={styles.btnEncolar}
          >
            Agregar los tildados a la cola de prospección ({Object.values(seleccionados).filter(Boolean).length})
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: '24px',
    maxWidth: '1100px',
    margin: '0 auto',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#0f172a',
  },
  header: {
    marginBottom: '24px',
  },
  titulo: {
    fontSize: '26px',
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: '8px',
  },
  bajada: {
    fontSize: '14px',
    color: '#64748b',
  },
  errorBox: {
    padding: '12px 16px',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '8px',
    color: '#991b1b',
    marginBottom: '20px',
  },
  formCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '20px',
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    marginBottom: '24px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: '1 1 240px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#475569',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontSize: '14px',
  },
  inputNum: {
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontSize: '14px',
    width: '120px',
  },
  btnEstimar: {
    padding: '10px 20px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '14px',
  },
  preflightCard: {
    background: '#f8fafc',
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '24px',
  },
  preflightTitulo: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: '14px',
  },
  preflightGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '12px',
    fontSize: '14px',
    marginBottom: '20px',
  },
  badgeSuccess: {
    background: '#dcfce7',
    color: '#15803d',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: '600',
    fontSize: '12px',
  },
  badgeInfo: {
    background: '#e0f2fe',
    color: '#0369a1',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: '600',
    fontSize: '12px',
  },
  btnGroup: {
    display: 'flex',
    gap: '12px',
  },
  btnEjecutar: {
    padding: '12px 24px',
    background: '#16a34a',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '15px',
  },
  btnRefrescar: {
    padding: '12px 20px',
    background: '#d97706',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '14px',
  },
  exportCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '20px',
    marginTop: '24px',
  },
  exportTitulo: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: '6px',
  },
  exportDesc: {
    fontSize: '13px',
    color: '#64748b',
    marginBottom: '12px',
  },
  exportInputRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
  },
  exportInput: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '13px',
    background: '#f8fafc',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontFamily: 'monospace',
  },
  btnCopiar: {
    padding: '8px 16px',
    background: '#475569',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  instruccionesPowerBI: {
    fontSize: '12px',
    color: '#0369a1',
    background: '#f0f9ff',
    padding: '8px 12px',
    borderRadius: '6px',
  },
  prospeccionCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '20px',
    marginTop: '24px',
  },
  prospeccionTitulo: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: '6px',
  },
  prospeccionDesc: {
    fontSize: '13px',
    color: '#64748b',
    marginBottom: '16px',
  },
  mensajeSuccess: {
    padding: '10px',
    background: '#dcfce7',
    color: '#15803d',
    borderRadius: '6px',
    marginBottom: '14px',
    fontSize: '14px',
  },
  tabla: {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '16px',
    fontSize: '13px',
  },
  th: {
    background: '#f8fafc',
    padding: '10px',
    textAlign: 'left',
    borderBottom: '2px solid #e2e8f0',
    color: '#475569',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
  },
  td: {
    padding: '10px',
  },
  tdCenter: {
    padding: '10px',
    textAlign: 'center',
  },
  badgeCercano: {
    background: '#dbeafe',
    color: '#1e40af',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
  },
  badgeAmplio: {
    background: '#f1f5f9',
    color: '#475569',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
  },
  badgeNuevo: {
    background: '#dcfce7',
    color: '#166534',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '700',
  },
  badgeLead: {
    background: '#fef3c7',
    color: '#92400e',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
  },
  badgeSupresion: {
    background: '#fef2f2',
    color: '#991b1b',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
  },
  badgeEscribio: {
    background: '#e0f2fe',
    color: '#0369a1',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
  },
  btnEncolar: {
    padding: '10px 20px',
    background: '#0d9488',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '14px',
  },
};
