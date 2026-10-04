-- =============================================================
-- CRM Partners · Fase 3 — emails personalizados (2026-10)
-- =============================================================
-- partners_emails: registro de cada email (CRM manual de servicio o
--   comercial, pruebas y secuencia automatica) con su id de Resend y el
--   estado que llega por el webhook de Resend (entregado, rebotado,
--   queja, abierto). Solo escribe service_role (Edge Functions); el admin
--   lee.
-- partners_email_plantillas: plantillas guardables (admin las gestiona).
-- Idempotente.

create table if not exists partners_emails (
  id uuid primary key default gen_random_uuid(),
  envio_id uuid,                                   -- agrupa un envio masivo
  tipo text not null check (tipo in ('servicio', 'comercial', 'secuencia', 'prueba')),
  plantilla_id uuid,
  asunto text not null,
  email text not null,
  nombre text,
  solicitud_id uuid references partners_solicitudes(id) on delete set null,
  inscripcion_id uuid references inscripciones(id) on delete set null,
  sesion_id uuid references sesiones_1a1(id) on delete set null,
  resend_id text unique,
  estado text not null default 'enviado'
    check (estado in ('enviado', 'entregado', 'retrasado', 'rebotado', 'queja', 'abierto', 'error')),
  estado_at timestamptz,
  abierto_at timestamptz,
  error text,
  enviado_por uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_partners_emails_email on partners_emails(lower(email));
create index if not exists idx_partners_emails_solicitud on partners_emails(solicitud_id);
create index if not exists idx_partners_emails_envio on partners_emails(envio_id);

alter table partners_emails enable row level security;
drop policy if exists "Admin can read partners_emails" on partners_emails;
create policy "Admin can read partners_emails" on partners_emails for select using (is_admin());

create table if not exists partners_email_plantillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo text not null default 'servicio' check (tipo in ('servicio', 'comercial')),
  asunto text not null,
  cuerpo text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table partners_email_plantillas enable row level security;
drop policy if exists "Admin manages plantillas" on partners_email_plantillas;
create policy "Admin manages plantillas" on partners_email_plantillas
  for all to authenticated using (is_admin()) with check (is_admin());

-- Plantillas de servicio iniciales (la firma «Juan de Mora · Curino» la
-- añade el envio automaticamente).
insert into partners_email_plantillas (nombre, tipo, asunto, cuerpo) values
('Enlace de Zoom', 'servicio', 'Tu enlace para las clases del Intensivo Curino Partners',
'Hola {nombre},

Este es tu enlace de Zoom para las clases del Intensivo Curino Partners:

{zoom}

La primera clase es el **{fecha_inicio} a las {hora}** (hora peninsular).

**Es el mismo enlace para las 8 clases**, así que guárdalo bien.

Si tienes cualquier duda, responde a este email.'),
('Agenda tu sesión', 'servicio', 'Reserva tu sesión 1:1 conmigo',
'Hola {nombre},

Ya puedes reservar tu sesión 1:1 de 30 minutos conmigo. Elige el día y la hora que mejor te vengan aquí:

{enlace_reserva}

Si ninguna hora te encaja, responde a este email y lo buscamos.'),
('Recordatorio de clase', 'servicio', 'Hoy tenemos clase a las {hora}',
'Hola {nombre},

Hoy tenemos clase a las **{hora}** (hora peninsular). Este es el enlace de Zoom:

{zoom}

¡Nos vemos dentro!')
on conflict (nombre) do nothing;
