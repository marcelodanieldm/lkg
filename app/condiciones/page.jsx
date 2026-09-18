import Link from 'next/link';

export const metadata = {
  title: 'Condiciones del Servicio',
  robots: 'noindex,nofollow',
};

const AGENCIA = process.env.AGENCIA_NOMBRE || 'Lokigi';
const CIUDAD = process.env.AGENCIA_CIUDAD || '[TU CIUDAD]';
const CORREO = process.env.EMAIL_OPERADOR || process.env.GMAIL_FROM || '';
const PERSONA = process.env.AGENCIA_PERSONA || '[TU NOMBRE]';

export default function Condiciones() {
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
          Condiciones del Servicio
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', marginBottom: 36 }}>
          Última actualización: septiembre de 2026. Términos y condiciones que rigen las auditorías, diagnósticos y propuestas de {AGENCIA}.
        </p>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>1. Objeto y Alcance del Servicio</h2>
            <p>
              <b>{AGENCIA}</b> brinda servicios de diagnóstico, auditoría técnica
              y optimización operativa para perfiles comerciales públicos en Google Maps. Las presentes condiciones aplican a
              los informes gratuitos generados a solicitud y a las contrataciones de servicios de optimización.
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>2. Metodología Determinista e Informes</h2>
            <p style={{ marginBottom: 10 }}>
              El puntaje de auditoría (0 a 100 puntos) se calcula mediante un motor determinista basado en 25 puntos de control
              distribuidos en 6 dimensiones fijas.
            </p>
            <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li><b>Sin estimaciones infundadas:</b> Todo parámetro no verificable a través de fuentes públicas o captura asistida queda excluido del cálculo en lugar de ser inventado.</li>
              <li><b>Transparencia y coherencia:</b> Dos evaluaciones sobre el mismo perfil público producen exactamente el mismo resultado numérico.</li>
              <li><b>Sin falsas promesas:</b> {AGENCIA} no promete ni garantiza primeras posiciones en el algoritmo de búsqueda de Google ni duplicación de ventas, ya que los resultados dependen de factores de mercado locales y atención directa del establecimiento.</li>
            </ul>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>3. Presupuestos y Cotizaciones</h2>
            <p>
              Los precios de las propuestas comerciales derivan directamente del catálogo de servicios y del cálculo de eficiencia
              en horas de trabajo reales. Los presupuestos presentados quedan congelados en el sistema para garantizar que el valor pactado no sufra alteraciones imprevistas durante el período de vigencia de la oferta.
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>4. Solicitudes Web y Canal de Comunicación</h2>
            <p>
              El envío de una solicitud de auditoría desde el formulario web no constituye la creación de una cuenta comercial
              ni compromete a la contratación de planes. La comunicación se realiza exclusivamente de forma electrónica por correo electrónico, respetando la cuota máxima de envíos diarios y las normas de buena práctica comercial.
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>5. Cancelación y Baja Definitiva</h2>
            <p>
              Cualquier usuario o establecimiento puede solicitar la baja de nuestras comunicaciones en cualquier momento
              respondiendo con la palabra <b>BAJA</b> o haciendo clic en el enlace de desuscripción de 1 clic en <Link href="/baja" style={{ color: 'var(--accent)' }}>/baja</Link>.
              Por diseño, la baja es <b>definitiva e irreversible</b> y bloquea futuros contactos de forma automática.
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>6. Contacto y Consultas</h2>
            <p>
              Para cualquier aclaración sobre estas condiciones o los informes emitidos, podés comunicarte directamente a <b>info@lokigi.online</b>.
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
