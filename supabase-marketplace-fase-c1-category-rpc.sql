-- =============================================================
-- Fase C1 hotfix — RPC para actualizar categoría de una pieza
-- =============================================================

create or replace function update_library_item_category(p_item_id uuid, p_new_category text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_owner_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  if p_new_category is null or p_new_category not in ('asientos', 'mesas', 'almacenamiento', 'iluminacion', 'decoracion', 'exterior', 'otros') then
    raise exception 'invalid_category' using errcode = '22023';
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
    set category = p_new_category, updated_at = now()
    where id = p_item_id;
end;
$$;
revoke all on function update_library_item_category(uuid, text) from public, anon;
grant execute on function update_library_item_category(uuid, text) to authenticated;
