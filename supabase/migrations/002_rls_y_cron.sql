-- 002_rls_y_cron.sql — Seguridad de filas y el reemplazo del cron de n8n.
--
-- Dos problemas que resuelve este archivo:
--
-- 1. SEGURIDAD. Supabase expone toda tabla por API REST. Sin políticas de
--    seguridad a nivel de fila, la clave anónima —que viaja al navegador—
--    puede leer el CRM entero. Acá se cierra todo por defecto y se abre
--    únicamente lo que el informe público necesita.
--
-- 2. PROGRAMACIÓN. El plan Hobby de Vercel permite cron UNA VEZ POR DÍA, con
--    ±59 minutos de imprecisión. Eso no alcanza para revisar la cola de
--    aprobación cada quince minutos. La solución es no usar el cron de Vercel:
--    pg_cron corre dentro de Postgres, es gratis, acepta cada minuto, y con
--    pg_net llama a los endpoints de la aplicación.

-- ─────────────────────────────────────────────────────────────────────
-- Seguridad a nivel de fila
-- ─────────────────────────────────────────────────────────────────────

alter table leads        enable row level security;
alter table aprobaciones enable row level security;
alter table mensajes     enable row level security;
alter table supresiones  enable row level security;
alter table corpus       enable row level security;
alter table clientes     enable row level security;
alter table tareas       enable row level security;
alter table config       enable row level security;
alter table metricas     enable row level security;
alter table bitacora     enable row level security;

-- Sin políticas, nadie entra salvo la clave de servicio, que ignora RLS y vive
-- solo del lado del servidor. Ese es el estado por defecto y es el correcto:
-- el panel de Lokigi lo usa una sola persona, autenticada, desde el servidor.

-- Única excepción: el informe público. El prospecto lo abre sin cuenta, así
-- que necesita leer una fila concreta de leads. Se expone lo mínimo mediante
-- una función, no abriendo la tabla.
create or replace function informe_publico(p_lead_id text)
returns table (negocio text, categoria text, ciudad text, direccion text,
               score int, potencial int, percentil int, maps_url text)
language sql security definer stable
set search_path = public
as $$
  select negocio, categoria, ciudad, direccion, score, potencial, percentil, maps_url
  from leads where id = p_lead_id and opt_out = false
$$;

revoke all on function informe_publico(text) from public;
grant execute on function informe_publico(text) to anon, authenticated;

-- Registrar que el informe se abrió. Es la señal de interés más fuerte del
-- embudo, y tiene que poder escribirla alguien sin sesión.
create or replace function registrar_apertura(p_lead_id text)
returns void language sql security definer
set search_path = public
as $$
  update leads set informe_visto = coalesce(informe_visto, 0) + 1,
                   etapa = case when etapa = 'contactado' then 'respondio'::etapa_lead else etapa end
  where id = p_lead_id;
$$;

revoke all on function registrar_apertura(text) from public;
grant execute on function registrar_apertura(text) to anon, authenticated;

-- La baja de un clic desde el correo. Sin sesión, y solo puede ir en la
-- dirección segura: da de baja, nunca reactiva.
create or replace function darse_de_baja(p_lead_id text, p_canal text default 'email')
returns void language plpgsql security definer
set search_path = public
as $$
declare v_email text; v_tel text;
begin
  select email, telefono into v_email, v_tel from leads where id = p_lead_id;
  update leads set opt_out = true, opt_out_canal = p_canal where id = p_lead_id;
  if v_email is not null then
    insert into supresiones (valor, tipo, motivo, origen)
    values (lower(v_email), 'email', 'baja solicitada', 'enlace del correo')
    on conflict do nothing;
  end if;
  if v_tel is not null then
    insert into supresiones (valor, tipo, motivo, origen)
    values (v_tel, 'telefono', 'baja solicitada', 'enlace del correo')
    on conflict do nothing;
  end if;
end $$;

revoke all on function darse_de_baja(text, text) from public;
grant execute on function darse_de_baja(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- pg_cron: el reemplazo de n8n
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Los secretos van en Vault, no en el cuerpo del job: cualquiera con acceso a
-- cron.job podría leerlos de otro modo.
-- Antes de correr esto, cargá en el editor SQL de Supabase:
--   select vault.create_secret('https://TU-APP.vercel.app', 'app_url');
--   select vault.create_secret('TU_LOKIGI_API_KEY', 'lokigi_api_key');

create or replace function llamar_tarea(p_tarea text)
returns bigint language plpgsql security definer
set search_path = public, vault
as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'lokigi_api_key';

  return net.http_post(
    url     := v_url || '/api/cron/' || p_tarea,
    headers := jsonb_build_object('Content-Type','application/json','X-API-Key', v_key),
    body    := jsonb_build_object('origen','pg_cron','tarea',p_tarea),
    timeout_milliseconds := 55000
  );
end $$;

-- Los horarios van en UTC. Argentina es UTC-3, así que 8:00 local son las 11:00.
select cron.schedule('lokigi-prospeccion',  '0 11 * * 1-5', $$ select llamar_tarea('prospeccion') $$);
select cron.schedule('lokigi-aprobaciones', '*/15 * * * *', $$ select llamar_tarea('aprobaciones') $$);
select cron.schedule('lokigi-bandeja',      '*/10 * * * *', $$ select llamar_tarea('bandeja') $$);
select cron.schedule('lokigi-supervisor',   '0 22 * * *',   $$ select llamar_tarea('supervisor') $$);
select cron.schedule('lokigi-postventa',    '0 12 1 * *',   $$ select llamar_tarea('postventa') $$);

-- El proyecto gratuito de Supabase se pausa tras 7 días sin actividad. Los
-- jobs de arriba ya la generan, pero si alguna vez se apagan todos, este
-- mantiene el proyecto vivo. Cuesta una consulta cada tres días.
select cron.schedule('lokigi-latido', '0 6 */3 * *', $$ select count(*) from leads $$);

-- Para ver qué corrió y cómo salió:
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select * from net._http_response order by created desc limit 20;
