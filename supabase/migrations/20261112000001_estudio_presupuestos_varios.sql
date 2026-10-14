-- =============================================================
-- Estudio Curino · varios presupuestos por proyecto (2026-10)
-- =============================================================
-- - estudio_presupuestos pasa a tener id propio (antes, uno por proyecto con
--   proyecto_id como clave). Ninguno se borra ni se sobrescribe: «Duplicar»
--   crea Z…-B, -C…; solo uno «aceptado» por proyecto (índice único parcial).
-- - numero (copia de datos.numero) y comision_importe (comisión del
--   interiorista que cuenta como coste cuando el cliente paga el PVP).
-- - Vista estudio_presupuesto_principal: el aceptado o, si no hay, el último
--   modificado de cada proyecto (métricas, «Mi negocio», tarjetas, cobros).
-- - estudio_documentos.presupuesto_id y variante (cliente / interiorista).
-- Idempotente.

alter table estudio_presupuestos add column if not exists id uuid not null default gen_random_uuid();
alter table estudio_presupuestos add column if not exists numero text;
alter table estudio_presupuestos add column if not exists comision_importe numeric(12,2);
update estudio_presupuestos set numero = nullif(datos->>'numero', '') where numero is null;

do $$
begin
  if exists (select 1 from pg_constraint c where c.conrelid = 'estudio_presupuestos'::regclass and c.contype = 'p'
             and pg_get_constraintdef(c.oid) like '%(proyecto_id)%') then
    execute (select format('alter table estudio_presupuestos drop constraint %I', conname) from pg_constraint
              where conrelid = 'estudio_presupuestos'::regclass and contype = 'p');
    alter table estudio_presupuestos add primary key (id);
  end if;
end $$;

create index if not exists idx_estudio_presupuestos_proyecto on estudio_presupuestos(proyecto_id, updated_at desc);
create unique index if not exists uq_estudio_presupuestos_aceptado on estudio_presupuestos(proyecto_id) where estado = 'aceptado';

create or replace view estudio_presupuesto_principal with (security_invoker = true) as
  select distinct on (proyecto_id) *
    from estudio_presupuestos
   order by proyecto_id, (estado = 'aceptado') desc, updated_at desc;
grant select on estudio_presupuesto_principal to authenticated, service_role;

alter table estudio_documentos add column if not exists presupuesto_id uuid references estudio_presupuestos(id) on delete set null;
alter table estudio_documentos add column if not exists variante text check (variante is null or variante in ('cliente', 'interiorista'));
