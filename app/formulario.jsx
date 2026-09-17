'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { pedirAuditoriaWeb, buscarNegocioWeb } from './solicitar.js';

/**
 * El formulario de la landing con detección visual interactiva de ubicación/negocio.
 * Soporta variante completa (por defecto) o variante compacta para el hero.
 */
export default function Formulario({ compacto = false }) {
  const [estado, accion, enviando] = useActionState(pedirAuditoriaWeb, { estado: 'inicial' });
  const [negocio, setNegocio] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [pais, setPais] = useState('Argentina');
  const [buscando, setBuscando] = useState(false);
  const [candidatos, setCandidatos] = useState([]);
  const [hallado, setHallado] = useState(null);
  const [confirmado, setConfirmado] = useState(false);
  const [mostrarMapa, setMostrarMapa] = useState(false);

  const confirmHeaderRef = useRef(null);
  const idPeticionRef = useRef(0);
  const ultimaConsultaRef = useRef('');

  // Mover el foco al campo con error cuando el servidor retorna una falla
  useEffect(() => {
    if (estado?.estado === 'error' && estado?.campo) {
      const prefijo = compacto ? 'hero-' : '';
      const el = document.getElementById(`${prefijo}${estado.campo}`);
      if (el) el.focus();
    }
  }, [estado, compacto]);

  // Mover el foco al encabezado de la confirmación al enviarse con éxito
  useEffect(() => {
    if (estado?.estado === 'listo' && confirmHeaderRef.current) {
      confirmHeaderRef.current.focus();
    }
  }, [estado?.estado]);

  // Detección automática con debounce (900 ms) en versión completa
  useEffect(() => {
    if (compacto || confirmado) return;

    const negocioTrim = negocio.trim();
    if (negocioTrim.length < 3) {
      setCandidatos([]);
      setHallado(null);
      setBuscando(false);
      ultimaConsultaRef.current = '';
      return;
    }

    const queryActual = `${negocioTrim}|${direccion.trim()}|${ciudad.trim()}|${pais.trim()}`;
    if (queryActual === ultimaConsultaRef.current) {
      return;
    }

    const miId = ++idPeticionRef.current;

    const timer = setTimeout(async () => {
      ultimaConsultaRef.current = queryActual;
      setBuscando(true);
      try {
        const res = await buscarNegocioWeb({ negocio, direccion, ciudad, pais });
        if (miId !== idPeticionRef.current) return;

        if (res.ok && res.resultados && res.resultados.length > 0) {
          setCandidatos(res.resultados);
          setHallado(null);
          setConfirmado(false);
        } else {
          setCandidatos([]);
          setHallado(null);
        }
      } catch {
        if (miId === idPeticionRef.current) {
          setCandidatos([]);
          setHallado(null);
        }
      } finally {
        if (miId === idPeticionRef.current) {
          setBuscando(false);
        }
      }
    }, 900);

    return () => {
      clearTimeout(timer);
    };
  }, [negocio, direccion, ciudad, pais, confirmado, compacto]);

  if (estado?.estado === 'listo') {
    const destino = estado?.email ? `a ${estado.email}` : 'al correo que dejaste';
    return (
      <div className="formulario" role="status">
        <div className="gracias">
          <b ref={confirmHeaderRef} tabIndex={-1}>Anotado.</b>
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

  const errorNegocio = estado?.estado === 'error' && estado?.campo === 'negocio';
  const errorCorreo = estado?.estado === 'error' && estado?.campo === 'correo';

  if (compacto) {
    return (
      <form className="formulario" action={accion} noValidate style={{ padding: '20px 22px', borderRadius: 12 }}>
        <label htmlFor="hero-negocio">Nombre del negocio o servicio</label>
        <input
          id="hero-negocio"
          name="negocio"
          type="text"
          required
          maxLength={160}
          value={negocio}
          onChange={(e) => setNegocio(e.target.value)}
          placeholder="Panadería La Esquina de Oro"
          autoComplete="organization"
          aria-invalid={errorNegocio ? 'true' : undefined}
          aria-describedby={errorNegocio ? 'error-formulario-hero' : undefined}
        />

        <label htmlFor="hero-correo">A dónde te lo mando</label>
        <input
          id="hero-correo"
          name="correo"
          type="email"
          required
          maxLength={200}
          placeholder="hola@tunegocio.com.ar"
          autoComplete="email"
          aria-invalid={errorCorreo ? 'true' : undefined}
          aria-describedby={errorCorreo ? 'error-formulario-hero' : undefined}
        />

        {/* Trampa para bots */}
        <div
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}
        >
          <label htmlFor="hero-sitio">No completes este campo</label>
          <input id="hero-sitio" name="sitio" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {estado?.estado === 'error' && (
          <p className="yerro" role="alert" id="error-formulario-hero">
            {estado.mensaje}
          </p>
        )}

        <button className="cta" type="submit" disabled={enviando} style={{ marginTop: 10, width: '100%' }}>
          {enviando ? 'Mandando…' : 'Pedir mi auditoría gratis'}
        </button>
      </form>
    );
  }

  return (
    <form className="formulario" action={accion} noValidate>
      <input type="hidden" name="placeId" value={confirmado && hallado ? hallado.id : ''} />
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
        aria-invalid={errorNegocio ? 'true' : undefined}
        aria-describedby={errorNegocio ? 'error-formulario' : undefined}
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
          <select
            id="pais"
            name="pais"
            value={pais}
            onChange={(e) => setPais(e.target.value)}
            autoComplete="country-name"
          >
            <option value="Argentina">Argentina</option>
            <option value="Uruguay">Uruguay</option>
            <option value="Chile">Chile</option>
            <option value="Colombia">Colombia</option>
            <option value="México">México</option>
            <option value="España">España</option>
            <option value="Otro">Otro país</option>
          </select>
        </div>
      </div>

      <label htmlFor="correo">A dónde te lo mando</label>
      <input
        id="correo"
        name="correo"
        type="email"
        required
        maxLength={200}
        placeholder="hola@tunegocio.com.ar"
        autoComplete="email"
        aria-invalid={errorCorreo ? 'true' : undefined}
        aria-describedby={errorCorreo ? 'error-formulario' : undefined}
      />

      {/* Trampa para bots: una persona nunca ve este campo ni lo completa. */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}
      >
        <label htmlFor="sitio">No completes este campo</label>
        <input id="sitio" name="sitio" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {estado?.estado === 'error' && (
        <p className="yerro" role="alert" id="error-formulario">
          {estado.mensaje}
        </p>
      )}

      <button className="cta" type="submit" disabled={enviando}>
        {enviando ? 'Mandando…' : 'Pedir mi auditoría'}
      </button>

      <p className="letra">Un solo correo, con el informe completo.</p>

      {/* Región viva de detección visual (ubicada debajo del botón para evitar saltos de maquetado) */}
      <div aria-live="polite" aria-atomic="true" style={{ marginTop: 16 }}>
        {buscando && (
          <div className="tarjeta-deteccion busqueda">
            <span className="indicador-spin" aria-hidden="true">📍</span>
            <span>Buscando y verificando ubicación en Google Maps...</span>
          </div>
        )}

        {!buscando && candidatos.length > 0 && (
          <div className={`tarjeta-deteccion ${confirmado ? 'confirmado' : 'detectado'}`}>
            <div className="encabezado-det">
              <span className="badge-det">
                <span aria-hidden="true">{confirmado ? '✓ ' : '📍 '}</span>
                {confirmado
                  ? (hallado ? 'Ubicación y negocio confirmados' : 'Opción registrada')
                  : 'Coincidencias encontradas en Google Maps'}
              </span>
              {confirmado && (
                <button
                  type="button"
                  className="boton-cambiar"
                  onClick={() => {
                    setConfirmado(false);
                    setMostrarMapa(false);
                  }}
                >
                  Cambiar opción
                </button>
              )}
            </div>

            {!confirmado ? (
              <div className="lista-candidatos">
                <p className="instruccion-candidatos">
                  ¿Tu negocio es alguno de estos resultados? Seleccioná la opción correcta:
                </p>
                {candidatos.map((item, idx) => (
                  <button
                    key={item.id || idx}
                    type="button"
                    className="opcion-candidato"
                    onClick={() => {
                      setHallado(item);
                      setConfirmado(true);
                      setMostrarMapa(false);
                    }}
                  >
                    <div className="opcion-candidato-radio" aria-hidden="true">
                      <span>📍</span>
                    </div>
                    <div className="opcion-candidato-info">
                      <b>{item.nombre}</b>
                      <p className="dir-det">{item.direccion}</p>
                      <div className="meta-det">
                        {item.rating != null && (
                          <span className="rating-det">
                            <span aria-hidden="true">★ </span>
                            {item.rating} ({item.resenas ?? 0} reseñas)
                          </span>
                        )}
                        <span className="cat-det">{item.categoria}</span>
                      </div>
                    </div>
                  </button>
                ))}

                <button
                  type="button"
                  className="opcion-candidato opcion-ninguno"
                  onClick={() => {
                    setHallado(null);
                    setConfirmado(true);
                    setMostrarMapa(false);
                  }}
                >
                  <div className="opcion-candidato-radio" aria-hidden="true">
                    <span>✕</span>
                  </div>
                  <div className="opcion-candidato-info">
                    <b>Ninguno de estos negocios es el mío</b>
                    <p className="dir-det">Continuar sólo con los datos del formulario</p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="cuerpo-det">
                {hallado ? (
                  <>
                    <b>{hallado.nombre}</b>
                    <p className="dir-det">
                      <span aria-hidden="true">📍 </span>
                      {hallado.direccion}
                    </p>
                    <div className="meta-det">
                      {hallado.rating != null && (
                        <span className="rating-det">
                          <span aria-hidden="true">★ </span>
                          {hallado.rating} ({hallado.resenas ?? 0} reseñas)
                        </span>
                      )}
                      <span className="cat-det">{hallado.categoria}</span>
                    </div>

                    {/* Botón de mapa a demanda (Lazy Load) */}
                    <div className="mapa-200m-wrap">
                      {!mostrarMapa ? (
                        <button
                          type="button"
                          className="boton-ver-mapa"
                          onClick={() => setMostrarMapa(true)}
                        >
                          <span aria-hidden="true">📍 </span>
                          Ver mapa de la ubicación (200m a la redonda)
                        </button>
                      ) : (
                        <>
                          <div className="mapa-200m-header">
                            <span>
                              <span aria-hidden="true">📍 </span>
                              Google Maps — Ubicación (200m a la redonda)
                            </span>
                            <span className="badge-zoom">Radio 200m</span>
                          </div>
                          <iframe
                            title="Mapa de la ubicación en 200 metros a la redonda"
                            src={hallado.mapEmbedUrl}
                            className="iframe-mapa-200m"
                            loading="lazy"
                            allowFullScreen
                          ></iframe>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="dir-det">
                    Se enviará la auditoría basada exclusivamente en los datos ingresados en el formulario.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
