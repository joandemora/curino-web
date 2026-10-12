-- =============================================================
-- Estudio Curino · F2: proyectos, versiones, chat y uso de la IA (2026-10)
-- =============================================================
-- - estudio_proyectos: un proyecto por cliente del alumno (nombre + ref.).
-- - estudio_versiones: cada propuesta o cambio de Claude guarda el JSON
--   completo (esquema de _shared/estudio/esquema.ts) como versión nueva
--   (v1, v2…). Volver atrás crea otra versión copia de la elegida.
-- - estudio_mensajes: chat del proyecto (alumno ↔ asistente).
-- - estudio_archivos: planos/croquis subidos (bucket privado «estudio»,
--   ruta <user_id>/<proyecto_id>/<uuid>.<ext>, subida con URL firmada).
-- - estudio_uso: cada llamada a la API (tokens y coste estimado en USD).
-- - estudio_config: modelo, precios por millón de tokens y límites
--   (editables en el admin en F4).
-- Escrituras solo desde la Edge Function estudio-ia (service_role).
-- Lectura: el dueño de cada proyecto y admin.
-- Idempotente.

create table if not exists estudio_config (
  id int primary key default 1 check (id = 1),
  modelo text not null default 'claude-sonnet-5-5',
  precio_entrada numeric(10,4) not null default 2,          -- USD por millón de tokens
  precio_salida numeric(10,4) not null default 10,
  precio_cache_escritura numeric(10,4) not null default 2.5, -- caché de 5 min
  precio_cache_lectura numeric(10,4) not null default 0.1,
  max_llamadas_hora int not null default 30,
  max_mb int not null default 20,
  max_paginas int not null default 10,
  updated_at timestamptz not null default now()
);
insert into estudio_config (id) values (1) on conflict (id) do nothing;
alter table estudio_config enable row level security;
drop policy if exists "Admin lee estudio_config" on estudio_config;
create policy "Admin lee estudio_config" on estudio_config for select using (is_admin());

create table if not exists estudio_proyectos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 80),
  referencia text check (char_length(referencia) <= 40),
  version_actual int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_estudio_proyectos_user on estudio_proyectos(user_id, updated_at desc);

create table if not exists estudio_versiones (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references estudio_proyectos(id) on delete cascade,
  numero int not null check (numero > 0),
  datos jsonb not null,
  origen text not null check (origen in ('ia', 'restaurada', 'manual')),
  nota text,
  created_at timestamptz not null default now(),
  unique (proyecto_id, numero)
);

create table if not exists estudio_mensajes (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references estudio_proyectos(id) on delete cascade,
  rol text not null check (rol in ('usuario', 'asistente')),
  texto text not null,
  version int,
  pregunta boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_mensajes_proyecto on estudio_mensajes(proyecto_id, created_at);

create table if not exists estudio_archivos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references estudio_proyectos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  nombre text not null,
  tipo text not null check (tipo in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  bytes int not null check (bytes > 0),
  paginas int,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_archivos_proyecto on estudio_archivos(proyecto_id);

create table if not exists estudio_uso (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proyecto_id uuid references estudio_proyectos(id) on delete set null,
  accion text not null,
  modelo text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_escritura_tokens int not null default 0,
  cache_lectura_tokens int not null default 0,
  coste_usd numeric(12,6) not null default 0,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_uso_user on estudio_uso(user_id, created_at desc);

alter table estudio_proyectos enable row level security;
alter table estudio_versiones enable row level security;
alter table estudio_mensajes enable row level security;
alter table estudio_archivos enable row level security;
alter table estudio_uso enable row level security;

drop policy if exists "Dueño o admin lee estudio_proyectos" on estudio_proyectos;
create policy "Dueño o admin lee estudio_proyectos" on estudio_proyectos for select
  using (user_id = auth.uid() or is_admin());
drop policy if exists "Dueño o admin lee estudio_versiones" on estudio_versiones;
create policy "Dueño o admin lee estudio_versiones" on estudio_versiones for select
  using (exists (select 1 from estudio_proyectos p where p.id = proyecto_id and (p.user_id = auth.uid() or is_admin())));
drop policy if exists "Dueño o admin lee estudio_mensajes" on estudio_mensajes;
create policy "Dueño o admin lee estudio_mensajes" on estudio_mensajes for select
  using (exists (select 1 from estudio_proyectos p where p.id = proyecto_id and (p.user_id = auth.uid() or is_admin())));
drop policy if exists "Dueño o admin lee estudio_archivos" on estudio_archivos;
create policy "Dueño o admin lee estudio_archivos" on estudio_archivos for select
  using (user_id = auth.uid() or is_admin());
drop policy if exists "Dueño o admin lee estudio_uso" on estudio_uso;
create policy "Dueño o admin lee estudio_uso" on estudio_uso for select
  using (user_id = auth.uid() or is_admin());

-- Bucket privado (sin policies: solo service_role y URLs firmadas)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estudio', 'estudio', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
