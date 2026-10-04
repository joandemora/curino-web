-- =============================================================
-- clases.fecha_confirmada — ediciones a la venta sin fecha cerrada
-- =============================================================
-- clases.fecha es NOT NULL. Para vender una edicion cuya fecha aun no
-- esta confirmada se guarda una fecha provisional y fecha_confirmada =
-- false. Mientras sea false:
--   - no se muestra la fecha en ningun sitio (landing, Stripe, email de
--     compra, factura);
--   - el email de compra avisa de que la fecha y el horario se confirmaran
--     por email y en el grupo de WhatsApp;
--   - notify-class-reminder NO envia recordatorios de esa edicion.
-- La fecha provisional si se usa para ordenar ediciones y para el
-- contador de plazas (fecha > now()).
--
-- Idempotente. Las filas existentes quedan como confirmadas (default true).

alter table clases add column if not exists fecha_confirmada boolean not null default true;
