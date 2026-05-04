-- ============================================================
-- Curino: catalog-photos bucket (Catálogo Multi-vista Fase D)
-- Run this in Supabase SQL Editor AFTER the Phase 3A and 3B Storage SQL.
-- ============================================================
-- Stores the realistic product photo plus per-variant photos that show
-- in the panel "Marcas" of the configurador (and, eventually, in
-- Propiedades when a variant is selected).
--
-- Path convention (mirrors catalog-dxfs / catalog-thumbnails):
--   admin: <uuid>_main.<ext>            or <uuid>_var_<variantId>.<ext>
--   brand: <user_id>/<uuid>_main.<ext>  or <user_id>/<uuid>_var_<variantId>.<ext>
--
-- Public read so the configurador can fetch by URL with no auth.

insert into storage.buckets (id, name, public)
  values ('catalog-photos', 'catalog-photos', true)
  on conflict (id) do nothing;

create policy "Public read catalog-photos"
  on storage.objects for select
  using (bucket_id = 'catalog-photos');

-- Admin can write anywhere in the bucket.
create policy "Admins insert catalog-photos"
  on storage.objects for insert
  with check (bucket_id = 'catalog-photos' and is_admin());

create policy "Admins update catalog-photos"
  on storage.objects for update
  using (bucket_id = 'catalog-photos' and is_admin())
  with check (bucket_id = 'catalog-photos' and is_admin());

create policy "Admins delete catalog-photos"
  on storage.objects for delete
  using (bucket_id = 'catalog-photos' and is_admin());

-- Brand can write only inside their own folder, same convention as
-- supabase-brand-storage.sql for catalog-dxfs / catalog-thumbnails.
create policy "Brands insert catalog-photos"
  on storage.objects for insert
  with check (
    bucket_id = 'catalog-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Brands update catalog-photos"
  on storage.objects for update
  using (
    bucket_id = 'catalog-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'catalog-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Brands delete catalog-photos"
  on storage.objects for delete
  using (
    bucket_id = 'catalog-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
