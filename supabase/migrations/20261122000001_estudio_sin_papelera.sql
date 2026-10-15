-- Estudio Curino · sin papelera (2026-10-15)
--
-- Se retira la papelera (20261120000001 / 20261121000001): borrar vuelve a ser
-- definitivo. Lo que contenía se borró antes, archivos incluidos. Se quitan la
-- tarea pg_cron de purga y la tabla. La función estudio-papelera se elimina con
-- `supabase functions delete estudio-papelera`. Idempotente.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('estudio-papelera-purgar')
      where exists (select 1 from cron.job where jobname = 'estudio-papelera-purgar');
  end if;
end $$;

drop table if exists public.estudio_papelera;
