-- =============================================================
-- Fase H2 — Tabla armario_orders + serie de factura AR-
-- =============================================================
-- Registro de pedidos del configurador de armarios. Venta directa
-- al consumidor (sin seller, sin auto-factura), paralela a la
-- estructura de marketplace_orders + magazine_purchases.
--
-- Persistencia disparada por el webhook stripe-webhook al recibir
-- checkout.session.completed con metadata.purpose = 'armario'.
-- (El handler en sí — handleArmarioCompleted — se añade en Fase H3.)

-- =============================================================
-- 1. Tabla armario_orders
-- =============================================================
create table if not exists armario_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  stripe_session_id text not null unique,
  stripe_payment_intent_id text,

  -- Importes (céntimos para evitar floats)
  amount_total_cents integer not null check (amount_total_cents > 0),
  amount_discount_cents integer not null default 0 check (amount_discount_cents >= 0),
  precio_bruto_eur numeric(10,2),
  base_cents integer,
  tax_amount_cents integer,
  tax_rate_pct integer not null default 21,
  currency text not null default 'eur',

  -- Estado del pedido
  status text not null default 'paid'
    check (status in ('paid', 'en_produccion', 'enviado', 'cancelado')),

  -- Configuración del armario (ancho, alto, fondo, material, interior,
  -- puertas — todo el detalle de metadata.* en JSON para flexibilidad
  -- futura sin migraciones).
  configuracion jsonb not null default '{}'::jsonb,

  -- Dirección de envío (snapshot)
  shipping_name text,
  shipping_line text,
  shipping_city text,
  shipping_postal text,
  shipping_province text,
  shipping_country text,
  shipping_phone text,
  shipping_nif text,

  -- Dirección de facturación (opcional, nullable; si igual a envío
  -- el frontend manda los mismos valores).
  billing_name text,
  billing_line text,
  billing_city text,
  billing_postal text,
  billing_nif text,

  -- Email del comprador (snapshot, capturado de session.customer_details.email
  -- para que sobreviva aunque el user se elimine).
  buyer_email_snapshot text,

  -- Numeración fiscal (serie AR-)
  invoice_number text,
  invoice_year integer,

  -- PDF de factura (path en bucket 'invoices', se rellena en Fase H4)
  pdf_url text,

  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- =============================================================
-- 2. Índices
-- =============================================================
create index if not exists idx_armario_orders_user on armario_orders(user_id);
create index if not exists idx_armario_orders_status on armario_orders(status);
create index if not exists idx_armario_orders_stripe_session on armario_orders(stripe_session_id);
create index if not exists idx_armario_orders_created_at on armario_orders(created_at desc);

-- =============================================================
-- 3. RLS
-- =============================================================
-- Patrón paralelo a marketplace_orders (uses is_admin()) y
-- magazine_purchases (uses exists user_roles role='admin').
-- Aquí seguimos marketplace_orders porque is_admin() es más limpio
-- y ya está definido en supabase-user-roles.sql.
alter table armario_orders enable row level security;

drop policy if exists "Buyers read own armario_orders" on armario_orders;
drop policy if exists "Admins read all armario_orders" on armario_orders;
drop policy if exists "Admins update armario_orders status" on armario_orders;

create policy "Buyers read own armario_orders"
  on armario_orders for select using (auth.uid() = user_id);

create policy "Admins read all armario_orders"
  on armario_orders for select using (is_admin());

-- Solo admin puede modificar el estado (paid → en_produccion → enviado).
-- El service_role del webhook bypasea RLS, así que no necesita policy
-- explícita para insertar.
create policy "Admins update armario_orders status"
  on armario_orders for update using (is_admin()) with check (is_admin());

-- =============================================================
-- 4. RPC assign_invoice_number — extender con tipo 'armario' (AR-)
-- =============================================================
-- Reemplaza la función actual (con tipos simplified/auto_invoice/magazine)
-- añadiendo 'armario' con prefijo 'AR-'. Formato AR-YYYY-NNNNNN.
-- El contador invoice_counters ya existe (creado fuera de repo) y es
-- atómico por (invoice_type, year).
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
  if p_type not in ('simplified', 'auto_invoice', 'magazine', 'armario') then
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
  end;
  v_formatted := v_prefix || '-' || p_year::text || '-' || lpad(v_number::text, 6, '0');
  return v_formatted;
end;
$$;

-- =============================================================
-- 5. Storage policy: bucket 'invoices' — armario/<order_id>.pdf
-- =============================================================
-- El bucket 'invoices' ya existe (creado en Fase E del marketplace).
-- Path acordado para armarios: armario/<order_id>.pdf (paralelo a
-- magazine/<id>.pdf que usa magazine_purchases).
--
-- - Comprador autenticado lee su propio PDF.
-- - Admin lee todos los PDFs del prefijo armario/.
-- - service_role (webhook) bypasea RLS para subir, no necesita policy.

drop policy if exists "Buyer can read own armario invoice" on storage.objects;
create policy "Buyer can read own armario invoice"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and name like 'armario/%.pdf'
    and exists (
      select 1 from armario_orders
      where armario_orders.user_id = auth.uid()
        and 'armario/' || armario_orders.id::text || '.pdf' = name
    )
  );

drop policy if exists "Admin can read all armario invoices" on storage.objects;
create policy "Admin can read all armario invoices"
  on storage.objects for select
  using (
    bucket_id = 'invoices'
    and name like 'armario/%.pdf'
    and is_admin()
  );
