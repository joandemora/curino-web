-- Estudio Curino · llamadas a Claude que fallan no se cobran (2026-10-17)
--
-- estudio_uso.cobrado: false cuando la llamada falló o no dio resultado. El
-- coste real se sigue guardando (coste_usd) para el panel de costes, pero el
-- crédito gastado del alumno (estudio_alumnos.gastado_usd) solo suma lo cobrado,
-- y no se descuenta del saldo de packs. Idempotente.

alter table public.estudio_uso add column if not exists cobrado boolean not null default true;

CREATE OR REPLACE FUNCTION public.estudio_alumnos(p_email text DEFAULT NULL::text)
 RETURNS TABLE(email text, nombre text, productos text, inicio timestamp with time zone, fin_curso timestamp with time zone, acceso_hasta timestamp with time zone, ampliado boolean, cortado boolean, concedido boolean, activo boolean, user_id uuid, credito_usd numeric, gastado_usd numeric, proyectos integer, nota text, saldo_usd numeric, suscripcion text, suscripcion_hasta timestamp with time zone, puede_suscribirse boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cfg as (select * from estudio_config where id = 1),
  compras as (
    select lower(i.email) as email, i.nombre, 'Intensivo'::text as producto,
           c.fecha as inicio, c.fecha + interval '21 days' as fin
      from inscripciones i join clases c on c.id = i.clase_id
     where i.estado = 'pagada' and coalesce(c.oculta, false) = false
    union all
    select lower(o.email), o.nombre, 'One-to-one', o.created_at, o.created_at + interval '3 months'
      from one_to_one_compras o where o.estado = 'pagada'
  ),
  por_email as (
    select email, (array_agg(nombre order by fin desc))[1] as nombre,
           string_agg(distinct producto, ' + ') as productos, min(inicio) as inicio, max(fin) as fin
      from compras group by email
  ),
  subs as (
    select lower(s.email) as email, s.estado, s.current_period_end,
           (s.estado in ('active', 'trialing', 'past_due') and coalesce(s.current_period_end, now()) >= now()) as vigente
      from estudio_suscripciones s
  ),
  todos as (
    select coalesce(p.email, a.email, s.email) as email, p.nombre, p.productos, p.inicio, p.fin,
           a.acceso_hasta as manual, coalesce(a.cortado, false) as cortado, coalesce(a.concedido, false) as concedido,
           a.credito_mensual_usd, a.nota, s.estado as sus_estado, s.current_period_end as sus_hasta, coalesce(s.vigente, false) as suscrito
      from por_email p
      full join estudio_accesos a on a.email = p.email
      full join subs s on s.email = coalesce(p.email, a.email)
  ),
  calc as (
    select t.*, coalesce(t.manual, t.fin + make_interval(months => (select meses_tras_fin from cfg))) as hasta_incluido
      from todos t
  )
  select c.email, c.nombre, coalesce(c.productos, case when c.concedido then 'Acceso concedido' when c.suscrito then 'Plan mensual' end),
         c.inicio, c.fin,
         case when c.suscrito then greatest(coalesce(c.hasta_incluido, c.sus_hasta), c.sus_hasta) else c.hasta_incluido end,
         c.manual is not null, c.cortado, c.concedido,
         (not c.cortado) and (
           c.suscrito
           or ((c.productos is not null or c.concedido) and coalesce(c.hasta_incluido, 'infinity'::timestamptz) >= now())
         ) as activo,
         u.id,
         case when c.suscrito then greatest(coalesce(c.credito_mensual_usd, (select credito_mensual_usd from cfg)), (select plan_usd from cfg))
              else coalesce(c.credito_mensual_usd, (select credito_mensual_usd from cfg)) end
           + coalesce((select sum(x.usd) from estudio_creditos x where x.email = c.email and x.mes = estudio_mes_actual()), 0),
         coalesce((select sum(us.coste_usd) from estudio_uso us where us.user_id = u.id and us.created_at >= estudio_inicio_mes() and us.cobrado), 0),
         coalesce((select count(*)::int from estudio_proyectos pr where pr.user_id = u.id), 0),
         c.nota,
         greatest(0, coalesce((select sum(sa.usd) from estudio_saldo sa where sa.email = c.email), 0)),
         c.sus_estado, c.sus_hasta,
         (not c.cortado) and (c.productos is not null or c.concedido or c.sus_estado is not null)
    from calc c
    left join auth.users u on lower(u.email) = c.email
   where (p_email is null or c.email = lower(p_email))
     and (auth.role() = 'service_role' or is_admin())
$function$;
