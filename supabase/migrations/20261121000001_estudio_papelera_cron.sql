-- Estudio Curino · purga diaria de la papelera (2026-10-15)
--
-- Tarea pg_cron 'estudio-papelera-purgar' a las 04:15 UTC (≈ 6:15 Madrid en
-- verano, después de 'estudio-caducar-presupuestos'): llama a la función
-- estudio-papelera, que borra definitivamente (archivos + entrada) lo que lleva
-- más de 30 días en estudio_papelera, en todos los proyectos. Los archivos del
-- almacenamiento solo se pueden borrar desde la API de Storage, por eso no es
-- SQL puro. Mismo patrón que partners-seguimiento (URL y secreto en Vault).
-- Idempotente.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'supabase_vault')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('estudio-papelera-purgar')
      where exists (select 1 from cron.job where jobname = 'estudio-papelera-purgar');
    perform cron.schedule(
      'estudio-papelera-purgar',
      '15 4 * * *',
      $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'clases_functions_url') || '/estudio-papelera',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'clases_cron_secret')
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  end if;
end $$;
