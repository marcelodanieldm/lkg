import React from 'react';
import { REGLAS } from '../../../lib/core/rubric.js';

/**
 * InformeConciso.jsx — Renderizado del Informe de Competencia Conciso.
 *
 * REGLAS DE DISEÑO:
 * - Conciso es cortar datos, no achicar la letra. La tabla de 38 filas va al export.
 * - Gráficos en CSS puro y SVG embebido. NINGUNA librería externa.
 * - NINGÚN dato de contacto de competidores (teléfono, email).
 * - Conteo absoluto de negocios (ej: "31 de 38..."), NUNCA porcentajes abstractos.
 */
export default function InformeConciso({ barridoRes }) {
  if (!barridoRes || !barridoRes.comparacion) return null;

  const { origen, comparacion, llamadasGastadas, llamadasAhorradas, costoUSD, fechaRelevamiento } = barridoRes;
  const { baseSuficiente, razon, resumen, parrafos, anilloCercano, anilloAmplio, comparacionReglas = [] } = comparacion;

  if (!baseSuficiente) {
    return (
      <div style={styles.contenedor}>
        <div style={styles.insuficienteBox}>
          <h3 style={styles.subtituloAlert}>⚠ Base de Comparación Insuficiente</h3>
          <p style={styles.textoInsuficiente}>
            {razon || 'Se encontraron menos de 5 competidores o menos de 10 reglas comunes evaluables en este radio.'}
          </p>
          <p style={styles.textoNotaInsuficiente}>
            <strong>Nota estratégica:</strong> Poca competencia en la zona es en sí un hallazgo clave. Indica un mercado donde casi cualquier optimización del perfil generará dominancia local inmediata.
          </p>
        </div>
        <div style={styles.pieMetodologia}>
          <h4>Metodología y Transparencia del Relevamiento</h4>
          <div style={styles.pieGrid}>
            <div><strong>Radio de búsqueda:</strong> 4 km</div>
            <div><strong>Negocios encontrados:</strong> {resumen?.totalCompetidores ?? 0}</div>
            <div><strong>Reglas evaluables en común:</strong> {resumen?.reglasComunesEvaluadas ?? 0}</div>
            <div><strong>Fecha del relevamiento:</strong> {fechaRelevamiento ? new Date(fechaRelevamiento).toLocaleString('es-AR') : '—'}</div>
          </div>
        </div>
      </div>
    );
  }

  // 1. Desglose de competidores para la cinta horizontal
  const todosCompetidores = [
    { id: origen.placeId, nombre: origen.nombre, score: origen.score, esPropio: true },
    ...(anilloCercano?.competidores || []).map(c => ({ id: c.placeId, nombre: c.nombre, score: c.score ?? 0, esPropio: false })),
    ...(anilloAmplio?.competidores || []).map(c => ({ id: c.placeId, nombre: c.nombre, score: c.score ?? 0, esPropio: false })),
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

  const mapaReglas = new Map(REGLAS.map(r => [r.id, r]));

  return (
    <div style={styles.contenedor}>
      {/* a) EL VEREDICTO en 1 línea con posición en número grande */}
      <div style={styles.veredictoBox}>
        <span style={styles.veredictoTexto}>
          Sos el <strong style={styles.numeroGrande}>{resumen.posicionGlobal}º</strong> de {resumen.totalEnTabla} {origen.nombre ? 'negocios' : ''} en 4 km a la redonda.
        </span>
        <div style={styles.scoreBadge}>Score Propio: {origen.score}/100</div>
      </div>

      {/* b) DOS PÁRRAFOS DE ANÁLISIS (Deterministas, máximo 90 palabras c/u) */}
      <div style={styles.seccionParrafos}>
        {parrafos?.parrafo1 && <p style={styles.parrafoAnalisis}>{parrafos.parrafo1}</p>}
        {parrafos?.parrafo2 && <p style={styles.parrafoAnalisis}>{parrafos.parrafo2}</p>}
      </div>

      {/* c) LA CINTA HORIZONTAL (38 marcas en 1 línea) */}
      <div style={styles.seccionCinta}>
        <div style={styles.cintaTitulo}>DISTRIBUCIÓN DEL SECTOR EN 4 KM (PUNTAJE RÚBRICA 0 A 100)</div>
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
                boxShadow: c.esPropio ? '0 0 0 3px rgba(16, 185, 129, 0.4)' : 'none',
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

      {/* d) TUS CINCO VECINOS (Formato párrafo por vecino, no tabla) */}
      <div style={styles.seccionVecinos}>
        <h3 style={styles.subtitulo}>Tus 5 Vecinos Más Cercanos</h3>
        <div style={styles.gridVecinos}>
          {(anilloCercano?.competidores || []).map((c, idx) => {
            const cuadras = Math.max(1, Math.round((c.distanciaMetros || 0) / 100));
            const comparativoDetalle = obtenerDetalleComparativoVecino(c, mapaReglas);

            return (
              <div key={c.placeId || idx} style={styles.tarjetaVecino}>
                <div style={styles.vecinoEncabezado}>
                  <strong style={styles.vecinoNombre}>{c.nombre}</strong>
                  <span style={styles.vecinoDistancia}>a {cuadras} cuadras ({c.distanciaMetros} m)</span>
                </div>
                <div style={styles.vecinoScoreRow}>
                  <span style={styles.vecinoScoreLbl}>Score Rúbrica:</span>
                  <strong style={styles.vecinoScoreVal}>{c.score ?? 'nd'}/100</strong>
                </div>
                <div style={styles.vecinoDetalleText}>
                  <p style={styles.vecinoQueHace}><strong>Qué hace mejor:</strong> {comparativoDetalle.queHaceMejor}</p>
                  <p style={styles.vecinoQueVeCliente}><strong>Qué ve un cliente que está eligiendo:</strong> {comparativoDetalle.queVeCliente}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* e) DÓNDE TE GANAN (Máximo 5 con conteo absoluto) */}
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
                  <strong>{h.cumplenCompetencia} de {resumen.totalCompetidores}</strong> competidores tienen <em>{h.nombre}</em>. Vos no lo tenés resuelto.
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* f) DÓNDE GANÁS VOS (Máximo 3) */}
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
                  <strong>{f.nombre}</strong>: Tenés esta regla correctamente cumplida a tu favor.
                </div>
              </li>
            ))}
          </ul>
      {/* g) TRES NUEVOS ANÁLISIS DE DISTRIBUCIÓN */}
      {comparacion.huecoMercado && comparacion.huecoMercado.sePublica && comparacion.huecoMercado.huecos?.length > 0 && (
        <div style={styles.seccionEspecialD9}>
          <h3 style={styles.subtituloAmber}>💡 El Hueco del Mercado (Lo que casi nadie hace)</h3>
          <ul style={styles.listaPuntos}>
            {comparacion.huecoMercado.huecos.map(h => (
              <li key={h.id} style={styles.itemAmber}>
                <span>🚪</span>
                <div>{h.texto}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {comparacion.liderYReceta && comparacion.liderYReceta.sePublica && comparacion.liderYReceta.texto && (
        <div style={styles.seccionEspecialSky}>
          <h3 style={styles.subtituloSky}>👑 El Líder y su Receta</h3>
          <p style={styles.textoDestacado}>{comparacion.liderYReceta.texto}</p>
        </div>
      )}

      {comparacion.umbralEntrada && comparacion.umbralEntrada.sePublica && comparacion.umbralEntrada.texto && (
        <div style={styles.seccionEspecialGreen}>
          <h3 style={styles.subtituloGreen}>🎯 El Umbral de Entrada</h3>
          <p style={styles.textoDestacado}>{comparacion.umbralEntrada.texto}</p>
        </div>
      )}

      {/* h) AL PIE, EL MÉTODO */}
      <div style={styles.pieMetodologia}>
        <h4>Metodología y Transparencia del Relevamiento</h4>
        <div style={styles.pieGrid}>
          <div><strong>Radio de búsqueda:</strong> 4 km</div>
          <div><strong>Negocios encontrados:</strong> {resumen.totalCompetidores}</div>
          <div><strong>Anillo Cercano (con Detalle):</strong> {anilloCercano?.total ?? 0} negocios</div>
          <div><strong>Anillo Amplio (con Búsqueda):</strong> {anilloAmplio?.total ?? 0} negocios</div>
          <div><strong>Reglas evaluables en común:</strong> {resumen.reglasComunesEvaluadas}</div>
          <div><strong>Fecha del relevamiento:</strong> {fechaRelevamiento ? new Date(fechaRelevamiento).toLocaleString('es-AR') : '—'}</div>
          <div><strong>Llamadas API gastadas:</strong> {llamadasGastadas}</div>
          <div><strong>Llamadas ahorradas por corpus:</strong> {llamadasAhorradas || 0}</div>
        </div>
      </div>
    </div>
  );
}

function obtenerDetalleComparativoVecino(c, mapaReglas) {
  if (!c.auditoria || !c.auditoria.hallazgos) {
    return {
      queHaceMejor: 'Mantiene perfil activo y verificado en Google Maps.',
      queVeCliente: 'Un cliente ve un negocio cercano con información básica cargada.'
    };
  }

  const fuertes = c.auditoria.hallazgos.filter(h => h.puntos > 0);

  if (!fuertes.length) {
    return {
      queHaceMejor: 'Mantiene presencia básica en Google Maps.',
      queVeCliente: 'El perfil muestra los datos esenciales de ubicación.'
    };
  }

  const mejorRegla = fuertes[0];
  const def = mapaReglas.get(mejorRegla.id);

  const queHaceMejor = mejorRegla.evidencia || def?.titulo || 'Cumple con estándares del sector.';
  const queVeCliente = def?.comparativo || def?.recomendacion || 'Alguien que busca desde el celular ve información más completa en este perfil.';

  return { queHaceMejor, queVeCliente };
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
    borderLeft: '6px solid #2563eb',
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
  seccionParrafos: {
    marginBottom: '24px',
    background: '#f1f5f9',
    padding: '16px 20px',
    borderRadius: '8px',
    borderLeft: '4px solid #64748b',
  },
  parrafoAnalisis: {
    fontSize: '15px',
    lineHeight: '1.6',
    color: '#334155',
    marginBottom: '12px',
  },
  seccionCinta: {
    marginBottom: '32px',
    padding: '16px',
    background: '#f8fafc',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
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
    background: 'linear-gradient(90deg, #fee2e2 0%, #fef3c7 50%, #dcfce7 100%)',
    borderRadius: '12px',
    marginBottom: '8px',
  },
  cintaPin: {
    position: 'absolute',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    borderRadius: '50%',
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
    marginBottom: '16px',
    color: '#0f172a',
  },
  gridVecinos: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  tarjetaVecino: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '16px',
  },
  vecinoEncabezado: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  vecinoNombre: {
    fontSize: '16px',
    color: '#1e293b',
  },
  vecinoDistancia: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: '600',
  },
  vecinoScoreRow: {
    marginBottom: '8px',
    fontSize: '14px',
  },
  vecinoScoreLbl: {
    color: '#64748b',
    marginRight: '6px',
  },
  vecinoScoreVal: {
    color: '#0f172a',
  },
  vecinoDetalleText: {
    fontSize: '14px',
    color: '#334155',
    lineHeight: '1.5',
  },
  vecinoQueHace: {
    marginBottom: '4px',
  },
  vecinoQueVeCliente: {
    color: '#475569',
    fontStyle: 'italic',
  },
  seccionHallazgos: {
    marginBottom: '28px',
  },
  seccionFortalezas: {
    marginBottom: '28px',
  },
  subtituloAlert: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#dc2626',
    marginBottom: '12px',
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
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  itemFallo: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    background: '#fef2f2',
    padding: '10px 14px',
    borderRadius: '6px',
    fontSize: '14px',
  },
  itemExito: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    background: '#f0fdf4',
    padding: '10px 14px',
    borderRadius: '6px',
    fontSize: '14px',
  },
  iconFallo: {
    color: '#dc2626',
  },
  iconExito: {
    color: '#16a34a',
    fontWeight: 'bold',
  },
  textoVacio: {
    fontSize: '14px',
    color: '#64748b',
    fontStyle: 'italic',
  },
  insuficienteBox: {
    background: '#fffbebfb',
    borderLeft: '6px solid #f59e0b',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '24px',
  },
  textoInsuficiente: {
    fontSize: '16px',
    color: '#92400e',
    marginBottom: '8px',
  },
  textoNotaInsuficiente: {
    fontSize: '14px',
    color: '#78350f',
  },
  pieMetodologia: {
    background: '#f8fafc',
    borderTop: '1px solid #e2e8f0',
    paddingTop: '16px',
    marginTop: '24px',
    fontSize: '13px',
    color: '#64748b',
  },
  seccionEspecialD9: {
    marginBottom: '24px',
    background: '#fffbebfb',
    border: '1px solid #fde68a',
    borderLeft: '5px solid #d97706',
    borderRadius: '8px',
    padding: '16px',
  },
  subtituloAmber: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#b45309',
    marginBottom: '10px',
  },
  itemAmber: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    background: '#ffffff',
    padding: '10px 14px',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#78350f',
  },
  seccionEspecialSky: {
    marginBottom: '24px',
    background: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderLeft: '5px solid #0284c7',
    borderRadius: '8px',
    padding: '16px',
  },
  subtituloSky: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#0369a1',
    marginBottom: '8px',
  },
  seccionEspecialGreen: {
    marginBottom: '24px',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderLeft: '5px solid #16a34a',
    borderRadius: '8px',
    padding: '16px',
  },
  subtituloGreen: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#15803d',
    marginBottom: '8px',
  },
  textoDestacado: {
    fontSize: '14.5px',
    lineHeight: '1.5',
    color: '#1e293b',
    margin: 0,
  },
  pieGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '8px 16px',
    marginTop: '8px',
  },
};
