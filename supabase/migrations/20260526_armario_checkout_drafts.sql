-- =============================================================
-- Fase H10 — Tabla armario_checkout_drafts (multi-armario)
-- =============================================================
-- El carrito de armarios puede contener N items, cada uno con su
-- configuración completa (doorDetail, moduleDetail, etc.). La
-- metadata de Stripe (50 keys × 500 chars/value) NO puede transportar
-- ese array entero íntegro.
--
-- Solución: el frontend, justo antes de redirigir a Stripe, persiste
-- el carrito completo en esta tabla y pasa el draft_id a Stripe vía
-- client_reference_id. El webhook lee el draft, lo copia a
-- armario_orders.configuracion.items y lo borra.

create table if not exists armario_checkout_drafts (
  id uuid primary key default gen_random_uuid(),
  items jsonb not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_armario_checkout_drafts_created_at
  on armario_checkout_drafts(created_at);

-- =============================================================
-- RLS
-- =============================================================
-- El carrito puede ser de un usuario invitado (sin sesión), así que
-- el INSERT debe estar permitido a anon Y authenticated. La tabla
-- NO expone SELECT/UPDATE/DELETE al cliente: solo el webhook
-- (service_role) los lee y borra. service_role bypasea RLS, así
-- que no necesita policy.
--
-- Riesgo aceptado: spam de INSERTs. Mitigación: la tabla no contiene
-- datos sensibles (email/dirección/NIF NO van aquí, viajan por
-- metadata Stripe), solo configuración técnica del armario. Limpieza
-- por cron en operación.
alter table armario_checkout_drafts enable row level security;

drop policy if exists "Anyone can insert armario draft" on armario_checkout_drafts;
create policy "Anyone can insert armario draft"
  on armario_checkout_drafts for insert
  with check (true);

-- (No se crean policies SELECT/UPDATE/DELETE para el cliente.)

-- =============================================================
-- Mantenimiento sugerido (NO automatizado en esta migración)
-- =============================================================
-- Drafts huérfanos: si el cliente abandona el pago, el draft
-- queda sin que ningún webhook lo recoja. Limpieza recomendada:
--
--   delete from armario_checkout_drafts
--     where created_at < now() - interval '24 hours';
--
-- Ejecutar manualmente desde Studio cada cierto tiempo o
-- automatizar vía pg_cron (extensión Postgres) cuando convenga.
