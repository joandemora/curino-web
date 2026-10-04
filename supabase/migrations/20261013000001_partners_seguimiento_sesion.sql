-- =============================================================
-- Partners: seguimiento automático de solicitudes + Sesión 1:1 (2026-10)
-- =============================================================
-- 1. partners_solicitudes: marcas de la secuencia de seguimiento, baja,
--    oferta de la sesión y métricas de embudo.
-- 2. sesiones_1a1: compras de la "Sesión 1:1 con Juan · 30 min".
-- 3. Facturación: tipos 'sesion' (SESION-AAAA-NNNNNN) y 'sesion_rect'
--    (R-SESION-AAAA-NNNNNN); la tabla de rectificativas admite sesiones.
-- 4. Bucket privado partners-recursos (recursos adjuntos de la sesión).
-- 5. pg_cron: partners-seguimiento cada 15 min (la función no envía nada
--    mientras PARTNERS_SEGUIMIENTO_ACTIVO no sea 'true').
--
-- Idempotente.

-- -------------------------------------------------------------
-- 1. partners_solicitudes
-- -------------------------------------------------------------
alter table partners_solicitudes add column if not exists completada_at timestamptz;          -- paso 4 respondido
alter table partners_solicitudes add column if not exists aviso_sin_compra_at timestamptz;    -- aviso a Juan (+30 min)
alter table partners_solicitudes add column if not exists seguimiento_1_at timestamptz;       -- +1 h
alter table partners_solicitudes add column if not exists seguimiento_2_at timestamptz;       -- +24 h
alter table partners_solicitudes add column if not exists seguimiento_3_at timestamptz;       -- +48 h (oferta sesión)
alter table partners_solicitudes add column if not exists seguimiento_4_at timestamptz;       -- +72 h (último)
alter table partners_solicitudes add column if not exists oferta_sesion_enviada_at timestamptz; -- inicio ventana 3 h
alter table partners_solicitudes add column if not exists sesion_comprada_at timestamptz;
alter table partners_solicitudes add column if not exists baja_at timestamptz;                -- no más emails
alter table partners_solicitudes add column if not exists precio_visto_at timestamptz;        -- pantalla final con precio
alter table partners_solicitudes add column if not exists checkout_iniciado_at timestamptz;   -- clic en un checkout

create index if not exists idx_partners_solicitudes_seguimiento
  on partners_solicitudes(completada_at)
  where completada_at is not null and pagado_at is null and baja_at is null;

-- -------------------------------------------------------------
-- 2. sesiones_1a1
-- -------------------------------------------------------------
create table if not exists sesiones_1a1 (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid references partners_solicitudes(id) on delete set null,
  nombre text not null,
  email text not null,
  telefono text,
  email_formulario text,
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  importe_cents int not null check (importe_cents > 0),
  precio_tipo text not null check (precio_tipo in ('oferta', 'normal')),
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
  created_at timestamptz not null default now()
);

create index if not exists idx_sesiones_1a1_email on sesiones_1a1(lower(email));
create index if not exists idx_sesiones_1a1_payment_intent on sesiones_1a1(stripe_payment_intent);

alter table sesiones_1a1 enable row level security;
drop policy if exists "Admin can read sesiones_1a1" on sesiones_1a1;
create policy "Admin can read sesiones_1a1" on sesiones_1a1 for select using (is_admin());

-- -------------------------------------------------------------
-- 3. Facturación: 'sesion' y 'sesion_rect'
-- -------------------------------------------------------------
alter table invoice_counters drop constraint if exists invoice_counters_invoice_type_check;
alter table invoice_counters add constraint invoice_counters_invoice_type_check
  check (invoice_type = any (array[
    'simplified'::text, 'auto_invoice'::text, 'magazine'::text, 'armario'::text,
    'clase'::text, 'curso'::text, 'clase_rect'::text, 'sesion'::text, 'sesion_rect'::text
  ]));

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
  if p_type not in ('simplified', 'auto_invoice', 'magazine', 'armario', 'clase', 'curso', 'clase_rect', 'sesion', 'sesion_rect') then
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
  end;
  v_formatted := v_prefix || '-' || p_year::text || '-' || lpad(v_number::text, 6, '0');
  return v_formatted;
end;
$$;

-- Rectificativas: la misma tabla sirve para sesiones (serie R-SESION).
alter table facturas_rectificativas_clase add column if not exists serie text not null default 'clase'
  check (serie in ('clase', 'sesion'));
alter table facturas_rectificativas_clase add column if not exists sesion_id uuid
  references sesiones_1a1(id) on delete set null;

-- -------------------------------------------------------------
-- 4. Bucket privado con los recursos de la sesión (adjuntos del email)
-- -------------------------------------------------------------
-- Subir los PDF a partners-recursos/sesion/. Sin archivos, el email de
-- compra sale sin adjuntos (y la función lo avisa en el log).
insert into storage.buckets (id, name, public)
  values ('partners-recursos', 'partners-recursos', false)
  on conflict (id) do nothing;

-- -------------------------------------------------------------
-- 5. pg_cron: partners-seguimiento cada 15 min
-- -------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'supabase_vault')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('partners-seguimiento')
      where exists (select 1 from cron.job where jobname = 'partners-seguimiento');
    perform cron.schedule(
      'partners-seguimiento',
      '*/15 * * * *',
      $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'clases_functions_url') || '/partners-seguimiento',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'clases_cron_secret')
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  end if;
end $$;
