-- ============================================================================
-- Fase A v2: Marketplace de Biblioteca (corregido + idempotente)
-- ============================================================================

-- 1. CONFIG
create table if not exists marketplace_config (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table marketplace_config enable row level security;

drop policy if exists "Public read marketplace_config" on marketplace_config;
drop policy if exists "Admins write marketplace_config" on marketplace_config;

create policy "Public read marketplace_config"
  on marketplace_config for select using (true);

create policy "Admins write marketplace_config"
  on marketplace_config for all
  using (is_admin())
  with check (is_admin());

insert into marketplace_config (key, value, description) values
  ('commission_pct', '30'::jsonb, 'Porcentaje de comisión Curino sobre cada venta de pago.'),
  ('price_min_cents', '150'::jsonb, 'Precio mínimo permitido en céntimos para items de pago.'),
  ('price_max_cents', '300'::jsonb, 'Precio máximo permitido en céntimos.'),
  ('max_items_per_seller', '5'::jsonb, 'Máximo de items publicados simultáneamente por seller no-admin.')
on conflict (key) do nothing;


-- 2. SELLER_ACCOUNTS
create table if not exists seller_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text unique not null,
  onboarding_status text not null default 'pending'
    check (onboarding_status in ('pending', 'active', 'restricted', 'disabled')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_seller_accounts_status on seller_accounts(onboarding_status);

alter table seller_accounts enable row level security;

drop policy if exists "Users read own seller account" on seller_accounts;
drop policy if exists "Admins read all seller accounts" on seller_accounts;

create policy "Users read own seller account"
  on seller_accounts for select using (auth.uid() = user_id);

create policy "Admins read all seller accounts"
  on seller_accounts for select using (is_admin());


-- 3. ALTER LIBRARY_ITEMS
alter table library_items
  add column if not exists seller_id uuid references auth.users(id) on delete restrict,
  add column if not exists price_cents integer not null default 0,
  add column if not exists currency text not null default 'eur',
  add column if not exists status text not null default 'published'
    check (status in ('draft', 'published', 'taken_down', 'deleted')),
  add column if not exists description text,
  add column if not exists watermarked_preview_path text,
  add column if not exists taken_down_reason text,
  add column if not exists taken_down_at timestamptz;

alter table library_items drop constraint if exists library_items_price_valid;

alter table library_items
  add constraint library_items_price_valid
  check (price_cents = 0 OR (price_cents BETWEEN 150 AND 300));

update library_items
  set seller_id = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid,
      price_cents = coalesce(price_cents, 0),
      status = coalesce(status, 'published')
  where seller_id is null;

do $$
begin
  alter table library_items alter column seller_id set not null;
exception when others then null;
end $$;

create index if not exists idx_library_items_status
  on library_items(status) where status = 'published';
create index if not exists idx_library_items_seller on library_items(seller_id);
create index if not exists idx_library_items_status_category
  on library_items(status, category) where status = 'published';
create index if not exists idx_library_items_price
  on library_items(price_cents) where status = 'published';


-- 4. RLS LIBRARY_ITEMS
drop policy if exists "Public read library_items" on library_items;
drop policy if exists "Admins manage library_items" on library_items;
drop policy if exists "Public read published library_items" on library_items;
drop policy if exists "Sellers read own library_items" on library_items;
drop policy if exists "Admins read all library_items" on library_items;
drop policy if exists "Users insert own library_items" on library_items;
drop policy if exists "Admins insert any library_items" on library_items;
drop policy if exists "Sellers update own library_items" on library_items;
drop policy if exists "Admins update any library_items" on library_items;
drop policy if exists "Admins delete library_items" on library_items;

create policy "Public read published library_items"
  on library_items for select using (status = 'published');

create policy "Sellers read own library_items"
  on library_items for select using (auth.uid() = seller_id);

create policy "Admins read all library_items"
  on library_items for select using (is_admin());

create policy "Users insert own library_items"
  on library_items for insert
  with check (auth.uid() = seller_id AND status in ('draft', 'published'));

create policy "Admins insert any library_items"
  on library_items for insert with check (is_admin());

create policy "Sellers update own library_items"
  on library_items for update
  using (auth.uid() = seller_id)
  with check (auth.uid() = seller_id AND status in ('draft', 'published', 'deleted'));

create policy "Admins update any library_items"
  on library_items for update using (is_admin()) with check (is_admin());

create policy "Admins delete library_items"
  on library_items for delete using (is_admin());


-- 5. MARKETPLACE_ORDERS
create table if not exists marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete restrict,
  library_item_id uuid not null references library_items(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'eur',
  application_fee_cents integer not null check (application_fee_cents >= 0),
  stripe_fee_cents integer,
  seller_net_cents integer,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded', 'disputed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz
);

create index if not exists idx_marketplace_orders_buyer on marketplace_orders(buyer_id);
create index if not exists idx_marketplace_orders_seller on marketplace_orders(seller_id);
create index if not exists idx_marketplace_orders_item on marketplace_orders(library_item_id);
create index if not exists idx_marketplace_orders_status on marketplace_orders(status);
create index if not exists idx_marketplace_orders_stripe_session on marketplace_orders(stripe_session_id);

alter table marketplace_orders enable row level security;

drop policy if exists "Buyers read own marketplace_orders" on marketplace_orders;
drop policy if exists "Sellers read marketplace_orders of their items" on marketplace_orders;
drop policy if exists "Admins read all marketplace_orders" on marketplace_orders;

create policy "Buyers read own marketplace_orders"
  on marketplace_orders for select using (auth.uid() = buyer_id);

create policy "Sellers read marketplace_orders of their items"
  on marketplace_orders for select using (auth.uid() = seller_id);

create policy "Admins read all marketplace_orders"
  on marketplace_orders for select using (is_admin());


-- 6. PURCHASES
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  library_item_id uuid not null references library_items(id) on delete restrict,
  order_id uuid references marketplace_orders(id) on delete set null,
  acquired_at timestamptz not null default now(),
  unique (user_id, library_item_id)
);

create index if not exists idx_purchases_user on purchases(user_id);
create index if not exists idx_purchases_item on purchases(library_item_id);

alter table purchases enable row level security;

drop policy if exists "Users read own purchases" on purchases;
drop policy if exists "Admins read all purchases" on purchases;
drop policy if exists "Users claim free library_items" on purchases;

create policy "Users read own purchases"
  on purchases for select using (auth.uid() = user_id);

create policy "Admins read all purchases"
  on purchases for select using (is_admin());

create policy "Users claim free library_items"
  on purchases for insert
  with check (
    auth.uid() = user_id
    AND order_id is null
    AND exists (
      select 1 from library_items li
      where li.id = library_item_id
        AND li.status = 'published'
        AND li.price_cents = 0
    )
  );


-- 7. ITEM_REPORTS
create table if not exists item_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete set null,
  library_item_id uuid not null references library_items(id) on delete cascade,
  reason text not null check (reason in ('copyright', 'inappropriate', 'spam', 'other')),
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'auto_taken_down', 'resolved_takedown', 'resolved_dismissed')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_item_reports_status on item_reports(status);
create index if not exists idx_item_reports_item on item_reports(library_item_id);

alter table item_reports enable row level security;

drop policy if exists "Admins read all item_reports" on item_reports;
drop policy if exists "Users create item_reports" on item_reports;
drop policy if exists "Admins update item_reports" on item_reports;

create policy "Admins read all item_reports"
  on item_reports for select using (is_admin());

create policy "Users create item_reports"
  on item_reports for insert
  with check (auth.uid() = reporter_id AND auth.uid() is not null);

create policy "Admins update item_reports"
  on item_reports for update using (is_admin()) with check (is_admin());


-- 8. HELPERS RPC
create or replace function is_seller_active(uid uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select
    exists (select 1 from user_roles where user_id = uid and role = 'admin')
    OR
    exists (
      select 1 from seller_accounts
      where user_id = uid and onboarding_status = 'active' and charges_enabled = true
    );
$$;

grant execute on function is_seller_active(uuid) to authenticated;

create or replace function has_purchased(uid uuid, item_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from purchases where user_id = uid and library_item_id = item_id
  );
$$;

grant execute on function has_purchased(uuid, uuid) to authenticated;

create or replace function can_download(uid uuid, item_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select
    exists (select 1 from user_roles where user_id = uid and role = 'admin')
    OR
    exists (select 1 from library_items where id = item_id and seller_id = uid)
    OR
    exists (select 1 from purchases where user_id = uid and library_item_id = item_id);
$$;

grant execute on function can_download(uuid, uuid) to authenticated;


-- 9. TRIGGERS
create or replace function validate_paid_item_requires_active_seller()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if NEW.price_cents > 0 then
    if not is_seller_active(NEW.seller_id) then
      raise exception 'Seller % does not have an active Stripe Connect account; cannot publish paid items', NEW.seller_id
        using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_validate_paid_item on library_items;
create trigger trg_validate_paid_item
  before insert or update of price_cents, seller_id on library_items
  for each row execute function validate_paid_item_requires_active_seller();


create or replace function enforce_max_items_per_seller()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  current_count integer;
  max_allowed integer;
  is_admin_seller boolean;
begin
  if NEW.status != 'published' then return NEW; end if;
  if TG_OP = 'UPDATE' AND OLD.status = 'published' then return NEW; end if;

  select exists (select 1 from user_roles where user_id = NEW.seller_id and role = 'admin')
    into is_admin_seller;
  if is_admin_seller then return NEW; end if;

  select (value::text)::integer into max_allowed
    from marketplace_config where key = 'max_items_per_seller';
  if max_allowed is null then max_allowed := 5; end if;

  select count(*) into current_count
    from library_items
    where seller_id = NEW.seller_id and status = 'published' and id != NEW.id;

  if current_count >= max_allowed then
    raise exception 'Seller % has reached the maximum of % published items', NEW.seller_id, max_allowed
      using errcode = 'check_violation';
  end if;

  return NEW;
end; $$;

drop trigger if exists trg_max_items_per_seller on library_items;
create trigger trg_max_items_per_seller
  before insert or update of status on library_items
  for each row execute function enforce_max_items_per_seller();


create or replace function auto_takedown_on_copyright_report()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if NEW.reason = 'copyright' then
    update library_items
      set status = 'taken_down',
          taken_down_reason = 'Auto-takedown por reporte de copyright (report_id: ' || NEW.id::text || ')',
          taken_down_at = now()
      where id = NEW.library_item_id and status = 'published';

    if found then
      NEW.status := 'auto_taken_down';
      NEW.resolved_at := now();
    end if;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_auto_takedown_copyright on item_reports;
create trigger trg_auto_takedown_copyright
  before insert on item_reports
  for each row execute function auto_takedown_on_copyright_report();


create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin NEW.updated_at := now(); return NEW; end; $$;

drop trigger if exists trg_library_items_updated_at on library_items;
create trigger trg_library_items_updated_at
  before update on library_items
  for each row execute function set_updated_at();

drop trigger if exists trg_seller_accounts_updated_at on seller_accounts;
create trigger trg_seller_accounts_updated_at
  before update on seller_accounts
  for each row execute function set_updated_at();


-- 10. STORAGE
update storage.buckets set public = false where id = 'library-dxfs';

insert into storage.buckets (id, name, public)
  values ('library-previews', 'library-previews', false)
  on conflict (id) do nothing;

drop policy if exists "Public read library-dxfs" on storage.objects;
drop policy if exists "Admin write library-dxfs" on storage.objects;
drop policy if exists "Admins manage library-dxfs" on storage.objects;
drop policy if exists "Sellers read own library-dxfs files" on storage.objects;
drop policy if exists "Users upload to own prefix in library-dxfs" on storage.objects;
drop policy if exists "Users update own files in library-dxfs" on storage.objects;
drop policy if exists "Users delete own files in library-dxfs" on storage.objects;
drop policy if exists "Sellers read own library-previews files" on storage.objects;
drop policy if exists "Users upload to own prefix in library-previews" on storage.objects;
drop policy if exists "Users update own files in library-previews" on storage.objects;
drop policy if exists "Users delete own files in library-previews" on storage.objects;

create policy "Sellers read own library-dxfs files"
  on storage.objects for select
  using (
    bucket_id = 'library-dxfs'
    AND (
      (position('/' in name) = 0 AND is_admin())
      OR (split_part(name, '/', 1)::uuid = auth.uid() OR is_admin())
    )
  );

create policy "Users upload to own prefix in library-dxfs"
  on storage.objects for insert
  with check (
    bucket_id = 'library-dxfs'
    AND auth.uid() is not null
    AND (split_part(name, '/', 1)::uuid = auth.uid() OR is_admin())
  );

create policy "Users update own files in library-dxfs"
  on storage.objects for update
  using (
    bucket_id = 'library-dxfs'
    AND (split_part(name, '/', 1)::uuid = auth.uid() OR is_admin())
  );

create policy "Users delete own files in library-dxfs"
  on storage.objects for delete
  using (
    bucket_id = 'library-dxfs'
    AND (split_part(name, '/', 1)::uuid = auth.uid() OR is_admin())
  );

create policy "Sellers read own library-previews files"
  on storage.objects for select
  using (
    bucket_id = 'library-previews'
    AND (
      (position('/' in name) = 0 AND is_admin())
      OR (split_part(name, '/', 1)::uuid = auth.uid() OR is_admin())
    )
  );

create policy "Users upload to own prefix in library-previews"
  on storage.objects for insert
  with check (
    bucket_id = 'library-previews'
    AND auth.uid() is not null
    AND (split_part(name, '/', 1)::uuid = auth.uid() OR is_admin())
  );

create policy "Users update own files in library-previews"
  on storage.objects for update
  using (
    bucket_id = 'library-previews'
    AND (split_part(name, '/', 1)::uuid = auth.uid() OR is_admin())
  );

create policy "Users delete own files in library-previews"
  on storage.objects for delete
  using (
    bucket_id = 'library-previews'
    AND (split_part(name, '/', 1)::uuid = auth.uid() OR is_admin())
  );


-- 11. RPC PÚBLICOS
create or replace function my_library_items()
returns setof library_items language sql stable security definer
set search_path = public as $$
  select * from library_items where seller_id = auth.uid() order by created_at desc;
$$;
grant execute on function my_library_items() to authenticated;

create or replace function my_purchases()
returns table (
  purchase_id uuid, library_item_id uuid, item_name text, item_category text,
  acquired_at timestamptz, was_paid boolean, amount_cents integer
)
language sql stable security definer set search_path = public as $$
  select p.id, p.library_item_id, li.name, li.category, p.acquired_at,
         (p.order_id is not null), o.amount_cents
  from purchases p
  join library_items li on li.id = p.library_item_id
  left join marketplace_orders o on o.id = p.order_id
  where p.user_id = auth.uid()
  order by p.acquired_at desc;
$$;
grant execute on function my_purchases() to authenticated;

create or replace function my_seller_status()
returns table (
  has_account boolean, onboarding_status text, charges_enabled boolean,
  payouts_enabled boolean, details_submitted boolean
)
language sql stable security definer set search_path = public as $$
  select (sa.user_id is not null), coalesce(sa.onboarding_status, 'none'),
         coalesce(sa.charges_enabled, false), coalesce(sa.payouts_enabled, false),
         coalesce(sa.details_submitted, false)
  from (select auth.uid() as uid) u
  left join seller_accounts sa on sa.user_id = u.uid;
$$;
grant execute on function my_seller_status() to authenticated;
