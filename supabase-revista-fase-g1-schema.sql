-- =============================================================
-- Fase G1 — Schema base de la Revista de Curino
-- =============================================================

-- Habilitar extensión unaccent (necesaria para slugs)
create extension if not exists unaccent;

-- =============================================================
-- 1. magazine_profiles — perfil del user para publicar
-- =============================================================
create table if not exists magazine_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  contact_email text not null,
  contact_phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_magazine_profiles_user on magazine_profiles(user_id);

-- =============================================================
-- 2. magazine_purchases — compra de paquetes
-- =============================================================
create table if not exists magazine_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  package_size int not null check (package_size in (1, 2, 6)),
  amount_paid_cents int not null check (amount_paid_cents > 0),
  stripe_session_id text not null unique,
  stripe_payment_intent_id text,
  invoice_number text,
  pdf_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_magazine_purchases_user on magazine_purchases(user_id);
create index if not exists idx_magazine_purchases_session on magazine_purchases(stripe_session_id);

-- =============================================================
-- 3. magazine_credits — lote de saldo (FIFO al consumir)
-- =============================================================
create table if not exists magazine_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  purchase_id uuid not null references magazine_purchases(id) on delete restrict,
  credits_total int not null check (credits_total > 0),
  credits_remaining int not null check (credits_remaining >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_magazine_credits_user_active on magazine_credits(user_id, expires_at, credits_remaining)
  where credits_remaining > 0;
create index if not exists idx_magazine_credits_purchase on magazine_credits(purchase_id);

-- =============================================================
-- 4. magazine_articles — los artículos
-- =============================================================
create table if not exists magazine_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  slug text not null unique,
  type text not null check (type in ('proyecto', 'material', 'articulo', 'noticia', 'entrevista')),
  content_html text,
  cover_image_url text,
  meta_description text,
  og_image_url text,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'rejected', 'unpublished')),
  credit_id uuid references magazine_credits(id) on delete restrict,
  credit_consumed_at timestamptz,
  admin_notes text,
  edited_by_admin boolean not null default false,
  author_first_name text,
  author_last_name text,
  author_contact_email text,
  published_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_magazine_articles_user on magazine_articles(user_id);
create index if not exists idx_magazine_articles_status on magazine_articles(status);
create index if not exists idx_magazine_articles_type on magazine_articles(type);
create index if not exists idx_magazine_articles_published on magazine_articles(published_at desc)
  where status = 'published';
create index if not exists idx_magazine_articles_slug on magazine_articles(slug);

-- =============================================================
-- 5. magazine_boosts — promociones temporales
-- =============================================================
create table if not exists magazine_boosts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references magazine_articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  type text not null check (type in ('section_cover', 'main_page')),
  amount_paid_cents int not null check (amount_paid_cents > 0),
  stripe_session_id text not null unique,
  starts_at timestamptz,
  ends_at timestamptz,
  impressions_count int not null default 0,
  impressions_limit int,
  status text not null default 'queued' check (status in ('queued', 'active', 'expired_time', 'expired_views', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_magazine_boosts_active on magazine_boosts(type, status, starts_at)
  where status in ('queued', 'active');
create index if not exists idx_magazine_boosts_article on magazine_boosts(article_id);

-- =============================================================
-- 6. magazine_boost_impressions — log anónimo
-- =============================================================
create table if not exists magazine_boost_impressions (
  id bigserial primary key,
  boost_id uuid not null references magazine_boosts(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  ip_hash text
);

create index if not exists idx_magazine_boost_impressions_boost on magazine_boost_impressions(boost_id, viewed_at);

-- =============================================================
-- 7. RLS — habilitar en todas las tablas
-- =============================================================
alter table magazine_profiles enable row level security;
alter table magazine_purchases enable row level security;
alter table magazine_credits enable row level security;
alter table magazine_articles enable row level security;
alter table magazine_boosts enable row level security;
alter table magazine_boost_impressions enable row level security;

-- =============================================================
-- 8. RLS Policies
-- =============================================================

-- magazine_profiles
drop policy if exists "Users see own profile" on magazine_profiles;
create policy "Users see own profile" on magazine_profiles for select using (auth.uid() = user_id);

drop policy if exists "Users insert own profile" on magazine_profiles;
create policy "Users insert own profile" on magazine_profiles for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own profile" on magazine_profiles;
create policy "Users update own profile" on magazine_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Admin sees all profiles" on magazine_profiles;
create policy "Admin sees all profiles" on magazine_profiles for all
  using (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'));

-- magazine_purchases
drop policy if exists "Users see own purchases" on magazine_purchases;
create policy "Users see own purchases" on magazine_purchases for select using (auth.uid() = user_id);

drop policy if exists "Admin sees all purchases" on magazine_purchases;
create policy "Admin sees all purchases" on magazine_purchases for all
  using (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'));

-- magazine_credits
drop policy if exists "Users see own credits" on magazine_credits;
create policy "Users see own credits" on magazine_credits for select using (auth.uid() = user_id);

drop policy if exists "Admin sees all credits" on magazine_credits;
create policy "Admin sees all credits" on magazine_credits for all
  using (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'));

-- magazine_articles
drop policy if exists "Public reads published articles" on magazine_articles;
create policy "Public reads published articles" on magazine_articles for select using (status = 'published');

drop policy if exists "Users see own articles" on magazine_articles;
create policy "Users see own articles" on magazine_articles for select using (auth.uid() = user_id);

drop policy if exists "Users insert own articles" on magazine_articles;
create policy "Users insert own articles" on magazine_articles for insert with check (auth.uid() = user_id and status = 'draft');

drop policy if exists "Users update own drafts" on magazine_articles;
create policy "Users update own drafts" on magazine_articles for update
  using (auth.uid() = user_id and status in ('draft', 'rejected'))
  with check (auth.uid() = user_id and status in ('draft', 'rejected'));

drop policy if exists "Admin all articles" on magazine_articles;
create policy "Admin all articles" on magazine_articles for all
  using (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'));

-- magazine_boosts
drop policy if exists "Users see own boosts" on magazine_boosts;
create policy "Users see own boosts" on magazine_boosts for select using (auth.uid() = user_id);

drop policy if exists "Admin all boosts" on magazine_boosts;
create policy "Admin all boosts" on magazine_boosts for all
  using (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'));

-- magazine_boost_impressions
drop policy if exists "Admin sees impressions" on magazine_boost_impressions;
create policy "Admin sees impressions" on magazine_boost_impressions for all
  using (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin'));

-- =============================================================
-- 9. RPCs (funciones SECURITY DEFINER)
-- =============================================================

-- consume_magazine_credit: el user envía artículo a revisión.
-- Decrementa el lote FIFO válido más antiguo + guarda snapshot del autor.
create or replace function consume_magazine_credit(p_article_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_credit_id uuid;
  v_remaining int;
  v_article_user uuid;
  v_profile record;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required';
  end if;

  select user_id into v_article_user
  from magazine_articles where id = p_article_id;
  if v_article_user is null then
    raise exception 'article_not_found';
  end if;
  if v_article_user != v_user_id then
    raise exception 'forbidden';
  end if;

  select first_name, last_name, contact_email, contact_phone
  into v_profile
  from magazine_profiles where user_id = v_user_id;
  if v_profile is null then
    raise exception 'profile_required';
  end if;

  select id, credits_remaining into v_credit_id, v_remaining
  from magazine_credits
  where user_id = v_user_id
    and credits_remaining > 0
    and expires_at > now()
  order by created_at asc
  limit 1
  for update;

  if v_credit_id is null then
    raise exception 'no_credits_available';
  end if;

  update magazine_credits
  set credits_remaining = credits_remaining - 1
  where id = v_credit_id;

  update magazine_articles
  set credit_id = v_credit_id,
      credit_consumed_at = now(),
      status = 'pending_review',
      author_first_name = v_profile.first_name,
      author_last_name = v_profile.last_name,
      author_contact_email = v_profile.contact_email,
      updated_at = now()
  where id = p_article_id;

  return json_build_object(
    'article_id', p_article_id,
    'credit_id', v_credit_id,
    'credits_remaining_after', v_remaining - 1
  );
end;
$$;

grant execute on function consume_magazine_credit(uuid) to authenticated;

-- refund_magazine_credit: admin rechaza el artículo, devuelve crédito al lote si no caducó.
create or replace function refund_magazine_credit(p_article_id uuid, p_admin_notes text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_credit_id uuid;
  v_credit_expires timestamptz;
  v_refunded boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required';
  end if;

  select exists(select 1 from user_roles where user_id = v_user_id and role = 'admin') into v_is_admin;
  if not v_is_admin then
    raise exception 'admin_only';
  end if;

  select credit_id into v_credit_id
  from magazine_articles where id = p_article_id
  for update;

  if v_credit_id is null then
    raise exception 'no_credit_to_refund';
  end if;

  select expires_at into v_credit_expires
  from magazine_credits where id = v_credit_id;

  v_refunded := (v_credit_expires > now());

  if v_refunded then
    update magazine_credits
    set credits_remaining = credits_remaining + 1
    where id = v_credit_id;
  end if;

  update magazine_articles
  set status = 'rejected',
      admin_notes = p_admin_notes,
      rejected_at = now(),
      updated_at = now()
  where id = p_article_id;

  return json_build_object(
    'article_id', p_article_id,
    'credit_refunded', v_refunded,
    'credit_id', v_credit_id
  );
end;
$$;

grant execute on function refund_magazine_credit(uuid, text) to authenticated;

-- publish_magazine_article: admin publica desde pending_review.
create or replace function publish_magazine_article(p_article_id uuid, p_edited_by_admin boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required';
  end if;

  select exists(select 1 from user_roles where user_id = v_user_id and role = 'admin') into v_is_admin;
  if not v_is_admin then
    raise exception 'admin_only';
  end if;

  update magazine_articles
  set status = 'published',
      published_at = now(),
      edited_by_admin = p_edited_by_admin,
      updated_at = now()
  where id = p_article_id and status = 'pending_review';

  if not found then
    raise exception 'article_not_in_review';
  end if;

  return json_build_object('article_id', p_article_id, 'published_at', now());
end;
$$;

grant execute on function publish_magazine_article(uuid, boolean) to authenticated;

-- generate_unique_slug: crea slug único a partir del título.
create or replace function generate_unique_slug(p_title text)
returns text
language plpgsql
as $$
declare
  v_base_slug text;
  v_final_slug text;
  v_counter int := 0;
begin
  v_base_slug := lower(regexp_replace(
    regexp_replace(unaccent(p_title), '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  ));
  v_base_slug := trim(both '-' from regexp_replace(v_base_slug, '-+', '-', 'g'));
  v_base_slug := substr(v_base_slug, 1, 80);

  v_final_slug := v_base_slug;

  while exists (select 1 from magazine_articles where slug = v_final_slug) loop
    v_counter := v_counter + 1;
    v_final_slug := v_base_slug || '-' || v_counter;
  end loop;

  return v_final_slug;
end;
$$;

grant execute on function generate_unique_slug(text) to authenticated;

-- =============================================================
-- 10. Vista pública para listados de la revista
-- =============================================================
create or replace view magazine_articles_public as
select
  id, title, slug, type,
  cover_image_url, meta_description, og_image_url,
  author_first_name, author_last_name,
  published_at, created_at
from magazine_articles
where status = 'published'
order by published_at desc;

grant select on magazine_articles_public to anon, authenticated;

-- =============================================================
-- VERIFICACIÓN FINAL
-- =============================================================
select 'tablas creadas' as item, count(*)::text as count from information_schema.tables
  where table_name like 'magazine_%'
union all
select 'políticas creadas', count(*)::text from pg_policies where tablename like 'magazine_%'
union all
select 'funciones creadas', count(*)::text from pg_proc
  where proname in ('consume_magazine_credit', 'refund_magazine_credit', 'publish_magazine_article', 'generate_unique_slug')
union all
select 'vista creada', count(*)::text from information_schema.views where table_name = 'magazine_articles_public';
