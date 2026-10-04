-- =============================================================
-- CRM Partners · Fase 1 — contactos, ventas y ediciones (2026-10)
-- =============================================================
-- Panel /admin/partners/ (login de admin = user_roles.role 'admin',
-- comprobado con is_admin()). El navegador lee con supabase-js y RLS; las
-- escrituras van por RPCs security definer que comprueban is_admin() y
-- solo tocan estado, notas y datos de la edicion. No hay forma de borrar
-- contactos ni ventas desde el panel.
--
-- Idempotente.

-- -------------------------------------------------------------
-- 1. partners_solicitudes: estado CRM, notas y motivo de baja
-- -------------------------------------------------------------
alter table partners_solicitudes add column if not exists crm_estado text not null default 'nuevo';
alter table partners_solicitudes drop constraint if exists partners_solicitudes_crm_estado_check;
alter table partners_solicitudes add constraint partners_solicitudes_crm_estado_check
  check (crm_estado in ('nuevo', 'contactado', 'interesado', 'compro', 'descartado'));
alter table partners_solicitudes add column if not exists crm_notas text;
alter table partners_solicitudes add column if not exists crm_actualizado_at timestamptz;
-- baja_at (ya existente) + motivo: enlace del email | rebote | queja de spam
alter table partners_solicitudes add column if not exists motivo_baja text;
alter table partners_solicitudes drop constraint if exists partners_solicitudes_motivo_baja_check;
alter table partners_solicitudes add constraint partners_solicitudes_motivo_baja_check
  check (motivo_baja in ('enlace', 'rebote', 'queja'));
update partners_solicitudes set motivo_baja = 'enlace' where baja_at is not null and motivo_baja is null;

-- Quien ya compro aparece como "compro"
update partners_solicitudes set crm_estado = 'compro'
  where (pagado_at is not null or sesion_comprada_at is not null) and crm_estado <> 'compro';

-- -------------------------------------------------------------
-- 2. Lectura solo admin de compras y ediciones (antes: solo service_role)
-- -------------------------------------------------------------
drop policy if exists "Admin can read inscripciones" on inscripciones;
create policy "Admin can read inscripciones" on inscripciones for select using (is_admin());

drop policy if exists "Admin can read clases" on clases;
create policy "Admin can read clases" on clases for select using (is_admin());

-- PDFs de sesiones en el bucket privado invoices (clases/ ya tiene policy)
drop policy if exists "Admin can read all sesion invoices" on storage.objects;
create policy "Admin can read all sesion invoices"
  on storage.objects for select
  using (bucket_id = 'invoices' and name like 'sesiones/%.pdf' and is_admin());

-- -------------------------------------------------------------
-- 3. Vistas (security_invoker: aplican las RLS de admin de las tablas)
-- -------------------------------------------------------------
create or replace view crm_partners_ventas with (security_invoker = true) as
select
  'intensivo'::text                         as producto,
  i.id                                      as compra_id,
  i.clase_id                                as edicion_id,
  coalesce(c.titulo, 'Intensivo Curino Partners') as edicion,
  i.created_at                              as fecha,
  i.nombre, i.email, i.telefono,
  i.importe_cents,
  round(i.importe_cents / 1.21)::int        as base_cents,
  i.importe_cents - round(i.importe_cents / 1.21)::int as iva_cents,
  i.invoice_number, i.pdf_url,
  i.estado,
  i.importe_reembolsado_cents,
  r.rect_numeros, r.rect_pdfs,
  ps.id                                     as solicitud_id
from inscripciones i
left join clases c on c.id = i.clase_id
left join partners_solicitudes ps on ps.inscripcion_id = i.id
left join lateral (
  select string_agg(f.invoice_number, ', ' order by f.created_at) as rect_numeros,
         array_agg(f.pdf_url order by f.created_at)               as rect_pdfs
  from facturas_rectificativas_clase f
  where f.inscripcion_id = i.id and f.invoice_number is not null
) r on true
where c.oculta is not true                   -- fuera la edicion de prueba oculta
union all
select
  'sesion'::text, s.id, null::uuid, 'Sesión 1:1 con Juan · 30 min', s.created_at,
  s.nombre, s.email, s.telefono,
  s.importe_cents,
  round(s.importe_cents / 1.21)::int,
  s.importe_cents - round(s.importe_cents / 1.21)::int,
  s.invoice_number, s.pdf_url,
  s.estado,
  s.importe_reembolsado_cents,
  r.rect_numeros, r.rect_pdfs,
  s.solicitud_id
from sesiones_1a1 s
left join lateral (
  select string_agg(f.invoice_number, ', ' order by f.created_at) as rect_numeros,
         array_agg(f.pdf_url order by f.created_at)               as rect_pdfs
  from facturas_rectificativas_clase f
  where f.sesion_id = s.id and f.invoice_number is not null
) r on true;

grant select on crm_partners_ventas to authenticated;

-- -------------------------------------------------------------
-- 4. RPCs de escritura (solo admin)
-- -------------------------------------------------------------
create or replace function crm_partners_actualizar_contacto(p_id uuid, p_estado text, p_notas text)
returns partners_solicitudes
language plpgsql
security definer
set search_path = public
as $$
declare v partners_solicitudes;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  update partners_solicitudes
    set crm_estado = coalesce(p_estado, crm_estado),
        crm_notas  = p_notas,
        crm_actualizado_at = now()
    where id = p_id
    returning * into v;
  return v;
end;
$$;
revoke all on function crm_partners_actualizar_contacto(uuid, text, text) from public, anon;
grant execute on function crm_partners_actualizar_contacto(uuid, text, text) to authenticated;

create or replace function crm_partners_actualizar_edicion(p_id uuid, p_fecha timestamptz, p_fecha_confirmada boolean, p_meet_url text)
returns clases
language plpgsql
security definer
set search_path = public
as $$
declare v clases;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  update clases
    set fecha = coalesce(p_fecha, fecha),
        fecha_confirmada = coalesce(p_fecha_confirmada, fecha_confirmada),
        meet_url = nullif(trim(coalesce(p_meet_url, '')), '')
    where id = p_id
    returning * into v;
  return v;
end;
$$;
revoke all on function crm_partners_actualizar_edicion(uuid, timestamptz, boolean, text) from public, anon;
grant execute on function crm_partners_actualizar_edicion(uuid, timestamptz, boolean, text) to authenticated;

-- La vista solo para usuarios autenticados (y la RLS de admin filtra).
revoke all on crm_partners_ventas from anon;
