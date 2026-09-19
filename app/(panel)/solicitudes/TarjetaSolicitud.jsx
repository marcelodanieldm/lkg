'use client';

import { useState } from 'react';
import { auditarSolicitud, descartarSolicitud, contactarSolicitud } from './acciones.js';

export default function TarjetaSolicitud({ s }) {
  const [cargandoAuditar, setCargandoAuditar] = useState(false);
  const [cargandoDescartar, setCargandoDescartar] = useState(false);
  const [cargandoContactar, setCargandoContactar] = useState(false);

  async function handleAuditar(e) {
    e.preventDefault();
    setCargandoAuditar(true);
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email');
    const enviarEmail = formData.get('enviarEmail') === 'on' || formData.get('enviarEmail') === 'true';

    try {
      const res = await auditarSolicitud(formData);
      if (res && res.ok) {
        if (enviarEmail && email) {
          alert(`✅ Se auditó el perfil y se confirmó el envío del mail a ${email}.\n\nLead creado e informe congelado en el sistema.`);
        } else {
          alert(`✅ Auditoría completada con éxito.\n\nLead creado en el CRM para ${s.negocio}.`);
        }
      } else {
        alert(`❌ Falló la auditoría de la solicitud (${s.negocio}):\n\nOrigen del fallo: ${res?.error || 'Error en el servidor'}`);
      }
    } catch (err) {
      alert(`❌ Falló la auditoría de la solicitud (${s.negocio}):\n\nOrigen del fallo: ${err.message || err}`);
    } finally {
      setCargandoAuditar(false);
    }
  }

  async function handleDescartar(e) {
    e.preventDefault();
    setCargandoDescartar(true);
    try {
      const formData = new FormData(e.currentTarget);
      const res = await descartarSolicitud(formData);
      if (res && res.ok) {
        alert(`✅ Solicitud de ${s.negocio} descartada exitosamente.`);
      } else {
        alert(`❌ Falló al descartar la solicitud (${s.negocio}):\n\nOrigen del fallo: ${res?.error || 'Error en el servidor'}`);
      }
    } catch (err) {
      alert(`❌ Falló al descartar la solicitud (${s.negocio}):\n\nOrigen del fallo: ${err.message || err}`);
    } finally {
      setCargandoDescartar(false);
    }
  }

  async function handleContactar(e) {
    e.preventDefault();
    setCargandoContactar(true);
    try {
      const formData = new FormData(e.currentTarget);
      const res = await contactarSolicitud(formData);
      if (res && res.ok) {
        alert(`✅ Solicitud de ${s.negocio} marcada como contactada.`);
      } else {
        alert(`❌ Falló al marcar como contactada (${s.negocio}):\n\nOrigen del fallo: ${res?.error || 'Error en el servidor'}`);
      }
    } catch (err) {
      alert(`❌ Falló al marcar como contactada (${s.negocio}):\n\nOrigen del fallo: ${err.message || err}`);
    } finally {
      setCargandoContactar(false);
    }
  }

  const desactivado = cargandoAuditar || cargandoDescartar || cargandoContactar;

  return (
    <article className="aprob">
      <header>
        <h3>{s.negocio}</h3>
        <span className="meta">
          {s.ciudad || 'Sin ciudad'} · {s.cuando}
        </span>
      </header>

      <div className="meta" style={{ marginBottom: 4 }}>
        <b>Contacto:</b> {s.email}{s.telefono ? ` · Tel: ${s.telefono}` : ''}
      </div>

      {s.motivo_busqueda && (
        <div className="aviso-motivo-destacado" style={{ background: '#f0fdf4', border: '1px solid #86efac', padding: '10px 14px', borderRadius: 8, margin: '10px 0', color: '#166534' }}>
          <b style={{ display: 'block', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#15803d', marginBottom: 2 }}>
            💬 ¿Por qué busca esto? (Respuesta del prospecto):
          </b>
          <span style={{ fontSize: 14, fontWeight: 600 }}>"{s.motivo_busqueda}"</span>
        </div>
      )}

      {s.mensaje && (
        <div className="motivo">
          <b>Mensaje:</b> {s.mensaje}
        </div>
      )}

      {s.nota && (
        <div className="aviso stop" style={{ marginTop: 12 }}>
          <span className="lab">Atención</span>
          <p>
            <b>Dirección en lista de supresión:</b> {s.nota}
          </p>
        </div>
      )}

      <div className="acciones">
        {!s.nota && (
          <form onSubmit={handleAuditar} style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginBottom: 12 }}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="placeId" value={s.place_id || s.placeId || ''} />
            <input type="hidden" name="negocio" value={s.negocio} />
            <input type="hidden" name="ciudad" value={s.ciudad || ''} />
            <input type="hidden" name="email" value={s.email || ''} />

            <div style={{ background: 'var(--sub-bg, rgba(255,255,255,0.03))', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--borde, #e5e7eb)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5, fontWeight: 500 }}>
                <input type="checkbox" name="enviarEmail" defaultChecked disabled={desactivado} style={{ width: 16, height: 16 }} />
                Enviar informe por email a <b>{s.email}</b> al terminar de auditar
              </label>

              <textarea
                name="mensajePersonalizado"
                disabled={desactivado}
                placeholder="Mensaje personalizado opcional (ej: Hola! Analicé tu perfil y te adjunto la auditoría completa con recomendaciones)..."
                rows={2}
                className="campo"
                style={{ marginTop: 8, width: '100%', fontSize: 13, resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="aprobar" type="submit" disabled={desactivado}>
                {cargandoAuditar ? 'Auditando...' : 'Auditar y procesar'}
              </button>
            </div>
          </form>
        )}

        <form onSubmit={handleDescartar}>
          <input type="hidden" name="id" value={s.id} />
          <button className="rechazar" type="submit" disabled={desactivado}>
            {cargandoDescartar ? 'Guardando...' : 'Descartar'}
          </button>
        </form>

        <form onSubmit={handleContactar}>
          <input type="hidden" name="id" value={s.id} />
          <button className="sec" type="submit" disabled={desactivado}>
            {cargandoContactar ? 'Guardando...' : 'Ya la contacté'}
          </button>
        </form>
      </div>
    </article>
  );
}
