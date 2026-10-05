-- partners_solicitudes.llamada_estado: añade 'no_presentado' (evento de
-- Cal.com «no presentación actualizada»). Idempotente.
alter table partners_solicitudes drop constraint if exists partners_solicitudes_llamada_estado_check;
alter table partners_solicitudes add constraint partners_solicitudes_llamada_estado_check
  check (llamada_estado in ('reservada', 'cancelada', 'no_presentado'));
