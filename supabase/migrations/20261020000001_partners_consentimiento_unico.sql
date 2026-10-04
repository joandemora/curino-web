-- =============================================================
-- Partners · consentimiento unico (2026-10)
-- =============================================================
-- La casilla obligatoria del formulario cubre solicitud + informacion y
-- ofertas de formaciones: el formulario guarda consentimiento_solicitud y
-- consentimiento_comercial a la vez (origen 'formulario'). Las solicitudes
-- anteriores se quedan como estan («solo solicitud»: emails 1, 2 y 4).
-- En el CRM hay un solo check «Consentimiento»: p_campo 'ambos' activa o
-- quita los dos. Se mantienen 'solicitud' y 'comercial'. Idempotente.

create or replace function crm_partners_consentimiento(p_id uuid, p_campo text, p_valor boolean)
returns partners_solicitudes
language plpgsql security definer set search_path = public as $$
declare r partners_solicitudes;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_campo not in ('solicitud', 'comercial', 'ambos') then raise exception 'campo no valido'; end if;
  update partners_solicitudes set
    consentimiento_solicitud = case when p_campo in ('solicitud', 'ambos') then p_valor else consentimiento_solicitud end,
    consentimiento_solicitud_at = case when p_campo in ('solicitud', 'ambos') then now() else consentimiento_solicitud_at end,
    consentimiento_solicitud_origen = case when p_campo in ('solicitud', 'ambos') then 'manual' else consentimiento_solicitud_origen end,
    consentimiento_comercial = case when p_campo in ('comercial', 'ambos') then p_valor else consentimiento_comercial end,
    consentimiento_comercial_at = case when p_campo in ('comercial', 'ambos') then now() else consentimiento_comercial_at end,
    consentimiento_comercial_origen = case when p_campo in ('comercial', 'ambos') then 'manual' else consentimiento_comercial_origen end,
    -- al activar la solicitud sin ningun email enviado, la secuencia empieza ahora
    secuencia_inicio_at = case when p_campo in ('solicitud', 'ambos') and p_valor
                                and seguimiento_1_at is null and seguimiento_2_at is null and seguimiento_4_at is null
                               then now() else secuencia_inicio_at end
  where id = p_id returning * into r;
  if r.id is null then raise exception 'no encontrado'; end if;
  return r;
end $$;
revoke all on function crm_partners_consentimiento(uuid, text, boolean) from public, anon;
grant execute on function crm_partners_consentimiento(uuid, text, boolean) to authenticated;
