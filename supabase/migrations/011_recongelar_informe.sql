-- 011_recongelar_informe.sql — Ascenso de la muestra al análisis completo al recongelar el informe.
--
-- INVARIANTE CRÍTICO:
-- Al recongelar un informe cuando se ejecuta un barrido completo, la versión previa
-- del HTML congelado NUNCA se pisa silenciosamente: se guarda en `html_anterior`.
-- El puntaje y todas las cifras de la auditoría se mantienen byte a byte idénticos,
-- sustituyendo únicamente la sección de competencia con los datos completos.

alter table informes
  add column if not exists html_anterior  text,
  add column if not exists actualizado_en timestamptz;

-- Disparador determinista: respalda el HTML previo si new.html cambia.
create or replace function guardar_informe_anterior() returns trigger
language plpgsql as $$
begin
  if new.html is distinct from old.html and old.html is not null then
    new.html_anterior := coalesce(old.html_anterior, old.html);
    new.actualizado_en := now();
  end if;
  return new;
end $$;

drop trigger if exists informes_anterior on informes;
create trigger informes_anterior before update on informes
  for each row execute function guardar_informe_anterior();
