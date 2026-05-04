-- ============================================================
-- Curino: brand_applications + brand-logos bucket (Marcas Fase 2)
-- Run this in Supabase SQL Editor.
-- Depends on: user_roles + is_admin() helper (Marcas Fase 1).
-- ============================================================

-- 1. Tabla de solicitudes de marca
create table if not exists brand_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_name text not null,
  legal_name text not null,
  cif_nif text not null,
  contact_name text not null,
  phone text not null,
  website text,
  logo_url text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_notes text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz default now(),

  unique (user_id)  -- un usuario solo puede tener una solicitud activa
);

alter table brand_applications enable row level security;

-- Lectura: el usuario ve la suya, el admin ve todas.
create policy "Users read own application"
  on brand_applications for select
  using (auth.uid() = user_id);

create policy "Admins read all applications"
  on brand_applications for select
  using (is_admin());

-- Inserción: el usuario solo puede crear su propia solicitud, en estado pending.
create policy "Users create own application"
  on brand_applications for insert
  with check (auth.uid() = user_id and status = 'pending');

-- Edición por usuario: cualquier estado de origen, pero el resultado debe quedar
-- en 'pending'. Cubre dos casos:
--   1. Editar una solicitud pending antes de que la revise el admin.
--   2. Re-aplicar tras un rejected (la fila salta de rejected → pending).
-- WITH CHECK pin a status='pending' garantiza que un usuario nunca puede
-- auto-aprobarse (ni saltar a 'rejected' tampoco — solo el admin lo hace).
create policy "Users update own application"
  on brand_applications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status = 'pending');

-- Edición por admin: sin restricción de status — esto es lo que permite
-- aprobar o rechazar. Reusa is_admin() de la Fase 1.
create policy "Admins update applications"
  on brand_applications for update
  using (is_admin())
  with check (is_admin());

-- Sin policy de DELETE: ni el usuario ni el admin pueden borrar filas vía RLS.
-- Las solicitudes son histórico — se mantienen incluso tras aprobar/rechazar.
-- Si alguna vez hay que purgar, se hace con service role desde Supabase Studio.

-- 2. Storage bucket para logos de marca (público read, write solo en propia carpeta)
-- Convención de path: brand-logos/{user_id}/logo.{ext}
insert into storage.buckets (id, name, public)
  values ('brand-logos', 'brand-logos', true)
  on conflict (id) do nothing;

create policy "Public read brand-logos"
  on storage.objects for select
  using (bucket_id = 'brand-logos');

create policy "Users upload own brand-logo"
  on storage.objects for insert
  with check (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users update own brand-logo"
  on storage.objects for update
  using (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own brand-logo"
  on storage.objects for delete
  using (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
