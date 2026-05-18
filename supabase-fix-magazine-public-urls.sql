-- =============================================================
-- Fix: convertir signed URLs viejas a public URLs en bucket magazine-articles
-- =============================================================
-- Origen: el editor de G2/H usaba createSignedUrl. El bucket se hizo público
-- después pero las URLs ya guardadas seguían siendo signed (con token JWT).
-- Las signed URLs NO permiten Image Transformations.
-- Esta query convierte signed → public via regex en cover_image_url, og_image_url, y content_html.

update magazine_articles
set cover_image_url = regexp_replace(cover_image_url, '/object/sign/(magazine-articles/[^?]+)\?token=[^&]+', '/object/public/\1'),
    og_image_url    = regexp_replace(og_image_url,    '/object/sign/(magazine-articles/[^?]+)\?token=[^&]+', '/object/public/\1'),
    content_html    = regexp_replace(content_html,    '/object/sign/(magazine-articles/[^?]+)\?token=[^&]+', '/object/public/\1', 'g')
where cover_image_url ilike '%/object/sign/magazine-articles/%'
   or og_image_url    ilike '%/object/sign/magazine-articles/%'
   or content_html    ilike '%/object/sign/magazine-articles/%';

-- Verificación: ningún artículo debería tener signed URLs después
select 'articulos con signed urls restantes' as item,
  count(*) as count
from magazine_articles
where cover_image_url ilike '%/object/sign/magazine-articles/%'
   or og_image_url    ilike '%/object/sign/magazine-articles/%'
   or content_html    ilike '%/object/sign/magazine-articles/%';
