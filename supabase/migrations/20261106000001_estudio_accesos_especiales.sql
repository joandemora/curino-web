-- =============================================================
-- Estudio Curino · accesos especiales por usuario (2026-10)
-- =============================================================
-- Para la cuenta propia de Juan (sistemacurino@gmail.com) y casos similares:
-- - ilimitado: sin tope de créditos (el consumo se sigue registrando en
--   estudio_uso, pero nunca devuelve 402 ni descuenta saldo).
-- - almacenamiento_mb: cuota propia (null = estudio_config.almacenamiento_mb).
-- - emisor_curino: emite presupuestos como SISTEMA & CURINO SLU igual que el
--   admin (plantilla PLANTILLA_ADMIN, sin el bloqueo de datos de Curino).
-- Acceso permanente = concedido sin acceso_hasta ni compras (ya lo era).
-- Idempotente.

alter table estudio_accesos add column if not exists ilimitado boolean not null default false;
alter table estudio_accesos add column if not exists almacenamiento_mb int check (almacenamiento_mb is null or almacenamiento_mb between 10 and 1048576);
alter table estudio_accesos add column if not exists emisor_curino boolean not null default false;
