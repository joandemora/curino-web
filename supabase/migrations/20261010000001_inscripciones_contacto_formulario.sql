-- =============================================================
-- inscripciones: email y telefono del formulario como referencia
-- =============================================================
-- Desde 2026-10 el email y el telefono de la inscripcion son los que el
-- comprador confirma en Stripe Checkout (customer_details.email / .phone):
-- se usan para la factura y los emails. Los del formulario de /partners
-- se guardan aqui solo como referencia (telefono_formulario solo si
-- difiere del de Checkout).
--
-- Idempotente.

alter table inscripciones add column if not exists email_formulario text;
alter table inscripciones add column if not exists telefono_formulario text;
