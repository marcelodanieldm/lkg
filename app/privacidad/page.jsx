import Link from 'next/link';

export const metadata = {
  title: 'Política de Privacidad',
  robots: 'noindex,nofollow',
};

const AGENCIA = process.env.AGENCIA_NOMBRE || 'Lokigi';
const CIUDAD = process.env.AGENCIA_CIUDAD || '[TU CIUDAD]';
const CORREO = process.env.EMAIL_OPERADOR || process.env.GMAIL_FROM || '';
const PERSONA = process.env.AGENCIA_PERSONA || '[TU NOMBRE]';

export default function Privacidad() {
  return (
    <>
      <header className="tapa">
        <div className="ancho" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <Link href="/" className="marca"
                style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'var(--ink)' }}>
            <Pin size={24} color="var(--accent)" />
            <b style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, letterSpacing: '-.02em' }}>{AGENCIA}</b>
          </Link>
          <nav style={{ marginLeft: 'auto' }}>
            <Link href="/">Volver a la landing</Link>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: '60px auto 100px', padding: '0 20px', lineHeight: 1.65, color: 'var(--ink)' }}>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, marginBottom: 12, letterSpacing: '-.02em' }}>
          Política de Privacidad
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', marginBottom: 36 }}>
          Última actualización: septiembre de 2026. Esta política describe cómo {AGENCIA} trata los datos públicos
          y las solicitudes recibidas a través de este sitio.
        </p>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>1. Responsable del tratamiento</h2>
            <p>
              El servicio es operado por <b>{PERSONA}</b> ({AGENCIA}), con base en {CIUDAD}, Argentina.
              {CORREO && <> Para cualquier consulta sobre la privacidad o el manejo de datos, podés escribir a <b>{CORREO}</b>.</>}
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>2. Origen y naturaleza de los datos</h2>
            <p style={{ marginBottom: 12 }}>
              {AGENCIA} audita perfiles comerciales públicos en Google Maps. Los datos analizados provienen exclusivamente de:
            </p>
            <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li><b>Información pública en Google Maps:</b> Nombre comercial, dirección, horario, teléfono, categoría, fotografías y reseñas públicas.</li>
              <li><b>Sitio web oficial del negocio:</b> Casilla de contacto publicada abiertamente por el propio establecimiento.</li>
              <li><b>Formulario de solicitud voluntario:</b> Los datos ingresados voluntariamente al solicitar un informe desde esta web (nombre del negocio, correo de contacto, ubicación e IP de origen para prevención anti-spam).</li>
            </ul>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>3. Finalidad del tratamiento</h2>
            <p>
              Los datos se utilizan únicamente para calcular el puntaje de control del perfil (25 reglas deterministas)
              y hacer entrega del informe de diagnóstico correspondiente. <b>No compramos ni vendemos bases de datos</b>,
              no realizamos llamadas telefónicas comerciales no solicitadas ni compartimos la información con terceros.
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>4. Solicitud de baja e irreversibilidad (Opt-out)</h2>
            <p>
              Respetamos de forma absoluta la voluntad de no recibir comunicaciones. Si no querés recibir más correos:
            </p>
            <ul style={{ paddingLeft: 20, margin: '10px 0 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Podés responder cualquier correo recibido con la palabra <b>BAJA</b>.</li>
              <li>Podés utilizar el enlace directo de desuscripción disponible en el pie de los correos o en <Link href="/baja" style={{ color: 'var(--accent)' }}>/baja</Link>.</li>
            </ul>
            <p style={{ fontSize: 14.5, color: 'var(--ink-2)' }}>
              Por diseño del sistema, la baja es <b>definitiva e irreversible</b>: la dirección de correo ingresa a una tabla
              de supresión protegida que el motor de envíos consulta antes de cada mensaje.
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>5. Almacenamiento y seguridad</h2>
            <p>
              Los datos se almacenan en infraestructura segura en Supabase con reglas de acceso estricto a nivel de filas (RLS).
              Los mensajes enviados son inmutables y quedan registrados para auditoría operativa y cumplimiento normativo.
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>6. Tus derechos</h2>
            <p>
              Tenés derecho a solicitar el acceso a los datos asociados a tu perfil comercial o requerir la supresión inmediata de tu dirección de nuestras listas de contacto en cualquier momento.
            </p>
          </div>
        </section>

        <div style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>{AGENCIA} · {CIUDAD}</span>
          <Link href="/" style={{ fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}>← Volver al inicio</Link>
        </div>
      </main>
    </>
  );
}

const Pin = ({ size = 24, color = 'var(--accent)' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 22s7.5-7.2 7.5-12.5A7.5 7.5 0 0 0 4.5 9.5C4.5 14.8 12 22 12 22z"
          fill="none" stroke={color} strokeWidth="1.8" />
    <circle cx="12" cy="9.4" r="2.6" fill={color} />
  </svg>
);
