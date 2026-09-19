'use client';

import { useState } from 'react';
import { reanudarSistema } from './acciones.js';

export default function FormularioReanudar() {
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setCargando(true);
    try {
      const formData = new FormData(e.currentTarget);
      await reanudarSistema(formData);
      alert('✅ El sistema fue reanudado exitosamente. Se reactivaron los envíos.');
    } catch (err) {
      alert(`❌ Falló la reanudación del sistema:\n\nOrigen del fallo: ${err.message || err}`);
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
      <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
        Motivo obligatorio para reanudar (mínimo 20 caracteres):
      </label>

      <textarea
        name="motivo"
        rows={3}
        minLength={20}
        required
        disabled={cargando}
        placeholder="Explicá la causa del problema y cómo se resolvió antes de reanudar..."
        style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />
      <button type="submit" disabled={cargando} className="bot" style={{ marginTop: 8, padding: '6px 14px', cursor: 'pointer' }}>
        {cargando ? 'Reanudando...' : 'Reanudar envíos'}
      </button>
    </form>
  );
}
