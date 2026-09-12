'use client';

import { useActionState } from 'react';
import { pedirAuditoriaWeb } from './solicitar.js';

/**
 * El formulario de la landing.
 *
 * Es de cliente solo para poder mostrar el estado después de enviar sin que la
 * página se recargue. No sabe nada de la base: llama a una acción de servidor y
 * muestra lo que le devuelve.
 */
export default function Formulario() {
  const [estado, accion, enviando] = useActionState(pedirAuditoriaWeb, { estado: 'inicial' });

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
      <label htmlFor="negocio">Tu negocio</label>
      <input id="negocio" name="negocio" type="text" required maxLength={160}
             placeholder="Panadería La Esquina de Oro" autoComplete="organization" />

      <label htmlFor="ciudad">Ciudad</label>
      <input id="ciudad" name="ciudad" type="text" maxLength={80}
             placeholder="Rosario" autoComplete="address-level2" />

      <label htmlFor="correo">A dónde te lo mando</label>
      <input id="correo" name="correo" type="email" required maxLength={200}
             placeholder="hola@tunegocio.com.ar" autoComplete="email" />

      {/* Trampa para bots: una persona nunca ve este campo ni lo completa.
          Va oculto con CSS y fuera del orden de tabulación, no con type=hidden
          —que los bots saltean— ni con display:none, que algunos detectan. */}
      <div aria-hidden="true"
           style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
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
