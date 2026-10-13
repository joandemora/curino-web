-- =============================================================
-- Estudio Curino · ficha del proyecto: documentos, archivos, costes y cobros (2026-10)
-- =============================================================
-- - estudio_proyectos.miniatura: SVG del último alzado (para la tarjeta).
-- - estudio_documentos: todo lo generado (alzados PDF por versión,
--   presupuestos PDF y Excel con su n.º), guardado al generarse.
-- - estudio_ficheros: archivos propios del alumno (facturas y presupuestos
--   de proveedor, facturas a cliente, fotos de obra…) con proveedor, fecha
--   e importes (a mano o «Leer con IA»).
-- - estudio_costes: costes manuales por categoría (sin IVA).
-- - estudio_cobros: plazos de cobro (forma de pago de la plantilla sobre el
--   total CON IVA) con fecha prevista (1.º al aceptar, siguientes +30 días),
--   check de cobrado y fecha de cobro.
-- Reglas de métricas (estudio-ia/proyecto.ts): facturación = facturas a
-- cliente subidas (base) o, si no hay, presupuesto aceptado sin IVA; costes =
-- facturas de proveedor (base) + costes manuales; margen sobre bases sin IVA.
-- - estudio_config.almacenamiento_mb: límite por alumno (def. 1024).
-- Bucket «estudio»: admite también Excel. Escrituras solo vía estudio-ia.
-- Idempotente.

alter table estudio_proyectos add column if not exists miniatura text;
alter table estudio_config add column if not exists almacenamiento_mb int not null default 1024;

create table if not exists estudio_documentos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references estudio_proyectos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('alzados_pdf', 'presupuesto_pdf', 'presupuesto_xlsx')),
  version int,
  numero text,
  nombre text not null,
  path text not null unique,
  bytes int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_documentos_proyecto on estudio_documentos(proyecto_id, created_at desc);

create table if not exists estudio_ficheros (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references estudio_proyectos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  nombre text not null,
  mime text not null,
  bytes int not null check (bytes > 0),
  subido boolean not null default false,
  tipo text not null default 'otro' check (tipo in ('factura_proveedor', 'presupuesto_proveedor', 'factura_cliente', 'foto_obra', 'otro')),
  proveedor text,
  fecha date,
  base numeric(12,2),
  iva numeric(12,2),
  total numeric(12,2),
  notas text,
  leido_ia boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_ficheros_proyecto on estudio_ficheros(proyecto_id, created_at desc);

create table if not exists estudio_costes (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references estudio_proyectos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  categoria text not null check (categoria in ('materiales', 'mano_obra', 'transporte', 'montaje', 'otros')),
  concepto text,
  fecha date,
  importe numeric(12,2) not null check (importe >= 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_costes_proyecto on estudio_costes(proyecto_id);

create table if not exists estudio_cobros (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references estudio_proyectos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  orden int not null default 1,
  concepto text not null,
  pct numeric(6,2),
  importe numeric(12,2) not null check (importe >= 0),   -- con IVA
  fecha_prevista date,
  cobrado boolean not null default false,
  fecha_cobro date,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_cobros_proyecto on estudio_cobros(proyecto_id, orden);

alter table estudio_documentos enable row level security;
alter table estudio_ficheros enable row level security;
alter table estudio_costes enable row level security;
alter table estudio_cobros enable row level security;
do $$ declare t text; begin
  foreach t in array array['estudio_documentos', 'estudio_ficheros', 'estudio_costes', 'estudio_cobros'] loop
    execute format('drop policy if exists "Dueño o admin lee %1$s" on %1$s', t);
    execute format('create policy "Dueño o admin lee %1$s" on %1$s for select using (user_id = auth.uid() or is_admin())', t);
  end loop;
end $$;

update storage.buckets set allowed_mime_types = array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'
] where id = 'estudio';
