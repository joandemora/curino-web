-- =============================================================
-- Carpintería — schema base Fase 1 (proyectos, catálogo, despiece)
-- =============================================================
--
-- Multi-tenant: tablas raíz (clients, projects, materials, hardware,
-- cost_config) tienen owner_id. RLS filtra por owner_id = auth.uid().
-- Las tablas hijas heredan ownership vía join al padre. Por ahora todos
-- los owner_id se rellenan con a36ca0a3-... (admin único), pero el
-- modelo queda listo para multi-carpintero.
--
-- TODO (Fase 2 — nesting): el modelo de veta usa dos sistemas de
-- referencia distintos:
--   - materials.grain_direction: 'long' / 'short' / 'none' referido
--     al lado largo/corto DEL TABLERO.
--   - panels.grain_along: 'width' / 'height' / 'any' referido a las
--     dimensiones DE LA PIEZA.
-- En Fase 2 hay que mapearlo a la rotación permitida en nesting,
-- documentar con casos límite y tests visuales. NO TOCAR en Fase 1.
--
-- Ejecutar manualmente en Supabase Studio.
-- =============================================================

create extension if not exists pgcrypto;

-- =============================================================
-- 1. CLIENTES
-- =============================================================
create table if not exists carpinteria_clients (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null,
  name       text not null,
  email      text,
  phone      text,
  address    text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_carpinteria_clients_owner
  on carpinteria_clients(owner_id);

-- =============================================================
-- 2. CONFIG por carpintero (singleton por owner_id)
--    PK = owner_id. Una fila por carpintero. Se autocrea en la UI
--    al primer guardado de Configuración.
-- =============================================================
create table if not exists carpinteria_cost_config (
  owner_id                          uuid primary key,
  default_margin_percent            numeric(5,2)  not null default 30.00,
  default_vat_percent               numeric(5,2)  not null default 21.00,
  default_rate_cut_per_ml_eur       numeric(10,4) not null default 0.00,
  default_rate_edge_band_per_ml_eur numeric(10,4) not null default 0.00,
  default_kerf_mm                   numeric(6,2)  not null default 4.0,
  default_border_trim_mm            numeric(6,2)  not null default 10.0,

  -- Mapa CONFIGURABLE de capa DXF por tipo de operación. Editar este
  -- JSON cambia el nombre de las capas en los DXF exportados — útil
  -- si el postprocesador CNC pide convenciones específicas.
  dxf_layer_map jsonb not null default '{
    "panel_outline":  "CORTE",
    "drill_through":  "TALADRO_PASANTE",
    "drill_blind":    "TALADRO_CIEGO",
    "hinge_cup":      "BISAGRA",
    "groove":         "RANURA",
    "pocket":         "CAJEADO",
    "router":         "FRESADO",
    "panel_label":    "ETIQUETA"
  }'::jsonb,

  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- =============================================================
-- 3. MATERIALES (tableros + cantos)
-- =============================================================
create table if not exists carpinteria_materials (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  name            text not null,
  type            text not null check (type in ('panel','edge_band')),
  category        text,
  thickness_mm    numeric(6,2) not null,
  grain_direction text not null default 'none'
                    check (grain_direction in ('long','short','none')),

  cost_per_m2_eur numeric(10,4),
  cost_per_ml_eur numeric(10,4),
  sale_per_m2_eur numeric(10,4),
  sale_per_ml_eur numeric(10,4),

  supplier   text,
  reference  text,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pricing_matches_type check (
    (type = 'panel'     and cost_per_m2_eur is not null) or
    (type = 'edge_band' and cost_per_ml_eur is not null)
  )
);
create index if not exists idx_carpinteria_materials_owner
  on carpinteria_materials(owner_id, type, active);

-- =============================================================
-- 4. FORMATOS DE TABLERO (multi-formato por material)
-- =============================================================
create table if not exists carpinteria_material_board_sizes (
  id                 uuid primary key default gen_random_uuid(),
  material_id        uuid not null references carpinteria_materials(id) on delete cascade,
  width_mm           numeric(8,2) not null,
  height_mm          numeric(8,2) not null,
  cost_per_board_eur numeric(10,4),
  sort_order         int not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create index if not exists idx_carpinteria_material_board_sizes_mat
  on carpinteria_material_board_sizes(material_id, active);

-- =============================================================
-- 5. HERRAJES
-- =============================================================
create table if not exists carpinteria_hardware (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null,
  name       text not null,
  category   text,
  reference  text,
  cost_eur   numeric(10,4) not null,
  sale_eur   numeric(10,4),
  supplier   text,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_carpinteria_hardware_owner
  on carpinteria_hardware(owner_id, active);

-- =============================================================
-- 6. PROYECTOS (encargo) — tarifas snapshot del cost_config al crear
-- =============================================================
create table if not exists carpinteria_projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  client_id   uuid references carpinteria_clients(id) on delete set null,
  code        text not null,
  name        text not null,
  status      text not null default 'draft'
              check (status in ('draft','quoted','accepted','in_production','delivered','archived')),

  -- Tarifas snapshot (editables por proyecto)
  margin_percent             numeric(5,2)  not null,
  vat_percent                numeric(5,2)  not null,
  rate_cut_per_ml_eur        numeric(10,4) not null,
  rate_edge_band_per_ml_eur  numeric(10,4) not null,

  -- Nesting params snapshot (sin uso en Fase 1; se rellenan al crear)
  kerf_mm        numeric(6,2) not null,
  border_trim_mm numeric(6,2) not null,

  -- Extensibilidad de costes (futuro)
  fixed_assembly_eur numeric(10,2),
  extra_costs        jsonb not null default '[]'::jsonb,

  notes        text,
  quoted_at    timestamptz,
  accepted_at  timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (owner_id, code)
);
create index if not exists idx_carpinteria_projects_owner
  on carpinteria_projects(owner_id, status);
create index if not exists idx_carpinteria_projects_client
  on carpinteria_projects(client_id);

-- =============================================================
-- 7. MUEBLES
-- =============================================================
create table if not exists carpinteria_furnitures (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references carpinteria_projects(id) on delete cascade,
  code        text not null,
  name        text not null,
  description text,
  width_mm    numeric(8,2),
  height_mm   numeric(8,2),
  depth_mm    numeric(8,2),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (project_id, code)
);
create index if not exists idx_carpinteria_furnitures_project
  on carpinteria_furnitures(project_id, sort_order);

-- =============================================================
-- 8. PIEZAS
-- =============================================================
create table if not exists carpinteria_panels (
  id           uuid primary key default gen_random_uuid(),
  furniture_id uuid not null references carpinteria_furnitures(id) on delete cascade,
  material_id  uuid not null references carpinteria_materials(id) on delete restrict,
  code         text not null,
  name         text not null,

  qty          int  not null default 1 check (qty > 0),
  width_mm     numeric(8,2) not null,
  height_mm    numeric(8,2) not null,
  thickness_mm numeric(6,2) not null,

  -- Veta de la pieza (ver TODO Fase 2 sobre el cruce con grain_direction).
  grain_along  text not null default 'any'
                check (grain_along in ('width','height','any')),

  notes      text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (furniture_id, code),
  check (width_mm > 0 and height_mm > 0 and thickness_mm > 0)
);
create index if not exists idx_carpinteria_panels_furniture
  on carpinteria_panels(furniture_id, sort_order);
create index if not exists idx_carpinteria_panels_material
  on carpinteria_panels(material_id);

-- =============================================================
-- 9. BORDES DE PIEZA
-- =============================================================
create table if not exists carpinteria_panel_edges (
  id               uuid primary key default gen_random_uuid(),
  panel_id         uuid not null references carpinteria_panels(id) on delete cascade,
  edge             text not null check (edge in ('top','right','bottom','left')),
  edge_material_id uuid not null references carpinteria_materials(id) on delete restrict,
  unique (panel_id, edge)
);
create index if not exists idx_carpinteria_panel_edges_panel
  on carpinteria_panel_edges(panel_id);

-- =============================================================
-- 9b. TRIGGER: validar que edge_material_id apunta a type='edge_band'
--     (defensa en BD; complementa validación cliente)
-- =============================================================
create or replace function carpinteria_validate_edge_material()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select type into v_type from carpinteria_materials where id = new.edge_material_id;
  if v_type is null then
    raise exception 'edge_material_id no existe en carpinteria_materials'
      using errcode = '23503';
  end if;
  if v_type <> 'edge_band' then
    raise exception 'edge_material_id debe tener type=edge_band, recibido: %', v_type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_carpinteria_validate_edge_material on carpinteria_panel_edges;
create trigger trg_carpinteria_validate_edge_material
  before insert or update on carpinteria_panel_edges
  for each row execute function carpinteria_validate_edge_material();

-- =============================================================
-- 10. MECANIZADOS
-- =============================================================
create table if not exists carpinteria_panel_operations (
  id          uuid primary key default gen_random_uuid(),
  panel_id    uuid not null references carpinteria_panels(id) on delete cascade,
  type        text not null check (type in (
    'drill_through','drill_blind','hinge_cup','groove','pocket','router'
  )),
  x_mm        numeric(8,2) not null,
  y_mm        numeric(8,2) not null,
  diameter_mm numeric(6,2),
  depth_mm    numeric(6,2),
  length_mm   numeric(8,2),
  width_op_mm numeric(8,2),
  angle_deg   numeric(6,2) not null default 0,
  hardware_id uuid references carpinteria_hardware(id) on delete set null,
  notes       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_carpinteria_panel_ops_panel
  on carpinteria_panel_operations(panel_id);

-- =============================================================
-- 11. HERRAJES POR MUEBLE
-- =============================================================
create table if not exists carpinteria_furniture_hardware (
  id           uuid primary key default gen_random_uuid(),
  furniture_id uuid not null references carpinteria_furnitures(id) on delete cascade,
  hardware_id  uuid not null references carpinteria_hardware(id) on delete restrict,
  qty          int  not null default 1 check (qty > 0),
  notes        text,
  unique (furniture_id, hardware_id)
);
create index if not exists idx_carpinteria_furniture_hw_furniture
  on carpinteria_furniture_hardware(furniture_id);

-- =============================================================
-- 12. NESTINGS (sólo schema en Fase 1; el motor llega en Fase 2)
-- =============================================================
create table if not exists carpinteria_nestings (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references carpinteria_projects(id) on delete cascade,
  label             text,
  algorithm         text not null default 'maxrects',
  kerf_mm           numeric(6,2) not null,
  border_trim_mm    numeric(6,2) not null,
  total_boards_used int not null,
  total_waste_m2    numeric(10,4),
  efficiency_pct    numeric(5,2),
  result_json       jsonb not null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_carpinteria_nestings_project
  on carpinteria_nestings(project_id, created_at desc);

-- =============================================================
-- TRIGGERS updated_at (en raíces que tienen updated_at)
-- =============================================================
create or replace function carpinteria_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'carpinteria_clients','carpinteria_materials','carpinteria_hardware',
    'carpinteria_projects','carpinteria_furnitures','carpinteria_panels'
  ])
  loop
    execute format('drop trigger if exists trg_touch_%I on %I', t, t);
    execute format(
      'create trigger trg_touch_%I before update on %I '
      'for each row execute function carpinteria_touch_updated_at()',
      t, t
    );
  end loop;
end $$;

-- =============================================================
-- RLS — Multi-tenant por owner_id
-- =============================================================
-- Tablas raíz: filtran directamente por owner_id = auth.uid().
-- Tablas hijas: filtran vía EXISTS (...) al padre.
-- =============================================================

-- 1. CLIENTS
alter table carpinteria_clients enable row level security;
drop policy if exists "owner crud clients" on carpinteria_clients;
create policy "owner crud clients" on carpinteria_clients
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 2. COST_CONFIG (PK = owner_id)
alter table carpinteria_cost_config enable row level security;
drop policy if exists "owner crud cost_config" on carpinteria_cost_config;
create policy "owner crud cost_config" on carpinteria_cost_config
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 3. MATERIALS
alter table carpinteria_materials enable row level security;
drop policy if exists "owner crud materials" on carpinteria_materials;
create policy "owner crud materials" on carpinteria_materials
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 4. MATERIAL_BOARD_SIZES (hereda de materials)
alter table carpinteria_material_board_sizes enable row level security;
drop policy if exists "owner crud material_board_sizes" on carpinteria_material_board_sizes;
create policy "owner crud material_board_sizes" on carpinteria_material_board_sizes
  for all
  using (exists (select 1 from carpinteria_materials m
                 where m.id = carpinteria_material_board_sizes.material_id
                   and m.owner_id = auth.uid()))
  with check (exists (select 1 from carpinteria_materials m
                      where m.id = carpinteria_material_board_sizes.material_id
                        and m.owner_id = auth.uid()));

-- 5. HARDWARE
alter table carpinteria_hardware enable row level security;
drop policy if exists "owner crud hardware" on carpinteria_hardware;
create policy "owner crud hardware" on carpinteria_hardware
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 6. PROJECTS
alter table carpinteria_projects enable row level security;
drop policy if exists "owner crud projects" on carpinteria_projects;
create policy "owner crud projects" on carpinteria_projects
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 7. FURNITURES (hereda de projects)
alter table carpinteria_furnitures enable row level security;
drop policy if exists "owner crud furnitures" on carpinteria_furnitures;
create policy "owner crud furnitures" on carpinteria_furnitures
  for all
  using (exists (select 1 from carpinteria_projects p
                 where p.id = carpinteria_furnitures.project_id
                   and p.owner_id = auth.uid()))
  with check (exists (select 1 from carpinteria_projects p
                      where p.id = carpinteria_furnitures.project_id
                        and p.owner_id = auth.uid()));

-- 8. PANELS (hereda de furniture → project)
alter table carpinteria_panels enable row level security;
drop policy if exists "owner crud panels" on carpinteria_panels;
create policy "owner crud panels" on carpinteria_panels
  for all
  using (exists (select 1 from carpinteria_furnitures f
                 join carpinteria_projects p on p.id = f.project_id
                 where f.id = carpinteria_panels.furniture_id
                   and p.owner_id = auth.uid()))
  with check (exists (select 1 from carpinteria_furnitures f
                      join carpinteria_projects p on p.id = f.project_id
                      where f.id = carpinteria_panels.furniture_id
                        and p.owner_id = auth.uid()));

-- 9. PANEL_EDGES (hereda de panel → furniture → project)
alter table carpinteria_panel_edges enable row level security;
drop policy if exists "owner crud panel_edges" on carpinteria_panel_edges;
create policy "owner crud panel_edges" on carpinteria_panel_edges
  for all
  using (exists (select 1 from carpinteria_panels pn
                 join carpinteria_furnitures f on f.id = pn.furniture_id
                 join carpinteria_projects p on p.id = f.project_id
                 where pn.id = carpinteria_panel_edges.panel_id
                   and p.owner_id = auth.uid()))
  with check (exists (select 1 from carpinteria_panels pn
                      join carpinteria_furnitures f on f.id = pn.furniture_id
                      join carpinteria_projects p on p.id = f.project_id
                      where pn.id = carpinteria_panel_edges.panel_id
                        and p.owner_id = auth.uid()));

-- 10. PANEL_OPERATIONS
alter table carpinteria_panel_operations enable row level security;
drop policy if exists "owner crud panel_operations" on carpinteria_panel_operations;
create policy "owner crud panel_operations" on carpinteria_panel_operations
  for all
  using (exists (select 1 from carpinteria_panels pn
                 join carpinteria_furnitures f on f.id = pn.furniture_id
                 join carpinteria_projects p on p.id = f.project_id
                 where pn.id = carpinteria_panel_operations.panel_id
                   and p.owner_id = auth.uid()))
  with check (exists (select 1 from carpinteria_panels pn
                      join carpinteria_furnitures f on f.id = pn.furniture_id
                      join carpinteria_projects p on p.id = f.project_id
                      where pn.id = carpinteria_panel_operations.panel_id
                        and p.owner_id = auth.uid()));

-- 11. FURNITURE_HARDWARE
alter table carpinteria_furniture_hardware enable row level security;
drop policy if exists "owner crud furniture_hardware" on carpinteria_furniture_hardware;
create policy "owner crud furniture_hardware" on carpinteria_furniture_hardware
  for all
  using (exists (select 1 from carpinteria_furnitures f
                 join carpinteria_projects p on p.id = f.project_id
                 where f.id = carpinteria_furniture_hardware.furniture_id
                   and p.owner_id = auth.uid()))
  with check (exists (select 1 from carpinteria_furnitures f
                      join carpinteria_projects p on p.id = f.project_id
                      where f.id = carpinteria_furniture_hardware.furniture_id
                        and p.owner_id = auth.uid()));

-- 12. NESTINGS
alter table carpinteria_nestings enable row level security;
drop policy if exists "owner crud nestings" on carpinteria_nestings;
create policy "owner crud nestings" on carpinteria_nestings
  for all
  using (exists (select 1 from carpinteria_projects p
                 where p.id = carpinteria_nestings.project_id
                   and p.owner_id = auth.uid()))
  with check (exists (select 1 from carpinteria_projects p
                      where p.id = carpinteria_nestings.project_id
                        and p.owner_id = auth.uid()));

-- =============================================================
-- VERIFICACIÓN FINAL
-- =============================================================
select 'tablas creadas' as item, count(*)::text as count
  from information_schema.tables
  where table_name like 'carpinteria_%'
union all
select 'policies creadas', count(*)::text from pg_policies
  where tablename like 'carpinteria_%'
union all
select 'trigger edge_band validator', count(*)::text from pg_trigger
  where tgname = 'trg_carpinteria_validate_edge_material'
union all
select 'triggers updated_at', count(*)::text from pg_trigger
  where tgname like 'trg_touch_carpinteria_%';
