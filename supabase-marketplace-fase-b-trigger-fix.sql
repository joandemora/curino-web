-- Fix: trigger set_auto_invoice_consent_date debe disparase también en INSERT
-- cuando auto_invoice_consent llega ya como true. Sin esto, al hacer un
-- INSERT directo desde Edge Function, la fecha queda NULL.

create or replace function set_auto_invoice_consent_date()
returns trigger language plpgsql as $$
begin
  -- INSERT: si llega con consent=true, registrar fecha automáticamente
  if TG_OP = 'INSERT' then
    if NEW.auto_invoice_consent = true then
      NEW.auto_invoice_consent_date := coalesce(NEW.auto_invoice_consent_date, now());
    end if;
    return NEW;
  end if;

  -- UPDATE: si pasa de false/null a true, registrar fecha
  if TG_OP = 'UPDATE' then
    if NEW.auto_invoice_consent = true AND (OLD.auto_invoice_consent IS NULL OR OLD.auto_invoice_consent = false) then
      NEW.auto_invoice_consent_date := now();
    end if;
    return NEW;
  end if;

  return NEW;
end; $$;

drop trigger if exists trg_seller_auto_invoice_consent on seller_accounts;
create trigger trg_seller_auto_invoice_consent
  before insert or update of auto_invoice_consent on seller_accounts
  for each row execute function set_auto_invoice_consent_date();

-- Backfill: rellenar auto_invoice_consent_date para rows existentes con consent=true y date=null
update seller_accounts
set auto_invoice_consent_date = created_at
where auto_invoice_consent = true and auto_invoice_consent_date is null;
