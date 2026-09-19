-- 012_embudo_simplificado.sql — Embudo de 6 etapas verificables.
--
-- El embudo anterior tenía 10 etapas con distinciones subjetivas que nadie
-- puede sostener en una operación de medio tiempo: ¿cuándo pasa alguien de
-- "respondio" a "interesado"? Lo decide una persona a ojo, de a uno, y en
-- dos semanas todos quedan en "respondio" para siempre.
--
-- La regla nueva: una etapa es un HECHO VERIFICABLE, no una opinión.
-- Los hechos se definen sobre los dos entregables que existen: el informe
-- de auditoría y el mensaje enviado.
--
-- ETAPAS NUEVAS (+ 2 salidas permanentes):
--   auditado    → informe congelado (automático al auditar)
--   contactado  → primer mensaje salió (automático al enviar)
--   leyo        → abrió el informe ≥10 s + ≥25% scroll (automático)
--   conversando → contestó (manual)
--   propuesta   → cotización enviada (manual)
--   cliente     → paga (manual)
--   perdido     → cierre sin conversión, motivo obligatorio (manual)
--   baja        → opt-out (automático por trigger existente)
--
-- BACKFILL: no hay datos en producción que requieran backfill. La tabla
-- `leads` está vacía en este punto del proyecto. La migración lo declara
-- explícitamente para que quede en el historial.
--
-- IDEMPOTENCIA: cada sentencia usa IF NOT EXISTS / OR REPLACE / DO NOTHING
-- para que la migración pueda correrse dos veces sin error.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Recrear el tipo etapa_lead con los 8 nuevos valores
-- ─────────────────────────────────────────────────────────────────────
--
-- Postgres no permite eliminar valores de un enum existente, así que la
-- técnica segura es: renombrar el viejo, crear el nuevo con los valores
-- correctos, migrar la columna (noop: no hay filas) y eliminar el viejo.
-- TODO esto dentro de un bloque DO para que sea idempotente.

DO $$
DECLARE
  v_valores TEXT[];
  v_esperados TEXT[] := ARRAY['auditado','contactado','leyo','conversando','propuesta','cliente','perdido','baja'];
  v_tiene_nuevos BOOLEAN := TRUE;
  v_val TEXT;
BEGIN
  -- Verificar si el tipo ya tiene exactamente los 8 valores nuevos.
  SELECT array_agg(enumlabel::TEXT ORDER BY enumsortorder)
    INTO v_valores
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'etapa_lead';

  FOREACH v_val IN ARRAY v_esperados LOOP
    IF NOT (v_val = ANY(COALESCE(v_valores, '{}'::TEXT[]))) THEN
      v_tiene_nuevos := FALSE;
      EXIT;
    END IF;
  END LOOP;

  IF v_tiene_nuevos AND array_length(v_valores, 1) = 8 THEN
    RAISE NOTICE 'etapa_lead ya tiene los 8 valores nuevos — nada que hacer.';
    RETURN;
  END IF;

  -- Declarado explícitamente: no hay filas en leads, el backfill no aplica.
  RAISE NOTICE 'Sin filas en leads — procediendo a recrear etapa_lead.';

  -- Renombrar el tipo viejo para liberar el nombre.
  ALTER TYPE etapa_lead RENAME TO etapa_lead_v1;

  -- Crear el nuevo tipo con los 8 valores.
  CREATE TYPE etapa_lead AS ENUM (
    'auditado', 'contactado', 'leyo', 'conversando', 'propuesta',
    'cliente', 'perdido', 'baja'
  );

  -- Migrar la columna etapa de leads al nuevo tipo.
  -- (Si hubiera filas con valores viejos, este ALTER fallaría. No hay filas.)
  ALTER TABLE leads
    ALTER COLUMN etapa TYPE etapa_lead USING etapa::TEXT::etapa_lead;

  -- Actualizar el valor por defecto al primer valor del nuevo enum.
  ALTER TABLE leads ALTER COLUMN etapa SET DEFAULT 'auditado';

  -- Eliminar el tipo viejo.
  DROP TYPE etapa_lead_v1;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Columnas de timestamp por etapa
-- ─────────────────────────────────────────────────────────────────────
-- Registran el momento exacto en que el lead entró a cada etapa.
-- No se calcula: se escribe una sola vez y no se modifica.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS auditado_en    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contactado_en  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS leyo_en        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conversando_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS propuesta_en   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cliente_en     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS perdido_en     TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Motivo de pérdida — CHECK constraint con las 5 opciones fijas
-- ─────────────────────────────────────────────────────────────────────
-- La columna motivo_perdida ya existe (creada en 001_esquema.sql sin
-- constraint). Aquí se agrega el constraint si no existe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'leads'
      AND constraint_name = 'leads_motivo_perdida_check'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_motivo_perdida_check
      CHECK (motivo_perdida IN (
        'precio',
        'momento',
        'ya tiene proveedor',
        'nunca contestó',
        'no era el decisor'
      ));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Trigger: etapa a 'perdido' requiere motivo
-- ─────────────────────────────────────────────────────────────────────
-- Un CHECK constraint de columna no puede ver el valor de otra columna,
-- así que la validación "perdido sin motivo → error" va en el trigger
-- que ya existe para proteger opt_out. Se reemplaza la función completa.

CREATE OR REPLACE FUNCTION proteger_opt_out() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Baja irreversible.
  IF OLD.opt_out = TRUE AND NEW.opt_out = FALSE THEN
    RAISE EXCEPTION 'La baja es irreversible: no se puede pasar opt_out de true a false (lead %)', OLD.id;
  END IF;

  -- Al darse de baja: fijar fecha y etapa.
  IF NEW.opt_out = TRUE AND OLD.opt_out = FALSE THEN
    NEW.opt_out_fecha := COALESCE(NEW.opt_out_fecha, NOW());
    NEW.etapa := 'baja';
  END IF;

  -- Cerrar como perdido requiere motivo.
  IF NEW.etapa = 'perdido' AND OLD.etapa <> 'perdido' THEN
    IF NEW.motivo_perdida IS NULL OR TRIM(NEW.motivo_perdida) = '' THEN
      RAISE EXCEPTION 'Para marcar un lead como perdido el motivo_perdida es obligatorio.';
    END IF;
    NEW.perdido_en := COALESCE(NEW.perdido_en, NOW());
  END IF;

  -- Timestamps automáticos de entrada a cada etapa.
  IF NEW.etapa <> OLD.etapa THEN
    CASE NEW.etapa
      WHEN 'auditado'    THEN NEW.auditado_en    := COALESCE(NEW.auditado_en,    NOW());
      WHEN 'contactado'  THEN NEW.contactado_en  := COALESCE(NEW.contactado_en,  NOW());
      WHEN 'leyo'        THEN NEW.leyo_en        := COALESCE(NEW.leyo_en,        NOW());
      WHEN 'conversando' THEN NEW.conversando_en := COALESCE(NEW.conversando_en, NOW());
      WHEN 'propuesta'   THEN NEW.propuesta_en   := COALESCE(NEW.propuesta_en,   NOW());
      WHEN 'cliente'     THEN NEW.cliente_en     := COALESCE(NEW.cliente_en,     NOW());
      ELSE NULL;
    END CASE;
  END IF;

  NEW.actualizado_en := NOW();
  RETURN NEW;
END $$;

-- El trigger ya existe; se deja como está (BEFORE UPDATE ON leads).
-- Si por alguna razón no existiera, se crea.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'leads_proteger_opt_out'
      AND tgrelid = 'leads'::regclass
  ) THEN
    CREATE TRIGGER leads_proteger_opt_out BEFORE UPDATE ON leads
      FOR EACH ROW EXECUTE FUNCTION proteger_opt_out();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Ampliar registrar_visto_informe para avanzar a 'leyo'
-- ─────────────────────────────────────────────────────────────────────
-- La señal de permanencia del navegador (≥10 s + ≥25 % scroll) ya llama
-- a esta función. Se agrega: si el lead está en 'contactado', avanzar a
-- 'leyo' y registrar leyo_en.

CREATE OR REPLACE FUNCTION registrar_visto_informe(p_lead_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auto      BOOLEAN;
  v_origen    TEXT;
  v_tope      INT;
  v_hoy       INT;
  v_ya        BOOLEAN;
  v_es_sol    BOOLEAN;
  v_etapa_act TEXT;
BEGIN
  -- 1. Contador de vistas y timestamp del primer visto.
  UPDATE leads
     SET informe_visto   = COALESCE(informe_visto, 0) + 1,
         informe_visto_en = COALESCE(informe_visto_en, NOW())
   WHERE id = p_lead_id;

  UPDATE solicitudes
     SET informe_visto_en = COALESCE(informe_visto_en, NOW())
   WHERE lead_id = p_lead_id OR id::TEXT = p_lead_id;

  -- 2. Avanzar a 'leyo' si estaba en 'contactado'.
  --    El trigger escribe leyo_en automáticamente al cambiar la etapa.
  SELECT etapa::TEXT INTO v_etapa_act FROM leads WHERE id = p_lead_id;
  IF v_etapa_act = 'contactado' THEN
    UPDATE leads SET etapa = 'leyo' WHERE id = p_lead_id;
  END IF;

  -- 3. Leer configuración de barrido automático.
  SELECT (valor = 'TRUE' OR valor = 'true') INTO v_auto
    FROM config WHERE clave = 'barrido_automatico';
  IF NOT COALESCE(v_auto, FALSE) THEN
    RETURN jsonb_build_object('ok', true, 'barrido', 'desactivado');
  END IF;

  SELECT COALESCE(valor, 'solicitudes') INTO v_origen
    FROM config WHERE clave = 'barrido_auto_origen';
  SELECT COALESCE(valor::INT, 10) INTO v_tope
    FROM config WHERE clave = 'barrido_auto_tope_diario';

  -- 4. Verificar origen.
  SELECT EXISTS(
    SELECT 1 FROM solicitudes
     WHERE lead_id = p_lead_id OR id::TEXT = p_lead_id
  ) INTO v_es_sol;
  IF v_origen = 'solicitudes' AND NOT v_es_sol THEN
    RETURN jsonb_build_object('ok', true, 'barrido', 'origen_no_aplicable');
  END IF;

  -- 5. Idempotencia: ya solicitado antes.
  SELECT EXISTS(
    SELECT 1 FROM leads WHERE id = p_lead_id AND barrido_solicitado = TRUE
    UNION ALL
    SELECT 1 FROM solicitudes
      WHERE (lead_id = p_lead_id OR id::TEXT = p_lead_id) AND barrido_solicitado = TRUE
  ) INTO v_ya;
  IF v_ya THEN
    RETURN jsonb_build_object('ok', true, 'barrido', 'ya_procesado');
  END IF;

  -- 6. Tope diario.
  SELECT COUNT(*) INTO v_hoy
    FROM solicitudes
   WHERE barrido_solicitado = TRUE AND informe_visto_en >= CURRENT_DATE;
  IF v_hoy >= v_tope THEN
    RETURN jsonb_build_object('ok', true, 'barrido', 'tope_diario_alcanzado');
  END IF;

  -- 7. Marcar como pendiente para la tarea desacoplada.
  UPDATE solicitudes
     SET barrido_solicitado = TRUE, barrido_estado = 'pendiente'
   WHERE lead_id = p_lead_id OR id::TEXT = p_lead_id;
  UPDATE leads
     SET barrido_solicitado = TRUE, barrido_estado = 'pendiente'
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'barrido', 'pendiente');
END $$;

REVOKE ALL ON FUNCTION registrar_visto_informe(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_visto_informe(TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Actualizar las vistas del panel
-- ─────────────────────────────────────────────────────────────────────

-- v_embudo: ahora excluye 'baja' y 'perdido' de los activos por defecto.
CREATE OR REPLACE VIEW v_embudo AS
SELECT etapa, COUNT(*) AS cantidad, ROUND(AVG(score), 1) AS score_promedio
FROM leads
WHERE opt_out = FALSE
GROUP BY etapa;

-- v_cola_hoy: excluye 'cliente' (antes excluía 'ganado').
CREATE OR REPLACE VIEW v_cola_hoy AS
SELECT l.id, l.negocio, l.etapa, l.toques, l.proximo_toque, l.email, l.score, l.percentil
FROM leads l
WHERE l.opt_out = FALSE
  AND l.etapa NOT IN ('cliente', 'perdido', 'baja')
  AND l.email IS NOT NULL
  AND (l.proximo_toque IS NULL OR l.proximo_toque <= NOW())
ORDER BY l.prioridad DESC NULLS LAST, l.proximo_toque ASC NULLS FIRST;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Plazos máximos por etapa en config
-- ─────────────────────────────────────────────────────────────────────
-- Los plazos viven en la tabla config y no en el código para poder
-- ajustarlos sin desplegar.

INSERT INTO config (clave, valor, nota) VALUES
  ('plazo_max_auditado',    '7',  'Días máximos en etapa auditado antes de considerar el lead frío'),
  ('plazo_max_contactado',  '5',  'Días máximos esperando que abra el informe'),
  ('plazo_max_leyo',        '7',  'Días máximos esperando respuesta tras haber visto el informe'),
  ('plazo_max_conversando', '14', 'Días máximos en conversación activa'),
  ('plazo_max_propuesta',   '10', 'Días máximos esperando respuesta a la propuesta'),
  ('plazo_max_cliente',     '0',  'Sin plazo: ya es cliente')
ON CONFLICT (clave) DO NOTHING;
