-- =============================================================
-- Estudio Curino · fecha de montaje y calendario (2026-10)
-- =============================================================
-- estudio_proyectos.montaje_previsto (obligatoria al aceptar: estudio-ia
-- presupuesto_estado la exige), montado + montado_at (fecha real) y
-- montaje_nota. Histórico de la cuenta propia: los aceptados cobrados al
-- 100 % quedan «montado (histórico)» sin fecha real (no se inventan fechas).
-- Idempotente.

alter table estudio_proyectos add column if not exists montaje_previsto date;
alter table estudio_proyectos add column if not exists montado boolean not null default false;
alter table estudio_proyectos add column if not exists montado_at date;
alter table estudio_proyectos add column if not exists montaje_nota text;

update estudio_proyectos y set montado = true, montaje_nota = 'montado (histórico)'
 where y.user_id = (select id from auth.users where lower(email) = 'sistemacurino@gmail.com')
   and not y.montado
   and exists (select 1 from estudio_presupuestos p where p.proyecto_id = y.id and p.estado = 'aceptado')
   and exists (select 1 from estudio_cobros c where c.proyecto_id = y.id)
   and not exists (select 1 from estudio_cobros c where c.proyecto_id = y.id and not c.cobrado);
