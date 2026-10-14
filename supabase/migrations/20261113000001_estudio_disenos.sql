-- =============================================================
-- Estudio Curino · varios diseños por proyecto (2026-10)
-- =============================================================
-- Un proyecto puede tener varios diseños; cada diseño tiene su chat y sus
-- versiones (la numeración vN sigue siendo por proyecto: unique(proyecto_id,
-- numero)). La pestaña Diseño abre en blanco; el diseño se crea al primer
-- mensaje como «Diseño sin guardar» (guardado = false) y pasa a documento
-- al «Guardar en documentos» (nombre, miniatura, JSON = su versión, PDF de
-- alzados enlazado en estudio_documentos.diseno_id). Los sin guardar se
-- borran a los 30 días (pg_cron diario 'estudio-limpiar-disenos').
-- Miniaturas de documentos y archivos: miniatura_path (JPEG pequeño que
-- genera el navegador la primera vez que se ve la tarjeta).
-- Proyectos existentes: sus versiones pasan a un «Diseño 1». Idempotente.

create table if not exists estudio_disenos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references estudio_proyectos(id) on delete cascade,
  nombre text not null default 'Diseño sin guardar',
  guardado boolean not null default false,
  version_actual int not null default 0,
  miniatura text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_estudio_disenos_proyecto on estudio_disenos(proyecto_id, updated_at desc);
alter table estudio_disenos enable row level security;
drop policy if exists "Dueño o admin lee estudio_disenos" on estudio_disenos;
create policy "Dueño o admin lee estudio_disenos" on estudio_disenos for select
  using (exists (select 1 from estudio_proyectos p where p.id = proyecto_id and (p.user_id = auth.uid() or is_admin())));

alter table estudio_versiones add column if not exists diseno_id uuid references estudio_disenos(id) on delete cascade;
alter table estudio_mensajes add column if not exists diseno_id uuid references estudio_disenos(id) on delete cascade;
alter table estudio_archivos add column if not exists diseno_id uuid references estudio_disenos(id) on delete set null;
alter table estudio_documentos add column if not exists diseno_id uuid references estudio_disenos(id) on delete cascade;
alter table estudio_documentos add column if not exists miniatura_path text;
alter table estudio_ficheros add column if not exists miniatura_path text;
create index if not exists idx_estudio_versiones_diseno on estudio_versiones(diseno_id, numero);
create index if not exists idx_estudio_mensajes_diseno on estudio_mensajes(diseno_id, created_at);

-- Proyectos con versiones y sin diseño: «Diseño 1» con todo lo anterior
do $$
declare r record; d uuid;
begin
  for r in select p.id, p.version_actual, p.miniatura from estudio_proyectos p
            where exists (select 1 from estudio_versiones v where v.proyecto_id = p.id and v.diseno_id is null) loop
    insert into estudio_disenos (proyecto_id, nombre, guardado, version_actual, miniatura)
    values (r.id, 'Diseño 1', true, r.version_actual, r.miniatura) returning id into d;
    update estudio_versiones set diseno_id = d where proyecto_id = r.id and diseno_id is null;
    update estudio_mensajes set diseno_id = d where proyecto_id = r.id and diseno_id is null;
    update estudio_archivos set diseno_id = d where proyecto_id = r.id and diseno_id is null;
    update estudio_documentos set diseno_id = d where proyecto_id = r.id and tipo = 'alzados_pdf' and version is not null and diseno_id is null;
  end loop;
end $$;

create or replace function estudio_limpiar_disenos() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from estudio_disenos where not guardado and updated_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function estudio_limpiar_disenos() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('estudio-limpiar-disenos') where exists (select 1 from cron.job where jobname = 'estudio-limpiar-disenos');
    perform cron.schedule('estudio-limpiar-disenos', '30 4 * * *', $cron$ select estudio_limpiar_disenos() $cron$);
  end if;
end $$;
