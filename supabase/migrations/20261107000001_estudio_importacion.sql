-- =============================================================
-- Estudio Curino · importación del histórico de proyectos (2026-10)
-- =============================================================
-- - estudio_ficheros.tipo admite 'plano' (planos y medidas).
-- - estudio_accesos.max_fichero_mb: tamaño máximo por archivo para ese
--   usuario (null = 20 MB). La cuenta propia de Juan sube hasta 250 MB.
-- - Bucket «estudio»: límite técnico 250 MB; el de 20 MB por archivo lo
--   sigue aplicando estudio-ia a todos los demás.
-- - Presupuestos importados: estudio_presupuestos.datos = { importado: true,
--   numero, fecha, archivo } con importe leído del PDF/Excel original; no
--   son editables (el editor los trata como «sin presupuesto generado»).
-- Idempotente.

alter table estudio_ficheros drop constraint if exists estudio_ficheros_tipo_check;
alter table estudio_ficheros add constraint estudio_ficheros_tipo_check
  check (tipo in ('factura_proveedor', 'presupuesto_proveedor', 'factura_cliente', 'foto_obra', 'plano', 'otro'));

alter table estudio_accesos add column if not exists max_fichero_mb int check (max_fichero_mb is null or max_fichero_mb between 1 and 250);

update storage.buckets set file_size_limit = 262144000 where id = 'estudio';
