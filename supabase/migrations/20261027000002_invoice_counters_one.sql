-- invoice_counters: admite las series del One-to-one ('one' → ONE,
-- 'one_rect' → R-ONE). Idempotente.
alter table invoice_counters drop constraint if exists invoice_counters_invoice_type_check;
alter table invoice_counters add constraint invoice_counters_invoice_type_check
  check (invoice_type in ('simplified', 'auto_invoice', 'magazine', 'armario', 'clase', 'curso', 'clase_rect', 'sesion', 'sesion_rect', 'one', 'one_rect'));
