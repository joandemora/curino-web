-- =============================================================
-- AI Article ↔ Library Item link
-- =============================================================
--
-- Añade la relación opcional artículo de Revista → pieza del
-- marketplace (library_items) usada como "producto relacionado"
-- al generar artículos por IA. Permite que la ficha del artículo
-- enlace en el futuro al producto y que el generador conozca los
-- datos reales (sin inventar).
--
-- ON DELETE SET NULL: si la pieza se borra, el artículo sobrevive
-- y simplemente pierde la referencia.
--
-- Ejecutar manualmente en Supabase Studio.
-- =============================================================

alter table magazine_articles
  add column if not exists related_library_item_id uuid;

-- FK defensiva: si ya existe la constraint (por re-ejecución), la
-- soltamos antes de añadirla.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'magazine_articles_related_library_item_fk'
      and conrelid = 'magazine_articles'::regclass
  ) then
    alter table magazine_articles drop constraint magazine_articles_related_library_item_fk;
  end if;
end $$;

alter table magazine_articles
  add constraint magazine_articles_related_library_item_fk
  foreign key (related_library_item_id) references library_items(id) on delete set null;

create index if not exists idx_magazine_articles_related_library_item
  on magazine_articles(related_library_item_id)
  where related_library_item_id is not null;

-- =============================================================
-- VERIFICACIÓN FINAL
-- =============================================================
select 'columna related_library_item_id añadida' as item, count(*)::text as count
  from information_schema.columns
  where table_name = 'magazine_articles' and column_name = 'related_library_item_id'
union all
select 'FK magazine_articles → library_items', count(*)::text
  from pg_constraint
  where conname = 'magazine_articles_related_library_item_fk'
union all
select 'índice related_library_item creado', count(*)::text
  from pg_indexes
  where indexname = 'idx_magazine_articles_related_library_item';
