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

create table if not exists leads (
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

create index if not exists leads_etapa_idx     on leads (etapa) where opt_out = false;
create index if not exists leads_proximo_idx   on leads (proximo_toque) where opt_out = false;
create index if not exists leads_prioridad_idx on leads (prioridad desc);
create index if not exists leads_email_idx     on leads (lower(email)) where email is not null;

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

drop trigger if exists leads_proteger_opt_out on leads;
create trigger leads_proteger_opt_out before update on leads
  for each row execute function proteger_opt_out();

-- ─────────────────────────────────────────────────────────────────────
-- La cola de aprobación
-- ─────────────────────────────────────────────────────────────────────

do $$ begin
  create type decision_aprobacion as enum ('PENDIENTE','APROBADO','RECHAZADO');
exception
  when duplicate_object then null;
end $$;

create table if not exists aprobaciones (
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

create index if not exists aprobaciones_pendientes_idx on aprobaciones (creado_en)
  where decision = 'PENDIENTE';
create index if not exists aprobaciones_por_enviar_idx on aprobaciones (decidido_en)
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

drop trigger if exists aprobaciones_original on aprobaciones;
create trigger aprobaciones_original before update on aprobaciones
  for each row execute function guardar_cuerpo_original();

-- ─────────────────────────────────────────────────────────────────────
-- Registro inmutable
-- ─────────────────────────────────────────────────────────────────────

create table if not exists mensajes (
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

create index if not exists mensajes_lead_idx  on mensajes (lead_id, creado_en desc);
create index if not exists mensajes_dia_idx   on mensajes (creado_en desc) where direccion = 'saliente';
create index if not exists mensajes_paso_idx  on mensajes (lead_id, paso) where direccion = 'saliente';

-- Append-only de verdad: no se puede editar ni borrar lo que ya se dijo.
do $$ begin
  create rule mensajes_no_update as on update to mensajes do instead nothing;
  create rule mensajes_no_delete as on delete to mensajes do instead nothing;
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- Cumplimiento
-- ─────────────────────────────────────────────────────────────────────

create table if not exists supresiones (
  valor     text not null,
  tipo      text not null check (tipo in ('email','telefono','dominio')),
  motivo    text,
  origen    text,
  creado_en timestamptz not null default now(),
  primary key (valor, tipo)
);

create index if not exists supresiones_valor_idx on supresiones (lower(valor));

-- Tampoco se borra: quitar a alguien de la lista negra es volver a escribirle.
do $$ begin
  create rule supresiones_no_delete as on delete to supresiones do instead nothing;
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- El activo: el corpus
-- ─────────────────────────────────────────────────────────────────────

create table if not exists corpus (
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
create index if not exists corpus_rubro_idx on corpus (lower(categoria), lower(ciudad), score);
create index if not exists corpus_fecha_idx on corpus (creado_en desc);

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

  -- Sin muestra suficiente se devuelve vacío. Un percentil calculated sobre
  -- ocho perfiles es peor que no decir nada.
  return;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- Clientes, tareas, operación
-- ─────────────────────────────────────────────────────────────────────

create table if not exists clientes (
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

create table if not exists tareas (
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

create index if not exists tareas_pendientes_idx on tareas (vence_en) where estado in ('pendiente','en_curso');

-- Config: lo que Marcelo cambia sin desplegar.
create table if not exists config (
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
  ('nicho','gastronomía','Rubro de prospección')
on conflict (clave) do nothing;

create table if not exists metricas (
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

create table if not exists bitacora (
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

create index if not exists bitacora_fecha_idx on bitacora (creado_en desc);
create index if not exists bitacora_lead_idx  on bitacora (lead_id, creado_en desc);
create index if not exists bitacora_dec_idx   on bitacora (decision, creado_en desc);

-- ─────────────────────────────────────────────────────────────────────
-- Vistas para el panel
-- ─────────────────────────────────────────────────────────────────────

create or replace view v_embudo as
select etapa, count(*) as cantidad, round(avg(score), 1) as score_promedio
from leads where opt_out = false group by etapa;

create or replace view v_cola_hoy as
select l.id, l.negocio, l.etapa, l.toques, l.proximo_toque, l.email, l.score, l.percentil
from leads l
where l.opt_out = false
  and l.etapa not in ('ganado','perdido','baja')
  and l.email is not null
  and (l.proximo_toque is null or l.proximo_toque <= now())
order by l.prioridad desc nulls last, l.proximo_toque asc nulls first;

create or replace view v_mrr as
select count(*) as clientes_activos,
       coalesce(sum(mensual), 0) as mrr,
       round(coalesce(avg(mensual), 0), 2) as ticket_promedio
from clientes where baja_en is null;

