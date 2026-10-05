-- /partners/formaciones es privada (solo por enlace tras la llamada): el
-- paso 3 de la secuencia (oferta de la sesión 1:1, hoy sin enviarse porque
-- la sesión está desactivada) deja de enlazar a formaciones y lleva a la
-- llamada de admisión. Idempotente.
update partners_secuencia_pasos set
  cuerpo = replace(cuerpo, '[[Quiero mi sesión por {precio_oferta_sesion} €]]({enlace_formaciones})', '[[Reservar mi llamada de admisión]]({enlace_llamada})'),
  updated_at = now()
 where cuerpo like '%({enlace_formaciones})%';
