-- =============================================================
-- /partners — solicitudes del formulario multipaso (2026-10)
-- =============================================================
-- La landing /partners/ pasa a ser una landing de SOLICITUD: paso 0
-- (contacto) + 4 preguntas + pantalla final donde el usuario elige
-- entre pagar el Intensivo (clases-checkout) o escribir por WhatsApp.
--
-- Una fila por email (upsert). El progreso se guarda paso a paso desde
-- la Edge Function partners-solicitud (service_role). Los pasos 1-4 y
-- el CTA final se autentican con id + edit_token (opaco, devuelto al
-- enviar el paso 0), nunca solo con el id.
--
-- RLS on sin policies: solo service_role lee/escribe (patron de
-- presupuesto_solicitudes / inscripciones).

create table if not exists partners_solicitudes (
  id uuid primary key default gen_random_uuid(),

  -- Paso 0: contacto (email siempre en minusculas → clave de upsert)
  nombre text not null,
  email text not null unique check (email = lower(email)),
  telefono_prefijo text not null default '+34',
  telefono text not null,
  consentimiento_privacidad boolean not null default false,
  consentimiento_at timestamptz,
  edit_token text not null,

  -- Paso 1: ¿A que te dedicas ahora?
  p1_dedicacion text check (p1_dedicacion in (
    'carpinteria_reformas', 'interiorismo_arquitectura', 'comercial_ventas',
    'cuenta_ajena', 'otro_negocio'
  )),
  -- Paso 2: situacion + Instagram/web
  p2_situacion text,
  p2_instagram_web text,
  -- Paso 3: ¿Cuando quieres empezar?
  p3_inicio text check (p3_inicio in ('noviembre', 'tres_meses', 'informandome')),
  -- Paso 4: ¿Puedes invertir en tu formacion?
  p4_inversion text check (p4_inversion in ('si_1000_4000', 'semanas', 'no')),

  -- 0 = contacto enviado, 1-4 = preguntas respondidas
  paso_alcanzado int not null default 0 check (paso_alcanzado between 0 and 4),

  -- cualificado = p3 <> 'informandome' AND p4 = 'si_1000_4000'.
  -- segmento permite el seguimiento comercial de los no cualificados:
  --   cualificado | necesita_semanas (p4='semanas') | informandose | sin_presupuesto
  cualificado boolean,
  segmento text check (segmento in (
    'cualificado', 'necesita_semanas', 'informandose', 'sin_presupuesto'
  )),

  -- CTA elegido en la pantalla final (ultimo clic gana)
  cta_final text check (cta_final in ('checkout', 'whatsapp')),
  cta_final_at timestamptz,

  -- Compra (la rellena stripe-webhook en handleClaseCompleted)
  inscripcion_id uuid references inscripciones(id),
  pagado_at timestamptz,

  -- Atribucion (capturada al aterrizar)
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  landing_url text,
  referrer text,
  event_id_lead text,       -- UUID compartido dataLayer/CAPI (Lead)

  -- Anti-abuso
  ip_hash text,
  user_agent text,

  -- Avisos a Juan (Resend)
  notificado_lead_at timestamptz,
  notificado_completa_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_partners_solicitudes_created on partners_solicitudes(created_at desc);
create index if not exists idx_partners_solicitudes_segmento on partners_solicitudes(segmento);
create index if not exists idx_partners_solicitudes_ip_time on partners_solicitudes(ip_hash, created_at);
create index if not exists idx_partners_solicitudes_telefono on partners_solicitudes(telefono_prefijo, telefono);

alter table partners_solicitudes enable row level security;

-- Admin lee todo (para un futuro listado en /admin).
drop policy if exists "Admin can read partners_solicitudes" on partners_solicitudes;
create policy "Admin can read partners_solicitudes"
  on partners_solicitudes for select
  using (is_admin());

-- updated_at automatico
create or replace function partners_solicitudes_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_partners_solicitudes_touch on partners_solicitudes;
create trigger trg_partners_solicitudes_touch
  before update on partners_solicitudes
  for each row execute function partners_solicitudes_touch();
