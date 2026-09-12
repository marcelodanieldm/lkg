-- 004_solicitudes.sql — Los pedidos que llegan por la landing.
--
-- Una solicitud NO es un lead, y la distinción no es burocrática:
--
-- 1. El formulario es público. Va a recibir basura, bots y pruebas. Si eso
--    entrara directo a `leads`, el CRM se ensucia y las métricas del embudo
--    dejan de significar algo.
--
-- 2. `leads.opt_out` es irreversible por disparador. Si alguien pidió la baja
--    y seis meses después completa el formulario, eso es consentimiento nuevo
--    y explícito — pero el sistema no puede revertir una baja, ni debería
--    poder. Con una tabla aparte el pedido queda registrado, vos lo ves, y le
--    contestás a mano desde tu casilla. El guardián sigue sin poder escribirle
--    automáticamente, que es exactamente lo que tiene que pasar.
--
-- 3. Una solicitud es alguien que levantó la mano. Merece otra cola y otra
--    prioridad que un negocio al que le escribimos nosotros.

create table if not exists solicitudes (
  id          uuid primary key default gen_random_uuid(),
  negocio     text not null,
  email       text not null,
  ciudad      text,
  telefono    text,
  mensaje     text,
  -- Se guarda para poder cortar una ráfaga sin tener que mirar los logs de
  -- Vercel. No se muestra en ninguna pantalla.
  origen_ip   text,
  estado      text not null default 'nueva'
              check (estado in ('nueva','auditada','contactada','descartada')),
  lead_id     text references leads(id) on delete set null,
  nota        text,
  atendida_en timestamptz,
  creado_en   timestamptz not null default now()
);

create index if not exists solicitudes_nuevas_idx on solicitudes (creado_en desc)
  where estado = 'nueva';
create index if not exists solicitudes_email_idx on solicitudes (lower(email));

alter table solicitudes enable row level security;

-- ─────────────────────────────────────────────────────────────────────
-- El alta desde la landing
-- ─────────────────────────────────────────────────────────────────────
-- La landing es pública y no tiene sesión, así que el alta va por una función
-- `security definer` que valida, limita y devuelve poco. Nunca se abre la
-- tabla: si se abriera, cualquiera podría LEER todas las solicitudes, que
-- traen nombre y correo de gente real.

create or replace function pedir_auditoria(
  p_negocio text, p_email text, p_ciudad text default null,
  p_telefono text default null, p_mensaje text default null, p_ip text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_recientes int; v_id uuid; v_baja boolean;
begin
  p_negocio := btrim(coalesce(p_negocio, ''));
  p_email   := lower(btrim(coalesce(p_email, '')));

  if length(p_negocio) < 2 or length(p_negocio) > 160 then
    return jsonb_build_object('ok', false, 'motivo', 'negocio');
  end if;
  if p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' or length(p_email) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'email');
  end if;

  -- Freno de ráfaga. No es antispam serio —eso no se resuelve en la base—
  -- pero corta el caso tonto: un bot mandando el mismo formulario cien veces.
  select count(*) into v_recientes from solicitudes
   where creado_en > now() - interval '1 hour'
     and (lower(email) = p_email or (p_ip is not null and origen_ip = p_ip));
  if v_recientes >= 3 then
    -- Se responde ok igual: decirle a un bot que lo frenaste le sirve a él.
    return jsonb_build_object('ok', true, 'id', null);
  end if;

  insert into solicitudes (negocio, email, ciudad, telefono, mensaje, origen_ip)
  values (p_negocio, p_email, nullif(btrim(p_ciudad), ''), nullif(btrim(p_telefono), ''),
          left(nullif(btrim(p_mensaje), ''), 2000), p_ip)
  returning id into v_id;

  -- Si esa dirección se había dado de baja, se marca. NO se revierte nada: la
  -- baja sigue firme y el sistema sigue sin poder escribirle. Lo que cambia es
  -- que vos lo ves y podés contestarle vos, a mano, que es lo correcto cuando
  -- alguien vuelve a golpear la puerta por su cuenta.
  select exists(select 1 from supresiones where lower(valor) = p_email and tipo = 'email')
    into v_baja;
  if v_baja then
    update solicitudes
       set nota = 'Esta dirección figura en la lista de supresión. La baja NO se revirtió: '
                  || 'el sistema no puede escribirle. Si querés responderle, hacelo a mano desde tu casilla.'
     where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'dado_de_baja', v_baja);
end $$;

revoke all on function pedir_auditoria(text, text, text, text, text, text) from public;
grant execute on function pedir_auditoria(text, text, text, text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Para el panel
-- ─────────────────────────────────────────────────────────────────────

create or replace view v_solicitudes_nuevas as
select s.id, s.negocio, s.email, s.ciudad, s.telefono, s.mensaje, s.nota,
       to_char(s.creado_en at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') as cuando,
       s.creado_en
from solicitudes s
where s.estado = 'nueva'
order by s.creado_en desc;

insert into config (clave, valor, nota) values
  ('avisar_solicitudes', 'TRUE', 'Mandarte un correo cuando alguien pide una auditoría desde la web')
on conflict (clave) do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- Los horarios que se le ofrecieron a un lead
-- ─────────────────────────────────────────────────────────────────────
-- El Conversador corre en una invocación y la respuesta del prospecto llega en
-- otra, minutos u horas después. Para poder entender "el martes a las 10" hay
-- que saber qué se le ofreció, así que la lista se guarda.
--
-- Se guarda la lista COMPLETA con sus fechas ISO, no solo las etiquetas: el
-- modelo devuelve una posición (1, 2, 3) y la fecha sale de acá. Pedirle al
-- modelo que devuelva un timestamp es pedirle que invente una zona horaria.

alter table leads
  add column if not exists horarios_ofrecidos jsonb;

comment on column leads.horarios_ofrecidos is
  'Horarios propuestos para la llamada: [{inicio, fin, etiqueta}]. El modelo elige por posición.';
