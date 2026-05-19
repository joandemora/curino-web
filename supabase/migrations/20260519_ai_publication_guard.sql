-- =============================================================
-- AI Publication Guard
-- =============================================================
-- Bloquea publicar (status='published') un artículo con
-- ai_generated=true mientras queden imágenes sugeridas sin revisar
-- legalmente. La revisión vive en suggested_images jsonb:
--   suggested_images[i].review_status puede ser:
--     - 'pendiente' (o ausente) → pending
--     - 'ok' | 'sustituir' | 'pedir_permiso' | 'descartar' → revisada
--
-- Además añade ai_article_generations.article_type para poder filtrar
-- el histórico por tipo sin tener que joinear con magazine_articles
-- (la fila puede sobrevivir aunque borren el artículo asociado).
--
-- Ejecutar manualmente en Supabase Studio.
-- =============================================================

-- =============================================================
-- 1. Persistir tipo del artículo en la fila de generación
-- =============================================================
alter table ai_article_generations
  add column if not exists article_type text;

create index if not exists idx_ai_article_generations_type
  on ai_article_generations(article_type)
  where article_type is not null;

-- =============================================================
-- 2. Función: comprobar imágenes pendientes antes de publicar
-- =============================================================
create or replace function check_ai_article_images_before_publish()
returns trigger
language plpgsql
as $$
declare
  v_pending int := 0;
  v_total int := 0;
begin
  -- Solo aplica cuando se está pasando A 'published'.
  if NEW.status is distinct from 'published' then
    return NEW;
  end if;
  if OLD.status is not distinct from 'published' then
    return NEW;
  end if;
  if coalesce(NEW.ai_generated, false) is not true then
    return NEW;
  end if;

  -- Contar imágenes y cuántas siguen pending o sin review_status.
  if NEW.suggested_images is not null
     and jsonb_typeof(NEW.suggested_images) = 'array' then
    select count(*) into v_total
    from jsonb_array_elements(NEW.suggested_images);

    select count(*) into v_pending
    from jsonb_array_elements(NEW.suggested_images) as img
    where coalesce(img->>'review_status', 'pendiente') = 'pendiente';
  end if;

  if v_pending > 0 then
    raise exception
      'Cannot publish AI-generated article: % image(s) pending legal review',
      v_pending
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

-- =============================================================
-- 3. Trigger en magazine_articles
-- =============================================================
drop trigger if exists trg_check_ai_article_images on magazine_articles;
create trigger trg_check_ai_article_images
  before update on magazine_articles
  for each row execute function check_ai_article_images_before_publish();

-- =============================================================
-- VERIFICACIÓN FINAL
-- =============================================================
select 'columna article_type añadida' as item, count(*)::text as count
  from information_schema.columns
  where table_name = 'ai_article_generations' and column_name = 'article_type'
union all
select 'trigger guard creado', count(*)::text from pg_trigger
  where tgname = 'trg_check_ai_article_images'
union all
select 'función guard creada', count(*)::text from pg_proc
  where proname = 'check_ai_article_images_before_publish';
