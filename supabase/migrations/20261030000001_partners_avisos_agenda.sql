-- =============================================================
-- Partners · leads «Sin agendar» y avisos (2026-10)
-- =============================================================
-- «Sin agendar» (calculado, no es un crm_estado): solicitud del formulario
-- (origen 'formulario'), completada y cualificada después de abrir el
-- embudo con llamada (2026-10-05 09:11 UTC: antes no vieron el calendario),
-- con consentimiento_solicitud, más de 1 h desde completada_at, sin baja,
-- sin compras y sin llamada vigente (llamada_estado nulo, 'cancelada' o
-- 'no_presentado').
-- partners_avisos_agenda: avisos por email a joandemora@gmail.com que manda
-- el cron de partners-seguimiento (franja 9:00–21:30 Madrid):
--   'sin_agendar'   → uno por contacto (índice único parcial);
--   'cancelada' / 'no_presentado' → uno por evento de Cal.com (cal-webhook).
-- Antes de enviar se comprueba que el contacto sigue sin llamada; si ha
-- vuelto a reservar, el aviso queda 'descartado'.
-- Solo lectura para admin; escribe service_role. Idempotente.

create table if not exists partners_avisos_agenda (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references partners_solicitudes(id) on delete cascade,
  tipo text not null check (tipo in ('sin_agendar', 'cancelada', 'no_presentado')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'descartado')),
  evento_at timestamptz not null default now(),
  enviado_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_aviso_sin_agendar on partners_avisos_agenda(solicitud_id) where tipo = 'sin_agendar';
create index if not exists idx_avisos_agenda_pend on partners_avisos_agenda(estado) where estado = 'pendiente';
alter table partners_avisos_agenda enable row level security;
drop policy if exists "Admin reads avisos agenda" on partners_avisos_agenda;
create policy "Admin reads avisos agenda" on partners_avisos_agenda for select using (is_admin());
