-- =============================================================
-- Fase G2 — Extensión RPC invoice + storage policies bucket magazine
-- =============================================================

-- 1. Extender RPC assign_invoice_number con tipo 'magazine' (prefijo REVISTA-)
create or replace function assign_invoice_number(p_type text, p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_prefix text;
  v_formatted text;
begin
  if p_type not in ('simplified', 'auto_invoice', 'magazine') then
    raise exception 'Invalid invoice type: %', p_type;
  end if;
  if p_year < 2026 or p_year > 2100 then
    raise exception 'Invalid year: %', p_year;
  end if;
  insert into invoice_counters (invoice_type, year, last_number)
    values (p_type, p_year, 0)
    on conflict (invoice_type, year) do nothing;
  update invoice_counters
    set last_number = last_number + 1,
        updated_at = now()
    where invoice_type = p_type and year = p_year
    returning last_number into v_number;
  v_prefix := case p_type
    when 'simplified' then 'CURINO'
    when 'auto_invoice' then 'AUTO'
    when 'magazine' then 'REVISTA'
  end;
  v_formatted := v_prefix || '-' || p_year::text || '-' || lpad(v_number::text, 6, '0');
  return v_formatted;
end;
$$;

-- 2. Storage policies para bucket magazine-articles (bucket público pero upload restringido)

-- INSERT: solo users autenticados pueden subir, y solo en la carpeta de un artículo que les pertenezca
drop policy if exists "Magazine users upload to own article folder" on storage.objects;
create policy "Magazine users upload to own article folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'magazine-articles'
    and exists (
      select 1 from magazine_articles
      where magazine_articles.id::text = (storage.foldername(name))[1]
        and magazine_articles.user_id = auth.uid()
    )
  );

-- UPDATE: solo dueño del artículo
drop policy if exists "Magazine users update own article files" on storage.objects;
create policy "Magazine users update own article files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'magazine-articles'
    and exists (
      select 1 from magazine_articles
      where magazine_articles.id::text = (storage.foldername(name))[1]
        and magazine_articles.user_id = auth.uid()
    )
  );

-- DELETE: solo dueño del artículo
drop policy if exists "Magazine users delete own article files" on storage.objects;
create policy "Magazine users delete own article files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'magazine-articles'
    and exists (
      select 1 from magazine_articles
      where magazine_articles.id::text = (storage.foldername(name))[1]
        and magazine_articles.user_id = auth.uid()
    )
  );

-- Admin puede hacer todo en el bucket
drop policy if exists "Admin all magazine files" on storage.objects;
create policy "Admin all magazine files"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'magazine-articles'
    and exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
  )
  with check (
    bucket_id = 'magazine-articles'
    and exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
  );

-- NOTA: la lectura pública NO se controla por RLS, se gestiona marcando el bucket como public=true.
-- Esto Joan lo hace manualmente desde Studio: Storage > magazine-articles > Edit bucket > toggle Public ON.

-- Verificación
select 'rpc tiene magazine' as check, exists (
  select 1 from pg_proc
  where proname = 'assign_invoice_number'
    and prosrc ilike '%magazine%'
) as ok
union all
select 'storage policies magazine', count(*)::boolean
from pg_policies
where policyname like '%agazine%' and tablename = 'objects';
