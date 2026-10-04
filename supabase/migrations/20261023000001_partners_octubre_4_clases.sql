-- =============================================================
-- Intensivo: edicion de octubre con 4 clases (2026-10)
-- =============================================================
-- Textos de la base de datos: titulo de la edicion abierta, plantilla
-- «Enlace de Zoom» y pasos de la secuencia «Seguimiento solicitud intensivo»
-- («8 clases», «dos por semana», «primera edición», «Quedan X de Y plazas»
-- → «{quedan_plazas}»). No cambia fechas ni plazas. Solo sustituye si el
-- texto antiguo sigue ahi (idempotente; respeta ediciones hechas a mano).

update clases set titulo = 'Intensivo Curino Partners · Octubre 2026'
 where id = 'c682f70b-74e8-431e-b0b2-6c44f71f87ea' and titulo = 'Intensivo Curino Partners · Noviembre 2026';

update partners_email_plantillas
   set cuerpo = replace(cuerpo, 'Es el mismo enlace para las 8 clases', 'Es el mismo enlace para las 4 clases'), updated_at = now()
 where cuerpo like '%mismo enlace para las 8 clases%';

update partners_secuencia_pasos
   set cuerpo = replace(cuerpo, '· 4 semanas y 8 clases en directo por Zoom conmigo.', '· 4 clases en directo por Zoom conmigo, una por semana.'), updated_at = now()
 where id = '5e9a0001-0000-4000-8000-000000000011' and cuerpo like '%4 semanas y 8 clases en directo por Zoom conmigo.%';

update partners_secuencia_pasos
   set cuerpo = replace(cuerpo, 'Son 8 clases en directo en 4 semanas, dos por semana.', 'Son 4 clases en directo, una por semana durante 4 semanas.'), updated_at = now()
 where id = '5e9a0001-0000-4000-8000-000000000012' and cuerpo like '%Son 8 clases en directo en 4 semanas, dos por semana.%';

update partners_secuencia_pasos
   set asunto = '{quedan_plazas} en el intensivo de octubre', updated_at = now()
 where id = '5e9a0001-0000-4000-8000-000000000014' and asunto = 'Quedan {plazas_libres} de {plazas_totales} plazas';
update partners_secuencia_pasos
   set cuerpo = replace(cuerpo,
       'Último email sobre esto: en la primera edición del Intensivo Curino Partners quedan **{plazas_libres} de {plazas_totales} plazas**.',
       'Último email sobre esto. **{quedan_plazas}** en el Intensivo Curino Partners de octubre.'), updated_at = now()
 where id = '5e9a0001-0000-4000-8000-000000000014' and cuerpo like '%primera edición del Intensivo Curino Partners quedan%';
