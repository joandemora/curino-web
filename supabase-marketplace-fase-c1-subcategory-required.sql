-- =============================================================
-- Fase C1 hotfix — subcategory obligatoria con set fijo
-- =============================================================
-- Las piezas del marketplace deben tener subcategoría para que el
-- configurador 2D las agrupe correctamente en biblioteca.
--
-- Cancela el hotfix anterior (subcategory nullable) y vuelve a NOT NULL.
-- Las piezas legacy ya tienen subcategory rellenada (de Curino).
--
-- Las subcategorías permitidas dependen de la categoría. La validación
-- vive en la Edge Function publish-library-item y en las RPCs
-- update_library_item_category, update_library_item_subcategory.

-- 1. Backfill defensivo (por si hubo alguna pieza creada sin subcategory)
update library_items
set subcategory = case category
  when 'asientos' then 'otros'
  when 'mesas' then 'mesa-comedor'
  when 'almacenamiento' then 'estanteria'
  when 'iluminacion' then 'lampara-techo'
  when 'decoracion' then 'cuadros'
  when 'exterior' then 'silla-exterior'
  else 'otros'
end
where subcategory is null;

-- 2. Volver a hacer NOT NULL
alter table library_items
  alter column subcategory set not null;

-- 3. RPC para actualizar subcategoría
create or replace function update_library_item_subcategory(p_item_id uuid, p_new_subcategory text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_owner_id uuid;
  v_category text;
  v_valid boolean := false;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  if p_new_subcategory is null or length(trim(p_new_subcategory)) = 0 then
    raise exception 'invalid_subcategory' using errcode = '22023';
  end if;

  select role = 'admin' into v_is_admin
  from user_roles where user_id = v_user_id;
  v_is_admin := coalesce(v_is_admin, false);

  select seller_id, category into v_owner_id, v_category
  from library_items
  where id = p_item_id;

  if v_owner_id is null then
    raise exception 'item_not_found' using errcode = '02000';
  end if;

  if not v_is_admin and v_owner_id != v_user_id then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Validar que la subcategoría es permitida para la categoría actual
  case v_category
    when 'asientos' then v_valid := p_new_subcategory in ('sofas', 'sillas', 'butacas', 'taburetes');
    when 'mesas' then v_valid := p_new_subcategory in ('mesa-comedor', 'mesa-centro', 'escritorio', 'mesilla');
    when 'almacenamiento' then v_valid := p_new_subcategory in ('estanteria', 'armario', 'cajonera', 'vitrina');
    when 'iluminacion' then v_valid := p_new_subcategory in ('lampara-techo', 'lampara-mesa', 'lampara-pie');
    when 'decoracion' then v_valid := p_new_subcategory in ('cuadros', 'jarrones', 'espejos', 'plantas');
    when 'exterior' then v_valid := p_new_subcategory in ('silla-exterior', 'mesa-exterior', 'parasol', 'jardineras');
    when 'otros' then v_valid := p_new_subcategory in ('otros');
    else v_valid := false;
  end case;

  if not v_valid then
    raise exception 'invalid_subcategory_for_category' using errcode = '22023';
  end if;

  update library_items
    set subcategory = p_new_subcategory, updated_at = now()
    where id = p_item_id;
end;
$$;
revoke all on function update_library_item_subcategory(uuid, text) from public, anon;
grant execute on function update_library_item_subcategory(uuid, text) to authenticated;

-- 4. Modificar update_library_item_category para que también
-- actualice subcategory cuando cambia category (la subcategoría
-- antigua puede no ser válida para la nueva categoría)
create or replace function update_library_item_category(p_item_id uuid, p_new_category text, p_new_subcategory text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_owner_id uuid;
  v_target_subcategory text;
  v_valid boolean := false;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  if p_new_category is null or p_new_category not in ('asientos', 'mesas', 'almacenamiento', 'iluminacion', 'decoracion', 'exterior', 'otros') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if p_new_subcategory is null or length(trim(p_new_subcategory)) = 0 then
    raise exception 'subcategory_required' using errcode = '22023';
  end if;

  v_target_subcategory := p_new_subcategory;

  -- Validar subcategoría para la nueva categoría
  case p_new_category
    when 'asientos' then v_valid := v_target_subcategory in ('sofas', 'sillas', 'butacas', 'taburetes');
    when 'mesas' then v_valid := v_target_subcategory in ('mesa-comedor', 'mesa-centro', 'escritorio', 'mesilla');
    when 'almacenamiento' then v_valid := v_target_subcategory in ('estanteria', 'armario', 'cajonera', 'vitrina');
    when 'iluminacion' then v_valid := v_target_subcategory in ('lampara-techo', 'lampara-mesa', 'lampara-pie');
    when 'decoracion' then v_valid := v_target_subcategory in ('cuadros', 'jarrones', 'espejos', 'plantas');
    when 'exterior' then v_valid := v_target_subcategory in ('silla-exterior', 'mesa-exterior', 'parasol', 'jardineras');
    when 'otros' then v_valid := v_target_subcategory in ('otros');
  end case;

  if not v_valid then
    raise exception 'invalid_subcategory_for_category' using errcode = '22023';
  end if;

  select role = 'admin' into v_is_admin
  from user_roles where user_id = v_user_id;
  v_is_admin := coalesce(v_is_admin, false);

  select seller_id into v_owner_id
  from library_items
  where id = p_item_id;

  if v_owner_id is null then
    raise exception 'item_not_found' using errcode = '02000';
  end if;

  if not v_is_admin and v_owner_id != v_user_id then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update library_items
    set category = p_new_category,
        subcategory = v_target_subcategory,
        updated_at = now()
    where id = p_item_id;
end;
$$;
revoke all on function update_library_item_category(uuid, text, text) from public, anon;
grant execute on function update_library_item_category(uuid, text, text) to authenticated;
