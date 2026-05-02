-- ============================================================
-- Curino: per-user logo for the cajetin
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Table that maps a user to their logo URL
create table if not exists user_logos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  logo_url text not null,
  updated_at timestamptz not null default now()
);

alter table user_logos enable row level security;

create policy "Users read own logo"
  on user_logos for select using (auth.uid() = user_id);
create policy "Users insert own logo"
  on user_logos for insert with check (auth.uid() = user_id);
create policy "Users update own logo"
  on user_logos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users delete own logo"
  on user_logos for delete using (auth.uid() = user_id);

-- 2. Storage bucket "user-logos" (public read so img tags work without signing)
insert into storage.buckets (id, name, public)
  values ('user-logos', 'user-logos', true)
  on conflict (id) do nothing;

-- 3. Storage policies: users can read/write only their own folder
--    Path convention: <user_id>/logo.<ext>
create policy "Public read user-logos"
  on storage.objects for select
  using (bucket_id = 'user-logos');

create policy "Users upload own logo"
  on storage.objects for insert
  with check (
    bucket_id = 'user-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users update own logo"
  on storage.objects for update
  using (
    bucket_id = 'user-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own logo"
  on storage.objects for delete
  using (
    bucket_id = 'user-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
