-- ============================================================
-- Curino: Saved Drawings table (Mis dibujos)
-- Run this in Supabase SQL Editor
-- ============================================================

create table if not exists saved_drawings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  data jsonb not null default '{}',
  thumbnail text,
  created_at timestamptz not null default now()
);

alter table saved_drawings enable row level security;

create policy "Users read own drawings"
  on saved_drawings for select using (auth.uid() = user_id);

create policy "Users insert own drawings"
  on saved_drawings for insert with check (auth.uid() = user_id);

create policy "Users delete own drawings"
  on saved_drawings for delete using (auth.uid() = user_id);
