-- =============================================================
-- Permitir pedidos a 0€ en armario_orders (cupones 100% descuento)
-- =============================================================
-- La migración H2 (20260526_armario_orders.sql) definió
--   amount_total_cents integer not null check (amount_total_cents > 0)
-- Esto rechaza INSERTs con valor 0, que son LEGÍTIMOS cuando un cliente
-- aplica un código promocional de 100% de descuento en Stripe Checkout
-- (Stripe completa la sesión con amount_total=0 y
-- payment_status='no_payment_required').
--
-- Cambiamos el check a >= 0. El handler stripe-webhook valida por
-- separado que session.payment_status sea 'paid' o 'no_payment_required'
-- antes de aceptar la inserción, así que la base de datos solo necesita
-- impedir importes negativos.
--
-- Idempotente: el DROP solo se ejecuta si el constraint con el nombre
-- por defecto existe; el ADD recrea con la nueva semántica.

alter table armario_orders
  drop constraint if exists armario_orders_amount_total_cents_check;

alter table armario_orders
  add constraint armario_orders_amount_total_cents_check
  check (amount_total_cents >= 0);
