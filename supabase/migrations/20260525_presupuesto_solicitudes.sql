-- Migración: tabla y bucket para solicitudes de presupuesto desde /solicitar-presupuesto/
-- Patrón: tabla con RLS restrictiva (insertable desde service_role; legible solo admin) +
-- bucket privado de Storage para adjuntos con RLS que permite INSERT anónimo (para que el
-- formulario público pueda subir archivos directamente sin exponer service_role) y SELECT
-- solo via signed URLs generadas por el backend.

-- ── 1. Tabla presupuesto_solicitudes ────────────────────────────────────────
create table if not exists public.presupuesto_solicitudes (
  id                    uuid        primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  nombre                text        not null,
  email                 text        not null,
  telefono              text,
  tipo_proyecto         text,        -- 'cocina' | 'armarios-vestidores' | 'bano' | 'integral' | 'otro'
  mensaje               text,
  archivos              jsonb        not null default '[]'::jsonb,  -- [{name,path,size,type,signed_url}]
  estado                text         not null default 'nuevo',       -- nuevo | leido | en_proceso | cerrado
  consentimiento_rgpd   boolean      not null default false,
  user_agent            text,
  ip_hash               text,        -- hash opcional para deduplicar/antiabuso
  notas_admin           text
);

create index if not exists presupuesto_solicitudes_created_at_idx
  on public.presupuesto_solicitudes (created_at desc);

create index if not exists presupuesto_solicitudes_estado_idx
  on public.presupuesto_solicitudes (estado, created_at desc);

-- ── 2. RLS de la tabla ──────────────────────────────────────────────────────
-- Solo service_role puede insertar/leer. El formulario público envía via endpoint
-- /api/solicitar-presupuesto que usa service_role; nadie lee directamente.
alter table public.presupuesto_solicitudes enable row level security;

-- Deniega lectura/escritura a anon y authenticated por defecto.
-- service_role bypasses RLS automáticamente en Supabase, no necesita policy.

-- Si en el futuro quieres que el admin loggeado lea desde /admin/, descomenta:
-- create policy "admin can read presupuesto_solicitudes"
--   on public.presupuesto_solicitudes for select
--   to authenticated
--   using (
--     auth.jwt() ->> 'role' = 'admin'
--     or auth.jwt() ->> 'email' = 'info@casacurino.com'
--   );

-- ── 3. Bucket de Storage: presupuesto-adjuntos (privado) ────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'presupuesto-adjuntos',
  'presupuesto-adjuntos',
  false,                                                -- privado: nada de URLs públicas
  10485760,                                             -- 10 MB por archivo
  array['application/pdf','image/jpeg','image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── 4. RLS del bucket ───────────────────────────────────────────────────────
-- INSERT abierto a anon (el formulario público sube directamente).
-- SELECT bloqueado para anon (los archivos solo se leen vía signed URL generada
--   por el backend con service_role).
-- DELETE bloqueado para anon (limpieza es responsabilidad admin/cron).

create policy "presupuesto adjuntos insert anon"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'presupuesto-adjuntos'
  );

-- (No hace falta policy de SELECT a anon — al ser bucket privado, anon no
-- puede leer; service_role bypasses RLS y genera signed URLs.)

-- ── 5. Comentarios ──────────────────────────────────────────────────────────
comment on table public.presupuesto_solicitudes is 'Solicitudes de presupuesto enviadas desde /solicitar-presupuesto/. INSERT solo vía /api/solicitar-presupuesto con service_role.';

comment on column public.presupuesto_solicitudes.archivos is 'Array de {name, path, size, type, signed_url} con los adjuntos subidos al bucket presupuesto-adjuntos. Las signed_url caducan a 7 días.';
