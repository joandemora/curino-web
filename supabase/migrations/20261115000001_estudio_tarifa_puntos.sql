-- =============================================================
-- Estudio Curino · tarifa de armarios por puntos (OTG 2026)
-- =============================================================
-- estudio_tarifas.precio_punto (€/punto; null = PENDIENTE) y puntos (solo los
-- conceptos que el usuario cambia sobre la tabla original OTG 2026, que está
-- en código: _shared/estudio/puntos.ts; «Restablecer» = quitar la clave).
-- El cuerpo y el interior (cuerpo €/ml, altillo, estante, barra, cajón) dejan
-- de calcularse en €. Idempotente.

alter table estudio_tarifas add column if not exists precio_punto numeric(10,4);
alter table estudio_tarifas add column if not exists puntos jsonb not null default '{}'::jsonb;
