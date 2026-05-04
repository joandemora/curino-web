-- ============================================================
-- Curino: flat folders for "Mis dibujos" (carpetas planas)
-- Run this in Supabase SQL Editor.
-- ============================================================
-- One level only — no sub-folders. Drawings can sit either at the root
-- (folder_id IS NULL) or inside exactly one folder. ON DELETE SET NULL
-- on the FK means deleting a folder doesn't cascade to its drawings;
-- they fall back to the root and stay in the user's library.

-- 1. Folders table
create table if not exists saved_drawing_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

alter table saved_drawing_folders enable row level security;

create policy "Users read own folders"
  on saved_drawing_folders for select
  using (auth.uid() = user_id);

create policy "Users insert own folders"
  on saved_drawing_folders for insert
  with check (auth.uid() = user_id);

create policy "Users update own folders"
  on saved_drawing_folders for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own folders"
  on saved_drawing_folders for delete
  using (auth.uid() = user_id);

-- 2. Add folder_id to saved_drawings (nullable, FK with set-null cascade)
alter table saved_drawings
  add column if not exists folder_id uuid references saved_drawing_folders(id) on delete set null;
