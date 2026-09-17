'use client';

import { useActionState, useState, useEffect } from 'react';
import { pedirAuditoriaWeb, buscarNegocioWeb } from './solicitar.js';

/**
 * El formulario de la landing con detección visual interactiva de ubicación/negocio.
 */
export default function Formulario() {
  const [estado, accion, enviando] = useActionState(pedirAuditoriaWeb, { estado: 'inicial' });
  const [negocio, setNegocio] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [pais, setPais] = useState('Argentina');
  const [buscando, setBuscando] = useState(false);
  const [hallado, setHallado] = useState(null);
  const [confirmado, setConfirmado] = useState(false);

  // Detección automática con debounce cuando el usuario ingresa o modifica los datos del negocio/ubicación
  useEffect(() => {
    if (confirmado) return;

    if (negocio.trim().length < 3) {
      setHallado(null);
      return;
    }

    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await buscarNegocioWeb({ negocio, direccion, ciudad, pais });
        if (res.ok && res.resultados.length > 0) {
          setHallado(res.resultados[0]);
        } else {
          setHallado(null);
        }
      } catch {
        setHallado(null);
      } finally {
        setBuscando(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [negocio, direccion, ciudad, pais, confirmado]);

  if (estado?.estado === 'listo') {
    const destino = estado?.email ? `a ${estado.email}` : 'al correo que dejaste';
    return (
      <div className="formulario">
        <div className="gracias">
          <b>Anotado.</b>
          <p>
            Te mando la auditoría lo antes posible {destino},
            en un solo mensaje y con el informe completo.
          </p>
          <p>
            Revisá también la carpeta de spam o correo no deseado: soy un
            remitente nuevo y a veces caigo ahí. Si lo encontrás ahí, marcalo
            como «no es spam» y los siguientes te llegan bien.
          </p>
          <p>
            Cuando llegue, si querés preguntarme algo, respondé ese mismo correo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="formulario" action={accion}>
      <label htmlFor="negocio">Nombre del negocio o servicio</label>
      <input
        id="negocio"
        name="negocio"
        type="text"
        required
        maxLength={160}
        value={negocio}
        onChange={(e) => setNegocio(e.target.value)}
        placeholder="Panadería La Esquina de Oro"
        autoComplete="organization"
      />

      <label htmlFor="direccion">Dirección</label>
      <input
        id="direccion"
        name="direccion"
        type="text"
        maxLength={160}
        value={direccion}
        onChange={(e) => setDireccion(e.target.value)}
        placeholder="Av. Colón 1450"
        autoComplete="street-address"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <label htmlFor="ciudad">Ciudad</label>
          <input
            id="ciudad"
            name="ciudad"
            type="text"
            maxLength={80}
            value={ciudad}
            onChange={(e) => setCiudad(e.target.value)}
            placeholder="Rosario"
            autoComplete="address-level2"
          />
        </div>
        <div>
          <label htmlFor="pais">País</label>
          <input
            id="pais"
            name="pais"
            type="text"
            maxLength={80}
            value={pais}
            onChange={(e) => setPais(e.target.value)}
            placeholder="Argentina"
            autoComplete="country-name"
          />
        </div>
      </div>

      {/* UX visual de detección de ubicación / negocio con Mapa a 200m */}
      {buscando && (
        <div className="tarjeta-deteccion busqueda">
          <span className="indicador-spin">📍</span>
          <span>Buscando y verificando ubicación en Google Maps...</span>
        </div>
      )}

      {!buscando && hallado && (
        <div className={`tarjeta-deteccion ${confirmado ? 'confirmado' : 'detectado'}`}>
          <div className="encabezado-det">
            <span className="badge-det">
              {confirmado ? '✓ Ubicación y negocio confirmados' : '📍 Ubicación detectada en Google Maps'}
            </span>
            {confirmado && (
              <button
                type="button"
                className="boton-cambiar"
                onClick={() => setConfirmado(false)}
              >
                Cambiar
              </button>
            )}
          </div>

          <div className="cuerpo-det">
            <b>{hallado.nombre}</b>
            <p className="dir-det">📍 {hallado.direccion}</p>
            <div className="meta-det">
              {hallado.rating && (
                <span className="rating-det">
                  ★ {hallado.rating} ({hallado.resenas ?? 0} reseñas)
                </span>
              )}
              <span className="cat-det">{hallado.categoria}</span>
            </div>
          </div>

          {/* Mapa embebido de Google Maps con radio de 200 metros a la redonda (zoom 17) */}
          <div className="mapa-200m-wrap">
            <div className="mapa-200m-header">
              <span>📍 Google Maps — Ubicación (200m a la redonda)</span>
              <span className="badge-zoom">Radio 200m</span>
            </div>
            <iframe
              title="Mapa de la ubicación en 200 metros a la redonda"
              src={hallado.mapEmbedUrl}
              className="iframe-mapa-200m"
              loading="lazy"
              allowFullScreen
            ></iframe>
          </div>

          {!confirmado && (
            <div className="pie-det">
              <span>¿Es esta la ubicación correcta de tu negocio?</span>
              <button
                type="button"
                className="boton-confirmar"
                onClick={() => setConfirmado(true)}
              >
                ✓ Sí, es mi negocio y ubicación
              </button>
            </div>
          )}
        </div>
      )}

      <label htmlFor="correo">A dónde te lo mando</label>
      <input
        id="correo"
        name="correo"
        type="email"
        required
        maxLength={200}
        placeholder="hola@tunegocio.com.ar"
        autoComplete="email"
      />

      {/* Trampa para bots: una persona nunca ve este campo ni lo completa. */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}
      >
        <label htmlFor="sitio">No completes este campo</label>
        <input id="sitio" name="sitio" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button className="cta" type="submit" disabled={enviando}>
        {enviando ? 'Mandando…' : 'Pedir mi auditoría'}
      </button>

      {estado?.estado === 'error' && <p className="yerro">{estado.mensaje}</p>}

      <p className="letra">Un solo correo, con el informe completo.</p>
    </form>
  );
}
