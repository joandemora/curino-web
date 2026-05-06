-- =============================================================
-- Fase C1 — RPCs para gestión de piezas del marketplace
-- =============================================================
-- Permite a un seller (o admin) gestionar sus piezas en library_items:
-- publicar, despublicar, editar precio, eliminar.
--
-- Reglas:
-- - Un seller solo puede tocar sus propias piezas (seller_id = auth.uid()).
-- - Admin puede tocar cualquier pieza.
-- - Eliminar: soft delete (status='deleted'). NO permitido si hay purchases existentes.
-- - Editar precio: validación rango 0 OR 150-300 (consistente con Fase A).
-- - Publicar: cambia status de 'draft' a 'published', valida no exceder 5 items
--   publicados (admin exento, ya cubierto por trigger enforce_max_items_per_seller).

-- =============================================================
-- RPC: publish_library_item
-- =============================================================
-- Cambia status de 'draft' a 'published'. Trigger validate_paid_item_requires_active_seller
-- y enforce_max_items_per_seller se ejecutan antes del UPDATE y bloquean si hace falta.
create or replace function publish_library_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_owner_id uuid;
  v_status text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select role = 'admin' into v_is_admin
  from user_roles where user_id = v_user_id;
  v_is_admin := coalesce(v_is_admin, false);

  select seller_id, status into v_owner_id, v_status
  from library_items
  where id = p_item_id;

  if v_owner_id is null then
    raise exception 'item_not_found' using errcode = '02000';
  end if;

  if not v_is_admin and v_owner_id != v_user_id then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if v_status = 'taken_down' and not v_is_admin then
    raise exception 'taken_down_cannot_republish' using errcode = '42501';
  end if;

  if v_status = 'deleted' then
    raise exception 'item_deleted' using errcode = '02000';
  end if;

  update library_items
    set status = 'published', updated_at = now()
    where id = p_item_id;
end;
$$;
revoke all on function publish_library_item(uuid) from public, anon;
grant execute on function publish_library_item(uuid) to authenticated;

-- =============================================================
-- RPC: unpublish_library_item
-- =============================================================
-- Cambia status de 'published' a 'draft'. Pieza queda invisible en biblioteca.
create or replace function unpublish_library_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_owner_id uuid;
  v_status text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select role = 'admin' into v_is_admin
  from user_roles where user_id = v_user_id;
  v_is_admin := coalesce(v_is_admin, false);

  select seller_id, status into v_owner_id, v_status
  from library_items
  where id = p_item_id;

  if v_owner_id is null then
    raise exception 'item_not_found' using errcode = '02000';
  end if;

  if not v_is_admin and v_owner_id != v_user_id then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if v_status not in ('published', 'taken_down') then
    raise exception 'invalid_status_transition' using errcode = '22023';
  end if;

  update library_items
    set status = 'draft', updated_at = now()
    where id = p_item_id;
end;
$$;
revoke all on function unpublish_library_item(uuid) from public, anon;
grant execute on function unpublish_library_item(uuid) to authenticated;

-- =============================================================
-- RPC: update_library_item_price
-- =============================================================
-- Cambia el precio de una pieza. Validación: 0 (gratis) o 150-300 cts (1.50-3.00€).
-- Si la pieza pasa de 0 a precio>0, valida que el seller esté activo.
create or replace function update_library_item_price(p_item_id uuid, p_new_price_cents int)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_owner_id uuid;
  v_old_price int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  if p_new_price_cents != 0 and (p_new_price_cents < 150 or p_new_price_cents > 300) then
    raise exception 'invalid_price' using errcode = '22023';
  end if;

  select role = 'admin' into v_is_admin
  from user_roles where user_id = v_user_id;
  v_is_admin := coalesce(v_is_admin, false);

  select seller_id, price_cents into v_owner_id, v_old_price
  from library_items
  where id = p_item_id;

  if v_owner_id is null then
    raise exception 'item_not_found' using errcode = '02000';
  end if;

  if not v_is_admin and v_owner_id != v_user_id then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Si pasa de gratis a precio>0, validar que el seller esté activo (admin exento)
  if v_old_price = 0 and p_new_price_cents > 0 and not v_is_admin then
    if not is_seller_active(v_user_id) then
      raise exception 'seller_not_active' using errcode = '42501';
    end if;
  end if;

  update library_items
    set price_cents = p_new_price_cents, updated_at = now()
    where id = p_item_id;
end;
$$;
revoke all on function update_library_item_price(uuid, int) from public, anon;
grant execute on function update_library_item_price(uuid, int) to authenticated;

-- =============================================================
-- RPC: delete_library_item
-- =============================================================
-- Soft delete: cambia status a 'deleted'. NO permitido si la pieza tiene
-- compras (purchases) registradas — esas compras tienen que seguir siendo
-- válidas (descargables por el comprador).
create or replace function delete_library_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_owner_id uuid;
  v_purchases_count int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required' using errcode = '42501';
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

  -- Verifica si hay compras de pago. Compras gratis (auto-claims con order_id=null) no bloquean.
  select count(*) into v_purchases_count
  from purchases
  where library_item_id = p_item_id and order_id is not null;

  if v_purchases_count > 0 and not v_is_admin then
    raise exception 'has_purchases_cannot_delete' using errcode = '42501';
  end if;

  update library_items
    set status = 'deleted', updated_at = now()
    where id = p_item_id;
end;
$$;
revoke all on function delete_library_item(uuid) from public, anon;
grant execute on function delete_library_item(uuid) to authenticated;
