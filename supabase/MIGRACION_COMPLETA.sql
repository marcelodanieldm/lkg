-- 001_esquema.sql — El CRM de Lokigi en Postgres.
--
-- Traducción de las diez pestañas de Google Sheets a tablas reales. Lo que se
-- gana con el cambio:
--   · SQL sobre el corpus, que es lo único que hace posible el percentil.
--   · Restricciones que la planilla no podía imponer (ver `opt_out` más abajo).
--   · Índices: con 10.000 auditorías, Sheets se arrastra y Postgres ni se entera.
--
-- Lo que se pierde: la pestaña de aprobaciones como interfaz. Se reemplaza por
-- una pantalla en la app, que además permite editar el cuerpo antes de aprobar.
--
-- Correr en el editor SQL de Supabase, o con: supabase db push

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- Núcleo del embudo
-- ─────────────────────────────────────────────────────────────────────

do $$ begin
  create type etapa_lead as enum (
    'nuevo','auditado','contactado','respondio','interesado',
    'presupuestado','negociando','ganado','perdido','baja'
  );
exception
  when duplicate_object then null;
end $$;

create table leads (
  id              text primary key,              -- place_id de Google
  negocio         text not null,
  categoria       text,
  ciudad          text,
  pais            text default 'AR',
  direccion       text,
  telefono        text,
  email           text,
  sitio_web       text,
  maps_url        text,
  contacto_nombre text,

  etapa           etapa_lead not null default 'nuevo',
  motivo_perdida  text,
  score           int check (score between 0 and 100),
  potencial       int check (potencial between 0 and 100),
  percentil       int check (percentil between 0 and 100),
  score_ia        int check (score_ia between 0 and 100),
  prioridad       int default 0,

  toques          int not null default 0,
  ultimo_toque    timestamptz,
  proximo_toque   timestamptz,

  -- Una vez en true no vuelve a false. La restricción de abajo lo garantiza a
  -- nivel de base: ninguna ruta de la aplicación puede revertir una baja,
  -- ni siquiera por error de programación.
  opt_out         boolean not null default false,
  opt_out_fecha   timestamptz,
  opt_out_canal   text,

  informe_url     text,
  informe_visto   int default 0,
  origen_dato     text default 'google_places_publico',
  notas           text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index leads_etapa_idx     on leads (etapa) where opt_out = false;
create index leads_proximo_idx   on leads (proximo_toque) where opt_out = false;
create index leads_prioridad_idx on leads (prioridad desc);
create index leads_email_idx     on leads (lower(email)) where email is not null;

-- El disparador que hace irreversible la baja.
create or replace function proteger_opt_out() returns trigger
language plpgsql as $$
begin
  if old.opt_out = true and new.opt_out = false then
    raise exception 'La baja es irreversible: no se puede pasar opt_out de true a false (lead %)', old.id;
  end if;
  if new.opt_out = true and old.opt_out = false then
    new.opt_out_fecha := coalesce(new.opt_out_fecha, now());
    new.etapa := 'baja';
  end if;
  new.actualizado_en := now();
  return new;
end $$;

create trigger leads_proteger_opt_out before update on leads
  for each row execute function proteger_opt_out();

-- ─────────────────────────────────────────────────────────────────────
-- La cola de aprobación
-- ─────────────────────────────────────────────────────────────────────

create type decision_aprobacion as enum ('PENDIENTE','APROBADO','RECHAZADO');

create table aprobaciones (
  id            text primary key,                 -- huella del intento, idempotente
  lead_id       text references leads(id) on delete cascade,
  negocio       text,
  canal         text not null check (canal in ('email','whatsapp')),
  paso          int,
  destinatario  text not null,
  asunto        text,
  -- Editable antes de aprobar: se envía esta versión, no la original.
  cuerpo        text not null,
  cuerpo_original text,
  motivo        text,
  advertencias  text,
  decision      decision_aprobacion not null default 'PENDIENTE',
  decidido_en   timestamptz,
  enviado_en    timestamptz,
  resultado     text,
  creado_en     timestamptz not null default now()
);

create index aprobaciones_pendientes_idx on aprobaciones (creado_en)
  where decision = 'PENDIENTE';
create index aprobaciones_por_enviar_idx on aprobaciones (decidido_en)
  where decision = 'APROBADO' and enviado_en is null;

-- Guarda el texto original la primera vez que se edita, para poder comparar
-- después qué corrige Marcelo. Cada corrección es una señal para el prompt.
create or replace function guardar_cuerpo_original() returns trigger
language plpgsql as $$
begin
  if new.cuerpo is distinct from old.cuerpo and old.cuerpo_original is null then
    new.cuerpo_original := old.cuerpo;
  end if;
  if new.decision is distinct from old.decision and new.decision <> 'PENDIENTE' then
    new.decidido_en := coalesce(new.decidido_en, now());
  end if;
  return new;
end $$;

create trigger aprobaciones_original before update on aprobaciones
  for each row execute function guardar_cuerpo_original();

-- ─────────────────────────────────────────────────────────────────────
-- Registro inmutable
-- ─────────────────────────────────────────────────────────────────────

create table mensajes (
  id            text primary key,
  lead_id       text references leads(id) on delete cascade,
  direccion     text not null check (direccion in ('saliente','entrante')),
  canal         text not null check (canal in ('email','whatsapp','llamada')),
  paso          int,
  asunto        text,
  cuerpo        text,
  proveedor_id  text,
  estado        text,
  objecion      text,
  agente        text,
  aprobado_por  text check (aprobado_por in ('guardian','humano')),
  costo_usd     numeric(10,5) default 0,
  creado_en     timestamptz not null default now()
);

create index mensajes_lead_idx  on mensajes (lead_id, creado_en desc);
create index mensajes_dia_idx   on mensajes (creado_en desc) where direccion = 'saliente';
create index mensajes_paso_idx  on mensajes (lead_id, paso) where direccion = 'saliente';

-- Append-only de verdad: no se puede editar ni borrar lo que ya se dijo.
create rule mensajes_no_update as on update to mensajes do instead nothing;
create rule mensajes_no_delete as on delete to mensajes do instead nothing;

-- ─────────────────────────────────────────────────────────────────────
-- Cumplimiento
-- ─────────────────────────────────────────────────────────────────────

create table supresiones (
  valor     text not null,
  tipo      text not null check (tipo in ('email','telefono','dominio')),
  motivo    text,
  origen    text,
  creado_en timestamptz not null default now(),
  primary key (valor, tipo)
);

create index supresiones_valor_idx on supresiones (lower(valor));

-- Tampoco se borra: quitar a alguien de la lista negra es volver a escribirle.
create rule supresiones_no_delete as on delete to supresiones do instead nothing;

-- ─────────────────────────────────────────────────────────────────────
-- El activo: el corpus
-- ─────────────────────────────────────────────────────────────────────

create table corpus (
  id              uuid primary key default gen_random_uuid(),
  place_id        text not null,
  categoria       text,
  ciudad          text,
  pais            text default 'AR',
  score           int not null,
  potencial       int,
  cobertura       int,
  d_fundamentos   int,
  d_reputacion    int,
  d_visual        int,
  d_actividad     int,
  d_conversion    int,
  d_presencia     int,
  resenas         int,
  rating          numeric(2,1),
  fotos           int,
  score_ia        int,
  menciones_ia    int,
  version_rubrica text not null,
  creado_en       timestamptz not null default now()
);

-- El índice que hace barato el percentil.
create index corpus_rubro_idx on corpus (lower(categoria), lower(ciudad), score);
create index corpus_fecha_idx on corpus (creado_en desc);

-- El percentil como función de base de datos: una sola ida y vuelta en vez de
-- traerse el corpus entero a la función serverless.
create or replace function percentil_rubro(
  p_score int, p_categoria text, p_ciudad text default null, p_minimo int default 30
) returns table (percentil int, muestra int, alcance text)
language plpgsql stable as $$
declare v_n int;
begin
  -- Capa 1: categoría + ciudad
  if p_ciudad is not null then
    select count(*) into v_n from corpus
      where lower(categoria) = lower(p_categoria) and lower(ciudad) = lower(p_ciudad);
    if v_n >= p_minimo then
      return query
        select (100.0 * count(*) filter (where score < p_score) / count(*))::int,
               count(*)::int, (p_categoria || ' en ' || p_ciudad)
        from corpus where lower(categoria) = lower(p_categoria) and lower(ciudad) = lower(p_ciudad);
      return;
    end if;
  end if;

  -- Capa 2: solo categoría
  select count(*) into v_n from corpus where lower(categoria) = lower(p_categoria);
  if v_n >= p_minimo then
    return query
      select (100.0 * count(*) filter (where score < p_score) / count(*))::int,
             count(*)::int, p_categoria
      from corpus where lower(categoria) = lower(p_categoria);
    return;
  end if;

  -- Sin muestra suficiente se devuelve vacío. Un percentil calculado sobre
  -- ocho perfiles es peor que no decir nada.
  return;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- Clientes, tareas, operación
-- ─────────────────────────────────────────────────────────────────────

create table clientes (
  id             uuid primary key default gen_random_uuid(),
  lead_id        text not null unique references leads(id),
  plan           text not null check (plan in ('esencial','crecimiento','dominio','setup_unico')),
  moneda         text default 'ARS',
  setup          numeric(12,2),
  mensual        numeric(12,2),
  dia_cobro      int default 1,
  metodo_pago    text,
  suscripcion_id text,
  score_inicial  int,
  score_objetivo int,
  gbp_acceso     boolean default false,
  nps            int check (nps between 0 and 10),
  alta_en        timestamptz not null default now(),
  baja_en        timestamptz,
  motivo_baja    text
);

create table tareas (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete cascade,
  lead_id    text references leads(id) on delete cascade,
  servicio   text,
  titulo     text not null,
  detalle    text,
  horas_est  numeric(4,1),
  vence_en   date,
  estado     text not null default 'pendiente'
             check (estado in ('pendiente','en_curso','hecho','bloqueada')),
  hecho_en   timestamptz,
  creado_en  timestamptz not null default now()
);

create index tareas_pendientes_idx on tareas (vence_en) where estado in ('pendiente','en_curso');

-- Config: lo que Marcelo cambia sin desplegar.
create table config (
  clave text primary key,
  valor text,
  nota  text
);

insert into config (clave, valor, nota) values
  ('modo_autonomia','aprobacion','aprobacion | auto_con_excepciones | auto'),
  ('envios_aprobados_para_auto','50','Envíos revisados a mano antes de pasar a automático'),
  ('cupo_diario_email','25','Tope de correos en frío por día. Google permite más; la reputación no.'),
  ('cupo_diario_whatsapp','20',''),
  ('horario_desde','9',''),
  ('horario_hasta','18',''),
  ('dias_habiles','1,2,3,4,5',''),
  ('horas_min_entre_toques','48',''),
  ('max_toques','4','Después de esto se cierra el ciclo'),
  ('presupuesto_api_mes_usd','40',''),
  ('zona_horaria','America/Argentina/Buenos_Aires',''),
  ('dia_inicio_calentamiento','','Fecha ISO del primer envío; la rampa se calcula desde acá'),
  ('pausa_general','FALSE','TRUE frena TODOS los envíos al instante'),
  ('auditorias_por_corrida','25',''),
  ('nicho','gastronomía','Rubro de prospección');

create table metricas (
  fecha                 date primary key,
  auditorias            int default 0,
  enviados_email        int default 0,
  enviados_wa           int default 0,
  bloqueados            int default 0,
  diferidos             int default 0,
  pendientes_aprobacion int default 0,
  respuestas            int default 0,
  bajas                 int default 0,
  informes_abiertos     int default 0,
  leads_nuevos          int default 0,
  costo_api_usd         numeric(10,4) default 0,
  mrr                   numeric(12,2) default 0
);

create table bitacora (
  id        bigserial primary key,
  agente    text,
  accion    text,
  lead_id   text,
  decision  text,
  razon     text,
  confianza numeric(3,2),
  costo_usd numeric(10,5) default 0,
  creado_en timestamptz not null default now()
);

create index bitacora_fecha_idx on bitacora (creado_en desc);
create index bitacora_lead_idx  on bitacora (lead_id, creado_en desc);
create index bitacora_dec_idx   on bitacora (decision, creado_en desc);

-- ─────────────────────────────────────────────────────────────────────
-- Vistas para el panel
-- ─────────────────────────────────────────────────────────────────────

create view v_embudo as
select etapa, count(*) as cantidad, round(avg(score), 1) as score_promedio
from leads where opt_out = false group by etapa;

create view v_cola_hoy as
select l.id, l.negocio, l.etapa, l.toques, l.proximo_toque, l.email, l.score, l.percentil
from leads l
where l.opt_out = false
  and l.etapa not in ('ganado','perdido','baja')
  and l.email is not null
  and (l.proximo_toque is null or l.proximo_toque <= now())
order by l.prioridad desc nulls last, l.proximo_toque asc nulls first;

create view v_mrr as
select count(*) as clientes_activos,
       coalesce(sum(mensual), 0) as mrr,
       round(coalesce(avg(mensual), 0), 2) as ticket_promedio
from clientes where baja_en is null;
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
-- 003_workspace.sql — Lo que hace falta para enganchar Google Workspace.
--
-- Decisión que ordena todo este archivo: **Supabase manda, Workspace espeja.**
-- Postgres es donde vive la verdad porque es donde están las garantías que la
-- planilla no puede dar: la baja irreversible, los mensajes que no se editan,
-- la lista de supresión que no se borra, el percentil en SQL. Sheets, Docs,
-- Drive y Calendar son superficies de trabajo: se escriben desde acá y se leen
-- a mano, pero nada de lo que pase en ellas puede cambiar el estado del
-- sistema.
--
-- Consecuencia práctica que conviene tener clara: si borrás una fila en la
-- planilla espejo, no pasa nada. El espejo se rehace entero cada noche.

-- ─────────────────────────────────────────────────────────────────────
-- Referencias a los documentos de Workspace
-- ─────────────────────────────────────────────────────────────────────
-- Se guardan las URLs, no los archivos. El archivo vive en Drive; acá queda
-- el puntero para poder abrirlo desde el panel y para saber qué ya se generó
-- (que es lo que evita crear el mismo documento dos veces).

alter table leads
  add column if not exists doc_propuesta_url text,
  add column if not exists drive_informe_url text,
  add column if not exists evento_url        text,
  add column if not exists agendado_en       timestamptz;

-- ─────────────────────────────────────────────────────────────────────
-- Propuestas: la cotización que se mandó, congelada
-- ─────────────────────────────────────────────────────────────────────
-- El motor de cotización es determinista, pero los precios del catálogo
-- cambian. Si dentro de seis meses un cliente pregunta "¿por qué me cobraste
-- esto?", hace falta el número que se le dijo ese día, no el que devolvería
-- el motor hoy. Por eso se guarda el JSON completo del plan.

create table if not exists propuestas (
  id            uuid primary key default gen_random_uuid(),
  lead_id       text not null references leads(id) on delete cascade,
  nivel         text not null check (nivel in ('esencial','crecimiento','dominio')),
  moneda        text not null default 'ARS',
  setup         numeric(12,2),
  mensual       numeric(12,2),
  -- El plan entero tal como se calculó: servicios, argumentos, alternativas.
  plan          jsonb not null,
  doc_id        text,
  doc_url       text,
  enviada_en    timestamptz,
  aceptada_en   timestamptz,
  rechazada_en  timestamptz,
  motivo_rechazo text,
  version_rubrica text,
  creado_en     timestamptz not null default now()
);

create index if not exists propuestas_lead_idx on propuestas (lead_id, creado_en desc);

-- Igual que los mensajes: una propuesta enviada es un hecho, no un borrador.
-- Se puede marcar aceptada o rechazada; no se puede reescribir el precio.
create or replace function proteger_propuesta_enviada() returns trigger
language plpgsql as $$
begin
  if old.enviada_en is not null
     and (new.plan is distinct from old.plan
          or new.setup is distinct from old.setup
          or new.mensual is distinct from old.mensual) then
    raise exception 'La propuesta % ya se envió: no se puede cambiar el precio ni el plan. Creá una nueva.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists propuestas_congelar on propuestas;
create trigger propuestas_congelar before update on propuestas
  for each row execute function proteger_propuesta_enviada();

-- ─────────────────────────────────────────────────────────────────────
-- El informe, guardado tal como se le mostró al prospecto
-- ─────────────────────────────────────────────────────────────────────
-- Se guarda el HTML renderizado, no los datos para volver a renderizarlo.
--
-- La alternativa era recalcular la auditoría cada vez que alguien abre el
-- enlace, y tiene dos problemas. Uno: cada apertura costaría una llamada a la
-- API de Places. Dos, y más serio: el negocio puede haber cambiado entre que
-- se mandó el correo y que lo abrieron, así que el número que verían no sería
-- el número del que habla el correo. Un informe es una foto de un momento; si
-- cambia solo, deja de ser un argumento.
--
-- Postgres comprime las columnas de texto largas sin que uno haga nada, así
-- que un informe de ~30 KB ocupa alrededor de 6 KB en disco.

create table if not exists informes (
  lead_id     text primary key references leads(id) on delete cascade,
  html        text not null,
  score       int,
  version_rubrica text,
  creado_en   timestamptz not null default now()
);

-- El prospecto no tiene sesión: necesita poder leer su propio informe y
-- ninguno más. Se expone por función, nunca abriendo la tabla.
alter table informes enable row level security;

create or replace function informe_html(p_lead_id text)
returns text language sql security definer stable
set search_path = public
as $$
  select i.html from informes i
    join leads l on l.id = i.lead_id
   where i.lead_id = p_lead_id
     -- Si pidió la baja, el enlace deja de servir. Es coherente con lo que
     -- dice el correo: "se procesa al instante y de forma definitiva".
     and l.opt_out = false
$$;

revoke all on function informe_html(text) from public;
grant execute on function informe_html(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- El toque, incrementado donde corresponde
-- ─────────────────────────────────────────────────────────────────────
-- Dos tareas programadas pueden tocar el mismo lead en la misma corrida. Un
-- leer-sumar-guardar desde la función serverless perdería uno de los dos
-- incrementos, y perder un toque significa escribirle de más a alguien: es
-- justamente lo que el tope de la secuencia existe para impedir.
--
-- Acá el incremento es atómico porque `update ... set toques = toques + 1`
-- toma el lock de la fila.

create or replace function registrar_toque(
  p_lead_id text, p_proximo timestamptz default null
) returns int
language plpgsql security definer set search_path = public as $$
declare v_toques int;
begin
  update leads
     set toques        = toques + 1,
         ultimo_toque  = now(),
         proximo_toque = p_proximo,
         etapa         = case when etapa in ('nuevo','auditado') then 'contactado'::etapa_lead else etapa end
   where id = p_lead_id
     -- Si pidió la baja entre que se aprobó el mensaje y este momento, el
     -- toque no se registra. La fila no se toca y devuelve null.
     and opt_out = false
  returning toques into v_toques;

  return v_toques;
end $$;

revoke all on function registrar_toque(text, timestamptz) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Lo que lee el espejo de Sheets
-- ─────────────────────────────────────────────────────────────────────
-- Vistas planas, ya formateadas para volcar en una planilla. La idea es que la
-- tarea `espejo` no tenga que armar nada: lee, y escribe la grilla tal cual.

create or replace view v_espejo_leads as
select l.id                                   as place_id,
       l.negocio, l.categoria, l.ciudad,
       l.etapa::text                          as etapa,
       l.score, l.potencial, l.percentil, l.prioridad,
       l.email, l.telefono, l.sitio_web,
       l.toques,
       to_char(l.ultimo_toque  at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') as ultimo_toque,
       to_char(l.proximo_toque at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')         as proximo_toque,
       l.informe_url, l.informe_visto,
       l.doc_propuesta_url, l.evento_url,
       case when l.opt_out then 'SÍ' else '' end as dado_de_baja,
       to_char(l.creado_en at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as creado
from leads l
order by l.prioridad desc nulls last, l.creado_en desc;

create or replace view v_espejo_actividad as
select to_char(m.creado_en at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI') as cuando,
       m.direccion, m.canal, coalesce(l.negocio, m.lead_id) as negocio,
       m.paso, m.asunto, m.estado, m.objecion, m.agente, m.aprobado_por,
       round(m.costo_usd, 4) as costo_usd
from mensajes m left join leads l on l.id = m.lead_id
order by m.creado_en desc
limit 2000;

-- El corpus agregado: esto es el activo del negocio y lo que más sentido tiene
-- mirar en una planilla, porque invita a hacer tablas dinámicas.
create or replace view v_espejo_benchmarks as
select categoria, ciudad,
       count(*)                                            as auditados,
       round(avg(score), 1)                                as score_promedio,
       percentile_cont(0.5) within group (order by score)::int as mediana,
       percentile_cont(0.9) within group (order by score)::int as top_10,
       round(avg(d_reputacion), 1)                         as reputacion,
       round(avg(d_visual), 1)                             as visual,
       round(avg(d_conversion), 1)                         as conversion,
       round(avg(resenas), 0)                              as resenas_promedio,
       round(avg(rating), 2)                               as rating_promedio
from corpus
group by categoria, ciudad
having count(*) >= 5
order by count(*) desc;

-- ─────────────────────────────────────────────────────────────────────
-- El espejo, programado
-- ─────────────────────────────────────────────────────────────────────
-- Una vez por noche. No hace falta más: la planilla es para mirar, no para
-- operar. Operar se hace en el panel, que lee Postgres directo y siempre está
-- al día.

select cron.schedule(
  'lokigi-espejo',
  '0 5 * * *',                      -- 02:00 en Argentina
  $$ select llamar_tarea('espejo') $$
);

-- ─────────────────────────────────────────────────────────────────────
-- Config nueva
-- ─────────────────────────────────────────────────────────────────────
-- `sheets_espejo_id` se llena solo en la primera corrida del espejo. Si borrás
-- esa fila, la próxima corrida crea una planilla nueva — que es la forma de
-- empezar de cero si la arruinaste sin querer.

insert into config (clave, valor, nota) values
  ('sheets_espejo_id',        '',    'Se completa solo. Borrar esta fila crea una planilla nueva.'),
  ('sheets_espejo_url',       '',    'Enlace al tablero espejo'),
  ('drive_carpeta_informes',  '',    'Id de carpeta de Drive. Vacío = se crea "Lokigi — informes"'),
  ('drive_carpeta_propuestas','',    'Id de carpeta de Drive para las propuestas'),
  ('calendar_id',             'primary', 'Calendario donde se agendan las llamadas'),
  ('moneda',                  'ars', 'ars | usd — moneda en la que se cotiza'),
  ('tipo_cambio',             '',    'ARS por USD. Obligatorio si moneda=ars. Actualizalo a mano.'),
  ('tarifa_hora_usd',         '22',  'Tu costo/hora objetivo. Define el margen de cada plan.')
on conflict (clave) do nothing;
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
-- 005_seguimiento.sql - Programacion de la tarea de seguimiento de la secuencia.
--
-- La tarea de seguimiento envia los pasos 2, 3 y 4 de la secuencia de
-- prospeccion a los leads cuya fecha de proximo toque haya vencido.
--
-- POR QUE A LAS 13:00 UTC (10:00 hora de Argentina):
-- Correr seguimiento a la misma hora que prospeccion (11:00 UTC) crea una
-- condicion de carrera sobre el contador de cupo_diario del guardian: ambas
-- tareas leen el gasto enviado antes de registrar sus mensajes, dejando pasar
-- mas toques de los autorizados y superando el cupo diario de calentamiento.
-- Separandolas dos horas, prospeccion completa sus envios y seguimiento evalua
-- el cupo real disponible para los toques posteriores.

select cron.schedule('lokigi-seguimiento', '0 13 * * 1-5', $$ select llamar_tarea('seguimiento') $$);

-- ─────────────────────────────────────────────────────────────────────
-- 008_retencion.sql — Mecanismo de retención e informes mensuales
-- ─────────────────────────────────────────────────────────────────────

create table if not exists historial_clientes (
  id text primary key,
  lead_id text not null references leads(id) on delete cascade,
  score int not null,
  posicion int,
  total_competidores int,
  auditado_json jsonb,
  barrido_id text references barridos(id) on delete set null,
  diagnostico_caida text check (diagnostico_caida in ('cliente_perdio_terreno', 'competidor_avanzo', 'cambio_perfil', 'sin_cambio')),
  es_primera_medicion boolean default false,
  creado_en timestamptz not null default now()
);

create table if not exists alertas_operador (
  id text primary key,
  lead_id text references leads(id) on delete cascade,
  tipo text not null check (tipo in ('salto_competidor', 'nuevo_competidor', 'caida_rating_cliente')),
  detalle jsonb not null,
  enviado boolean default false,
  creado_en timestamptz not null default now()
);

create index if not exists idx_historial_clientes_lead on historial_clientes (lead_id, creado_en desc);
create index if not exists idx_alertas_operador_enviado on alertas_operador (enviado, creado_en);

alter table historial_clientes enable row level security;
alter table alertas_operador enable row level security;

insert into config (clave, valor, nota) values
  ('dia_informe_cliente', '26', 'Día del mes para el informe de retención a clientes'),
  ('alerta_salto_score_pts', '10', 'Puntos de salto de score de un competidor para alertar al operador')
on conflict (clave) do nothing;

select cron.schedule('lokigi-informe-cliente', '0 15 26 * *', $$ select llamar_tarea('informe_cliente') $$);

