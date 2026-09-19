import React from 'react';
import Link from 'next/link';
import { requerirSesion } from '../../../lib/auth.js';

export const metadata = {
  title: 'Guía del Usuario — Lokigi',
};

export default async function GuiaPage() {
  await requerirSesion();

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px 80px' }}>
      <header style={{ marginBottom: 32, borderBottom: '1px solid var(--border, #e2e8f0)', paddingBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink, #0f172a)', margin: '0 0 8px' }}>
          📖 Guía del Usuario y Flujos de Trabajo
        </h1>
        <p className="sub" style={{ fontSize: 15, color: 'var(--muted, #64748b)', margin: 0 }}>
          Manual práctico para entender cada pantalla del panel y cómo opera el circuito de auditoría, prospección y retención en Lokigi.
        </p>
      </header>

      {/* Regla de Oro */}
      <section style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 20, marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e40af', margin: '0 0 8px' }}>
          🛡 Regla Innegociable del Sistema
        </h2>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#1e3a8a' }}>
          <b>Ningún agente de IA puede enviar correos directamente.</b> La IA redacta intenciones de mensaje, pero el guardián determinista de 12 reglas evalúa cada propuesta y solo un humano (desde la cola de <code>/aprobaciones</code>) o una tarea programada autoriza el despacho final.
        </p>
      </section>

      {/* Secciones del Panel */}
      <section style={{ marginBottom: 44 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 20, color: 'var(--ink, #0f172a)' }}>
          📍 Módulos del Panel
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>📊 <Link href="/panel">Panel General (/panel)</Link></h3>
            <p style={cardDescStyle}>
              Centro de monitoreo comercial. Muestra si el sistema está activo o pausado, el estado del embudo de ventas, los correos enviados hoy frente al cupo diario, el gasto de APIs del mes y el botón de detención de emergencia (PARAR TODO).
            </p>
          </div>

          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>📥 <Link href="/solicitudes">Solicitudes (/solicitudes)</Link></h3>
            <p style={cardDescStyle}>
              Cola de prospectos inbound que solicitaron su auditoría desde la landing pública. Permite auditar el perfil con 1 clic, generar su informe congelado, cargarlo al CRM y despachar el mail con recomendaciones.
            </p>
          </div>

          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>✍ <Link href="/aprobaciones">Aprobaciones (/aprobaciones)</Link></h3>
            <p style={cardDescStyle}>
              Superficie de revisión humana. Acá llegan las propuestas de correo generadas por los agentes. Podés editar el asunto o cuerpo, autorizar el envío definitivo o rechazar el mensaje.
            </p>
          </div>

          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>🗂 <Link href="/leads">Leads (/leads)</Link></h3>
            <p style={cardDescStyle}>
              Base de datos central del CRM. Registra cada negocio auditado con su puntaje (0-100), potencial alcanzable, toques de seguimiento realizados, historial de baja (<code>opt_out</code>) y enlace permanente al informe.
            </p>
          </div>

          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>🗺 <Link href="/competencia">Competencia (/competencia)</Link></h3>
            <p style={cardDescStyle}>
              Relevamiento geográfico en un radio de 4 km. Incluye estimación previa de costos (Pre-flight), tabla comparativa de los 5 vecinos más cercanos, exportación a Excel/Power BI (UTF-8 BOM) y selección manual para prospección.
            </p>
          </div>

          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>🧪 <Link href="/simulacro">Simulacro (/simulacro)</Link></h3>
            <p style={cardDescStyle}>
              Entorno de prueba en seco (Dry-run). Permite correr una simulación de prospección sobre la base de datos sin enviar mails ni gastar credenciales de Gmail, para verificar qué reglas del guardián bloquearían o permitirían cada mensaje.
            </p>
          </div>
        </div>
      </section>

      {/* Flujos de Negocio */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 20, color: 'var(--ink, #0f172a)' }}>
          🔄 Flujos Operativos de Negocio
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Flujo 1 */}
          <div style={flowBoxStyle}>
            <span style={stepBadgeStyle}>FLUJO 1</span>
            <h3 style={{ margin: '6px 0 8px', fontSize: 17, fontWeight: 700 }}>Captura Entrante (Inbound Solicitudes)</h3>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--ink-2, #334155)', lineHeight: 1.6 }}>
              <li>El usuario visita la landing pública (<code>/</code>) y envía su negocio y correo.</li>
              <li>El pedido ingresa a <code>/solicitudes</code> con su motivo de búsqueda y estado <code>nueva</code>.</li>
              <li>El operador presiona <b>Auditar y procesar</b>: el motor determinista calcula el puntaje sin modelo de IA y congela el informe en Supabase.</li>
              <li>Si se marcó envío por mail, el mensaje se despacha y el lead pasa a <code>contactado</code> en <code>/leads</code>.</li>
            </ol>
          </div>

          {/* Flujo 2 */}
          <div style={flowBoxStyle}>
            <span style={stepBadgeStyle}>FLUJO 2</span>
            <h3 style={{ margin: '6px 0 8px', fontSize: 17, fontWeight: 700 }}>Prospección Saliente Automática (Outbound)</h3>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--ink-2, #334155)', lineHeight: 1.6 }}>
              <li>La tarea <code>pg_cron</code> dispara <code>/api/cron/prospeccion</code> diariamente.</li>
              <li>Se realiza búsqueda de perfiles públicos en Google Maps API y el motor <code>audit-engine.js</code> calcula su puntaje.</li>
              <li>El agente redactor propone el correo y <code>guard.js</code> evalúa las 12 reglas.</li>
              <li>Si requiere visto bueno, se encola en <code>/aprobaciones</code>. Una vez aprobado, sale por Gmail y se incrementa el contador del cupo diario.</li>
            </ol>
          </div>

          {/* Flujo 3 */}
          <div style={flowBoxStyle}>
            <span style={stepBadgeStyle}>FLUJO 3</span>
            <h3 style={{ margin: '6px 0 8px', fontSize: 17, fontWeight: 700 }}>Lectura del Informe y Barrido Automático</h3>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--ink-2, #334155)', lineHeight: 1.6 }}>
              <li>El prospecto hace clic en el enlace de su informe (<code>/informe/[id]</code>).</li>
              <li>Al cumplir $\ge 10$ segundos de permanencia y scroll, el navegador emite la señal de lectura.</li>
              <li>La tarea <code>barrido_pendientes</code> procesa en segundo plano el análisis de los 5 competidores a 4 km.</li>
              <li>El informe se <b>recongela con la competencia completa</b> sin alterar ninguna cifra de la auditoría inicial.</li>
            </ol>
          </div>

          {/* Flujo 4 */}
          <div style={flowBoxStyle}>
            <span style={stepBadgeStyle}>FLUJO 4</span>
            <h3 style={{ margin: '6px 0 8px', fontSize: 17, fontWeight: 700 }}>Respuestas de Clientes y Agendamiento</h3>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--ink-2, #334155)', lineHeight: 1.6 }}>
              <li>La tarea <code>bandeja</code> lee las respuestas entrantes en Gmail.</li>
              <li>Si detecta una baja (<code>BAJA</code>, <code>stop</code>, <code>no me interesa</code>), activa la baja irreversible (<code>opt_out</code>) y envía confirmación.</li>
              <li>Si muestra interés o consulta precios, el agente conversador clasifica la intención y prepara el presupuesto o propone horarios de llamada.</li>
            </ol>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--border, #e2e8f0)', paddingTop: 20, fontSize: 13, color: 'var(--muted, #64748b)' }}>
        Sistema Agéntico Lokigi · Documentación interna para operadores del panel.
      </footer>
    </main>
  );
}

const cardStyle = {
  background: 'var(--card-bg, #ffffff)',
  border: '1px solid var(--border, #e2e8f0)',
  borderRadius: 12,
  padding: 18,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const cardTitleStyle = {
  fontSize: 16,
  fontWeight: 700,
  margin: '0 0 8px',
  color: 'var(--ink, #0f172a)',
};

const cardDescStyle = {
  fontSize: 13.5,
  color: 'var(--muted, #64748b)',
  lineHeight: 1.5,
  margin: 0,
};

const flowBoxStyle = {
  background: 'var(--card-bg, #ffffff)',
  border: '1px solid var(--border, #e2e8f0)',
  borderRadius: 12,
  padding: 20,
};

const stepBadgeStyle = {
  display: 'inline-block',
  background: '#e0f2fe',
  color: '#0369a1',
  fontSize: 11,
  fontWeight: 800,
  padding: '2px 8px',
  borderRadius: 99,
  letterSpacing: '0.06em',
};
