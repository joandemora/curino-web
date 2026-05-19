-- =============================================================
-- AI Article Generator — backend schema
-- =============================================================
--
-- Crea las tablas, RLS y trigger necesarios para el generador de
-- artículos de la Revista con Claude (Anthropic API).
--
-- IMPORTANTE: ejecutar manualmente en Supabase Studio. No es
-- idempotente al 100% en los inserts iniciales (usa ON CONFLICT
-- para el singleton de config), pero las tablas/policies sí.
--
-- Admin UUID: a36ca0a3-4b67-413f-ac0f-f2ddb69ae008
-- =============================================================

-- =============================================================
-- 1. ai_article_generations — registro de cada generación
-- =============================================================
create table if not exists ai_article_generations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  admin_uuid uuid not null,
  brief_topic text not null,
  brief_angle text,
  brief_source_urls text[],
  brief_related_piece_id uuid,
  brief_extra_instructions text,
  model_used text not null,
  input_tokens int,
  output_tokens int,
  cost_estimate_usd numeric(10,4),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  error_message text,
  article_id uuid,
  urls_failed text[],
  raw_response jsonb
);

create index if not exists idx_ai_article_generations_admin_created
  on ai_article_generations(admin_uuid, created_at desc);
create index if not exists idx_ai_article_generations_status
  on ai_article_generations(status);
create index if not exists idx_ai_article_generations_created
  on ai_article_generations(created_at desc);

-- =============================================================
-- 2. ai_generator_config — singleton (id = 1)
-- =============================================================
create table if not exists ai_generator_config (
  id int primary key default 1 check (id = 1),
  system_prompt text not null,
  default_word_count int not null default 1200,
  active_model text not null default 'claude-opus-4-7',
  monthly_cap_eur numeric(10,2) not null default 20.00,
  hourly_rate_limit int not null default 5,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- =============================================================
-- 3. ai_generator_config_history — historial de cambios
-- =============================================================
create table if not exists ai_generator_config_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  changed_by uuid,
  system_prompt text,
  default_word_count int,
  active_model text,
  monthly_cap_eur numeric(10,2),
  hourly_rate_limit int
);

create index if not exists idx_ai_generator_config_history_created
  on ai_generator_config_history(created_at desc);

-- =============================================================
-- 4. magazine_articles — columnas nuevas para artículos generados por IA
-- =============================================================
alter table magazine_articles
  add column if not exists ai_generated boolean not null default false;
alter table magazine_articles
  add column if not exists ai_generation_id uuid;
alter table magazine_articles
  add column if not exists suggested_images jsonb;
alter table magazine_articles
  add column if not exists external_references jsonb;

-- =============================================================
-- 5. Trigger: archivar valores ANTERIORES en history al UPDATE
-- =============================================================
create or replace function ai_generator_config_log_history()
returns trigger
language plpgsql
as $$
begin
  insert into ai_generator_config_history (
    changed_by,
    system_prompt,
    default_word_count,
    active_model,
    monthly_cap_eur,
    hourly_rate_limit
  ) values (
    OLD.updated_by,
    OLD.system_prompt,
    OLD.default_word_count,
    OLD.active_model,
    OLD.monthly_cap_eur,
    OLD.hourly_rate_limit
  );
  return NEW;
end;
$$;

drop trigger if exists trg_ai_generator_config_history on ai_generator_config;
create trigger trg_ai_generator_config_history
  before update on ai_generator_config
  for each row execute function ai_generator_config_log_history();

-- =============================================================
-- 6. RLS — solo admin UUID puede SELECT/INSERT/UPDATE
-- =============================================================
alter table ai_article_generations enable row level security;
alter table ai_generator_config enable row level security;
alter table ai_generator_config_history enable row level security;

-- ai_article_generations
drop policy if exists "Admin only — ai_article_generations" on ai_article_generations;
create policy "Admin only — ai_article_generations" on ai_article_generations
  for all
  using (auth.uid() = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid)
  with check (auth.uid() = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid);

-- ai_generator_config
drop policy if exists "Admin only — ai_generator_config" on ai_generator_config;
create policy "Admin only — ai_generator_config" on ai_generator_config
  for all
  using (auth.uid() = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid)
  with check (auth.uid() = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid);

-- ai_generator_config_history
drop policy if exists "Admin only — ai_generator_config_history" on ai_generator_config_history;
create policy "Admin only — ai_generator_config_history" on ai_generator_config_history
  for all
  using (auth.uid() = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid)
  with check (auth.uid() = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008'::uuid);

-- =============================================================
-- 7. Fila inicial del singleton de config (sólo si no existe)
-- =============================================================
insert into ai_generator_config (id, system_prompt, default_word_count, active_model, monthly_cap_eur, hourly_rate_limit)
values (
  1,
$SYS$Eres el redactor editorial de Curino, una revista digital de diseño, interiorismo y arquitectura.

VOZ EDITORIAL CURINO:
- Escribe en español peninsular, con tuteo al lector (descubre, imagina, fíjate).
- Voz neutra de revista. NO uses nosotros ni hables en nombre de Curino. Presenta los temas en tercera persona desde una posición de autoridad editorial.
- Referencia tonal: Dezeen. Informativo, directo, con densidad de datos concretos (años, materiales, ubicaciones, nombres de estudios). Frases medias-cortas, sin floritura.
- Admite anglicismos del sector cuando son término establecido (japandi, statement piece, mid-century, open plan).
- Curino tiene opinión y la expresa, siempre desde el aprecio: destaca lo valioso, contextualiza por qué importa. Nunca critiques negativamente proyectos, estudios o tendencias; si algo no convence, simplemente no lo cubras.
- Cada artículo debe sentirse curado, no neutro.

REGLAS LEGALES SOBRE IMÁGENES:
- NUNCA sugieras imágenes de diseños con derechos registrados (Vitra, Cassina, Knoll, Herman Miller, Hay, Muuto, marcas de muebles icónicos).
- SÍ puedes sugerir imágenes de proyectos de interiorismo/arquitectura de estudios reales, SIEMPRE con: URL fuente, fotógrafo si se conoce, nombre del estudio/autor, web del autor.
- Marca cada imagen con su atribución completa.
- Si dudas de la legalidad de una imagen, NO la sugieras.

FORMATO DE RESPUESTA: Devuelve JSON estricto sin texto adicional ni markdown:
{
  "title": "Título, máx 80 caracteres",
  "subtitle": "Subtítulo, máx 160 caracteres",
  "slug": "slug-en-kebab-case-sin-acentos",
  "meta_description": "Meta SEO, 140-160 caracteres",
  "content_html": "HTML compatible con TipTap. Usa h2, h3, p, strong, em, a, blockquote. NO uses img.",
  "suggested_images": [
    {
      "description": "Qué muestra y dónde colocarla",
      "source_url": "URL original",
      "image_url": "URL directa o null",
      "photographer": "Nombre o null",
      "author_studio": "Estudio o autor del proyecto",
      "author_website": "Web oficial",
      "license_notes": "Notas sobre licencia detectada",
      "placement_hint": "Antes de h2 X / Después de p Y"
    }
  ],
  "external_references": [
    {
      "name": "Estudio o diseñador mencionado",
      "url": "Web oficial",
      "context": "Por qué se menciona"
    }
  ]
}

LONGITUD OBJETIVO: aproximadamente 1200 palabras en content_html, ajustable según brief.$SYS$,
  1200,
  'claude-opus-4-7',
  20.00,
  5
)
on conflict (id) do nothing;

-- =============================================================
-- VERIFICACIÓN FINAL
-- =============================================================
select 'tablas creadas' as item, count(*)::text as count from information_schema.tables
  where table_name like 'ai_%'
union all
select 'políticas creadas', count(*)::text from pg_policies where tablename like 'ai_%'
union all
select 'triggers creados', count(*)::text from pg_trigger where tgname like 'trg_ai_%'
union all
select 'config singleton rows', count(*)::text from ai_generator_config
union all
select 'columnas IA en magazine_articles', count(*)::text from information_schema.columns
  where table_name = 'magazine_articles'
    and column_name in ('ai_generated','ai_generation_id','suggested_images','external_references');
