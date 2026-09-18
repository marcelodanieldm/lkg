-- 007_barridos.sql — Tablas para barridos de competencia por cercanía (Dos Anillos)
--
-- Registra relevamientos geográficos de competidores sin contaminar la tabla de Leads.
-- Formato analítico listo para consultas SQL o Power BI.

CREATE TABLE IF NOT EXISTS barridos (
  id TEXT PRIMARY KEY,
  origen_place_id TEXT NOT NULL,
  celda TEXT NOT NULL,
  categoria TEXT NOT NULL,
  radio_m INT NOT NULL DEFAULT 4000,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  encontrados INT NOT NULL DEFAULT 0,
  auditados INT NOT NULL DEFAULT 0,
  llamadas_gastadas INT NOT NULL DEFAULT 0,
  llamadas_ahorradas INT NOT NULL DEFAULT 0,
  costo_usd NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS barrido_competidores (
  id TEXT PRIMARY KEY,
  barrido_id TEXT NOT NULL REFERENCES barridos(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  distancia_m INT NOT NULL,
  anillo TEXT NOT NULL CHECK (anillo IN ('cercano', 'amplio')),
  origen_dato TEXT NOT NULL CHECK (origen_dato IN ('corpus', 'busqueda', 'detalle')),
  score INT,
  auditado_json JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS barrido_reglas (
  id TEXT PRIMARY KEY,
  barrido_id TEXT NOT NULL REFERENCES barridos(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  regla_id TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('ok', 'fallo', 'nd')),
  ratio NUMERIC(5, 2),
  puntos NUMERIC(5, 2),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para búsqueda rápida por celda, categoría y frescura (< 30 días)
CREATE INDEX IF NOT EXISTS idx_barridos_celda_cat ON barridos (celda, categoria, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_barrido_comp_barrido ON barrido_competidores (barrido_id);
CREATE INDEX IF NOT EXISTS idx_barrido_reglas_barrido ON barrido_reglas (barrido_id, regla_id);

-- Habilitar seguridad de filas (RLS) sin políticas públicas para mantener lectura/escritura exclusiva a service_role
ALTER TABLE barridos ENABLE ROW LEVEL SECURITY;
ALTER TABLE barrido_competidores ENABLE ROW LEVEL SECURITY;
ALTER TABLE barrido_reglas ENABLE ROW LEVEL SECURITY;
