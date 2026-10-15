-- Estudio Curino · papelera y presupuestos como tarjetas en Documentos (2026-10-15)
--
-- 1) estudio_papelera: borrar un presupuesto, un diseño o un documento lo manda
--    aquí 30 días con la copia de sus filas (y de las que caen con él) y las
--    rutas de sus archivos, que no se borran del almacenamiento hasta purgar.
--    Restaurar vuelve a insertar las filas con los mismos ids. La escribe solo
--    la función estudio-ia (service role); el dueño y el admin pueden leerla.
-- 2) Presupuestos importados del histórico: su PDF (estudio_documentos con el
--    mismo nombre que datos.archivo) se vincula al presupuesto para que salgan
--    en una sola tarjeta. No se borra nada ni cambia ningún estado.

create table if not exists public.estudio_papelera (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  proyecto_id uuid references public.estudio_proyectos(id) on delete cascade,
  tipo text not null check (tipo in ('presupuesto', 'diseno', 'documento', 'fichero')),
  nombre text not null default '',
  filas jsonb not null default '{}'::jsonb,     -- { tabla: [filas] } en el orden de restauración
  enlaces jsonb not null default '{}'::jsonb,   -- relaciones que se pierden al borrar (p. ej. «sustituido_por»)
  paths text[] not null default '{}',
  borrado_por uuid,
  borrado_at timestamptz not null default now(),
  caduca_at timestamptz not null default now() + interval '30 days'
);
create index if not exists estudio_papelera_proyecto_idx on public.estudio_papelera (proyecto_id, borrado_at desc);
create index if not exists estudio_papelera_caduca_idx on public.estudio_papelera (caduca_at);

alter table public.estudio_papelera enable row level security;
drop policy if exists estudio_papelera_leer on public.estudio_papelera;
create policy estudio_papelera_leer on public.estudio_papelera for select
  using (user_id = auth.uid() or public.is_admin());

-- PDF del histórico → su presupuesto importado (mismo proyecto y nombre)
update public.estudio_documentos d
   set presupuesto_id = p.id, numero = coalesce(d.numero, p.numero)
  from public.estudio_presupuestos p
 where p.datos ? 'importado'
   and d.proyecto_id = p.proyecto_id
   and d.presupuesto_id is null
   and d.tipo in ('presupuesto_pdf', 'presupuesto_xlsx')
   and d.nombre = p.datos->>'archivo';
