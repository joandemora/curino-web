-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- Orders table
create table if not exists public.orders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  configuracion jsonb not null default '{}',
  precio numeric(10,2) not null,
  estado text not null default 'pagado' check (estado in ('pagado','en_produccion','enviado')),
  created_at timestamptz default now() not null
);

-- Index for fast user lookups
create index if not exists orders_user_id_idx on public.orders(user_id);

-- Enable RLS
alter table public.orders enable row level security;

-- Users can only read their own orders
create policy "Users read own orders"
  on public.orders for select
  using (auth.uid() = user_id);

-- Only service_role (webhook) can insert/update orders
-- No insert/update policy for anon/authenticated — orders are created server-side via Stripe webhook
create policy "Service role manages orders"
  on public.orders for all
  using (auth.role() = 'service_role');
