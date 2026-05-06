-- =============================================================
-- Fase D — Schema defensivo de marketplace_orders
-- =============================================================
-- El webhook stripe-webhook (handleCheckoutCompleted) persiste filas en
-- marketplace_orders con columnas que pueden no existir aún en BD si la
-- secuencia de fases A v2 + B Bloque 1 + D no añadió todas las que la
-- function escribe. Este script es idempotente: usa IF NOT EXISTS y solo
-- aplica los cambios que falten.
--
-- Joan: ejecuta este SQL en Studio antes de procesar el primer
-- checkout.session.completed real.

-- 1. Columnas nuevas escritas por el webhook
alter table marketplace_orders
  add column if not exists base_cents integer,
  add column if not exists tax_country text,
  add column if not exists commission_cents integer;

-- 2. Si Fase A v2 dejó application_fee_cents como NOT NULL,
--    hacerlo nullable para no bloquear el INSERT del webhook (que ahora
--    persiste el equivalente en commission_cents).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'marketplace_orders'
      and column_name = 'application_fee_cents'
      and is_nullable = 'NO'
  ) then
    alter table marketplace_orders alter column application_fee_cents drop not null;
  end if;
end $$;

-- 3. Backfill defensivo: si quedan rows antiguas con application_fee_cents
--    poblada y commission_cents NULL, copiar el valor (la semántica es la misma).
update marketplace_orders
  set commission_cents = application_fee_cents
  where commission_cents is null
    and application_fee_cents is not null;
