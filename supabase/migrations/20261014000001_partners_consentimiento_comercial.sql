-- =============================================================
-- partners_solicitudes.consentimiento_comercial
-- =============================================================
-- Casilla nueva del formulario (2026-10): «Acepto que Curino contacte
-- conmigo por email y WhatsApp sobre mi solicitud y sobre sus formaciones.
-- Puedo darme de baja en cualquier momento.» Solo las solicitudes con esta
-- marca entran en la secuencia de partners-seguimiento. Las anteriores
-- (casilla «para valorar mi caso») quedan en false y no reciben emails.
-- Idempotente.
alter table partners_solicitudes add column if not exists consentimiento_comercial boolean not null default false;
