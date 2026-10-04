-- =============================================================
-- clases.oculta + clases.titulo — ediciones no publicas (pruebas)
-- =============================================================
-- Una edicion con oculta = true:
--   - NO aparece en clases_public (landing /partners, /api/clases-proxima).
--   - NO cuenta en plazas_intensivo_disponibles() (contador del paso 4).
--   - SI se puede comprar por su id via clases-checkout (que lee la tabla
--     con service_role), para compras de prueba con enlace directo.
-- titulo es opcional y, si existe, es el nombre del producto en Stripe.
--
-- Idempotente. No cambia filas existentes (oculta default false).

alter table clases add column if not exists oculta boolean not null default false;
alter table clases add column if not exists titulo text;

create or replace view clases_public as
select
  id,
  fecha,
  duracion_min,
  plazas_totales,
  plazas_ocupadas,
  precio_cents
from clases
where estado = 'abierta'
  and not oculta
order by fecha asc;

grant select on clases_public to anon, authenticated;

create or replace function plazas_intensivo_disponibles()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(plazas_totales - plazas_ocupadas, 0)
  from clases
  where tipo = 'directo'
    and estado in ('abierta', 'agotada')
    and not oculta
    and fecha > now()
  order by fecha asc
  limit 1;
$$;

revoke all on function plazas_intensivo_disponibles() from public;
grant execute on function plazas_intensivo_disponibles() to anon, authenticated;
