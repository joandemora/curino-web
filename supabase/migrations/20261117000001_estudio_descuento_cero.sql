-- =============================================================
-- Estudio Curino · descuento profesional por defecto = 0 %
-- =============================================================
-- La tabla nacía con 30 % por defecto y las tres tarifas existentes (Curino,
-- sistemacurino y el alumno de prueba) lo tenían sin haberlo elegido nadie.
-- Por defecto pasa a 0 % (armarios y cocinas) y las tres se ponen a 0 %
-- (confirmado por Joan, 2026-10-14). Los presupuestos guardados conservan el
-- descuento de cada partida.

alter table estudio_tarifas alter column descuento_pct set default 0;
update estudio_tarifas set descuento_pct = 0 where descuento_pct = 30;
