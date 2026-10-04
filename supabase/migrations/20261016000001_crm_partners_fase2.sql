-- =============================================================
-- CRM Partners · Fase 2 — alumnos por edición y Sesión 1:1 (2026-10)
-- =============================================================
-- Marcas manuales por alumno (fecha = marcado; null = no):
--   inscripciones: materiales_enviados_at, grupo_whatsapp_at
--   sesiones_1a1:  materiales_enviados_at (recursos), sesion_reservada_at
-- Solo se cambian con la RPC crm_partners_marcar_alumno (admin). Idempotente.

alter table inscripciones add column if not exists materiales_enviados_at timestamptz;
alter table inscripciones add column if not exists grupo_whatsapp_at timestamptz;
alter table sesiones_1a1 add column if not exists materiales_enviados_at timestamptz;
alter table sesiones_1a1 add column if not exists sesion_reservada_at timestamptz;

create or replace function crm_partners_marcar_alumno(p_tipo text, p_id uuid, p_campo text, p_valor boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v timestamptz := case when p_valor then now() else null end;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_tipo = 'intensivo' and p_campo in ('materiales_enviados_at', 'grupo_whatsapp_at') then
    execute format('update inscripciones set %I = $1 where id = $2', p_campo) using v, p_id;
  elsif p_tipo = 'sesion' and p_campo in ('materiales_enviados_at', 'sesion_reservada_at') then
    execute format('update sesiones_1a1 set %I = $1 where id = $2', p_campo) using v, p_id;
  else
    raise exception 'campo no permitido';
  end if;
  return v;
end;
$$;
revoke all on function crm_partners_marcar_alumno(text, uuid, text, boolean) from public, anon;
grant execute on function crm_partners_marcar_alumno(text, uuid, text, boolean) to authenticated;
