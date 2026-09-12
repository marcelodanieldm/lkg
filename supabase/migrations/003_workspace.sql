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
