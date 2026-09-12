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
