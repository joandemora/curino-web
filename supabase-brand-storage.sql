-- ============================================================
-- Curino: brand storage policies (Marcas Fase 3B)
-- Run this in Supabase SQL Editor AFTER:
--   - supabase-catalog-items.sql        (Fase 1 — catálogo + buckets)
--   - supabase-user-roles.sql           (Fase 1 — roles + is_admin())
--   - supabase-admin-helpers.sql        (Fase 3A — admin write policies)
-- ============================================================
-- Lets users with role='brand' upload / replace / delete files in the
-- catalog buckets, scoped to their own folder. Path convention:
--   admin:  <uuid>.<ext>                   (root of bucket)
--   brand:  <user_id>/<uuid>.<ext>         (folder = auth.uid())
--
-- The policy distinguishes admin vs brand purely on the path: brands can
-- only touch files whose first folder segment matches auth.uid(), so two
-- brands can never overwrite each other's pieces. Public read from
-- supabase-catalog-items.sql still applies — anyone can fetch any DXF /
-- thumbnail by URL regardless of the folder structure.

-- catalog-dxfs
create policy "Brands insert catalog-dxfs"
  on storage.objects for insert
  with check (
    bucket_id = 'catalog-dxfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Brands update catalog-dxfs"
  on storage.objects for update
  using (
    bucket_id = 'catalog-dxfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'catalog-dxfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Brands delete catalog-dxfs"
  on storage.objects for delete
  using (
    bucket_id = 'catalog-dxfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- catalog-thumbnails
create policy "Brands insert catalog-thumbnails"
  on storage.objects for insert
  with check (
    bucket_id = 'catalog-thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Brands update catalog-thumbnails"
  on storage.objects for update
  using (
    bucket_id = 'catalog-thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'catalog-thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Brands delete catalog-thumbnails"
  on storage.objects for delete
  using (
    bucket_id = 'catalog-thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
