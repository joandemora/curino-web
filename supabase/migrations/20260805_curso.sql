-- =============================================================
-- Pivot /clases: de clase en directo a curso pregrabado
-- =============================================================
-- Producto nuevo: curso pregrabado de 4 videos, 90 EUR IVA incl,
-- comprable 24/7 con acceso inmediato via token.
--
-- La infraestructura del directo (tabla clases, inscripciones,
-- notify-class-reminder, handleClaseCompleted, cron) se conserva
-- INACTIVA para futuras mentorias 1-1: la landing publica ya no
-- lee de clases, pero la tabla + la logica siguen desplegadas.
--
-- Cambios:
--  1. clases.tipo ('directo' | 'mentoria') con backfill a 'directo'
--     para historicos y default 'mentoria' para nuevos.
--  2. Tabla inscripciones_curso (separada, semantica limpia).
--  3. Extension de invoice_counters CHECK + assign_invoice_number
--     con tipo 'curso' -> prefijo CURSO-YYYY-NNNNNN.
--  4. Storage policies para bucket invoices/cursos/.
--
-- No borra nada del directo.

-- =============================================================
-- 1. Columna tipo en clases (directo | mentoria)
-- =============================================================
-- Backfill: cualquier fila existente (si la hubiera) queda como
-- 'directo' porque proviene del producto viejo. En produccion
-- actual la tabla esta vacia -> no-op, pero el bloque queda para
-- futuros entornos.
alter table clases add column if not exists tipo text;
update clases set tipo = 'directo' where tipo is null;
alter table clases alter column tipo set default 'mentoria';
alter table clases alter column tipo set not null;

alter table clases drop constraint if exists clases_tipo_check;
alter table clases add constraint clases_tipo_check
  check (tipo in ('directo', 'mentoria'));

-- =============================================================
-- 2. Tabla inscripciones_curso
-- =============================================================
create table if not exists inscripciones_curso (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text not null,
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  importe_cents int not null check (importe_cents > 0),
  desistimiento_renunciado boolean not null default false,

  -- Token opaco base64url de 32 bytes (43 chars). Se genera en el
  -- webhook con crypto.getRandomValues. UNIQUE para lookups en la
  -- Edge Function curso-acceso.
  access_token text not null unique,

  utm_source text,
  utm_medium text,
  utm_campaign text,

  estado text not null default 'pagada'
    check (estado in ('pagada', 'reembolsada')),

  invoice_number text,   -- CURSO-YYYY-NNNNNN
  pdf_url text,          -- ruta en bucket invoices
  event_id text,         -- UUID compartido con dataLayer para dedup GA4

  confirmation_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_inscripciones_curso_email on inscripciones_curso(lower(email));
create index if not exists idx_inscripciones_curso_token on inscripciones_curso(access_token);
create index if not exists idx_inscripciones_curso_estado on inscripciones_curso(estado);

-- =============================================================
-- 3. RLS: sin policies (service_role only)
-- =============================================================
-- Patron identico a inscripciones / presupuesto_solicitudes:
-- RLS on + sin policies = solo service_role puede leer/escribir.
-- La Edge Function curso-acceso valida el token y devuelve solo
-- lo minimo al cliente (nombre + videos), nunca hace SELECT
-- publico expuesto.
alter table inscripciones_curso enable row level security;

-- =============================================================
-- 4. Extension de invoice_counters con tipo 'curso'
-- =============================================================
-- Ver 20260802_clases.sql para el patron. Cada nuevo tipo requiere
-- extender el CHECK ANTES del primer insert desde la RPC.
alter table invoice_counters drop constraint if exists invoice_counters_invoice_type_check;
alter table invoice_counters add constraint invoice_counters_invoice_type_check
  check (invoice_type = any (array[
    'simplified'::text,
    'auto_invoice'::text,
    'magazine'::text,
    'armario'::text,
    'clase'::text,
    'curso'::text
  ]));

-- =============================================================
-- 5. Extension de assign_invoice_number con 'curso' -> CURSO
-- =============================================================
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
  if p_type not in ('simplified', 'auto_invoice', 'magazine', 'armario', 'clase', 'curso') then
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
  end;
  v_formatted := v_prefix || '-' || p_year::text || '-' || lpad(v_number::text, 6, '0');
  return v_formatted;
end;
$$;

-- =============================================================
-- 6. Storage: bucket 'invoices' -- policies para cursos/<id>.pdf
-- =============================================================
-- Bucket 'invoices' ya existe (Fase E marketplace). Aqui solo se
-- anaden policies para el prefijo cursos/.
--
-- Nota: los compradores del curso son invitados (sin login
-- Supabase). La factura llega adjunta al email de confirmacion;
-- estas policies existen por trazabilidad y coherencia con el
-- resto de tipos (magazine/armario/clase). service_role bypasea
-- RLS y sube sin problema.
drop policy if exists "Buyer can read own curso invoice" on storage.objects;
create policy "Buyer can read own curso invoice"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and name like 'cursos/%.pdf'
    and exists (
      select 1 from inscripciones_curso i
      where i.id::text = split_part(split_part(name, '/', 2), '.', 1)
        and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "Admin can read all curso invoices" on storage.objects;
create policy "Admin can read all curso invoices"
  on storage.objects for select
  using (
    bucket_id = 'invoices'
    and name like 'cursos/%.pdf'
    and is_admin()
  );

-- =============================================================
-- VERIFICACION FINAL (ejecutar manualmente tras aplicar)
-- =============================================================
-- select 'inscripciones_curso' as t, count(*)::text from inscripciones_curso
-- union all select 'clases con tipo', count(*)::text from clases where tipo is not null
-- union all select 'assign_invoice_number CURSO', assign_invoice_number('curso', 2026);
