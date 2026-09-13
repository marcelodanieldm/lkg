'use client';

import { useActionState, useState, useEffect } from 'react';
import { pedirAuditoriaWeb, buscarNegocioWeb } from './solicitar.js';

/**
 * El formulario de la landing con detección visual interactiva de ubicación/negocio.
 */
export default function Formulario() {
  const [estado, accion, enviando] = useActionState(pedirAuditoriaWeb, { estado: 'inicial' });
  const [negocio, setNegocio] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [hallado, setHallado] = useState(null);
  const [confirmado, setConfirmado] = useState(false);

  // Detección automática con debounce cuando el usuario ingresa el nombre del negocio
  useEffect(() => {
    if (negocio.trim().length < 3) {
      setHallado(null);
      setConfirmado(false);
      return;
    }

    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await buscarNegocioWeb({ negocio, ciudad });
        if (res.ok && res.resultados.length > 0) {
          setHallado(res.resultados[0]);
          setConfirmado(false);
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
  }, [negocio, ciudad]);

  if (estado?.estado === 'listo') {
    return (
      <div className="formulario">
        <div className="gracias">
          <b>Anotado.</b>
          <p>
            Te mando la auditoría en un par de días hábiles, en un solo correo.
            Si mientras tanto querés preguntarme algo, respondeme ese mismo mensaje.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="formulario" action={accion}>
      <label htmlFor="negocio">Tu negocio o servicio</label>
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

      {/* UX visual de detección de ubicación / negocio */}
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
              {confirmado ? '✓ Negocio verificado' : '📍 Ubicación detectada en Google Maps'}
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
            <p className="dir-det">{hallado.direccion}</p>
            <div className="meta-det">
              {hallado.rating && (
                <span className="rating-det">
                  ★ {hallado.rating} ({hallado.resenas ?? 0} reseñas)
                </span>
              )}
              <span className="cat-det">{hallado.categoria}</span>
            </div>
          </div>
          {!confirmado && (
            <div className="pie-det">
              <span>¿Es esta la ubicación de tu negocio?</span>
              <button
                type="button"
                className="boton-confirmar"
                onClick={() => setConfirmado(true)}
              >
                ✓ Sí, confirmar negocio
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

      <p className="letra">Llega en dos días hábiles. Un solo correo.</p>
    </form>
  );
}
