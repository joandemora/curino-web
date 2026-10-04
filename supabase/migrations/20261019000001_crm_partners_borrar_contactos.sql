-- =============================================================
-- CRM Partners · borrar contactos (2026-10)
-- =============================================================
-- Cambio de regla (decision de Juan, 2026-10): se pueden borrar contactos
-- desde el panel, salvo los que tienen compras (inscripcion pagada o
-- reembolsada, o sesion 1:1): sus facturas se conservan por ley. Las ventas
-- siguen sin poder borrarse.
--
-- partners_supresion: solo el hash SHA-256 del email (minusculas). La
--   secuencia no envia a solicitudes de ese email creadas ANTES del borrado
--   (reimportacion por error); si la persona vuelve a rellenar el formulario
--   se crea una fila nueva y entra como nueva.
-- partners_borrados: registro de cada borrado (fecha, admin, hash).
-- Escribe solo la RPC crm_partners_borrar_contactos (security definer,
-- is_admin()). Idempotente.

create table if not exists partners_supresion (
  email_hash text primary key,
  created_at timestamptz not null default now()
);
alter table partners_supresion enable row level security;
drop policy if exists "Admin can read partners_supresion" on partners_supresion;
create policy "Admin can read partners_supresion" on partners_supresion for select using (is_admin());

create table if not exists partners_borrados (
  id uuid primary key default gen_random_uuid(),
  borrado_at timestamptz not null default now(),
  admin_id uuid not null,
  admin_email text,
  email_hash text not null,
  solicitud_id uuid not null,           -- id ya inexistente, solo como referencia
  emails_borrados int not null default 0
);
alter table partners_borrados enable row level security;
drop policy if exists "Admin can read partners_borrados" on partners_borrados;
create policy "Admin can read partners_borrados" on partners_borrados for select using (is_admin());

create or replace function partners_email_hash(p_email text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(lower(trim(p_email)), 'sha256'), 'hex')
$$;

-- ¿Tiene compras? (por la solicitud o por el email)
create or replace function partners_contacto_tiene_compras(s partners_solicitudes) returns boolean
language sql stable security definer set search_path = public as $$
  select s.pagado_at is not null or s.sesion_comprada_at is not null
      or exists (select 1 from inscripciones i
                  where (i.id = s.inscripcion_id or lower(i.email) = lower(s.email))
                    and i.estado in ('pagada', 'reembolsada'))
      or exists (select 1 from sesiones_1a1 x where x.solicitud_id = s.id or lower(x.email) = lower(s.email))
$$;
revoke all on function partners_contacto_tiene_compras(partners_solicitudes) from public, anon;

-- Ids de contactos con compras (para desactivar el boton en el panel).
create or replace function crm_partners_contactos_con_compras() returns setof uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select s.id from partners_solicitudes s where partners_contacto_tiene_compras(s);
end $$;
revoke all on function crm_partners_contactos_con_compras() from public, anon;
grant execute on function crm_partners_contactos_con_compras() to authenticated;

-- Borrado. Devuelve [{id, ok, motivo?}] por cada id.
create or replace function crm_partners_borrar_contactos(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s partners_solicitudes;
  res jsonb := '[]'::jsonb;
  pid uuid;
  h text;
  n int;
  adm_email text;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select email into adm_email from auth.users where id = auth.uid();
  foreach pid in array coalesce(p_ids, '{}') loop
    select * into s from partners_solicitudes where id = pid for update;
    if s.id is null then
      res := res || jsonb_build_object('id', pid, 'ok', false, 'motivo', 'no existe');
      continue;
    end if;
    if partners_contacto_tiene_compras(s) then
      res := res || jsonb_build_object('id', pid, 'ok', false, 'motivo', 'tiene compras');
      continue;
    end if;
    h := partners_email_hash(s.email);
    insert into partners_supresion (email_hash) values (h)
      on conflict (email_hash) do update set created_at = now();
    -- Historial de emails del contacto (datos personales; no es obligatorio conservarlo)
    delete from partners_emails where solicitud_id = s.id or lower(email) = lower(s.email);
    get diagnostics n = row_count;
    insert into partners_borrados (admin_id, admin_email, email_hash, solicitud_id, emails_borrados)
      values (auth.uid(), adm_email, h, s.id, n);
    -- Borrar la fila cancela tambien la secuencia pendiente.
    delete from partners_solicitudes where id = s.id;
    res := res || jsonb_build_object('id', pid, 'ok', true);
  end loop;
  return res;
end $$;
revoke all on function crm_partners_borrar_contactos(uuid[]) from public, anon;
grant execute on function crm_partners_borrar_contactos(uuid[]) to authenticated;
