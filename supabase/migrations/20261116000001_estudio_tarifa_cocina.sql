-- =============================================================
-- Estudio Curino · tarifa de COCINAS por puntos (Cocinas – Proveedor 1)
-- =============================================================
-- La tarifa del proveedor (29/05/2025) está en código, en € y pasada a puntos
-- al alza (_shared/estudio/cocina-tarifa.ts y cocina-puntos.ts). Cada usuario
-- guarda su precio del punto cocina (independiente del de armarios; null =
-- PENDIENTE) y solo los puntos que cambie («Restablecer» = quitar la clave).
-- Idempotente.

alter table estudio_tarifas add column if not exists precio_punto_cocina numeric(10,4);
alter table estudio_tarifas add column if not exists puntos_cocina jsonb not null default '{}'::jsonb;
