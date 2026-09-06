-- =============================================================
-- CRM interno de prospección para carpinterías
-- =============================================================
-- Nuevo servicio comercial: Curino llama en nombre de la carpintería
-- cliente a estudios de arquitectura/interiorismo (prescriptores) y
-- agenda reuniones. Esta migración crea sólo el esquema, RLS, la
-- vista de métricas base para la garantía "mes sin reunión, mes
-- gratis" y una vista placeholder para el futuro portal del cliente.
--
-- Convenciones:
--   - Todas las tablas van con prefijo crm_.
--   - id uuid default gen_random_uuid() primary key.
--   - created_at + updated_at con trigger crm_set_updated_at().
--   - Los enums del brief se implementan como CHECK constraints
--     sobre text (patrón del resto del repo, ver `clases.estado`).
--   - RLS activa en las 4 tablas. Staff = JWT claim app_role in
--     ('sdr','admin'), leído vía helper is_crm_staff().
--   - Los prescriptores son un activo compartido de Curino, no del
--     cliente: cliente_asignado es nullable y sólo indica sobre en
--     nombre de quién estamos trabajando ese contacto ahora.

-- =============================================================
-- 0. Helpers
-- =============================================================

-- Trigger de updated_at compartido por las 4 tablas crm_.
create or replace function crm_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Staff check: lee el claim app_role del JWT. Compatible tanto con
-- claim directo como anidado en app_metadata (Supabase estándar).
-- Cuando en el futuro se añada un rol 'cliente_portal', se hará en
-- una migración aparte que amplíe las policies, no esta función.
create or replace function is_crm_staff()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'app_role') in ('sdr','admin'),
    (auth.jwt() ->> 'app_role') in ('sdr','admin'),
    false
  );
$$;

-- =============================================================
-- 1. crm_clientes — carpinterías que contratan el servicio
-- =============================================================
create table if not exists crm_clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nif text,
  persona_contacto text,
  email text,
  telefono text,
  poblacion text,
  territorio text,
  cuota_mensual numeric not null default 1700,
  estado text not null default 'piloto'
    check (estado in ('piloto','activo','pausado','baja')),
  fecha_alta date,
  objetivo_reuniones_mes int not null default 2 check (objetivo_reuniones_mes >= 0),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_clientes_estado on crm_clientes(estado);
create index if not exists idx_crm_clientes_territorio on crm_clientes(territorio);

drop trigger if exists trg_crm_clientes_updated_at on crm_clientes;
create trigger trg_crm_clientes_updated_at
  before update on crm_clientes
  for each row execute function crm_set_updated_at();

-- =============================================================
-- 2. crm_prescriptores — estudios de arquitectura / interiorismo
-- =============================================================
-- Activo compartido: cliente_asignado nullable. Un mismo estudio
-- puede pasar de un cliente a otro sin duplicarse (sólo se reasigna).
create table if not exists crm_prescriptores (
  id uuid primary key default gen_random_uuid(),
  nombre_estudio text not null,
  tipo text not null default 'arquitecto'
    check (tipo in ('arquitecto','interiorista','constructora','otro')),
  persona_contacto text,
  email text,
  telefono text,
  ciudad text,
  territorio text,
  instagram text,
  web text,
  estado text not null default 'frio'
    check (estado in (
      'frio','en_cadencia','contactado','reunion',
      'activo','descartado','no_molestar'
    )),
  cliente_asignado uuid references crm_clientes(id) on delete set null,
  fuente text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Email único case-insensitive sólo cuando existe (permite filas sin email).
create unique index if not exists idx_crm_prescriptores_email_lower_unique
  on crm_prescriptores(lower(email)) where email is not null;

create index if not exists idx_crm_prescriptores_telefono on crm_prescriptores(telefono);
create index if not exists idx_crm_prescriptores_estado on crm_prescriptores(estado);
create index if not exists idx_crm_prescriptores_cliente on crm_prescriptores(cliente_asignado);
create index if not exists idx_crm_prescriptores_territorio on crm_prescriptores(territorio);

drop trigger if exists trg_crm_prescriptores_updated_at on crm_prescriptores;
create trigger trg_crm_prescriptores_updated_at
  before update on crm_prescriptores
  for each row execute function crm_set_updated_at();

-- =============================================================
-- 3. crm_llamadas — registro de cada marcación
-- =============================================================
create table if not exists crm_llamadas (
  id uuid primary key default gen_random_uuid(),
  prescriptor_id uuid not null references crm_prescriptores(id) on delete cascade,
  cliente_id uuid not null references crm_clientes(id) on delete restrict,
  sdr_id uuid references auth.users(id) on delete set null,
  fecha timestamptz not null default now(),
  resultado text not null
    check (resultado in (
      'no_contesta','buzon','recepcion','conversacion',
      'reunion_agendada','no_interesado','volver_a_llamar'
    )),
  duracion_segundos int check (duracion_segundos is null or duracion_segundos >= 0),
  proximo_contacto date,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_llamadas_prescriptor on crm_llamadas(prescriptor_id);
create index if not exists idx_crm_llamadas_cliente on crm_llamadas(cliente_id);
create index if not exists idx_crm_llamadas_sdr on crm_llamadas(sdr_id);
create index if not exists idx_crm_llamadas_fecha on crm_llamadas(fecha desc);
create index if not exists idx_crm_llamadas_proximo on crm_llamadas(proximo_contacto)
  where proximo_contacto is not null;

drop trigger if exists trg_crm_llamadas_updated_at on crm_llamadas;
create trigger trg_crm_llamadas_updated_at
  before update on crm_llamadas
  for each row execute function crm_set_updated_at();

-- =============================================================
-- 4. crm_reuniones — el entregable del servicio
-- =============================================================
create table if not exists crm_reuniones (
  id uuid primary key default gen_random_uuid(),
  prescriptor_id uuid not null references crm_prescriptores(id) on delete restrict,
  cliente_id uuid not null references crm_clientes(id) on delete restrict,
  llamada_id uuid references crm_llamadas(id) on delete set null,
  fecha_reunion timestamptz not null,
  estado text not null default 'agendada'
    check (estado in ('agendada','celebrada','no_show','reprogramada','cancelada')),
  resultado_cliente text not null default 'pendiente'
    check (resultado_cliente in (
      'pendiente','proyecto_en_curso','presupuesto_enviado','sin_interes'
    )),
  valor_estimado numeric,
  notas_sdr text,
  notas_cliente text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_reuniones_cliente_fecha on crm_reuniones(cliente_id, fecha_reunion desc);
create index if not exists idx_crm_reuniones_prescriptor on crm_reuniones(prescriptor_id);
create index if not exists idx_crm_reuniones_llamada on crm_reuniones(llamada_id);
create index if not exists idx_crm_reuniones_estado on crm_reuniones(estado);

drop trigger if exists trg_crm_reuniones_updated_at on crm_reuniones;
create trigger trg_crm_reuniones_updated_at
  before update on crm_reuniones
  for each row execute function crm_set_updated_at();

-- =============================================================
-- 5. Vista crm_metricas_cliente_mes — base de la garantía
-- =============================================================
-- Una fila por cliente y mes con nº de reuniones agendadas y
-- celebradas. Es la fuente para "mes sin reunión = mes gratis".
-- El mes se calcula por fecha_reunion (no por created_at) porque
-- la garantía se computa sobre lo entregado en ese mes natural.
create or replace view crm_metricas_cliente_mes as
select
  cliente_id,
  date_trunc('month', fecha_reunion)::date as mes,
  count(*)::int as reuniones_agendadas,
  count(*) filter (where estado = 'celebrada')::int as reuniones_celebradas
from crm_reuniones
group by cliente_id, date_trunc('month', fecha_reunion);

-- =============================================================
-- 6. Vista crm_portal_reuniones — placeholder para portal cliente
-- =============================================================
-- Sólo columnas de reunión + nombre_estudio (nunca datos de contacto
-- del prescriptor, nunca llamadas). security_invoker = true para que,
-- cuando se añada el rol cliente_portal, la RLS de las tablas base
-- decida qué reuniones ve cada cliente. Hoy sólo staff (is_crm_staff)
-- puede consultarla porque es quien tiene policies en las base.
create or replace view crm_portal_reuniones
with (security_invoker = true) as
select
  r.id,
  r.cliente_id,
  r.fecha_reunion,
  r.estado,
  r.resultado_cliente,
  r.valor_estimado,
  p.nombre_estudio,
  r.created_at,
  r.updated_at
from crm_reuniones r
join crm_prescriptores p on p.id = r.prescriptor_id;

-- =============================================================
-- 7. RLS
-- =============================================================
alter table crm_clientes enable row level security;
alter table crm_prescriptores enable row level security;
alter table crm_llamadas enable row level security;
alter table crm_reuniones enable row level security;

-- Staff (sdr o admin) ve y modifica todo en las 4 tablas.
drop policy if exists "crm_clientes staff all" on crm_clientes;
create policy "crm_clientes staff all"
  on crm_clientes for all
  to authenticated
  using (is_crm_staff())
  with check (is_crm_staff());

drop policy if exists "crm_prescriptores staff all" on crm_prescriptores;
create policy "crm_prescriptores staff all"
  on crm_prescriptores for all
  to authenticated
  using (is_crm_staff())
  with check (is_crm_staff());

drop policy if exists "crm_llamadas staff all" on crm_llamadas;
create policy "crm_llamadas staff all"
  on crm_llamadas for all
  to authenticated
  using (is_crm_staff())
  with check (is_crm_staff());

drop policy if exists "crm_reuniones staff all" on crm_reuniones;
create policy "crm_reuniones staff all"
  on crm_reuniones for all
  to authenticated
  using (is_crm_staff())
  with check (is_crm_staff());

-- Grants: authenticated puede intentar leer/escribir (RLS decide).
-- Anon NUNCA. Portal cliente se resolverá en migración futura con
-- rol propio + policies añadidas a crm_reuniones y crm_prescriptores.
grant select, insert, update, delete on crm_clientes to authenticated;
grant select, insert, update, delete on crm_prescriptores to authenticated;
grant select, insert, update, delete on crm_llamadas to authenticated;
grant select, insert, update, delete on crm_reuniones to authenticated;
grant select on crm_metricas_cliente_mes to authenticated;
grant select on crm_portal_reuniones to authenticated;
