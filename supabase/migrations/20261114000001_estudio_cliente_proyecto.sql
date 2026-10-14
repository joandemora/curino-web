-- =============================================================
-- Estudio Curino · datos del cliente en el proyecto (2026-10)
-- =============================================================
-- Cliente (nombre o empresa), NIF/CIF, dirección de facturación y dirección
-- del proyecto: se guardan en el proyecto al guardar un presupuesto y se
-- rellenan solos en cada presupuesto nuevo. Proyectos existentes: cliente =
-- nombre del proyecto sin «NN - » (lo que salía en «A la atención de»).
-- Idempotente.

alter table estudio_proyectos add column if not exists cliente_nombre text;
alter table estudio_proyectos add column if not exists cliente_nif text;
alter table estudio_proyectos add column if not exists cliente_direccion text;
alter table estudio_proyectos add column if not exists obra_direccion text;
update estudio_proyectos set cliente_nombre = regexp_replace(nombre, '^\d{1,4}\s*-\s*', '') where cliente_nombre is null;
