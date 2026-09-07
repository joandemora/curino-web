-- =============================================================
-- Portal del cliente (carpintería) — vínculo user_id + policies read
-- =============================================================
-- Añade el enlace cuenta web ↔ carpintería y las policies de SOLO
-- LECTURA que el portal necesita para pintar reuniones y métricas
-- del cliente logueado, sin exponer datos de otros clientes, ni de
-- llamadas, ni el catálogo completo de prescriptores.
--
-- Reglas duras:
--   - crm_clientes: portal ve UNA fila (la suya).
--   - crm_reuniones: portal ve sólo sus reuniones.
--   - crm_prescriptores: portal ve SÓLO los que tienen reunión con
--     su cliente (para resolver nombre_estudio en la vista
--     crm_portal_reuniones sin dar acceso al catálogo).
--   - crm_llamadas: NINGUNA policy para el portal → 0 filas visibles.
--   - Nada de update/insert/delete para el portal (100% lectura).
--     resultado_cliente y estado de las reuniones los sigue
--     registrando el staff. Si en el futuro el cliente puede
--     confirmar recepción, se abrirá una policy de update MUY
--     acotada en otra migración (decisión: hoy portal = read-only).
--
-- crm_metricas_cliente_mes: se le hace security_invoker = true.
-- Con security_invoker por defecto (false) la vista corre como owner
-- y bypasea la RLS de crm_reuniones — cualquier authenticated podría
-- ver métricas de todos los clientes. Fix de seguridad extra por
-- encima del brief.

-- =============================================================
-- 1. Vínculo user_id en crm_clientes
-- =============================================================
alter table crm_clientes
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- Unique por columna (excepto null). Permite desvincular sin romper.
create unique index if not exists idx_crm_clientes_user_id_unique
  on crm_clientes(user_id) where user_id is not null;

-- =============================================================
-- 2. RPCs staff-only para vincular / desvincular
-- =============================================================
-- El admin no tiene acceso directo a auth.users desde el cliente
-- Supabase. Estas RPC lo resuelven bajo `security definer` con
-- guard is_crm_staff() al principio.

-- Vincular: dado email → uuid.
create or replace function get_user_id_by_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
begin
  if not is_crm_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select id into v_uid
    from auth.users
   where lower(email) = lower(trim(p_email))
   limit 1;
  return v_uid;
end;
$$;

revoke all on function get_user_id_by_email(text) from public;
grant execute on function get_user_id_by_email(text) to authenticated;

-- Reverse lookup para pintar el email en la ficha admin. Bulk para
-- alimentar el listado de clientes de un tirón.
create or replace function get_user_emails_by_ids(p_ids uuid[])
returns table(user_id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not is_crm_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text
      from auth.users u
     where u.id = any(p_ids);
end;
$$;

revoke all on function get_user_emails_by_ids(uuid[]) from public;
grant execute on function get_user_emails_by_ids(uuid[]) to authenticated;

-- =============================================================
-- 3. Policies de portal (SOLO SELECT)
-- =============================================================

-- crm_clientes: ve UNA fila, la suya.
drop policy if exists "crm_clientes portal read" on crm_clientes;
create policy "crm_clientes portal read"
  on crm_clientes for select
  to authenticated
  using (user_id = auth.uid());

-- crm_reuniones: sólo las de la carpintería del user.
drop policy if exists "crm_reuniones portal read" on crm_reuniones;
create policy "crm_reuniones portal read"
  on crm_reuniones for select
  to authenticated
  using (
    cliente_id in (
      select id from crm_clientes where user_id = auth.uid()
    )
  );

-- crm_prescriptores: SÓLO los que tienen reunión con el cliente del
-- user. Es lo mínimo para que crm_portal_reuniones (security invoker,
-- JOIN con prescriptores) resuelva nombre_estudio sin dar acceso al
-- catálogo completo.
drop policy if exists "crm_prescriptores portal read" on crm_prescriptores;
create policy "crm_prescriptores portal read"
  on crm_prescriptores for select
  to authenticated
  using (
    exists (
      select 1
      from crm_reuniones r
      join crm_clientes c on c.id = r.cliente_id
      where r.prescriptor_id = crm_prescriptores.id
        and c.user_id = auth.uid()
    )
  );

-- crm_llamadas: NINGUNA policy nueva. La única existente es la de
-- staff → un portal-user recibe 0 filas siempre.

-- =============================================================
-- 4. crm_metricas_cliente_mes → security_invoker = true
-- =============================================================
alter view crm_metricas_cliente_mes set (security_invoker = true);
