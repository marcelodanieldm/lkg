import Link from 'next/link';
import { requerirSesion } from '../../lib/auth.js';
import Nav from './nav.jsx';

/**
 * El marco del panel privado.
 *
 * `requerirSesion()` está acá y no solo en cada página: así, cualquier
 * pantalla que agregues adentro de este grupo queda protegida sin que tengas
 * que acordarte. La forma más común de filtrar un CRM es crear una pantalla
 * nueva y olvidarse del control de acceso.
 *
 * Las páginas igual lo llaman por su cuenta. Es redundante y así debe ser: la
 * verificación cuesta microsegundos y el costo de que falte es el CRM entero
 * público en internet.
 */
export default async function LayoutPanel({ children }) {
  await requerirSesion();

  return (
    <>
      <div className="barra">
        <Link href="/panel" className="marca"><Marca /><b>Lokigi</b></Link>
        <Nav />
        <div className="der">
          {/* Abre la cara pública en otra pestaña: sirve para revisar cómo se
              ve la landing sin perder lo que estabas haciendo acá. */}
          <a href="/" target="_blank" rel="noreferrer" className="salir">Ver el sitio ↗</a>
        </div>
      </div>
      {children}
    </>
  );
}

const Marca = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 22s7.5-7.2 7.5-12.5A7.5 7.5 0 0 0 4.5 9.5C4.5 14.8 12 22 12 22z"
          fill="none" stroke="var(--accent)" strokeWidth="1.8" />
    <circle cx="12" cy="9.4" r="2.6" fill="var(--accent)" />
  </svg>
);
