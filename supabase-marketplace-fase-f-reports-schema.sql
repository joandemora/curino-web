-- =============================================================
-- Fase F — Sistema de reports y takedowns
-- =============================================================

-- 1. Tabla library_item_reports
create table if not exists library_item_reports (
  id uuid primary key default gen_random_uuid(),
  library_item_id uuid not null references library_items(id) on delete cascade,
  reporter_id uuid not null references auth.users(id),
  reason text not null check (reason in ('copyright', 'inappropriate', 'incorrect_info', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved_takedown', 'resolved_no_action', 'dismissed_spam')),
  admin_notes text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Constraint: solo 1 report activo por (item, reporter). Si se quiere reportar otra vez, primero hay que cerrar el anterior.
create unique index if not exists idx_unique_open_report_per_user_item
  on library_item_reports(library_item_id, reporter_id)
  where status in ('open', 'under_review');

-- Índices auxiliares
create index if not exists idx_library_item_reports_status on library_item_reports(status);
create index if not exists idx_library_item_reports_item on library_item_reports(library_item_id);
create index if not exists idx_library_item_reports_created on library_item_reports(created_at desc);

-- 2. RLS policies
alter table library_item_reports enable row level security;

-- Reporter puede insertar sus propios reports
drop policy if exists "Users can insert own reports" on library_item_reports;
create policy "Users can insert own reports"
  on library_item_reports for insert
  with check (auth.uid() = reporter_id);

-- Reporter puede leer sus propios reports
drop policy if exists "Users can read own reports" on library_item_reports;
create policy "Users can read own reports"
  on library_item_reports for select
  using (auth.uid() = reporter_id);

-- Admin puede leer y modificar todos los reports
drop policy if exists "Admin can read all reports" on library_item_reports;
create policy "Admin can read all reports"
  on library_item_reports for all
  using (
    exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
  );

-- 3. RPC submit_report
create or replace function submit_report(
  p_item_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_seller_id uuid;
  v_report_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required';
  end if;

  -- Validar reason
  if p_reason not in ('copyright', 'inappropriate', 'incorrect_info', 'other') then
    raise exception 'invalid_reason: %', p_reason;
  end if;

  -- Si reason = 'other', details es obligatorio
  if p_reason = 'other' and (p_details is null or length(trim(p_details)) = 0) then
    raise exception 'details_required_for_other';
  end if;

  -- Validar que la pieza existe y obtener seller_id
  select seller_id into v_seller_id
  from library_items where id = p_item_id;
  if v_seller_id is null then
    raise exception 'item_not_found';
  end if;

  -- No se puede reportar la propia pieza
  if v_seller_id = v_user_id then
    raise exception 'cannot_report_own_item';
  end if;

  -- Insertar report (el UNIQUE INDEX evita duplicados activos)
  insert into library_item_reports (library_item_id, reporter_id, reason, details)
  values (p_item_id, v_user_id, p_reason, p_details)
  returning id into v_report_id;

  return v_report_id;
exception
  when unique_violation then
    raise exception 'already_reported';
end;
$$;

grant execute on function submit_report(uuid, text, text) to authenticated;

-- 4. RPC resolve_report (admin only)
create or replace function resolve_report(
  p_report_id uuid,
  p_action text,
  p_admin_notes text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
  v_item_id uuid;
  v_new_status text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'auth_required';
  end if;

  -- Verificar admin
  select exists(select 1 from user_roles where user_id = v_user_id and role = 'admin') into v_is_admin;
  if not v_is_admin then
    raise exception 'admin_only';
  end if;

  -- Mapear action a status
  if p_action = 'takedown' then
    v_new_status := 'resolved_takedown';
  elsif p_action = 'no_action' then
    v_new_status := 'resolved_no_action';
  elsif p_action = 'spam' then
    v_new_status := 'dismissed_spam';
  elsif p_action = 'review' then
    v_new_status := 'under_review';
  else
    raise exception 'invalid_action: %', p_action;
  end if;

  -- Cargar item_id del report
  select library_item_id into v_item_id
  from library_item_reports where id = p_report_id;
  if v_item_id is null then
    raise exception 'report_not_found';
  end if;

  -- Actualizar el report
  update library_item_reports
  set status = v_new_status,
      admin_notes = p_admin_notes,
      resolved_by = case when v_new_status = 'under_review' then null else v_user_id end,
      resolved_at = case when v_new_status = 'under_review' then null else now() end
  where id = p_report_id;

  -- Si action = takedown, retirar la pieza
  if p_action = 'takedown' then
    update library_items
    set status = 'taken_down', updated_at = now()
    where id = v_item_id and status = 'published';
  end if;

  return json_build_object('report_id', p_report_id, 'new_status', v_new_status, 'item_id', v_item_id);
end;
$$;

grant execute on function resolve_report(uuid, text, text) to authenticated;

-- 5. Vista para el panel admin (join con auth.users para mostrar email del reporter)
create or replace view library_item_reports_with_details as
select
  r.*,
  i.name as item_name,
  i.seller_id,
  i.status as item_status,
  ru.email as reporter_email
from library_item_reports r
join library_items i on i.id = r.library_item_id
left join auth.users ru on ru.id = r.reporter_id;

grant select on library_item_reports_with_details to authenticated;
