-- ============================================================
-- Curino: catalog_items + catalog-dxfs + catalog-thumbnails (Marcas Fase 1)
-- Run this in Supabase SQL Editor.
-- ============================================================
-- This is the public catalog of real furniture pieces (HAY, Vitra, etc.).
-- Phase 1 is read-only from the frontend; Joan populates rows manually
-- via Supabase Studio. Phase 2 (brand_applications) and Phase 3 (admin
-- panel + per-brand ownership via brand_user_id) build on top.

-- 1. Catalog table
create table if not exists catalog_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null,
  category text not null,
  subcategory text not null,
  designer text,
  year int,
  width_mm int,
  height_mm int,
  depth_mm int,
  dxf_url text not null,
  thumbnail_url text,
  default_unit text default 'mm',
  active boolean default true,
  created_at timestamptz default now()
);

alter table catalog_items enable row level security;

-- Public read for active rows. Insert/update/delete restricted to service
-- role (Supabase Studio) until Phase 1 of roles ships brand_user_id and
-- the per-brand / admin policies (see supabase-user-roles.sql).
create policy "Anyone can read catalog"
  on catalog_items for select
  using (active = true);

-- 2. DXF storage bucket — public read, no client write.
insert into storage.buckets (id, name, public)
  values ('catalog-dxfs', 'catalog-dxfs', true)
  on conflict (id) do nothing;

create policy "Public read catalog-dxfs"
  on storage.objects for select
  using (bucket_id = 'catalog-dxfs');

-- 3. Thumbnail storage bucket — public read, no client write.
insert into storage.buckets (id, name, public)
  values ('catalog-thumbnails', 'catalog-thumbnails', true)
  on conflict (id) do nothing;

create policy "Public read catalog-thumbnails"
  on storage.objects for select
  using (bucket_id = 'catalog-thumbnails');
