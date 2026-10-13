-- =============================================================
-- Estudio Curino · F5: «Mi negocio» y «Créditos y plan» (2026-10)
-- =============================================================
-- 1. Presupuestos con estado (borrador / enviado / aceptado / rechazado),
--    fechas de cada cambio e importes cacheados (sin IVA) para métricas.
-- 2. Venta de crédito con Stripe (cuenta SISTEMA & CURINO):
--    - packs de pago único (estudio_config.packs) → saldo permanente en
--      estudio_saldo (+ compra, − consumo por encima del crédito mensual,
--      − reembolso);
--    - plan mensual (Stripe Billing): mientras está activo da acceso aunque
--      haya caducado el incluido y su crédito mensual (plan_usd).
--    - estudio_compras (packs y cuotas del plan, factura EST-AAAA-NNNNNN,
--      rectificativa R-EST), estudio_suscripciones, estudio_clientes_stripe.
-- 3. estudio_alumnos(): + saldo, suscripción y alumnos que solo tienen plan.
-- Idempotente.

-- ── 1. Estado de los presupuestos ───────────────────────────────
alter table estudio_presupuestos add column if not exists estado text not null default 'borrador';
alter table estudio_presupuestos drop constraint if exists estudio_presupuestos_estado_check;
alter table estudio_presupuestos add constraint estudio_presupuestos_estado_check
  check (estado in ('borrador', 'enviado', 'aceptado', 'rechazado'));
alter table estudio_presupuestos add column if not exists estado_at timestamptz;
alter table estudio_presupuestos add column if not exists enviado_at timestamptz;
alter table estudio_presupuestos add column if not exists aceptado_at timestamptz;
alter table estudio_presupuestos add column if not exists rechazado_at timestamptz;
alter table estudio_presupuestos add column if not exists importe numeric(12,2);   -- total sin IVA (tras descuento)
alter table estudio_presupuestos add column if not exists pvp numeric(12,2);
alter table estudio_presupuestos add column if not exists created_at timestamptz not null default now();

-- ── 2. Venta de crédito ─────────────────────────────────────────
alter table estudio_config add column if not exists packs jsonb not null default
  '[{"id":"p10","eur":10,"usd":8},{"id":"p25","eur":25,"usd":20},{"id":"p50","eur":50,"usd":40}]'::jsonb;
alter table estudio_config add column if not exists plan_eur numeric(10,2) not null default 29;
alter table estudio_config add column if not exists plan_usd numeric(10,2) not null default 15;

create table if not exists estudio_clientes_stripe (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists estudio_suscripciones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  estado text not null,                 -- estados de Stripe: active, past_due, canceled, incomplete…
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists estudio_compras (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  tipo text not null check (tipo in ('pack', 'plan')),
  pack_id text,
  usd numeric(10,2) not null default 0,      -- crédito IA que suma (packs)
  importe_cents int not null check (importe_cents > 0),
  stripe_session_id text unique,
  stripe_invoice_id text unique,
  stripe_payment_intent text,
  stripe_subscription_id text,
  estado text not null default 'pagada' check (estado in ('pagada', 'reembolsada')),
  importe_reembolsado_cents int not null default 0,
  reembolsada_at timestamptz,
  terminos_aceptados boolean not null default false,
  factura_tipo text check (factura_tipo in ('simplificada', 'completa')),
  cliente_nombre_fiscal text,
  cliente_nif text,
  cliente_direccion text,
  invoice_number text,
  pdf_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_compras_pi on estudio_compras(stripe_payment_intent);
create index if not exists idx_estudio_compras_email on estudio_compras(email, created_at desc);

create table if not exists estudio_saldo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (email = lower(email)),
  usd numeric(12,6) not null,                -- + compra · − consumo / reembolso
  motivo text not null check (motivo in ('pack', 'consumo', 'reembolso', 'ajuste')),
  compra_id uuid references estudio_compras(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_saldo_email on estudio_saldo(email);

alter table estudio_clientes_stripe enable row level security;
alter table estudio_suscripciones enable row level security;
alter table estudio_compras enable row level security;
alter table estudio_saldo enable row level security;
drop policy if exists "Dueño o admin lee estudio_suscripciones" on estudio_suscripciones;
create policy "Dueño o admin lee estudio_suscripciones" on estudio_suscripciones for select using (user_id = auth.uid() or is_admin());
drop policy if exists "Dueño o admin lee estudio_compras" on estudio_compras;
create policy "Dueño o admin lee estudio_compras" on estudio_compras for select using (user_id = auth.uid() or is_admin());
drop policy if exists "Dueño o admin lee estudio_saldo" on estudio_saldo;
create policy "Dueño o admin lee estudio_saldo" on estudio_saldo for select using (user_id = auth.uid() or is_admin());

-- Facturas EST / R-EST
create or replace function assign_invoice_number(p_type text, p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_prefix text;
begin
  if p_type not in ('simplified', 'auto_invoice', 'magazine', 'armario', 'clase', 'curso', 'clase_rect', 'sesion', 'sesion_rect', 'one', 'one_rect', 'est', 'est_rect') then
    raise exception 'Invalid invoice type: %', p_type;
  end if;
  if p_year < 2026 or p_year > 2100 then
    raise exception 'Invalid year: %', p_year;
  end if;
  insert into invoice_counters (invoice_type, year, last_number)
    values (p_type, p_year, 0)
    on conflict (invoice_type, year) do nothing;
  update invoice_counters
    set last_number = last_number + 1,
        updated_at = now()
    where invoice_type = p_type and year = p_year
    returning last_number into v_number;
  v_prefix := case p_type
    when 'simplified' then 'CURINO'
    when 'auto_invoice' then 'AUTO'
    when 'magazine' then 'REVISTA'
    when 'armario' then 'AR'
    when 'clase' then 'CLASE'
    when 'curso' then 'CURSO'
    when 'clase_rect' then 'R-CLASE'
    when 'sesion' then 'SESION'
    when 'sesion_rect' then 'R-SESION'
    when 'one' then 'ONE'
    when 'one_rect' then 'R-ONE'
    when 'est' then 'EST'
    when 'est_rect' then 'R-EST'
  end;
  return v_prefix || '-' || p_year::text || '-' || lpad(v_number::text, 6, '0');
end;
$$;

-- El contador de facturas admite los tipos nuevos (check de la tabla legacy)
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'invoice_counters_invoice_type_check') then
    alter table invoice_counters drop constraint invoice_counters_invoice_type_check;
    alter table invoice_counters add constraint invoice_counters_invoice_type_check check (invoice_type in
      ('simplified', 'auto_invoice', 'magazine', 'armario', 'clase', 'curso', 'clase_rect', 'sesion', 'sesion_rect', 'one', 'one_rect', 'est', 'est_rect'));
  end if;
end $$;

alter table facturas_rectificativas_clase drop constraint if exists facturas_rectificativas_clase_serie_check;
alter table facturas_rectificativas_clase add constraint facturas_rectificativas_clase_serie_check
  check (serie in ('clase', 'sesion', 'one', 'est'));
alter table facturas_rectificativas_clase add column if not exists estudio_compra_id uuid
  references estudio_compras(id) on delete set null;

-- ── 3. Alumnos: + saldo y suscripción ───────────────────────────
drop function if exists estudio_alumnos(text);
create or replace function estudio_alumnos(p_email text default null)
returns table (
  email text, nombre text, productos text, inicio timestamptz, fin_curso timestamptz,
  acceso_hasta timestamptz, ampliado boolean, cortado boolean, concedido boolean, activo boolean,
  user_id uuid, credito_usd numeric, gastado_usd numeric, proyectos int, nota text,
  saldo_usd numeric, suscripcion text, suscripcion_hasta timestamptz, puede_suscribirse boolean
)
language sql stable security definer set search_path = public as $$
  with cfg as (select * from estudio_config where id = 1),
  compras as (
    select lower(i.email) as email, i.nombre, 'Intensivo'::text as producto,
           c.fecha as inicio, c.fecha + interval '21 days' as fin
      from inscripciones i join clases c on c.id = i.clase_id
     where i.estado = 'pagada' and coalesce(c.oculta, false) = false
    union all
    select lower(o.email), o.nombre, 'One-to-one', o.created_at, o.created_at + interval '3 months'
      from one_to_one_compras o where o.estado = 'pagada'
  ),
  por_email as (
    select email, (array_agg(nombre order by fin desc))[1] as nombre,
           string_agg(distinct producto, ' + ') as productos, min(inicio) as inicio, max(fin) as fin
      from compras group by email
  ),
  subs as (
    select lower(s.email) as email, s.estado, s.current_period_end,
           (s.estado in ('active', 'trialing', 'past_due') and coalesce(s.current_period_end, now()) >= now()) as vigente
      from estudio_suscripciones s
  ),
  todos as (
    select coalesce(p.email, a.email, s.email) as email, p.nombre, p.productos, p.inicio, p.fin,
           a.acceso_hasta as manual, coalesce(a.cortado, false) as cortado, coalesce(a.concedido, false) as concedido,
           a.credito_mensual_usd, a.nota, s.estado as sus_estado, s.current_period_end as sus_hasta, coalesce(s.vigente, false) as suscrito
      from por_email p
      full join estudio_accesos a on a.email = p.email
      full join subs s on s.email = coalesce(p.email, a.email)
  ),
  calc as (
    select t.*, coalesce(t.manual, t.fin + make_interval(months => (select meses_tras_fin from cfg))) as hasta_incluido
      from todos t
  )
  select c.email, c.nombre, coalesce(c.productos, case when c.concedido then 'Acceso concedido' when c.suscrito then 'Plan mensual' end),
         c.inicio, c.fin,
         case when c.suscrito then greatest(coalesce(c.hasta_incluido, c.sus_hasta), c.sus_hasta) else c.hasta_incluido end,
         c.manual is not null, c.cortado, c.concedido,
         (not c.cortado) and (
           c.suscrito
           or ((c.productos is not null or c.concedido) and coalesce(c.hasta_incluido, 'infinity'::timestamptz) >= now())
         ) as activo,
         u.id,
         case when c.suscrito then greatest(coalesce(c.credito_mensual_usd, (select credito_mensual_usd from cfg)), (select plan_usd from cfg))
              else coalesce(c.credito_mensual_usd, (select credito_mensual_usd from cfg)) end
           + coalesce((select sum(x.usd) from estudio_creditos x where x.email = c.email and x.mes = estudio_mes_actual()), 0),
         coalesce((select sum(us.coste_usd) from estudio_uso us where us.user_id = u.id and us.created_at >= estudio_inicio_mes()), 0),
         coalesce((select count(*)::int from estudio_proyectos pr where pr.user_id = u.id), 0),
         c.nota,
         greatest(0, coalesce((select sum(sa.usd) from estudio_saldo sa where sa.email = c.email), 0)),
         c.sus_estado, c.sus_hasta,
         (not c.cortado) and (c.productos is not null or c.concedido or c.sus_estado is not null)
    from calc c
    left join auth.users u on lower(u.email) = c.email
   where (p_email is null or c.email = lower(p_email))
     and (auth.role() = 'service_role' or is_admin())
$$;
revoke all on function estudio_alumnos(text) from public, anon;
grant execute on function estudio_alumnos(text) to authenticated, service_role;
