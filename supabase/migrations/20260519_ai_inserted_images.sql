-- =============================================================
-- AI Inserted Images — log de trazabilidad legal
-- =============================================================
--
-- Registra cada imagen que el admin descarga (vía endpoint
-- /api/admin/download-insert-image) e inserta en un artículo
-- generado por IA, con su origen y atribución.
--
-- Propósito: si en el futuro alguien reclama derechos sobre una
-- imagen, podemos consultar la URL original, fotógrafo/estudio
-- declarados al insertarla, y quién y cuándo lo hizo.
--
-- La inserción la dispara el admin manualmente tras revisar la
-- imagen, así que la decisión legal queda registrada con su uuid.
--
-- Ejecutar manualmente en Supabase Studio.
-- =============================================================

create table if not exists ai_inserted_images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  article_id uuid,
  image_index int,
  original_url text not null,
  stored_path text not null,
  photographer text,
  author_studio text,
  source_url text,
  inserted_by uuid
);

create index if not exists idx_ai_inserted_images_article
  on ai_inserted_images(article_id, created_at desc);
create index if not exists idx_ai_inserted_images_inserted_by
  on ai_inserted_images(inserted_by, created_at desc);

alter table ai_inserted_images enable row level security;

drop policy if exists "Admin only — ai_inserted_images" on ai_inserted_images;
create policy "Admin only — ai_inserted_images" on ai_inserted_images
  for all
  using (auth.uid() = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid)
  with check (auth.uid() = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid);

-- =============================================================
-- VERIFICACIÓN FINAL
-- =============================================================
select 'tabla creada' as item, count(*)::text as count
  from information_schema.tables where table_name = 'ai_inserted_images'
union all
select 'columnas creadas', count(*)::text from information_schema.columns
  where table_name = 'ai_inserted_images'
    and column_name in ('id','created_at','article_id','image_index','original_url','stored_path','photographer','author_studio','source_url','inserted_by')
union all
select 'policy admin creada', count(*)::text from pg_policies
  where tablename = 'ai_inserted_images';
