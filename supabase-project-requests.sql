-- Run in Supabase SQL Editor

create table if not exists public.project_requests (
  id uuid default gen_random_uuid() primary key,
  email text not null,
  name text not null default '',
  phone text not null default '',
  client_type text not null default '',
  professional_support text not null default '',
  rooms jsonb not null default '[]',
  timeline text not null default '',
  status text not null default 'draft' check (status in ('draft','pending','contacted','in_progress','completed')),
  paid boolean not null default false,
  created_at timestamptz default now() not null
);

-- Index for lookups
create index if not exists project_requests_email_idx on public.project_requests(email);

-- Enable RLS
alter table public.project_requests enable row level security;

-- Anyone can insert (form is public)
create policy "Public insert project requests"
  on public.project_requests for insert
  with check (true);

-- Anyone can update drafts (progressive save by id)
create policy "Public update draft project requests"
  on public.project_requests for update
  using (status = 'draft')
  with check (true);

-- Service role can do everything
create policy "Service role manages project requests"
  on public.project_requests for all
  using (auth.role() = 'service_role');
