-- =============================================================
-- plazas_intensivo_disponibles() — plazas libres de la edicion activa
-- =============================================================
-- Alimenta la etiqueta de urgencia del paso 4 del formulario de
-- /partners ("Solo quedan X plazas" / "Plazas agotadas"). Solo
-- devuelve un entero: nada de fechas, ids ni datos personales.
--
-- Misma fuente que el RPC atomico incrementar_plaza_clase():
-- plazas_totales - plazas_ocupadas de la tabla clases.
--
-- Edicion activa = la proxima clase tipo 'directo' en estado
-- 'abierta' o 'agotada' con fecha futura. A diferencia de la vista
-- clases_public (solo 'abierta'), incluye 'agotada' para poder
-- mostrar 0 plazas en lugar de "sin edicion".
--
-- Devuelve NULL si no hay edicion activa (la landing muestra
-- entonces "Plazas limitadas: maximo 20 alumnos").
--
-- No modifica la tabla clases. Idempotente.

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
    and fecha > now()
  order by fecha asc
  limit 1;
$$;

revoke all on function plazas_intensivo_disponibles() from public;
grant execute on function plazas_intensivo_disponibles() to anon, authenticated;
