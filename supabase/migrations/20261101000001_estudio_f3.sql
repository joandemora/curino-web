-- =============================================================
-- Estudio Curino · F3: tarifas, plantillas y presupuestos (2026-10)
-- =============================================================
-- - estudio_tarifas: precios PVP sin IVA por concepto (_shared/estudio/
--   tarifa.ts; null = PENDIENTE), descuento profesional e IVA. user_id null
--   = tarifa Curino por defecto (la edita admin); una por alumno (F4).
-- - estudio_plantillas: emisor y textos del presupuesto por usuario (JSON
--   Plantilla de presupuesto.ts). Admin = SISTEMA & CURINO; alumno = sus
--   datos (la Edge Function rechaza los de Curino).
-- - estudio_presupuestos: el presupuesto editable de cada proyecto (JSON
--   DocPresupuesto).
-- Escrituras solo desde estudio-ia (service_role). Idempotente.

create table if not exists estudio_tarifas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  valores jsonb not null default '{}'::jsonb,
  descuento_pct numeric(5,2) default 30 check (descuento_pct between 0 and 100),
  iva_pct numeric(5,2) default 21 check (iva_pct between 0 and 100),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_estudio_tarifas_user on estudio_tarifas (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
insert into estudio_tarifas (user_id) select null where not exists (select 1 from estudio_tarifas where user_id is null);

create table if not exists estudio_plantillas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  datos jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists estudio_presupuestos (
  proyecto_id uuid primary key references estudio_proyectos(id) on delete cascade,
  datos jsonb not null,
  updated_at timestamptz not null default now()
);

alter table estudio_tarifas enable row level security;
alter table estudio_plantillas enable row level security;
alter table estudio_presupuestos enable row level security;

drop policy if exists "Lee su tarifa, la de Curino o admin" on estudio_tarifas;
create policy "Lee su tarifa, la de Curino o admin" on estudio_tarifas for select
  using (user_id is null or user_id = auth.uid() or is_admin());
drop policy if exists "Dueño o admin lee estudio_plantillas" on estudio_plantillas;
create policy "Dueño o admin lee estudio_plantillas" on estudio_plantillas for select
  using (user_id = auth.uid() or is_admin());
drop policy if exists "Dueño o admin lee estudio_presupuestos" on estudio_presupuestos;
create policy "Dueño o admin lee estudio_presupuestos" on estudio_presupuestos for select
  using (exists (select 1 from estudio_proyectos p where p.id = proyecto_id and (p.user_id = auth.uid() or is_admin())));
