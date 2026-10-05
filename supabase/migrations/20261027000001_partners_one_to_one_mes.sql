-- =============================================================
-- Partners · one-to-one (3 meses) y mes dinámico del intensivo (2026-10)
-- =============================================================
-- 1. one_to_one_compras: compras del One-to-one (Stripe, purpose
--    'one_to_one', /partners/formaciones). Facturas ONE-AAAA-NNNNNN y
--    rectificativas R-ONE (tabla facturas_rectificativas_clase, serie 'one').
--    Aparece en crm_partners_ventas y en Alumnos (marca: primera sesión
--    agendada). partners_solicitudes.one_to_one_comprado_at.
-- 2. Mes dinámico: el título de las ediciones del intensivo se genera desde
--    su fecha («Intensivo Curino Partners · Noviembre 2026») con un trigger;
--    la pregunta 4 del formulario guarda 'ya' («Ya, en el intensivo de
--    {mes}»); las respuestas antiguas 'octubre'/'noviembre' se conservan.
--    Pasos de secuencia y plantillas: «octubre» → {mes_intensivo}.
-- Idempotente.

-- ── 1. One-to-one ─────────────────────────────────────────────
create table if not exists one_to_one_compras (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid references partners_solicitudes(id) on delete set null,
  nombre text not null,
  email text not null,
  telefono text,
  email_formulario text,
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  importe_cents int not null check (importe_cents > 0),
  estado text not null default 'pagada' check (estado in ('pagada', 'reembolsada')),
  importe_reembolsado_cents int not null default 0 check (importe_reembolsado_cents >= 0),
  reembolsada_at timestamptz,
  terminos_aceptados boolean not null default false,
  terminos_aceptados_at timestamptz,
  factura_tipo text check (factura_tipo in ('simplificada', 'completa')),
  cliente_nombre_fiscal text,
  cliente_nif text,
  cliente_direccion text,
  invoice_number text,
  pdf_url text,
  event_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  confirmation_sent_at timestamptz,
  aviso_enviado_at timestamptz,
  primera_sesion_reservada_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_one_to_one_pi on one_to_one_compras(stripe_payment_intent);
alter table one_to_one_compras enable row level security;
drop policy if exists "Admin can read one_to_one_compras" on one_to_one_compras;
create policy "Admin can read one_to_one_compras" on one_to_one_compras for select using (is_admin());

alter table partners_solicitudes add column if not exists one_to_one_comprado_at timestamptz;

alter table facturas_rectificativas_clase drop constraint if exists facturas_rectificativas_clase_serie_check;
alter table facturas_rectificativas_clase add constraint facturas_rectificativas_clase_serie_check
  check (serie in ('clase', 'sesion', 'one'));
alter table facturas_rectificativas_clase add column if not exists one_to_one_id uuid
  references one_to_one_compras(id) on delete set null;

create or replace function assign_invoice_number(p_type text, p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_prefix text;
  v_formatted text;
begin
  if p_type not in ('simplified', 'auto_invoice', 'magazine', 'armario', 'clase', 'curso', 'clase_rect', 'sesion', 'sesion_rect', 'one', 'one_rect') then
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
  end;
  v_formatted := v_prefix || '-' || p_year::text || '-' || lpad(v_number::text, 6, '0');
  return v_formatted;
end;
$$;

create or replace view crm_partners_ventas with (security_invoker = true) as
select
  'intensivo'::text                         as producto,
  i.id                                      as compra_id,
  i.clase_id                                as edicion_id,
  coalesce(c.titulo, 'Intensivo Curino Partners') as edicion,
  i.created_at                              as fecha,
  i.nombre, i.email, i.telefono,
  i.importe_cents,
  round(i.importe_cents / 1.21)::int        as base_cents,
  i.importe_cents - round(i.importe_cents / 1.21)::int as iva_cents,
  i.invoice_number, i.pdf_url,
  i.estado,
  i.importe_reembolsado_cents,
  r.rect_numeros, r.rect_pdfs,
  ps.id                                     as solicitud_id
from inscripciones i
left join clases c on c.id = i.clase_id
left join partners_solicitudes ps on ps.inscripcion_id = i.id
left join lateral (
  select string_agg(f.invoice_number, ', ' order by f.created_at) as rect_numeros,
         array_agg(f.pdf_url order by f.created_at)               as rect_pdfs
  from facturas_rectificativas_clase f
  where f.inscripcion_id = i.id and f.invoice_number is not null
) r on true
where c.oculta is not true                   -- fuera la edicion de prueba oculta
union all
select
  'sesion'::text, s.id, null::uuid, 'Sesión 1:1 con Juan · 30 min', s.created_at,
  s.nombre, s.email, s.telefono,
  s.importe_cents,
  round(s.importe_cents / 1.21)::int,
  s.importe_cents - round(s.importe_cents / 1.21)::int,
  s.invoice_number, s.pdf_url,
  s.estado,
  s.importe_reembolsado_cents,
  r.rect_numeros, r.rect_pdfs,
  s.solicitud_id
from sesiones_1a1 s
left join lateral (
  select string_agg(f.invoice_number, ', ' order by f.created_at) as rect_numeros,
         array_agg(f.pdf_url order by f.created_at)               as rect_pdfs
  from facturas_rectificativas_clase f
  where f.sesion_id = s.id and f.invoice_number is not null
) r on true
union all
select
  'one_to_one'::text, o.id, null::uuid, 'One-to-one Curino Partners · 3 meses', o.created_at,
  o.nombre, o.email, o.telefono,
  o.importe_cents,
  round(o.importe_cents / 1.21)::int,
  o.importe_cents - round(o.importe_cents / 1.21)::int,
  o.invoice_number, o.pdf_url,
  o.estado,
  o.importe_reembolsado_cents,
  r.rect_numeros, r.rect_pdfs,
  o.solicitud_id
from one_to_one_compras o
left join lateral (
  select string_agg(f.invoice_number, ', ' order by f.created_at) as rect_numeros,
         array_agg(f.pdf_url order by f.created_at)               as rect_pdfs
  from facturas_rectificativas_clase f
  where f.one_to_one_id = o.id and f.invoice_number is not null
) r on true;

create or replace function crm_partners_marcar_alumno(p_tipo text, p_id uuid, p_campo text, p_valor boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v timestamptz := case when p_valor then now() else null end;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_tipo = 'intensivo' and p_campo in ('materiales_enviados_at', 'grupo_whatsapp_at') then
    execute format('update inscripciones set %I = $1 where id = $2', p_campo) using v, p_id;
  elsif p_tipo = 'sesion' and p_campo in ('materiales_enviados_at', 'sesion_reservada_at') then
    execute format('update sesiones_1a1 set %I = $1 where id = $2', p_campo) using v, p_id;
  elsif p_tipo = 'one_to_one' and p_campo in ('primera_sesion_reservada_at') then
    execute format('update one_to_one_compras set %I = $1 where id = $2', p_campo) using v, p_id;
  else
    raise exception 'campo no permitido';
  end if;
  return v;
end;
$$;

-- ── 2. Mes dinámico ───────────────────────────────────────────
alter table partners_solicitudes drop constraint if exists partners_solicitudes_inicio_check;
alter table partners_solicitudes add constraint partners_solicitudes_inicio_check
  check (inicio in ('ya', 'octubre', 'noviembre', 'proximos_meses', 'informandome'));

-- «Intensivo Curino Partners · Noviembre 2026» desde la fecha (hora de Madrid)
create or replace function partners_titulo_edicion(p_fecha timestamptz) returns text
language sql immutable as $$
  select 'Intensivo Curino Partners · '
    || (array['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'])
         [extract(month from (p_fecha at time zone 'Europe/Madrid'))::int]
    || ' ' || extract(year from (p_fecha at time zone 'Europe/Madrid'))::int::text
$$;

-- Ediciones del intensivo: el título sigue a la fecha, salvo títulos
-- especiales puestos a mano (p. ej. la edición de prueba oculta).
create or replace function clases_titulo_desde_fecha() returns trigger
language plpgsql as $$
begin
  if new.tipo = 'directo' and new.fecha is not null
     and (new.titulo is null or new.titulo = '' or new.titulo ~ '^Intensivo Curino Partners · ') then
    new.titulo := partners_titulo_edicion(new.fecha);
  end if;
  return new;
end $$;
drop trigger if exists trg_clases_titulo on clases;
create trigger trg_clases_titulo before insert or update of fecha, titulo on clases
  for each row execute function clases_titulo_desde_fecha();

-- Renombra las ediciones con título automático (la abierta → Noviembre 2026)
update clases set titulo = partners_titulo_edicion(fecha)
 where tipo = 'directo' and fecha is not null and titulo ~ '^Intensivo Curino Partners · ';

-- Pasos de secuencia y plantillas: el mes pasa a ser {mes_intensivo}
update partners_secuencia_pasos set
  asunto = replace(asunto, ' de octubre', ' de {mes_intensivo}'),
  cuerpo = replace(cuerpo, ' de octubre', ' de {mes_intensivo}'),
  updated_at = now()
 where asunto like '% de octubre%' or cuerpo like '% de octubre%';
update partners_email_plantillas set
  asunto = replace(asunto, ' de octubre', ' de {mes_intensivo}'),
  cuerpo = replace(cuerpo, ' de octubre', ' de {mes_intensivo}'),
  updated_at = now()
 where asunto like '% de octubre%' or cuerpo like '% de octubre%';
