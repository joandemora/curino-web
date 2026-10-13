-- =============================================================
-- Estudio Curino · caducidad de presupuestos enviados (2026-10)
-- =============================================================
-- Un presupuesto «enviado» con más de estudio_config.dias_caducidad días
-- (def. 90) desde que pasó a enviado (estado_at; si no, enviado_at) pasa a
-- «rechazado» con estado_nota «Rechazado automáticamente: más de N días sin
-- respuesta» y la fecha del cambio. No toca aceptados ni borradores. Si el
-- usuario lo vuelve a «enviado», estado_at = ahora y cuentan N días de nuevo
-- (estudio-ia presupuesto_estado borra la nota). Tarea diaria pg_cron
-- 'estudio-caducar-presupuestos' a las 04:00 UTC (≈ 6:00 Madrid en verano).
-- Idempotente.

alter table estudio_presupuestos add column if not exists estado_nota text;
alter table estudio_config add column if not exists dias_caducidad int not null default 90 check (dias_caducidad between 7 and 365);

create or replace function estudio_caducar_presupuestos() returns int
language plpgsql security definer set search_path = public as $$
declare d int; n int;
begin
  select coalesce(dias_caducidad, 90) into d from estudio_config where id = 1;
  d := coalesce(d, 90);
  update estudio_presupuestos
     set estado = 'rechazado', rechazado_at = now(), estado_at = now(), updated_at = now(),
         aceptado_at = null,
         estado_nota = format('Rechazado automáticamente: más de %s días sin respuesta', d)
   where estado = 'enviado'
     and coalesce(estado_at, enviado_at, updated_at) < now() - make_interval(days => d);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function estudio_caducar_presupuestos() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('estudio-caducar-presupuestos')
      where exists (select 1 from cron.job where jobname = 'estudio-caducar-presupuestos');
    perform cron.schedule('estudio-caducar-presupuestos', '0 4 * * *', $cron$ select estudio_caducar_presupuestos() $cron$);
  end if;
end $$;
