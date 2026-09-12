import './globals.css';

/**
 * `noindex` por defecto, y a propósito.
 *
 * Casi todo el proyecto es privado o ajeno: el panel es tu CRM, y el informe de
 * un prospecto habla del negocio de otra persona que no pidió salir en Google.
 * La ÚNICA página que se indexa es la landing, que lo declara por su cuenta en
 * su propio `metadata`.
 *
 * El default va en el lado seguro: si mañana agregás una pantalla y te olvidás
 * de pensar en esto, queda fuera de los buscadores en vez de adentro.
 */
export const metadata = {
  title: 'Lokigi',
  description: 'Auditoría de perfiles de Google Business Profile, prospección y CRM.',
  robots: 'noindex,nofollow',
};

export const viewport = { width: 'device-width', initialScale: 1 };

/**
 * El marco mínimo: tipografías, estilos y nada más.
 *
 * La barra de navegación NO está acá a propósito. Este layout lo comparten
 * dos clases de página muy distintas: el panel, que es privado y solo usás
 * vos, y el informe público y la baja, que abre gente que nunca vio Lokigi.
 * Mostrarle a un prospecto un menú con "Aprobaciones" y "Leads" revela cómo
 * funciona la máquina que le escribió, y eso arruina el tono del primer
 * contacto.
 *
 * La barra vive en app/(panel)/layout.jsx, que envuelve únicamente lo privado.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
