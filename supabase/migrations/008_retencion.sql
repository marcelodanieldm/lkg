-- 008_retencion.sql — Mecanismo de retención de clientes e informes mensuales.
--
-- Tarea programada mensual `informe_cliente` (0 15 26 * *):
-- Re-auditoría del cliente y barrido geográfico desde corpus y caché.
-- Registra deltas de score, posición y cambios en competidores.
-- Guarda alertas agrupadas para el operador.

CREATE TABLE IF NOT EXISTS historial_clientes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  score INT NOT NULL,
  posicion INT,
  total_competidores INT,
  auditado_json JSONB,
  barrido_id TEXT REFERENCES barridos(id) ON DELETE SET NULL,
  diagnostico_caida TEXT CHECK (diagnostico_caida IN ('cliente_perdio_terreno', 'competidor_avanzo', 'cambio_perfil', 'sin_cambio')),
  es_primera_medicion BOOLEAN DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alertas_operador (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('salto_competidor', 'nuevo_competidor', 'caida_rating_cliente')),
  detalle JSONB NOT NULL,
  enviado BOOLEAN DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_clientes_lead ON historial_clientes (lead_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_operador_enviado ON alertas_operador (enviado, creado_en);

ALTER TABLE historial_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas_operador ENABLE ROW LEVEL SECURITY;

INSERT INTO config (clave, valor, nota) VALUES
  ('dia_informe_cliente', '26', 'Día del mes para el informe de retención a clientes'),
  ('alerta_salto_score_pts', '10', 'Puntos de salto de score de un competidor para alertar al operador')
ON CONFLICT (clave) DO NOTHING;

-- Programación mensual en pg_cron: el 26 de cada mes a las 15:00 UTC (12:00 Argentina)
-- No choca con prospección (11:00 UTC), seguimiento (13:00 UTC), supervisor (22:00 UTC) ni postventa (12:00 el día 1).
SELECT cron.schedule('lokigi-informe-cliente', '0 15 26 * *', $$ SELECT llamar_tarea('informe_cliente') $$);
