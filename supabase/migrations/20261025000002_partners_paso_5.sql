-- partners_solicitudes.paso_alcanzado: el formulario tiene 5 pasos desde la
-- pregunta de inversion (2026-10). El check solo admitia hasta 4 y el paso 5
-- no se guardaba. Idempotente.
alter table partners_solicitudes drop constraint if exists partners_solicitudes_paso_alcanzado_check;
alter table partners_solicitudes add constraint partners_solicitudes_paso_alcanzado_check
  check (paso_alcanzado >= 0 and paso_alcanzado <= 5);
