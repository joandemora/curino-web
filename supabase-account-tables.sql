-- ============================================================
-- Curino: Account tables (projects, user_profiles, addresses)
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. PROJECTS (configurador 2D)
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null default 'Sin nombre',
  data jsonb not null default '{}',
  thumbnail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects enable row level security;

create policy "Users read own projects"
  on projects for select using (auth.uid() = user_id);

create policy "Users insert own projects"
  on projects for insert with check (auth.uid() = user_id);

create policy "Users update own projects"
  on projects for update using (auth.uid() = user_id);

create policy "Users delete own projects"
  on projects for delete using (auth.uid() = user_id);

-- 2. USER PROFILES
create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  plan text not null default 'go',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_profiles enable row level security;

create policy "Users read own profile"
  on user_profiles for select using (auth.uid() = id);

create policy "Users insert own profile"
  on user_profiles for insert with check (auth.uid() = id);

create policy "Users update own profile"
  on user_profiles for update using (auth.uid() = id);

-- 3. ADDRESSES
create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  label text not null default 'Principal',
  name text not null default '',
  line text not null default '',
  line2 text,
  company text,
  nif text,
  city text not null default '',
  postal text not null default '',
  province text not null default '',
  country text not null default 'España',
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table addresses enable row level security;

create policy "Users read own addresses"
  on addresses for select using (auth.uid() = user_id);

create policy "Users insert own addresses"
  on addresses for insert with check (auth.uid() = user_id);

create policy "Users update own addresses"
  on addresses for update using (auth.uid() = user_id);

create policy "Users delete own addresses"
  on addresses for delete using (auth.uid() = user_id);

-- 4. Auto-create profile on signup (trigger)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, first_name, last_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'first_name'), split_part(coalesce(new.raw_user_meta_data->>'full_name',''), ' ', 1), ''),
    coalesce((new.raw_user_meta_data->>'last_name'), nullif(substring(coalesce(new.raw_user_meta_data->>'full_name','') from position(' ' in coalesce(new.raw_user_meta_data->>'full_name',''))+1), ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
