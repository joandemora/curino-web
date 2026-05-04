-- ============================================================
-- Curino: promoted brands (carrusel del modal Marcas)
-- Run this in Supabase SQL Editor AFTER:
--   - supabase-user-roles.sql           (Fase 1 — roles + is_admin())
--   - supabase-brand-applications.sql   (Fase 2 — solicitudes/logos)
-- ============================================================
-- Adds a `promoted` boolean to user_roles so the admin can flag which
-- brand accounts surface in the carousel at the top of the configurador's
-- Marcas modal. The default is FALSE — existing brands stay invisible
-- until the admin toggles them on from /admin/.
--
-- Plus a SECURITY DEFINER RPC that exposes the brand_name + logo_url
-- pairs of promoted brands to anon and authenticated callers, without
-- opening the full brand_applications table to non-admins.

alter table user_roles
  add column if not exists promoted boolean default false;

-- Public read of promoted brands (brand_name + logo_url joined from
-- brand_applications). Defined SECURITY DEFINER + locked search_path so
-- a non-admin caller doesn't need direct read on brand_applications.
create or replace function public_promoted_brands()
returns table (brand_name text, logo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select ur.brand_name, ba.logo_url
  from public.user_roles ur
  left join public.brand_applications ba on ba.user_id = ur.user_id
  where ur.role = 'brand' and ur.promoted = true
  order by ur.brand_name;
$$;

grant execute on function public_promoted_brands() to authenticated, anon;
