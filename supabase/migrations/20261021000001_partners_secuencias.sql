-- =============================================================
-- Partners · secuencias editables desde el panel (2026-10)
-- =============================================================
-- partners_secuencias: nombre, activa, disparador, salidas y franja de envio.
-- partners_secuencia_pasos: cada email (retraso desde el disparador, asunto,
--   cuerpo con el formato del editor de Emails, activo y condiciones).
-- partners_secuencia_estado: que paso se ha enviado o saltado a cada
--   solicitud (unico por solicitud y paso → nunca se repite).
-- partners_emails.paso_id / secuencia_id / clicado_at: metricas por paso.
-- La secuencia actual (antes en codigo) se migra como «Seguimiento solicitud
-- intensivo» con los mismos textos, tiempos y reglas, y lo ya enviado se
-- registra para no repetirlo.
-- Admin: lee y edita secuencias y pasos (RLS is_admin()); un paso solo se
-- puede borrar si nunca se ha enviado. Escribe el estado solo service_role.
-- Idempotente.

create table if not exists partners_secuencias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activa boolean not null default false,
  disparador text not null default 'solicitud_completa_sin_compra'
    check (disparador in ('solicitud_completa_sin_compra')),
  -- Salidas: baja y borrado siempre; compras configurables.
  sale_compra_intensivo boolean not null default true,
  sale_compra_sesion boolean not null default false,
  -- Franja de envio (hora de Madrid). Fuera de ella se espera a la siguiente.
  franja_inicio time not null default '09:00',
  franja_fin time not null default '21:30',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists partners_secuencia_pasos (
  id uuid primary key default gen_random_uuid(),
  secuencia_id uuid not null references partners_secuencias(id) on delete restrict,
  orden int not null default 0,
  nombre text not null default '',
  retraso_minutos int not null default 60 check (retraso_minutos >= 0),
  asunto text not null default '',
  cuerpo text not null default '',
  activo boolean not null default true,
  -- Condiciones propias del paso (si no se cumplen, se salta para ese contacto)
  req_comercial boolean not null default false,       -- consentimiento_comercial
  req_sesion_activa boolean not null default false,   -- PARTNERS_SEGUIMIENTO_SESION_ACTIVO
  req_plazas boolean not null default false,          -- edicion abierta con plazas
  no_si_sesion_comprada boolean not null default false,
  activa_oferta_sesion boolean not null default false, -- marca oferta_sesion_enviada_at (precio 60 € 3 h)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_secuencia_pasos_sec on partners_secuencia_pasos(secuencia_id, retraso_minutos);

create table if not exists partners_secuencia_estado (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references partners_solicitudes(id) on delete cascade,
  secuencia_id uuid not null references partners_secuencias(id) on delete restrict,
  paso_id uuid not null references partners_secuencia_pasos(id) on delete restrict,
  estado text not null check (estado in ('enviado', 'saltado')),
  motivo text,
  email_id uuid,
  created_at timestamptz not null default now(),
  unique (solicitud_id, paso_id)
);
create index if not exists idx_secuencia_estado_sol on partners_secuencia_estado(solicitud_id);

alter table partners_emails add column if not exists secuencia_id uuid references partners_secuencias(id) on delete set null;
alter table partners_emails add column if not exists paso_id uuid references partners_secuencia_pasos(id) on delete set null;
alter table partners_emails add column if not exists clicado_at timestamptz;
create index if not exists idx_partners_emails_paso on partners_emails(paso_id);

-- RLS
alter table partners_secuencias enable row level security;
drop policy if exists "Admin reads secuencias" on partners_secuencias;
create policy "Admin reads secuencias" on partners_secuencias for select using (is_admin());
drop policy if exists "Admin inserts secuencias" on partners_secuencias;
create policy "Admin inserts secuencias" on partners_secuencias for insert to authenticated with check (is_admin());
drop policy if exists "Admin updates secuencias" on partners_secuencias;
create policy "Admin updates secuencias" on partners_secuencias for update to authenticated using (is_admin()) with check (is_admin());

alter table partners_secuencia_pasos enable row level security;
drop policy if exists "Admin reads pasos" on partners_secuencia_pasos;
create policy "Admin reads pasos" on partners_secuencia_pasos for select using (is_admin());
drop policy if exists "Admin inserts pasos" on partners_secuencia_pasos;
create policy "Admin inserts pasos" on partners_secuencia_pasos for insert to authenticated with check (is_admin());
drop policy if exists "Admin updates pasos" on partners_secuencia_pasos;
create policy "Admin updates pasos" on partners_secuencia_pasos for update to authenticated using (is_admin()) with check (is_admin());
-- Borrar solo si nunca se ha enviado a nadie (si no, solo desactivar).
drop policy if exists "Admin deletes pasos sin envios" on partners_secuencia_pasos;
create policy "Admin deletes pasos sin envios" on partners_secuencia_pasos for delete to authenticated using (
  is_admin()
  and not exists (select 1 from partners_emails e where e.paso_id = partners_secuencia_pasos.id and e.tipo <> 'prueba')
  and not exists (select 1 from partners_secuencia_estado x where x.paso_id = partners_secuencia_pasos.id)
);

alter table partners_secuencia_estado enable row level security;
drop policy if exists "Admin reads secuencia_estado" on partners_secuencia_estado;
create policy "Admin reads secuencia_estado" on partners_secuencia_estado for select using (is_admin());

-- Metricas por paso. Bajas y compras se atribuyen al ultimo email de
-- secuencia recibido antes (hasta el siguiente email de secuencia).
create or replace view crm_partners_secuencia_metricas with (security_invoker = true) as
with e as (
  select id, paso_id, solicitud_id, created_at, estado, abierto_at, clicado_at,
         lead(created_at) over (partition by solicitud_id order by created_at) as siguiente_at
    from partners_emails
   where tipo = 'secuencia' and paso_id is not null
)
select p.id as paso_id, p.secuencia_id,
  count(e.id) as enviados,
  count(e.id) filter (where e.estado in ('entregado', 'abierto')) as entregados,
  count(e.id) filter (where e.abierto_at is not null) as abiertos,
  count(e.id) filter (where e.clicado_at is not null) as clics,
  count(e.id) filter (where s.baja_at >= e.created_at and (e.siguiente_at is null or s.baja_at < e.siguiente_at)) as bajas,
  count(e.id) filter (where (s.pagado_at >= e.created_at and (e.siguiente_at is null or s.pagado_at < e.siguiente_at))
                         or (s.sesion_comprada_at >= e.created_at and (e.siguiente_at is null or s.sesion_comprada_at < e.siguiente_at))) as compras,
  (select count(*) from partners_secuencia_estado x where x.paso_id = p.id and x.estado = 'saltado') as saltados
from partners_secuencia_pasos p
left join e on e.paso_id = p.id
left join partners_solicitudes s on s.id = e.solicitud_id
group by p.id, p.secuencia_id;
revoke all on crm_partners_secuencia_metricas from anon;
grant select on crm_partners_secuencia_metricas to authenticated;

-- -------------------------------------------------------------
-- Migracion de la secuencia actual (ids fijos para que sea idempotente)
-- -------------------------------------------------------------
insert into partners_secuencias (id, nombre, activa, disparador, sale_compra_intensivo, sale_compra_sesion)
values ('5e9a0001-0000-4000-8000-000000000001', 'Seguimiento solicitud intensivo', true, 'solicitud_completa_sin_compra', true, false)
on conflict (id) do nothing;

insert into partners_secuencia_pasos (id, secuencia_id, orden, nombre, retraso_minutos, asunto, cuerpo,
  req_comercial, req_sesion_activa, req_plazas, no_si_sesion_comprada, activa_oferta_sesion) values
('5e9a0001-0000-4000-8000-000000000011', '5e9a0001-0000-4000-8000-000000000001', 1, 'Enlace por si se cerró', 60,
 '{nombre}, te dejo el enlace por si se te cerró',
$b$Hola {nombre},

Te escribo por si se te cerró la página después de rellenar la solicitud del Intensivo Curino Partners.

Te recuerdo lo que incluye:
· 4 semanas y 8 clases en directo por Zoom conmigo.
· El negocio, producto y producción, diseño y presupuesto, y cómo vender y entregar.
· Plantilla de presupuesto, contrato de venta, catálogo y acceso al CAD de Curino.
· El grupo de WhatsApp de tu promoción.

Aquí tienes el enlace para reservar tu plaza:

[[Reservar mi plaza]]({enlace_plaza})

Si tienes cualquier duda, respóndeme a este email o [escríbeme por WhatsApp]({enlace_whatsapp}).$b$,
 false, false, false, false, false),
('5e9a0001-0000-4000-8000-000000000012', '5e9a0001-0000-4000-8000-000000000001', 2, 'Caso Maria Alcalde + 3 dudas', 1440,
 'El tipo de proyecto que vas a aprender a vender',
$b$Hola {nombre},

Te enseño un proyecto real: el armario a medida que hicimos para Maria Alcalde. Ella misma lo enseñó en su Instagram: https://www.instagram.com/p/DZNH1qfMFY0/

Este es el tipo de proyecto que se vende en este sector, y lo que aprenderás a vender en el intensivo: diseño, presupuesto y entrega, sin taller propio.

Las tres dudas que más me preguntan:

**«No sé nada de carpintería.»** No vas a fabricar nada: tu trabajo es diseñar, presupuestar y vender. Lo que necesitas saber de materiales, acabados y herrajes lo vemos en la semana 2.

**«No tengo mucho tiempo.»** Son 8 clases en directo en 4 semanas, dos por semana. Yo llevo Curino solo, unas 2 horas al día; para empezar te basta con reservar 1-2 horas diarias.

**«¿Cómo son las clases?»** En directo por Zoom, con tiempo para tus preguntas en cada una, y con el grupo de WhatsApp de la promoción entre clase y clase.

Si lo tienes claro, aquí tienes tu plaza:

[[Reservar mi plaza]]({enlace_plaza})$b$,
 false, false, false, false, false),
('5e9a0001-0000-4000-8000-000000000013', '5e9a0001-0000-4000-8000-000000000001', 3, 'Oferta sesión 1:1', 2880,
 'Si aún no es tu momento para el intensivo',
$b$Hola {nombre},

Si aún no es tu momento para el intensivo, empieza con una sesión 1:1 conmigo de 30 min y llévate los recursos iniciales para arrancar en el sector.

En 30 minutos vemos tu situación y tu plan para empezar, y te llevas los recursos iniciales: la plantilla de presupuesto, la lista de proveedores con los que empezar y los primeros pasos para conseguir tu primer cliente.

Solo para ti: **{precio_oferta_sesion} € durante las próximas {horas_oferta} horas** (después, {precio_sesion} €).

[[Quiero mi sesión por {precio_oferta_sesion} €]]({enlace_formaciones})$b$,
 true, true, false, true, true),
('5e9a0001-0000-4000-8000-000000000014', '5e9a0001-0000-4000-8000-000000000001', 4, 'Plazas reales (último)', 4320,
 'Quedan {plazas_libres} de {plazas_totales} plazas',
$b$Hola {nombre},

Último email sobre esto: en la primera edición del Intensivo Curino Partners quedan **{plazas_libres} de {plazas_totales} plazas**.

Es el mismo modelo con el que hemos hecho proyectos como el de Maria Alcalde.

Aquí tienes todas las formaciones, por si quieres empezar por el intensivo o con una sesión conmigo:

[[Ver las formaciones]]({enlace_formaciones})

Si no es tu momento, no pasa nada. Cuando quieras, respóndeme a este email.$b$,
 false, false, true, false, false)
on conflict (id) do nothing;

-- Lo ya procesado por la secuencia antigua (columnas seguimiento_N_at)
insert into partners_secuencia_estado (solicitud_id, secuencia_id, paso_id, estado, motivo, created_at)
select s.id, '5e9a0001-0000-4000-8000-000000000001', p.paso, 'enviado', 'migrado', p.at
  from partners_solicitudes s
  cross join lateral (values
    ('5e9a0001-0000-4000-8000-000000000011'::uuid, s.seguimiento_1_at),
    ('5e9a0001-0000-4000-8000-000000000012'::uuid, s.seguimiento_2_at),
    ('5e9a0001-0000-4000-8000-000000000013'::uuid, s.seguimiento_3_at),
    ('5e9a0001-0000-4000-8000-000000000014'::uuid, s.seguimiento_4_at)) as p(paso, at)
 where p.at is not null
on conflict (solicitud_id, paso_id) do nothing;

-- Emails de secuencia ya enviados → su paso (por asunto)
update partners_emails set secuencia_id = '5e9a0001-0000-4000-8000-000000000001',
  paso_id = case
    when asunto like '%te dejo el enlace por si se te cerró' or asunto like '%sobre tu solicitud del intensivo' then '5e9a0001-0000-4000-8000-000000000011'::uuid
    when asunto = 'El tipo de proyecto que vas a aprender a vender' then '5e9a0001-0000-4000-8000-000000000012'::uuid
    when asunto = 'Si aún no es tu momento para el intensivo' then '5e9a0001-0000-4000-8000-000000000013'::uuid
    when asunto like 'Quedan % de % plazas' then '5e9a0001-0000-4000-8000-000000000014'::uuid
  end
 where tipo = 'secuencia' and paso_id is null;

-- pg_cron: cada 5 min (antes 15)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'partners-seguimiento') then
    perform cron.alter_job((select jobid from cron.job where jobname = 'partners-seguimiento'), schedule := '*/5 * * * *');
  end if;
end $$;
