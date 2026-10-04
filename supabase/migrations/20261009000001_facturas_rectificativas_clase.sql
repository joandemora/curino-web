-- =============================================================
-- Facturas rectificativas del Intensivo (serie R-CLASE-AAAA-NNNNNN)
-- =============================================================
-- Se emiten desde stripe-webhook (charge.refunded): una por reembolso de
-- Stripe (refund id), por el importe reembolsado (total o parcial).
-- Idempotencia: stripe_refund_id UNIQUE; el webhook reclama la fila antes
-- de pedir numero, asi un evento repetido no consume otro numero ni crea
-- otro documento.
--
-- La fila guarda una copia de los datos de la factura original y del
-- comprador: es un documento fiscal y debe sobrevivir aunque se borre la
-- inscripcion (FK on delete set null).
--
-- Idempotente.

-- -------------------------------------------------------------
-- 1. Tipo 'clase_rect' en invoice_counters + assign_invoice_number
-- -------------------------------------------------------------
-- Patron: 20260802_clases.sql / 20260805_curso.sql. Hay que ampliar el
-- CHECK antes del primer insert desde la RPC.
alter table invoice_counters drop constraint if exists invoice_counters_invoice_type_check;
alter table invoice_counters add constraint invoice_counters_invoice_type_check
  check (invoice_type = any (array[
    'simplified'::text,
    'auto_invoice'::text,
    'magazine'::text,
    'armario'::text,
    'clase'::text,
    'curso'::text,
    'clase_rect'::text
  ]));

create or replace function assign_invoice_number(p_type text, p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_prefix text;
  v_formatted text;
begin
  if p_type not in ('simplified', 'auto_invoice', 'magazine', 'armario', 'clase', 'curso', 'clase_rect') then
    raise exception 'Invalid invoice type: %', p_type;
  end if;
  if p_year < 2026 or p_year > 2100 then
    raise exception 'Invalid year: %', p_year;
  end if;
  insert into invoice_counters (invoice_type, year, last_number)
    values (p_type, p_year, 0)
    on conflict (invoice_type, year) do nothing;
  update invoice_counters
    set last_number = last_number + 1,
        updated_at = now()
    where invoice_type = p_type and year = p_year
    returning last_number into v_number;
  v_prefix := case p_type
    when 'simplified' then 'CURINO'
    when 'auto_invoice' then 'AUTO'
    when 'magazine' then 'REVISTA'
    when 'armario' then 'AR'
    when 'clase' then 'CLASE'
    when 'curso' then 'CURSO'
    when 'clase_rect' then 'R-CLASE'
  end;
  v_formatted := v_prefix || '-' || p_year::text || '-' || lpad(v_number::text, 6, '0');
  return v_formatted;
end;
$$;

-- -------------------------------------------------------------
-- 2. Tabla facturas_rectificativas_clase
-- -------------------------------------------------------------
create table if not exists facturas_rectificativas_clase (
  id uuid primary key default gen_random_uuid(),
  stripe_refund_id text not null unique,
  stripe_charge_id text,
  inscripcion_id uuid references inscripciones(id) on delete set null,

  invoice_number text unique,            -- R-CLASE-AAAA-NNNNNN (null hasta asignar)
  importe_cents int not null check (importe_cents > 0),  -- importe reembolsado (positivo; el PDF lo muestra en negativo)
  motivo text not null default 'Devolución por cancelación antes del inicio del curso',

  -- Copia de la factura original y del comprador
  factura_original text not null,
  factura_original_fecha timestamptz not null,
  comprador_nombre text not null,
  comprador_email text,
  comprador_nif text,
  comprador_direccion text,

  pdf_url text,                          -- invoices/clases/<inscripcion>-rect-<refund>.pdf
  created_at timestamptz not null default now()
);

create index if not exists idx_rect_clase_inscripcion on facturas_rectificativas_clase(inscripcion_id);

alter table facturas_rectificativas_clase enable row level security;

drop policy if exists "Admin can read facturas_rectificativas_clase" on facturas_rectificativas_clase;
create policy "Admin can read facturas_rectificativas_clase"
  on facturas_rectificativas_clase for select
  using (is_admin());
