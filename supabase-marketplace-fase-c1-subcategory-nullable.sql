-- =============================================================
-- Fase C1 hotfix — subcategory nullable
-- =============================================================
-- subcategory era NOT NULL en schema legacy del catálogo de Curino.
-- Para piezas del marketplace, los sellers no necesitan elegirla.
-- Las piezas existentes (catálogo legacy) mantienen sus valores.

alter table library_items
  alter column subcategory drop not null;
