-- =============================================================
-- Partners · envios programados (2026-10)
-- =============================================================
-- Envios de la pantalla Emails con fecha y hora (Madrid). Los crea, edita y
-- cancela crm-email (solo admin, solo si siguen 'pendiente'); los ejecuta el
-- cron de partners-seguimiento (cada 5 min): recalcula los destinatarios con
-- las reglas de consentimiento y bajas, y si alguna variable sale vacia no
-- envia ('bloqueado') y avisa por email a quien lo programo.
-- Idempotente.

create table if not exists partners_envios_programados (
  id uuid primary key default gen_random_uuid(),
  programado_para timestamptz not null,
  tipo text not null check (tipo in ('servicio', 'comercial')),
  segmento jsonb,
  segmento_desc text,
  asunto text not null,
  cuerpo text not null,
  plantilla_id uuid,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviando', 'enviado', 'cancelado', 'bloqueado', 'error')),
  resultado jsonb,
  procesado_at timestamptz,
  creado_por uuid,
  creado_por_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_envios_programados_pend on partners_envios_programados(programado_para) where estado = 'pendiente';

alter table partners_envios_programados enable row level security;
drop policy if exists "Admin reads envios programados" on partners_envios_programados;
create policy "Admin reads envios programados" on partners_envios_programados for select using (is_admin());

alter table partners_emails add column if not exists programado_id uuid references partners_envios_programados(id) on delete set null;
