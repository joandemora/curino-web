-- =============================================================
-- Article header redesign — subtitle + cover_caption
-- =============================================================
--
-- Añade dos columnas opcionales a magazine_articles para el nuevo
-- header editorial (estilo AD):
--   - subtitle: subtítulo / dek bajo el título principal.
--   - cover_caption: pie de foto de la imagen de portada.
--
-- Y recrea la vista pública magazine_articles_public para exponer
-- ambos nuevos campos.
--
-- CRÍTICO: la vista en producción ya incluye content_html (Joan lo
-- añadió manualmente en algún momento), aunque el repo no lo
-- refleje. El CREATE OR REPLACE de abajo lo incluye explícitamente
-- para no romper el SSR del detalle público.
--
-- Ejecutar manualmente en Supabase Studio.
-- =============================================================

-- 1. Columnas nuevas en magazine_articles
alter table magazine_articles
  add column if not exists subtitle text;

alter table magazine_articles
  add column if not exists cover_caption text;

-- 2. Vista pública — recrear incluyendo content_html (ya en
-- producción) + subtitle + cover_caption.
create or replace view magazine_articles_public as
select
  id,
  title,
  subtitle,
  slug,
  type,
  content_html,
  cover_image_url,
  cover_caption,
  meta_description,
  og_image_url,
  author_first_name,
  author_last_name,
  published_at,
  created_at
from magazine_articles
where status = 'published'
order by published_at desc;

grant select on magazine_articles_public to anon, authenticated;

-- =============================================================
-- VERIFICACIÓN FINAL
-- =============================================================
select 'columna subtitle añadida' as item, count(*)::text as count
  from information_schema.columns
  where table_name = 'magazine_articles' and column_name = 'subtitle'
union all
select 'columna cover_caption añadida', count(*)::text
  from information_schema.columns
  where table_name = 'magazine_articles' and column_name = 'cover_caption'
union all
select 'vista incluye subtitle', count(*)::text
  from information_schema.columns
  where table_name = 'magazine_articles_public' and column_name = 'subtitle'
union all
select 'vista incluye cover_caption', count(*)::text
  from information_schema.columns
  where table_name = 'magazine_articles_public' and column_name = 'cover_caption'
union all
select 'vista incluye content_html', count(*)::text
  from information_schema.columns
  where table_name = 'magazine_articles_public' and column_name = 'content_html';
