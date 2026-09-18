-- 009_barrido_automatico.sql — Barrido de competencia automático al ver el informe.
--
-- Registra el visto del informe con permanencia mínima y desplazamiento desde el navegador.
-- Marca la solicitud/lead como "pendiente" para procesamiento desacoplado en segundo plano.

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS barrido_solicitado BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS barrido_estado TEXT DEFAULT 'ninguno' CHECK (barrido_estado IN ('ninguno', 'pendiente', 'completado', 'cancelado')),
  ADD COLUMN IF NOT EXISTS barrido_id TEXT REFERENCES barridos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS informe_visto_en TIMESTAMPTZ;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS barrido_solicitado BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS barrido_estado TEXT DEFAULT 'ninguno' CHECK (barrido_estado IN ('ninguno', 'pendiente', 'completado', 'cancelado')),
  ADD COLUMN IF NOT EXISTS barrido_id TEXT REFERENCES barridos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS informe_visto_en TIMESTAMPTZ;

INSERT INTO config (clave, valor, nota) VALUES
  ('barrido_automatico', 'TRUE', 'Activa la generación automática de barridos al ver el informe'),
  ('barrido_segundos_minimos', '10', 'Segundos mínimos de permanencia en el informe para activar el barrido'),
  ('barrido_auto_origen', 'solicitudes', 'Origen de leads a auditar automáticamente (solicitudes | todos)'),
  ('barrido_auto_tope_diario', '10', 'Tope diario de barridos automáticos por vistas de informe')
ON CONFLICT (clave) DO NOTHING;

-- Función RPC para registrar el visto e iniciar la cola de barrido automático
CREATE OR REPLACE FUNCTION registrar_visto_informe(p_lead_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auto BOOLEAN;
  v_origen TEXT;
  v_tope INT;
  v_hoy INT;
  v_ya_procesado BOOLEAN;
  v_es_solicitud BOOLEAN;
BEGIN
  -- 1. Registrar timestamp del visto si no existía (privacidad: sin IP ni User-Agent)
  UPDATE leads SET informe_visto_en = COALESCE(informe_visto_en, NOW()) WHERE id = p_lead_id;
  UPDATE solicitudes SET informe_visto_en = COALESCE(informe_visto_en, NOW()) WHERE lead_id = p_lead_id OR id::text = p_lead_id;

  -- 2. Leer configuración
  SELECT (valor = 'TRUE' OR valor = 'true') INTO v_auto FROM config WHERE clave = 'barrido_automatico';
  IF NOT COALESCE(v_auto, FALSE) THEN
    RETURN jsonb_build_object('ok', true, 'barrido', 'desactivado');
  END IF;

  SELECT COALESCE(valor, 'solicitudes') INTO v_origen FROM config WHERE clave = 'barrido_auto_origen';
  SELECT COALESCE(valor::int, 10) INTO v_tope FROM config WHERE clave = 'barrido_auto_tope_diario';

  -- 3. Verificar origen
  SELECT EXISTS(SELECT 1 FROM solicitudes WHERE lead_id = p_lead_id OR id::text = p_lead_id) INTO v_es_solicitud;
  IF v_origen = 'solicitudes' AND NOT v_es_solicitud THEN
    RETURN jsonb_build_object('ok', true, 'barrido', 'origen_no_aplicable');
  END IF;

  -- 4. Idempotencia: Verificar si ya se solicitó previamente para este lead/solicitud
  SELECT EXISTS(
    SELECT 1 FROM leads WHERE id = p_lead_id AND barrido_solicitado = TRUE
    UNION ALL
    SELECT 1 FROM solicitudes WHERE (lead_id = p_lead_id OR id::text = p_lead_id) AND barrido_solicitado = TRUE
  ) INTO v_ya_procesado;

  IF v_ya_procesado THEN
    RETURN jsonb_build_object('ok', true, 'barrido', 'ya_procesado');
  END IF;

  -- 5. Verificar tope diario
  SELECT COUNT(*) INTO v_hoy FROM solicitudes WHERE barrido_solicitado = TRUE AND informe_visto_en >= CURRENT_DATE;
  IF v_hoy >= v_tope THEN
    RETURN jsonb_build_object('ok', true, 'barrido', 'tope_diario_alcanzado');
  END IF;

  -- 6. Marcar como pendiente para la tarea programada desacoplada
  UPDATE solicitudes
     SET barrido_solicitado = TRUE, barrido_estado = 'pendiente'
   WHERE lead_id = p_lead_id OR id::text = p_lead_id;

  UPDATE leads
     SET barrido_solicitado = TRUE, barrido_estado = 'pendiente'
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'barrido', 'pendiente');
END $$;

REVOKE ALL ON FUNCTION registrar_visto_informe(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_visto_informe(TEXT) TO anon, authenticated;
