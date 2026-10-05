-- partners_solicitudes.fallo_aviso_at: ultimo aviso a info@ por un paso del
-- formulario que no se pudo guardar (evita repetir el aviso en 10 min).
alter table partners_solicitudes add column if not exists fallo_aviso_at timestamptz;
