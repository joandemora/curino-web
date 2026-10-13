-- =============================================================
-- Estudio Curino · tipo de IVA por proyecto (2026-10)
-- =============================================================
-- estudio_proyectos.iva_pct: 21 % por defecto; 10 % en reformas de vivienda.
-- Lo usan el presupuesto generado (totales y PDF/Excel), los plazos de
-- cobro (total con IVA) y las métricas. Idempotente.

alter table estudio_proyectos add column if not exists iva_pct numeric(5,2) not null default 21 check (iva_pct >= 0 and iva_pct <= 30);
