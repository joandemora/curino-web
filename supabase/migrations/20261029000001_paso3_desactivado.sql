-- Paso 3 «Oferta sesión 1:1» de la secuencia: desactivado (la Sesión 1:1
-- no se vende en la web). Se conserva con su historial; se puede volver a
-- activar desde Secuencias si se reactiva la sesión.
update partners_secuencia_pasos set activo = false, updated_at = now()
 where id = '5e9a0001-0000-4000-8000-000000000013' and activo;
