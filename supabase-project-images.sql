-- ============================================================
-- Curino: project-images bucket for canvas image uploads
-- Run this in Supabase SQL Editor
-- ============================================================
-- This bucket is separate from user-logos:
--   user-logos    → one file per user, replaced on upsert
--   project-images → append-only, many files per user, up to 5 MB each.
-- Path convention: {user_id}/{timestamp_random}.{ext}

insert into storage.buckets (id, name, public)
  values ('project-images', 'project-images', true)
  on conflict (id) do nothing;

create policy "Public read project-images"
  on storage.objects for select
  using (bucket_id = 'project-images');

create policy "Users upload own project-images"
  on storage.objects for insert
  with check (
    bucket_id = 'project-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users update own project-images"
  on storage.objects for update
  using (
    bucket_id = 'project-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'project-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own project-images"
  on storage.objects for delete
  using (
    bucket_id = 'project-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
