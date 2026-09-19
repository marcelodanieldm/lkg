'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * La navegación del panel, marcando dónde estás parado.
 *
 * Es el único componente de cliente del proyecto, y lo es por una sola razón:
 * `usePathname()` no existe del lado del servidor. No toca la base de datos ni
 * recibe datos del CRM — solo lee la URL. Un test falla si alguna vez un
 * componente de cliente importa el adaptador de Supabase.
 */
const PANTALLAS = [
  ['/panel', 'Panel'],
  ['/solicitudes', 'Solicitudes'],
  ['/aprobaciones', 'Aprobaciones'],
  ['/leads', 'Leads'],
  ['/competencia', 'Competencia'],
  ['/simulacro', 'Simulacro'],
  ['/guia', 'Guía'],
];

export default function Nav() {
  const ruta = usePathname();
  return (
    <nav>
      {PANTALLAS.map(([href, texto]) => (
        <Link key={href} href={href} aria-current={ruta === href ? 'page' : undefined}>
          {texto}
        </Link>
      ))}
    </nav>
  );
}
