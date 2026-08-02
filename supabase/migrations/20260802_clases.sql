-- =============================================================
-- Landing /clases — venta de plaza en clase en directo
-- =============================================================
-- Producto digital único (una plaza), pago Stripe 90 € IVA incl.,
-- email con enlace Meet + factura + recordatorios T-24h/T-1h.
--
-- La landing pública NUNCA lee de la tabla `clases` directamente,
-- solo de la vista `clases_public` (que excluye `meet_url`).
--
-- Persistencia disparada por stripe-webhook al recibir
-- checkout.session.completed con metadata.purpose = 'clase'.

-- =============================================================
-- 1. Tabla clases
-- =============================================================
create table if not exists clases (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null,
  duracion_min int not null default 120,
  plazas_totales int not null default 20 check (plazas_totales > 0),
  plazas_ocupadas int not null default 0 check (plazas_ocupadas >= 0),
  precio_cents int not null default 9000 check (precio_cents > 0),
  meet_url text,
  estado text not null default 'borrador'
    check (estado in ('borrador','abierta','agotada','cerrada','impartida')),
  created_at timestamptz not null default now()
);

create index if not exists idx_clases_estado_fecha on clases(estado, fecha);

-- =============================================================
-- 2. Tabla inscripciones
-- =============================================================
create table if not exists inscripciones (
  id uuid primary key default gen_random_uuid(),
  clase_id uuid not null references clases(id),
  nombre text not null,
  email text not null,
  telefono text,
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  importe_cents int not null check (importe_cents > 0),
  desistimiento_renunciado boolean not null default false,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','pagada','reembolsada')),
  invoice_number text,
  pdf_url text,
  event_id text,
  confirmation_sent_at timestamptz,
  reminder_24h_sent_at timestamptz,
  reminder_1h_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_inscripciones_clase on inscripciones(clase_id);
create index if not exists idx_inscripciones_email on inscripciones(lower(email));
create index if not exists idx_inscripciones_estado on inscripciones(estado);

-- =============================================================
-- 3. Tabla lista_espera
-- =============================================================
create table if not exists lista_espera (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_lista_espera_email on lista_espera(lower(email));
create index if not exists idx_lista_espera_ip_hash_time on lista_espera(ip_hash, created_at);

-- =============================================================
-- 4. Vista pública clases_public
-- =============================================================
-- La landing consulta esta vista con la anon key. NUNCA expone meet_url.
-- Patrón paralelo a magazine_articles_public.
create or replace view clases_public as
select
  id,
  fecha,
  duracion_min,
  plazas_totales,
  plazas_ocupadas,
  precio_cents
from clases
where estado = 'abierta'
order by fecha asc;

grant select on clases_public to anon, authenticated;

-- =============================================================
-- 5. RLS
-- =============================================================
-- Patrón paralelo a presupuesto_solicitudes: RLS on + sin policies para
-- anon/authenticated = solo service_role puede leer/escribir. Los datos
-- del comprador y el meet_url quedan invisibles al público.
alter table clases enable row level security;
alter table inscripciones enable row level security;
alter table lista_espera enable row level security;

-- Única excepción: lista_espera acepta INSERT desde anon (con throttle
-- en la Edge Function lista-espera-relay, no en RLS).
drop policy if exists "Anon insert lista_espera" on lista_espera;
create policy "Anon insert lista_espera"
  on lista_espera for insert
  to anon, authenticated
  with check (true);

-- =============================================================
-- 6. Función atómica de incremento de plaza
-- =============================================================
-- Devuelve la fila actualizada de `clases` si consiguió incrementar
-- (con la garantía de que plazas_ocupadas <= plazas_totales). Si la
-- clase ya estaba agotada, cerrada o no existe, devuelve NULL.
--
-- Si tras el incremento se llena, marca estado='agotada' en la misma
-- transacción para que la landing deje de vender inmediatamente.
create or replace function incrementar_plaza_clase(p_clase_id uuid)
returns clases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row clases%rowtype;
begin
  update clases
    set plazas_ocupadas = plazas_ocupadas + 1
    where id = p_clase_id
      and estado = 'abierta'
      and plazas_ocupadas < plazas_totales
    returning * into v_row;

  if not found then
    return null;
  end if;

  if v_row.plazas_ocupadas >= v_row.plazas_totales then
    update clases set estado = 'agotada'
      where id = v_row.id and estado = 'abierta';
    v_row.estado := 'agotada';
  end if;

  return v_row;
end;
$$;

-- =============================================================
-- 7. Extensión de assign_invoice_number con tipo 'clase' → prefijo CLASE
-- =============================================================
-- Reemplaza la RPC actual (simplified/auto_invoice/magazine/armario)
-- añadiendo 'clase' con prefijo 'CLASE'. Formato CLASE-YYYY-NNNNNN.
-- Idempotente: create or replace + insert on conflict do nothing sobre
-- invoice_counters (creado fuera de repo en Fase E marketplace).
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
  if p_type not in ('simplified', 'auto_invoice', 'magazine', 'armario', 'clase') then
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
  end;
  v_formatted := v_prefix || '-' || p_year::text || '-' || lpad(v_number::text, 6, '0');
  return v_formatted;
end;
$$;

-- =============================================================
-- 8. Storage: bucket 'invoices' — clases/<inscripcion_id>.pdf
-- =============================================================
-- El bucket 'invoices' ya existe (Fase E marketplace). Aquí solo añadimos
-- policies para el prefijo clases/.
--
-- La landing es de invitados (sin login), así que la policy de "buyer
-- reads own" empareja por email en auth.jwt() → funciona solo si el
-- comprador tiene sesión Supabase (caso poco frecuente en /clases).
-- La ruta habitual para acceder al PDF es el adjunto en el email de
-- confirmación (service_role bypasea RLS y genera la URL). Se mantiene
-- por trazabilidad y coherencia con marketplace/magazine/armario.
drop policy if exists "Buyer can read own clase invoice" on storage.objects;
create policy "Buyer can read own clase invoice"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and name like 'clases/%.pdf'
    and exists (
      select 1 from inscripciones i
      where i.id::text = split_part(split_part(name, '/', 2), '.', 1)
        and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "Admin can read all clase invoices" on storage.objects;
create policy "Admin can read all clase invoices"
  on storage.objects for select
  using (
    bucket_id = 'invoices'
    and name like 'clases/%.pdf'
    and is_admin()
  );

-- =============================================================
-- 9. pg_cron: recordatorios de clase (T-24h y T-1h)
-- =============================================================
-- Un cron único que llama cada 10 min a la Edge Function
-- notify-class-reminder. La función decide qué inscripciones tocan
-- recordatorio y marca reminder_24h_sent_at / reminder_1h_sent_at
-- (idempotencia por columna).
--
-- Requiere GUC:
--   alter database postgres set "app.settings.functions_url" = 'https://<PROJECT_REF>.supabase.co/functions/v1';
--   alter database postgres set "app.settings.cron_secret"   = '<CRON_SECRET_random_32B>';
--
-- Documentado en la descripción del PR.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('class-reminders-frequent')
      where exists (select 1 from cron.job where jobname = 'class-reminders-frequent');
    perform cron.schedule(
      'class-reminders-frequent',
      '*/10 * * * *',
      $cron$
        select net.http_post(
          url := current_setting('app.settings.functions_url', true) || '/notify-class-reminder',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Cron-Secret', current_setting('app.settings.cron_secret', true)
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
    raise notice 'pg_cron: class-reminders-frequent scheduled every 10 min';
  else
    raise notice 'pg_cron extension not installed; class-reminders-frequent NOT scheduled';
  end if;
end $$;

-- =============================================================
-- VERIFICACIÓN FINAL (ejecutar manualmente tras aplicar)
-- =============================================================
-- select 'clases' as t, count(*)::text from clases
-- union all select 'inscripciones', count(*)::text from inscripciones
-- union all select 'lista_espera', count(*)::text from lista_espera
-- union all select 'clases_public view', 'ok'
-- union all select 'assign_invoice_number CLASE', assign_invoice_number('clase', extract(year from now())::int);
