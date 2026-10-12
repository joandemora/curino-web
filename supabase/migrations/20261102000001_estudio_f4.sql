-- =============================================================
-- Estudio Curino · F4: acceso de alumnos, créditos y uso (2026-10)
-- =============================================================
-- Alumno activo = compra pagada (sin reembolso) del Intensivo (edición no
-- oculta; fin = fecha de la 1.ª clase + 21 días, 4 clases semanales) o del
-- One-to-one (fin = compra + 3 meses); acceso hasta fin + meses_tras_fin
-- (def. 6). Admin puede ampliar (acceso_hasta), cortar o conceder acceso
-- sin compra (estudio_accesos). Mientras estudio_config.abierto_alumnos =
-- false, solo entran admin y los accesos «concedidos» (pruebas).
-- Crédito mensual de IA (USD): estudio_config.credito_mensual_usd (def. 10)
-- o el personalizado del alumno + ampliaciones del mes (estudio_creditos).
-- Gasto = suma de estudio_uso.coste_usd del mes (hora de Madrid).
-- Idempotente.

alter table estudio_config add column if not exists credito_mensual_usd numeric(10,2) not null default 10;
alter table estudio_config add column if not exists meses_tras_fin int not null default 6;
alter table estudio_config add column if not exists abierto_alumnos boolean not null default false;

create table if not exists estudio_accesos (
  email text primary key check (email = lower(email)),
  acceso_hasta timestamptz,              -- null = el calculado por compras
  cortado boolean not null default false,
  concedido boolean not null default false,  -- acceso sin compra (pruebas, invitados)
  credito_mensual_usd numeric(10,2),     -- null = el de estudio_config
  nota text,
  updated_at timestamptz not null default now()
);

create table if not exists estudio_creditos (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  usd numeric(10,2) not null check (usd > 0),
  nota text,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_creditos_email_mes on estudio_creditos(email, mes);

create table if not exists estudio_enlaces (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  enviado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_estudio_enlaces_email on estudio_enlaces(email, created_at desc);

alter table estudio_accesos enable row level security;
alter table estudio_creditos enable row level security;
alter table estudio_enlaces enable row level security;
drop policy if exists "Admin lee estudio_accesos" on estudio_accesos;
create policy "Admin lee estudio_accesos" on estudio_accesos for select using (is_admin());
drop policy if exists "Admin o el alumno lee estudio_creditos" on estudio_creditos;
create policy "Admin o el alumno lee estudio_creditos" on estudio_creditos for select
  using (is_admin() or email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Mes actual en Madrid y su inicio en UTC
create or replace function estudio_mes_actual() returns text language sql stable as $$
  select to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM')
$$;
create or replace function estudio_inicio_mes() returns timestamptz language sql stable as $$
  select date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'
$$;

-- Alumnos (compras + accesos manuales) con su estado, crédito y gasto del mes.
-- Solo para service_role (Edge Function) y admin.
create or replace function estudio_alumnos(p_email text default null)
returns table (
  email text, nombre text, productos text, inicio timestamptz, fin_curso timestamptz,
  acceso_hasta timestamptz, ampliado boolean, cortado boolean, concedido boolean, activo boolean,
  user_id uuid, credito_usd numeric, gastado_usd numeric, proyectos int, nota text
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
  todos as (
    select coalesce(p.email, a.email) as email, p.nombre, p.productos, p.inicio, p.fin,
           a.acceso_hasta as manual, coalesce(a.cortado, false) as cortado, coalesce(a.concedido, false) as concedido,
           a.credito_mensual_usd, a.nota
      from por_email p full join estudio_accesos a on a.email = p.email
  )
  select t.email, t.nombre, coalesce(t.productos, case when t.concedido then 'Acceso concedido' end),
         t.inicio, t.fin,
         coalesce(t.manual, t.fin + make_interval(months => (select meses_tras_fin from cfg))) as acceso_hasta,
         t.manual is not null, t.cortado, t.concedido,
         (not t.cortado) and (t.productos is not null or t.concedido)
           and coalesce(t.manual, t.fin + make_interval(months => (select meses_tras_fin from cfg)), 'infinity'::timestamptz) >= now() as activo,
         u.id,
         coalesce(t.credito_mensual_usd, (select credito_mensual_usd from cfg))
           + coalesce((select sum(x.usd) from estudio_creditos x where x.email = t.email and x.mes = estudio_mes_actual()), 0),
         coalesce((select sum(us.coste_usd) from estudio_uso us where us.user_id = u.id and us.created_at >= estudio_inicio_mes()), 0),
         coalesce((select count(*)::int from estudio_proyectos pr where pr.user_id = u.id), 0),
         t.nota
    from todos t
    left join auth.users u on lower(u.email) = t.email
   where (p_email is null or t.email = lower(p_email))
     and (auth.role() = 'service_role' or is_admin())
$$;
revoke all on function estudio_alumnos(text) from public, anon;
grant execute on function estudio_alumnos(text) to authenticated, service_role;
