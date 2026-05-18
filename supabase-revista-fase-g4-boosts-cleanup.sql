-- =============================================================
-- Fase G4 — Boosts: simplificación schema + cron
-- =============================================================

-- 1. Simplificar magazine_boosts: el modelo es ahora 15 días fijos.
-- impressions_count e impressions_limit ya no aplican. Status simplificado.

alter table magazine_boosts drop column if exists impressions_count;
alter table magazine_boosts drop column if exists impressions_limit;

-- Cambiar el check constraint del status (eliminar expired_views).
alter table magazine_boosts drop constraint if exists magazine_boosts_status_check;
alter table magazine_boosts add constraint magazine_boosts_status_check
  check (status in ('queued', 'active', 'expired', 'cancelled'));

-- Migrar los status existentes (si los hay).
update magazine_boosts set status = 'expired' where status in ('expired_time', 'expired_views');

-- 1b. Añadir columnas para factura (la genera el webhook).
alter table magazine_boosts add column if not exists invoice_number text;
alter table magazine_boosts add column if not exists pdf_url text;

-- 2. RPC activate_boost_queue: lazy activation.
-- Marca como 'expired' los boosts cuyo ends_at < now().
-- Por cada zona (type), busca el siguiente queued en orden FIFO si hay slot libre.
-- Activa el boost, set starts_at=now(), ends_at=now()+15 days.
-- Devuelve lista de boost_ids recién activados (para que el caller mande emails).

create or replace function activate_boost_queue()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired_count int := 0;
  v_activated_ids uuid[] := array[]::uuid[];
  v_zone record;
  v_active_count int;
  v_next_boost record;
begin
  -- 1. Expirar boosts vencidos por tiempo
  update magazine_boosts
  set status = 'expired', updated_at = now()
  where status = 'active' and ends_at < now();
  get diagnostics v_expired_count = row_count;

  -- 2. Para cada zona (5 secciones + 1 página principal), revisar slots libres
  for v_zone in
    select 'section_cover'::text as type, t.section_type as section_filter
    from (values ('proyecto'), ('material'), ('articulo'), ('noticia'), ('entrevista')) as t(section_type)
    union all
    select 'main_page'::text as type, null::text as section_filter
  loop
    -- Contar boosts activos en esta zona
    if v_zone.type = 'section_cover' then
      select count(*) into v_active_count
      from magazine_boosts b
      join magazine_articles a on a.id = b.article_id
      where b.type = 'section_cover'
        and b.status = 'active'
        and a.type = v_zone.section_filter;
    else
      select count(*) into v_active_count
      from magazine_boosts
      where type = 'main_page' and status = 'active';
    end if;

    -- Mientras haya slots libres y haya cola, activar el siguiente
    while v_active_count < 3 loop
      v_next_boost := null;
      if v_zone.type = 'section_cover' then
        select b.id, b.article_id, b.user_id
        into v_next_boost
        from magazine_boosts b
        join magazine_articles a on a.id = b.article_id
        where b.type = 'section_cover'
          and b.status = 'queued'
          and a.type = v_zone.section_filter
        order by b.created_at asc
        limit 1 for update of b;
      else
        select id, article_id, user_id
        into v_next_boost
        from magazine_boosts
        where type = 'main_page' and status = 'queued'
        order by created_at asc
        limit 1 for update;
      end if;

      exit when v_next_boost.id is null;

      update magazine_boosts
      set status = 'active',
          starts_at = now(),
          ends_at = now() + interval '15 days',
          updated_at = now()
      where id = v_next_boost.id;

      v_activated_ids := v_activated_ids || v_next_boost.id;
      v_active_count := v_active_count + 1;
    end loop;
  end loop;

  return json_build_object(
    'expired_count', v_expired_count,
    'activated_count', coalesce(array_length(v_activated_ids, 1), 0),
    'activated_ids', v_activated_ids
  );
end;
$$;

grant execute on function activate_boost_queue() to authenticated, anon;

-- 3. Vista para listar boosts activos por zona (utilidad para frontend de revista)
create or replace view magazine_boosts_active as
select
  b.id as boost_id,
  b.article_id,
  b.type as boost_type,
  b.starts_at,
  b.ends_at,
  a.title, a.slug, a.type as article_type, a.cover_image_url,
  a.author_first_name, a.author_last_name, a.published_at
from magazine_boosts b
join magazine_articles a on a.id = b.article_id
where b.status = 'active' and a.status = 'published';

grant select on magazine_boosts_active to anon, authenticated;

-- 4. Cron Job: ejecutar activate_boost_queue cada hora.
-- Requiere extensión pg_cron habilitada (probablemente ya activa en Supabase).
-- Si no lo está, habilitarla desde Database → Extensions en Studio.

-- Si el job ya existe (re-ejecución), lo desprogramamos primero.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('magazine-boost-queue-hourly')
      where exists (select 1 from cron.job where jobname = 'magazine-boost-queue-hourly');
    perform cron.schedule(
      'magazine-boost-queue-hourly',
      '0 * * * *',
      $cron$select activate_boost_queue()$cron$
    );
  else
    raise notice 'pg_cron no está habilitado. Habilítalo desde Database → Extensions y vuelve a ejecutar este bloque.';
  end if;
end $$;

-- 5. Verificación
select 'boost columnas limpiadas' as item,
  case when not exists (
    select 1 from information_schema.columns
    where table_name = 'magazine_boosts' and column_name in ('impressions_count', 'impressions_limit')
  ) then 'ok' else 'fail' end as status
union all
select 'columnas factura añadidas',
  case when exists (
    select 1 from information_schema.columns
    where table_name = 'magazine_boosts' and column_name = 'invoice_number'
  ) and exists (
    select 1 from information_schema.columns
    where table_name = 'magazine_boosts' and column_name = 'pdf_url'
  ) then 'ok' else 'fail' end
union all
select 'rpc activate_boost_queue',
  case when exists (select 1 from pg_proc where proname = 'activate_boost_queue') then 'ok' else 'fail' end
union all
select 'vista magazine_boosts_active',
  case when exists (select 1 from information_schema.views where table_name = 'magazine_boosts_active') then 'ok' else 'fail' end
union all
select 'cron job',
  case when exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) and exists (
    select 1 from cron.job where jobname = 'magazine-boost-queue-hourly'
  ) then 'ok' else 'pendiente_o_pg_cron_off' end;
