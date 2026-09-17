-- 006_place_id.sql — Agrega la columna place_id a la tabla solicitudes.
--
-- Cuando un usuario confirma la ubicación/negocio detectado en la landing,
-- el id del lugar en Google Places API se envía y se almacena para evitar
-- volver a resolver por texto y caer en una sucursal equivocada.

alter table solicitudes
  add column if not exists place_id text;

comment on column solicitudes.place_id is
  'ID del lugar en Google Places API confirmado por el usuario en el formulario público.';

create or replace function pedir_auditoria(
  p_negocio text, p_email text, p_ciudad text default null,
  p_telefono text default null, p_mensaje text default null, p_ip text default null,
  p_place_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_recientes int; v_id uuid; v_baja boolean;
begin
  p_negocio  := btrim(coalesce(p_negocio, ''));
  p_email    := lower(btrim(coalesce(p_email, '')));
  p_place_id := nullif(btrim(coalesce(p_place_id, '')), '');

  if length(p_negocio) < 2 or length(p_negocio) > 160 then
    return jsonb_build_object('ok', false, 'motivo', 'negocio');
  end if;
  if p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' or length(p_email) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'email');
  end if;

  select count(*) into v_recientes from solicitudes
   where creado_en > now() - interval '1 hour'
     and (lower(email) = p_email or (p_ip is not null and origen_ip = p_ip));
  if v_recientes >= 3 then
    return jsonb_build_object('ok', true, 'id', null);
  end if;

  insert into solicitudes (negocio, email, ciudad, telefono, mensaje, origen_ip, place_id)
  values (p_negocio, p_email, nullif(btrim(p_ciudad), ''), nullif(btrim(p_telefono), ''),
          left(nullif(btrim(p_mensaje), ''), 2000), p_ip, p_place_id)
  returning id into v_id;

  select exists(select 1 from supresiones where lower(valor) = p_email and tipo = 'email')
    into v_baja;
  if v_baja then
    update solicitudes
       set nota = 'Esta dirección figura en la lista de supresión. La baja NO se revirtiól: '
                  || 'el sistema no puede escribirle. Si querés responderle, hacelo a mano desde tu casilla.'
     where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'dado_de_baja', v_baja);
end $$;

revoke all on function pedir_auditoria(text, text, text, text, text, text, text) from public;
grant execute on function pedir_auditoria(text, text, text, text, text, text, text) to anon, authenticated;
