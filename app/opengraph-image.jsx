import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Lokigi — Auditoría gratuita de tu perfil en Google Maps';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const agencia = process.env.AGENCIA_NOMBRE || 'Lokigi';
  const ciudad = process.env.AGENCIA_CIUDAD || 'Argentina';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#0C1116',
          padding: '48px 60px',
          fontFamily: 'sans-serif',
          color: '#E6ECF3',
        }}
      >
        {/* Lado izquierdo: Título y marca */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '520px',
            height: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: '#1B4FD8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontWeight: 'bold',
                fontSize: '20px',
              }}
            >
              📍
            </div>
            <span style={{ fontSize: '26px', fontWeight: 'bold', letterSpacing: '-0.02em', color: '#E6ECF3' }}>
              {agencia}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 'bold',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: '#6C9BFF',
                backgroundColor: '#152342',
                padding: '6px 12px',
                borderRadius: '6px',
                width: 'fit-content',
              }}
            >
              Auditoría de tu posicionamiento en Google Maps y GBP · {ciudad}
            </span>
            <h1
              style={{
                fontSize: '40px',
                fontWeight: '600',
                lineHeight: '1.15',
                margin: 0,
                color: '#FFFFFF',
                letterSpacing: '-0.02em',
              }}
            >
              Tu perfil de Google tiene un puntaje. Te digo cuál es, gratis.
            </h1>
            <p style={{ fontSize: '18px', color: '#AEBAC8', margin: 0, lineHeight: '1.4' }}>
              Reviso 25 puntos de control sobre el perfil público de tu negocio y te mando un informe completo.
            </p>
          </div>

          <div style={{ fontSize: '15px', color: '#788595' }}>
            Sin compromiso ni llamadas por teléfono
          </div>
        </div>

        {/* Lado derecho: Tarjeta de Puntaje (26/100 y 6 barras) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '500px',
            backgroundColor: '#161C24',
            border: '1px solid #252E39',
            borderRadius: '20px',
            padding: '32px 36px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#788595', fontWeight: 'bold' }}>
            Auditoría en vivo · Muestra de control
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', marginTop: '16px' }}>
            <span style={{ fontSize: '72px', fontWeight: 'bold', color: '#E58165', lineHeight: '0.9' }}>
              26
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingBottom: '6px' }}>
              <span style={{ fontSize: '22px', color: '#788595' }}>/100</span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 'bold',
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: '#2E1B16',
                  color: '#E58165',
                }}
              >
                CRÍTICO
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              marginTop: '24px',
              paddingTop: '20px',
              borderTop: '1px solid #252E39',
            }}
          >
            {[
              { nombre: 'Fundamentos del perfil', score: 45, color: '#D6A64C' },
              { nombre: 'Reputación y reseñas', score: 40, color: '#E08A55' },
              { nombre: 'Contenido visual', score: 19, color: '#E58165' },
              { nombre: 'Actividad y frescura', score: 0, color: '#E58165' },
              { nombre: 'Conversión y atención', score: 20, color: '#E58165' },
              { nombre: 'Presencia digital', score: 0, color: '#E58165' },
            ].map((d) => (
              <div key={d.nombre} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}>
                <span style={{ width: '180px', color: '#AEBAC8' }}>{d.nombre}</span>
                <div
                  style={{
                    flex: 1,
                    height: '8px',
                    backgroundColor: '#26303B',
                    borderRadius: '99px',
                    overflow: 'hidden',
                    display: 'flex',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(d.score, 3)}%`,
                      height: '100%',
                      backgroundColor: d.color,
                      borderRadius: '99px',
                    }}
                  />
                </div>
                <span style={{ width: '28px', textAlign: 'right', fontWeight: 'bold', color: d.color }}>
                  {d.score}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
