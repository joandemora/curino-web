-- ============================================================
-- Curino: admin panel helpers (Marcas Fase 3A)
-- Run this in Supabase SQL Editor AFTER:
--   - supabase-catalog-items.sql        (Fase 1 — catálogo)
--   - supabase-user-roles.sql           (Fase 1 — roles + is_admin())
--   - supabase-brand-applications.sql   (Fase 2)
-- ============================================================
-- This file adds two pieces:
--   1. A SECURITY DEFINER RPC that returns brand_applications with the
--      applicant email joined from auth.users — auth.users is in the auth
--      schema and cannot be read from the client even by admins, so we
--      gate access with is_admin() inside the function body.
--   2. Storage write policies for admins on catalog-dxfs and
--      catalog-thumbnails (Fase 1 only opened public read; admins now
--      need write access from the panel to upload DXFs and thumbnails).

-- 1. RPC: brand applications with applicant email + ordered for the panel.
create or replace function admin_brand_applications_with_email()
returns table (
  id uuid,
  user_id uuid,
  user_email text,
  brand_name text,
  legal_name text,
  cif_nif text,
  contact_name text,
  phone text,
  website text,
  logo_url text,
  message text,
  status text,
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;
  return query
    select
      ba.id, ba.user_id, au.email::text,
      ba.brand_name, ba.legal_name, ba.cif_nif,
      ba.contact_name, ba.phone, ba.website,
      ba.logo_url, ba.message, ba.status,
      ba.admin_notes, ba.reviewed_by, ba.reviewed_at, ba.created_at
    from public.brand_applications ba
    left join auth.users au on au.id = ba.user_id
    order by
      case ba.status
        when 'pending'  then 0
        when 'rejected' then 1
        when 'approved' then 2
        else 3
      end,
      ba.created_at desc;
end;
$$;

grant execute on function admin_brand_applications_with_email() to authenticated;

-- 2. Storage write policies for admins on catalog-dxfs.
create policy "Admins insert catalog-dxfs"
  on storage.objects for insert
  with check (bucket_id = 'catalog-dxfs' and is_admin());

create policy "Admins update catalog-dxfs"
  on storage.objects for update
  using (bucket_id = 'catalog-dxfs' and is_admin())
  with check (bucket_id = 'catalog-dxfs' and is_admin());

create policy "Admins delete catalog-dxfs"
  on storage.objects for delete
  using (bucket_id = 'catalog-dxfs' and is_admin());

-- 3. Same for catalog-thumbnails.
create policy "Admins insert catalog-thumbnails"
  on storage.objects for insert
  with check (bucket_id = 'catalog-thumbnails' and is_admin());

create policy "Admins update catalog-thumbnails"
  on storage.objects for update
  using (bucket_id = 'catalog-thumbnails' and is_admin())
  with check (bucket_id = 'catalog-thumbnails' and is_admin());

create policy "Admins delete catalog-thumbnails"
  on storage.objects for delete
  using (bucket_id = 'catalog-thumbnails' and is_admin());
