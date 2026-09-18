import React from 'react';

/**
 * InformeConciso.jsx — Renderizado del Informe de Competencia.
 *
 * REGLAS DE DISEÑO:
 * - Conciso es cortar datos, no achicar la letra.
 * - Gráficos en CSS puro y SVG embebido. NINGUNA librería externa.
 * - NINGÚN dato de contacto de competidores (teléfono, email).
 * - Conteo absoluto de negocios (ej: "31 de 38..."), NUNCA porcentajes abstractos.
 */
export default function InformeConciso({ barridoRes }) {
  if (!barridoRes || !barridoRes.comparacion) return null;

  const { origen, comparacion, llamadasGastadas, llamadasAhorradas, costoUSD, fechaRelevamiento, cache } = barridoRes;
  const { resumen, anilloCercano, anilloAmplio, comparacionReglas = [] } = comparacion;

  // 1. Desglose de competidores para la cinta horizontal
  const todosCompetidores = [
    { id: origen.placeId, nombre: origen.nombre, score: origen.score, esPropio: true },
    ...(anilloCercano.competidores || []).map(c => ({ id: c.placeId, nombre: c.nombre, score: c.score ?? 0, esPropio: false })),
    ...(anilloAmplio.competidores || []).map(c => ({ id: c.placeId, nombre: c.nombre, score: c.score ?? 0, esPropio: false })),
  ].sort((a, b) => b.score - a.score);

  // 2. Hallazgos: Dónde te ganan (Máximo 5 con conteo absoluto de negocios)
  const dondeGanan = comparacionReglas
    .filter(r => r.estadoPropio !== 'ok' && r.cumplenCompetencia > 0)
    .sort((a, b) => b.cumplenCompetencia - a.cumplenCompetencia)
    .slice(0, 5);

  // 3. Fortalezas: Dónde ganás vos (Máximo 3)
  const dondeGanas = comparacionReglas
    .filter(r => r.estadoPropio === 'ok')
    .slice(0, 3);

  return (
    <div style={styles.contenedor}>
      {/* a) Veredicto en 1 línea + Posición en número grande */}
      <div style={styles.veredictoBox}>
        <span style={styles.veredictoTexto}>
          Sos el <strong style={styles.numeroGrande}>{resumen.posicionGlobal}º</strong> de {resumen.totalEnTabla} {origen.nombre ? 'negocios' : ''} en 4 km.
        </span>
        <div style={styles.scoreBadge}>Score Propio: {origen.score}/100</div>
      </div>

      {/* b) Cinta Horizontal de Competidores (38 marcas en 1 línea) */}
      <div style={styles.seccionCinta}>
        <div style={styles.cintaTitulo}>DISTRIBUCIÓN DEL SECTOR EN 4 KM</div>
        <div style={styles.cintaTrack}>
          {todosCompetidores.map((c, idx) => (
            <div
              key={c.id || idx}
              title={`${c.nombre}: ${c.score}/100`}
              style={{
                ...styles.cintaPin,
                left: `${Math.min(98, Math.max(2, c.score))}%`,
                background: c.esPropio ? '#10b981' : '#64748b',
                width: c.esPropio ? '14px' : '8px',
                height: c.esPropio ? '14px' : '8px',
                zIndex: c.esPropio ? 10 : 1,
                boxShadow: c.esPropio ? '0 0 0 3px rgba(16, 185, 129, 0.3)' : 'none',
              }}
            />
          ))}
        </div>
        <div style={styles.cintaLeyenda}>
          <span>0 (Crítico)</span>
          <span>50 (Aceptable)</span>
          <span>100 (Excelente)</span>
        </div>
      </div>

      {/* c) TUS CINCO VECINOS (Anillo Cercano) */}
      <div style={styles.seccionVecinos}>
        <h3 style={styles.subtitulo}>Tus 5 Vecinos Más Cercanos</h3>
        <div style={styles.gridVecinos}>
          {(anilloCercano.competidores || []).map((c, idx) => (
            <div key={c.placeId || idx} style={styles.tarjetaVecino}>
              <div style={styles.vecinoEncabezado}>
                <strong style={styles.vecinoNombre}>{c.nombre}</strong>
                <span style={styles.vecinoDistancia}>{c.distanciaMetros}m</span>
              </div>
              <div style={styles.vecinoScoreRow}>
                <span style={styles.vecinoScoreLbl}>Score:</span>
                <strong style={styles.vecinoScoreVal}>{c.score ?? 'nd'}/100</strong>
              </div>
              <div style={styles.vecinoCualidad}>
                ✨ <em>{obtenerMejorCualidad(c)}</em>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* d) DÓNDE TE GANAN (Máximo 5 con conteos absolutos) */}
      <div style={styles.seccionHallazgos}>
        <h3 style={styles.subtituloAlert}>Dónde te Ganan</h3>
        {dondeGanan.length === 0 ? (
          <p style={styles.textoVacio}>No se detectaron desventajas principales frente a la competencia.</p>
        ) : (
          <ul style={styles.listaPuntos}>
            {dondeGanan.map(h => (
              <li key={h.id} style={styles.itemFallo}>
                <span style={styles.iconFallo}>❌</span>
                <div>
                  <strong>{h.cumplenCompetencia} de {h.evaluadosCompetencia}</strong> competidores cumplen con <em>{h.nombre}</em>.
                  {h.evidenciaPropia && <span style={styles.detallePropio}> (Tu estado: {h.evidenciaPropia})</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* e) DÓNDE GANÁS VOS (Máximo 3) */}
      <div style={styles.seccionFortalezas}>
        <h3 style={styles.subtituloExito}>Dónde Ganás Vos</h3>
        {dondeGanas.length === 0 ? (
          <p style={styles.textoVacio}>Tu perfil no lidera actualmente en las reglas evaluadas.</p>
        ) : (
          <ul style={styles.listaPuntos}>
            {dondeGanas.map(f => (
              <li key={f.id} style={styles.itemExito}>
                <span style={styles.iconExito}>✓</span>
                <div>
                  <strong>{f.nombre}</strong>: {f.evidenciaPropia || 'Cumples correctamente con esta regla.'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* f) Pie Metodológico */}
      <div style={styles.pieMetodologia}>
        <h4>Metodología y Transparencia del Relevamiento</h4>
        <div style={styles.pieGrid}>
          <div><strong>Radio de búsqueda:</strong> 4 km</div>
          <div><strong>Negocios encontrados:</strong> {resumen.totalCompetidores}</div>
          <div><strong>Anillo Cercano (Detalle):</strong> {anilloCercano.total} negocios</div>
          <div><strong>Anillo Amplio (Búsqueda):</strong> {anilloAmplio.total} negocios</div>
          <div><strong>Reglas evaluables en común:</strong> {resumen.reglasComunesEvaluadas}</div>
          <div><strong>Fecha del relevamiento:</strong> {new Date(fechaRelevamiento).toLocaleString('es-AR')}</div>
          <div><strong>Llamadas API gastadas:</strong> {llamadasGastadas}</div>
          <div><strong>Llamadas ahorradas por corpus:</strong> {llamadasAhorradas || 0}</div>
        </div>
      </div>
    </div>
  );
}

function obtenerMejorCualidad(c) {
  if (!c.auditoria || !c.auditoria.hallazgos) return 'Responde reseñas y mantiene fotos.';
  const fuertes = c.auditoria.hallazgos.filter(h => h.puntos > 0);
  if (fuertes.length) return fuertes[0].titulo || 'Información completa cargada.';
  return 'Perfil activo en Google Maps.';
}

const styles = {
  contenedor: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '24px',
    marginTop: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#0f172a',
  },
  veredictoBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    background: '#f8fafc',
    borderLeft: '6px solid #3b82f6',
    borderRadius: '8px',
    marginBottom: '24px',
  },
  veredictoTexto: {
    fontSize: '20px',
    color: '#1e293b',
  },
  numeroGrande: {
    fontSize: '36px',
    color: '#2563eb',
    fontWeight: '800',
  },
  scoreBadge: {
    background: '#0284c7',
    color: '#ffffff',
    padding: '8px 16px',
    borderRadius: '20px',
    fontWeight: '700',
    fontSize: '14px',
  },
  seccionCinta: {
    marginBottom: '32px',
    padding: '16px',
    background: '#f1f5f9',
    borderRadius: '8px',
  },
  cintaTitulo: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: '0.05em',
    marginBottom: '12px',
  },
  cintaTrack: {
    position: 'relative',
    height: '24px',
    background: 'linear-gradient(to right, #ef4444, #eab308, #22c55e)',
    borderRadius: '12px',
    margin: '10px 0',
  },
  cintaPin: {
    position: 'absolute',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    borderRadius: '50%',
    transition: 'all 0.3s ease',
  },
  cintaLeyenda: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#64748b',
  },
  seccionVecinos: {
    marginBottom: '32px',
  },
  subtitulo: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: '16px',
  },
  gridVecinos: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '12px',
  },
  tarjetaVecino: {
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '12px',
    background: '#ffffff',
  },
  vecinoEncabezado: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  vecinoNombre: {
    fontSize: '14px',
    color: '#0f172a',
    maxWidth: '140px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  vecinoDistancia: {
    fontSize: '12px',
    color: '#64748b',
  },
  vecinoScoreRow: {
    fontSize: '13px',
    marginBottom: '8px',
  },
  vecinoScoreLbl: {
    color: '#64748b',
    marginRight: '4px',
  },
  vecinoScoreVal: {
    color: '#0369a1',
  },
  vecinoCualidad: {
    fontSize: '12px',
    color: '#334155',
    background: '#f8fafc',
    padding: '6px',
    borderRadius: '4px',
  },
  seccionHallazgos: {
    marginBottom: '24px',
  },
  subtituloAlert: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#dc2626',
    marginBottom: '12px',
  },
  seccionFortalezas: {
    marginBottom: '32px',
  },
  subtituloExito: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#16a34a',
    marginBottom: '12px',
  },
  listaPuntos: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  itemFallo: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px',
    background: '#fef2f2',
    borderLeft: '4px solid #ef4444',
    borderRadius: '4px',
    marginBottom: '8px',
    fontSize: '14px',
  },
  iconFallo: {
    fontSize: '14px',
  },
  detallePropio: {
    color: '#991b1b',
    fontSize: '12px',
  },
  itemExito: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px',
    background: '#f0fdf4',
    borderLeft: '4px solid #22c55e',
    borderRadius: '4px',
    marginBottom: '8px',
    fontSize: '14px',
  },
  iconExito: {
    color: '#16a34a',
    fontWeight: 'bold',
  },
  textoVacio: {
    color: '#64748b',
    fontStyle: 'italic',
    fontSize: '14px',
  },
  pieMetodologia: {
    marginTop: '32px',
    paddingTop: '20px',
    borderTop: '1px solid #e2e8f0',
    fontSize: '12px',
    color: '#64748b',
  },
  pieGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '8px',
    marginTop: '10px',
  },
};
