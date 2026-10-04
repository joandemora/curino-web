-- =============================================================
-- Partners · consentimiento de solicitud (2026-10)
-- =============================================================
-- El formulario de /partners pasa a una sola casilla obligatoria:
-- «He leído y acepto la política de privacidad y que Curino contacte
-- conmigo por email y WhatsApp sobre mi solicitud del intensivo.»
--   consentimiento_solicitud → emails 1, 2 y 4 de la secuencia (sobre el
--     intensivo solicitado).
--   consentimiento_comercial → email 3 (oferta sesion 1:1) y envios
--     «Comercial» del CRM. Ya no hay casilla: se marca con el enlace de los
--     emails 1 y 2 («Quiero recibir también otras formaciones…») o a mano.
-- *_origen: 'formulario' | 'migracion' | 'enlace' | 'manual'.
-- secuencia_inicio_at: inicio de la secuencia si no es completada_at (las
--   solicitudes anteriores al despliegue empiezan ahora, con sus plazos).
-- Idempotente.

alter table partners_solicitudes add column if not exists consentimiento_solicitud boolean not null default false;
alter table partners_solicitudes add column if not exists consentimiento_solicitud_at timestamptz;
alter table partners_solicitudes add column if not exists consentimiento_solicitud_origen text;
alter table partners_solicitudes add column if not exists consentimiento_comercial_at timestamptz;
alter table partners_solicitudes add column if not exists consentimiento_comercial_origen text;
alter table partners_solicitudes add column if not exists secuencia_inicio_at timestamptz;

-- Comercial ya existente (casilla v2): fecha y origen del formulario.
update partners_solicitudes
   set consentimiento_comercial_at = coalesce(consentimiento_at, created_at), consentimiento_comercial_origen = 'formulario'
 where consentimiento_comercial and consentimiento_comercial_at is null;

-- Decision de 2026-10: todas las solicitudes anteriores al despliegue entran
-- en la secuencia (consentimiento_solicitud por migracion). Las completas,
-- sin compra, sin baja y sin ningun email de la secuencia empiezan ahora.
update partners_solicitudes
   set consentimiento_solicitud = true, consentimiento_solicitud_at = now(), consentimiento_solicitud_origen = 'migracion'
 where not consentimiento_solicitud and consentimiento_solicitud_origen is null;
update partners_solicitudes
   set secuencia_inicio_at = now()
 where secuencia_inicio_at is null and completada_at is not null and pagado_at is null
   and baja_at is null and seguimiento_1_at is null and seguimiento_2_at is null and seguimiento_4_at is null;

-- Cambio manual desde el CRM (check en Contactos / ficha). Solo admin.
create or replace function crm_partners_consentimiento(p_id uuid, p_campo text, p_valor boolean)
returns partners_solicitudes
language plpgsql security definer set search_path = public as $$
declare r partners_solicitudes;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_campo = 'solicitud' then
    update partners_solicitudes
       set consentimiento_solicitud = p_valor, consentimiento_solicitud_at = now(), consentimiento_solicitud_origen = 'manual',
           -- al activarlo sin ningun email enviado, la secuencia empieza ahora
           secuencia_inicio_at = case when p_valor and seguimiento_1_at is null and seguimiento_2_at is null and seguimiento_4_at is null
                                      then now() else secuencia_inicio_at end
     where id = p_id returning * into r;
  elsif p_campo = 'comercial' then
    update partners_solicitudes
       set consentimiento_comercial = p_valor, consentimiento_comercial_at = now(), consentimiento_comercial_origen = 'manual'
     where id = p_id returning * into r;
  else
    raise exception 'campo no valido';
  end if;
  if r.id is null then raise exception 'no encontrado'; end if;
  return r;
end $$;
revoke all on function crm_partners_consentimiento(uuid, text, boolean) from public, anon;
grant execute on function crm_partners_consentimiento(uuid, text, boolean) to authenticated;
