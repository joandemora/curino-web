-- ============================================================
-- Curino: user_roles + is_admin() + brand_user_id (Marcas Fase 1 — roles)
-- Run this in Supabase SQL Editor AFTER supabase-catalog-items.sql
-- (the alter table at the bottom assumes catalog_items already exists).
-- ============================================================
-- This file ONLY ships the schema and policies. The first admin row is
-- bootstrap-only and lives outside this script because it depends on the
-- specific user_id of the admin account — see the comment block at the
-- end of this file.

-- 1. Roles table
create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'brand', 'user')),
  brand_name text,                            -- only set when role='brand'
  granted_at timestamptz default now(),
  granted_by uuid references auth.users(id)   -- admin who flipped the role
);

alter table user_roles enable row level security;

-- 2. is_admin() helper
-- SECURITY DEFINER lets a policy on user_roles query user_roles itself
-- without re-entering RLS — needed because "Admins read all roles" below
-- would otherwise deadlock (it asks "is the caller admin?" → which means
-- reading user_roles → which triggers the same policy → recursion).
create or replace function is_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- 3. Policies on user_roles
-- Users always see their own row (the frontend reads it on sign-in to
-- decide which UI affordances to show).
create policy "Users read own role"
  on user_roles for select
  using (auth.uid() = user_id);

-- Admins can see and edit everyone.
create policy "Admins read all roles"
  on user_roles for select
  using (is_admin());

create policy "Admins insert roles"
  on user_roles for insert
  with check (is_admin());

create policy "Admins update roles"
  on user_roles for update
  using (is_admin())
  with check (is_admin());

create policy "Admins delete roles"
  on user_roles for delete
  using (is_admin());

-- 4. brand_user_id on catalog_items
-- Nullable so existing catalog rows keep working. Phase 3 will let brand
-- users claim their pieces and admins reassign them.
alter table catalog_items
  add column if not exists brand_user_id uuid references auth.users(id) on delete set null;

-- 5. Per-brand and admin policies on catalog_items
-- The pre-existing "Anyone can read catalog" policy stays intact.
create policy "Brands manage own catalog items"
  on catalog_items for all
  using (auth.uid() = brand_user_id)
  with check (auth.uid() = brand_user_id);

create policy "Admins manage all catalog items"
  on catalog_items for all
  using (is_admin())
  with check (is_admin());

-- ============================================================
-- BOOTSTRAP — DO NOT INCLUDE IN AUTOMATED MIGRATIONS
-- ============================================================
-- The "Admins insert roles" policy needs is_admin() to be true to fire,
-- but at first run user_roles is empty → nobody satisfies is_admin() →
-- the table can never be populated through normal RLS. The first admin
-- row has to be inserted manually with service-role permissions, exactly
-- once, by Joan. Steps:
--
--   1. Find the auth user id:
--        select id from auth.users where email = 'tu_email@dominio.com';
--   2. Copy the resulting uuid into both placeholders below and execute:
--
--        insert into user_roles (user_id, role, granted_by)
--        values ('PEGAR_UUID_AQUI', 'admin', 'PEGAR_UUID_AQUI');
--
-- After that any subsequent role grant goes through the admin panel
-- (Phase 3) or, in the meantime, through SQL Editor as the admin user.
