-- =============================================================
-- partners_solicitudes.inicio: admite 'octubre' (2026-10)
-- =============================================================
-- La pregunta 4 del formulario pasó a «Ya, en el intensivo de octubre»
-- (valor 'octubre') y el check solo admitía 'noviembre': la respuesta no se
-- guardaba y la solicitud no se completaba. 'noviembre' se mantiene para
-- las filas antiguas. Idempotente.
alter table partners_solicitudes drop constraint if exists partners_solicitudes_inicio_check;
alter table partners_solicitudes add constraint partners_solicitudes_inicio_check
  check (inicio in ('octubre', 'noviembre', 'proximos_meses', 'informandome'));
