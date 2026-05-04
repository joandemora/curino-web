-- ============================================================
-- Curino: Biblioteca — catálogo propio de Curino, separado de Marcas
-- Run this in Supabase SQL Editor AFTER:
--   - supabase-user-roles.sql      (Fase 1 — is_admin())
-- ============================================================
-- Biblioteca is the in-house catalog: pieces curated by Curino, written
-- only by admins, surfaced in the right column of the configurador
-- (between Dibujar and Marcas) and managed from /admin/. Same multi-view
-- DXF model as catalog_items (views jsonb + legacy dxf_url) but no
-- product photo, no variants, no brand — those concepts only apply to
-- third-party brand catalog entries.

create table if not exists library_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  subcategory text not null,
  designer text,
  year int,
  width_mm numeric,
  height_mm numeric,
  depth_mm numeric,
  default_unit text default 'mm',
  active boolean default true,
  views jsonb,
  dxf_url text,
  thumbnail_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table library_items enable row level security;

-- Anyone can read Biblioteca — the configurador surfaces it without auth.
create policy "Public read library_items"
  on library_items for select using (true);

-- Only admins can write. is_admin() comes from supabase-user-roles.sql.
create policy "Admins manage library_items"
  on library_items for all
  using (is_admin())
  with check (is_admin());

-- Storage buckets — public read (so the configurador can fetch DXF JSONs
-- and thumbnails without auth), admin-only write.

insert into storage.buckets (id, name, public)
  values ('library-dxfs', 'library-dxfs', true)
  on conflict (id) do nothing;

create policy "Public read library-dxfs"
  on storage.objects for select
  using (bucket_id = 'library-dxfs');

create policy "Admins insert library-dxfs"
  on storage.objects for insert
  with check (bucket_id = 'library-dxfs' and is_admin());

create policy "Admins update library-dxfs"
  on storage.objects for update
  using (bucket_id = 'library-dxfs' and is_admin())
  with check (bucket_id = 'library-dxfs' and is_admin());

create policy "Admins delete library-dxfs"
  on storage.objects for delete
  using (bucket_id = 'library-dxfs' and is_admin());

insert into storage.buckets (id, name, public)
  values ('library-thumbnails', 'library-thumbnails', true)
  on conflict (id) do nothing;

create policy "Public read library-thumbnails"
  on storage.objects for select
  using (bucket_id = 'library-thumbnails');

create policy "Admins insert library-thumbnails"
  on storage.objects for insert
  with check (bucket_id = 'library-thumbnails' and is_admin());

create policy "Admins update library-thumbnails"
  on storage.objects for update
  using (bucket_id = 'library-thumbnails' and is_admin())
  with check (bucket_id = 'library-thumbnails' and is_admin());

create policy "Admins delete library-thumbnails"
  on storage.objects for delete
  using (bucket_id = 'library-thumbnails' and is_admin());
