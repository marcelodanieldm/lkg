-- 010_motivo_busqueda.sql — Pregunta opcional post-envío en la landing
--
-- Permite registrar la respuesta a "¿Pasó algo que te hizo buscar esto?"
-- de forma opcional y desacoplada del envío inicial de la solicitud.

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS motivo_busqueda TEXT,
  ADD COLUMN IF NOT EXISTS motivo_busqueda_at TIMESTAMPTZ;

-- Actualizar vista v_solicitudes_nuevas para que incluya motivo_busqueda
CREATE OR REPLACE VIEW v_solicitudes_nuevas AS
SELECT s.id, s.negocio, s.email, s.ciudad, s.telefono, s.mensaje, s.nota,
       s.motivo_busqueda, s.motivo_busqueda_at,
       to_char(s.creado_en AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') AS cuando,
       s.creado_en
FROM solicitudes s
WHERE s.estado = 'nueva'
ORDER BY s.creado_en DESC;

-- RPC para guardar la respuesta opcional post-envío
CREATE OR REPLACE FUNCTION guardar_motivo_busqueda(
  p_solicitud_id UUID,
  p_motivo TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_solicitud_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'id_nulo');
  END IF;

  UPDATE solicitudes
     SET motivo_busqueda = left(btrim(coalesce(p_motivo, '')), 2000),
         motivo_busqueda_at = NOW()
   WHERE id = p_solicitud_id;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION guardar_motivo_busqueda(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guardar_motivo_busqueda(UUID, TEXT) TO anon, authenticated;
