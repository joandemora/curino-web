-- =============================================================
-- Estudio Curino · varios presupuestos aceptados por proyecto
-- =============================================================
-- - Un proyecto puede tener varios aceptados (fases, extras): se quita el
--   índice único. Aceptar uno ya no rechaza los demás (estudio-ia/negocio.ts).
-- - Montaje por presupuesto: fecha prevista, montado, fecha real y nota.
--   Se trasladan los del proyecto a su presupuesto aceptado; si un proyecto
--   no tiene ninguno aceptado, se quedan en el proyecto (siguen saliendo en el
--   calendario). Las columnas del proyecto no se borran.
-- - Serie de numeración por usuario (Tarifa): siguiente número base
--   («Z2606942»); null = el siguiente al Z más alto del usuario.
-- La vista estudio_presupuesto_principal se conserva (abrir el presupuesto por
-- defecto); las métricas suman todos los aceptados.
-- Idempotente.

drop index if exists uq_estudio_presupuestos_aceptado;

alter table estudio_presupuestos add column if not exists montaje_previsto date;
alter table estudio_presupuestos add column if not exists montado boolean not null default false;
alter table estudio_presupuestos add column if not exists montado_at date;
alter table estudio_presupuestos add column if not exists montaje_nota text;

update estudio_presupuestos x
   set montaje_previsto = p.montaje_previsto, montado = coalesce(p.montado, false), montado_at = p.montado_at, montaje_nota = p.montaje_nota
  from estudio_proyectos p
 where x.proyecto_id = p.id and x.estado = 'aceptado'
   and x.montaje_previsto is null and not x.montado
   and (p.montaje_previsto is not null or p.montado or p.montado_at is not null);

alter table estudio_tarifas add column if not exists serie_presupuesto text;
