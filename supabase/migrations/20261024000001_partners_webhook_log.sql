-- =============================================================
-- Registro de eventos del webhook de Resend (2026-10)
-- =============================================================
-- Una fila por evento con firma valida: tipo, resend_id y que se hizo
-- (actualizado / sin_email / ignorado_dominio). Sin datos personales.
-- Solo lectura para admin; escribe resend-webhook (service_role).
create table if not exists partners_webhook_log (
  id bigserial primary key,
  recibido_at timestamptz not null default now(),
  tipo text,
  resend_id text,
  resultado text
);
create index if not exists idx_partners_webhook_log_at on partners_webhook_log(recibido_at desc);
alter table partners_webhook_log enable row level security;
drop policy if exists "Admin reads webhook log" on partners_webhook_log;
create policy "Admin reads webhook log" on partners_webhook_log for select using (is_admin());
