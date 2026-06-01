-- ============================================================
-- supabase-quotes.sql — Módulo "Presupuestos" del admin
-- ============================================================
-- Crea:
--   1. quote_counters    — secuencia global de numeración (semilla 932)
--   2. quote_settings    — config editable (empresa, IBAN, cláusulas, forma de pago)
--   3. quotes            — cabecera del presupuesto
--   4. quote_lines       — líneas (productos)
--   5. Trigger BEFORE INSERT en quotes que asigna numero auto si viene NULL
--   6. Storage bucket "quote-plans" + policies (admin-only)
--   7. RLS admin-only en todas las tablas
--
-- Dependencias previas:
--   - supabase-user-roles.sql (función is_admin())
-- ============================================================

-- ============================================================
-- 1. quote_counters — contador GLOBAL (NO se resetea por mes/año)
-- ============================================================
create table if not exists quote_counters (
  scope      text primary key,
  next_value bigint not null
);

-- Semilla: el próximo presupuesto que se cree usará el valor 932
-- (Z2606931 fue el último creado a mano antes del módulo).
insert into quote_counters (scope, next_value)
  values ('global', 932)
  on conflict (scope) do nothing;

-- ============================================================
-- 2. quote_settings — config editable (sin hardcodear en JS)
-- ============================================================
create table if not exists quote_settings (
  key        text primary key,
  value      jsonb not null,
  label      text,
  sort_order int default 0,
  updated_at timestamptz default now()
);

-- Seeds iniciales — el admin podrá editar estos valores
insert into quote_settings (key, value, label, sort_order) values
  ('company', jsonb_build_object(
    'razon_social', 'SISTEMA & CURINO SLU',
    'nif', 'B24788580',
    'direccion', 'Carrer de Balmes 379, 2-3',
    'ciudad', '08022 Barcelona',
    'email', 'info@casacurino.com',
    'telefono', '+34 678 660 324',
    'gerente', 'Joan de Deu de Mora Oliveras',
    'lema', 'TAILOR MADE HAUTE FURNITURE'
  ), 'Datos de la empresa', 1),
  ('iban_default', to_jsonb(''::text), 'IBAN por defecto', 2),
  ('payment_schedule_default', jsonb_build_array(
    jsonb_build_object('concepto', 'Confirmación presupuesto', 'pct', 50),
    jsonb_build_object('concepto', 'Entrega materiales',       'pct', 40),
    jsonb_build_object('concepto', 'Final de obra',            'pct', 10)
  ), 'Forma de pago por defecto', 3),
  ('legal_clauses', jsonb_build_array(
    jsonb_build_object('title', 'IVA',
      'body', 'Los precios indicados NO incluyen IVA. El IVA aplicable se añadirá en la factura según la legislación vigente.'),
    jsonb_build_object('title', 'GARANTÍA',
      'body', 'Garantía de dos (2) años sobre defectos de fabricación, contados desde la entrega. No cubre desgaste por uso, mal mantenimiento, manipulación por terceros o daños accidentales.'),
    jsonb_build_object('title', 'EXCLUSIONES',
      'body', 'Quedan excluidos del presupuesto: obra civil, electricidad, fontanería, pintura general de la estancia y cualquier elemento no detallado expresamente en las líneas anteriores.'),
    jsonb_build_object('title', 'VALIDEZ',
      'body', 'Este presupuesto es válido durante el periodo indicado en la cabecera. Transcurrido ese plazo, los precios podrán ser revisados.'),
    jsonb_build_object('title', 'ACUERDO DE REVISIÓN DE PRECIO',
      'body', 'En caso de variaciones del coste de materiales o suministros superiores al 5% entre la firma del presupuesto y el inicio de los trabajos, las partes acuerdan revisar el importe afectado de forma proporcional.')
  ), 'Cláusulas legales', 4)
  on conflict (key) do nothing;

-- ============================================================
-- 3. quotes — cabecera
-- ============================================================
create table if not exists quotes (
  id                uuid primary key default gen_random_uuid(),
  numero            text unique,           -- auto-asignado por trigger si NULL
  fecha             date not null default current_date,
  estado            text not null default 'borrador'
                       check (estado in ('borrador','enviado','aceptado','rechazado','caducado','archivado')),
  validez_dias      int  not null default 30,
  cliente_nombre    text,
  cliente_direccion text,
  cliente_ciudad    text,
  cliente_email     text,
  cliente_tel       text,
  proyecto_nombre   text,
  proyecto_referencia text,
  dto_global_pct    numeric(6,2) not null default 10,
  forma_pago        jsonb not null default
    jsonb_build_array(
      jsonb_build_object('concepto', 'Confirmación presupuesto', 'pct', 50),
      jsonb_build_object('concepto', 'Entrega materiales',       'pct', 40),
      jsonb_build_object('concepto', 'Final de obra',            'pct', 10)
    ),
  iban              text,
  notas_internas    text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists quotes_fecha_idx  on quotes (fecha desc);
create index if not exists quotes_estado_idx on quotes (estado);

-- ============================================================
-- 4. quote_lines — líneas (productos)
-- ============================================================
create table if not exists quote_lines (
  id                   uuid primary key default gen_random_uuid(),
  quote_id             uuid not null references quotes(id) on delete cascade,
  seccion              text not null default 'MOBILIARIO A MEDIDA',
  orden                int  not null default 0,
  cantidad             int  not null default 1 check (cantidad > 0),
  producto_titulo      text,
  producto_descripcion text,
  material_grosor      text,
  ancho                numeric(8,2),
  alto                 numeric(8,2),
  fondo                numeric(8,2),
  precio_unitario      numeric(12,2) not null default 0,
  dto_pct              numeric(6,2)  not null default 10,
  nota                 text,
  imagenes             text[] default '{}'::text[],   -- paths dentro del bucket quote-plans
  created_at           timestamptz not null default now()
);

create index if not exists quote_lines_quote_idx on quote_lines (quote_id, orden);

-- ============================================================
-- 5. Trigger de numeración Z{YY}{MM}{seq} con contador GLOBAL
-- ============================================================
-- - Se dispara BEFORE INSERT en quotes.
-- - Si NEW.numero ya viene rellenado (override manual), no toca nada.
-- - Si viene NULL: incrementa quote_counters atomicamente y compone
--   Z + YY (a partir de NEW.fecha) + MM + seq.
-- - El YYMM es DECORATIVO; la unicidad la garantiza la secuencia global.
create or replace function quotes_assign_numero()
returns trigger
language plpgsql
as $$
declare
  v_seq   bigint;
  v_yy    text;
  v_mm    text;
begin
  if new.numero is not null and length(trim(new.numero)) > 0 then
    return new;  -- override manual
  end if;

  -- Reservar el próximo valor de la secuencia global (atómico)
  update quote_counters
     set next_value = next_value + 1
   where scope = 'global'
  returning next_value - 1 into v_seq;

  if v_seq is null then
    -- Si por algún motivo la fila no existe, la creamos en caliente
    insert into quote_counters (scope, next_value) values ('global', 933);
    v_seq := 932;
  end if;

  v_yy := to_char(coalesce(new.fecha, current_date), 'YY');
  v_mm := to_char(coalesce(new.fecha, current_date), 'MM');
  new.numero := 'Z' || v_yy || v_mm || v_seq::text;
  return new;
end;
$$;

drop trigger if exists quotes_assign_numero_trg on quotes;
create trigger quotes_assign_numero_trg
  before insert on quotes
  for each row execute function quotes_assign_numero();

-- Mantiene updated_at fresco en cada UPDATE
create or replace function quotes_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists quotes_touch_updated_at_trg on quotes;
create trigger quotes_touch_updated_at_trg
  before update on quotes
  for each row execute function quotes_touch_updated_at();

-- ============================================================
-- 6. Storage bucket privado "quote-plans"
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('quote-plans', 'quote-plans', false)
  on conflict (id) do nothing;

create policy "Admins read quote-plans"
  on storage.objects for select
  using (bucket_id = 'quote-plans' and is_admin());

create policy "Admins insert quote-plans"
  on storage.objects for insert
  with check (bucket_id = 'quote-plans' and is_admin());

create policy "Admins update quote-plans"
  on storage.objects for update
  using (bucket_id = 'quote-plans' and is_admin())
  with check (bucket_id = 'quote-plans' and is_admin());

create policy "Admins delete quote-plans"
  on storage.objects for delete
  using (bucket_id = 'quote-plans' and is_admin());

-- ============================================================
-- 7. RLS de tablas — admin-only (sin acceso público)
-- ============================================================
alter table quote_counters enable row level security;
alter table quote_settings enable row level security;
alter table quotes         enable row level security;
alter table quote_lines    enable row level security;

create policy "Admins full quote_counters" on quote_counters
  for all using (is_admin()) with check (is_admin());

create policy "Admins full quote_settings" on quote_settings
  for all using (is_admin()) with check (is_admin());

create policy "Admins full quotes" on quotes
  for all using (is_admin()) with check (is_admin());

create policy "Admins full quote_lines" on quote_lines
  for all using (is_admin()) with check (is_admin());

-- ============================================================
-- FIN. Test de humo (opcional, NO ejecutar en prod):
--   insert into quotes default values returning numero, fecha;
--   -- → 'Z2606932' (si fecha=2026-06-XX)
-- ============================================================
