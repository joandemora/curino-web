-- =============================================================
-- Estudio Curino · numeración de proyectos por usuario (2026-10)
-- =============================================================
-- estudio_proyectos.numero: n.º correlativo por usuario (01, 02…). El nombre
-- se guarda como «NN - Nombre». Al crear, estudio-ia asigna max(numero) + 1.
-- Los proyectos importados llevan el n.º de su carpeta; los de «OLD» y
-- «Proveedores y tarifas» no tienen número (null, al final de la lista).
-- Idempotente.

alter table estudio_proyectos add column if not exists numero int check (numero is null or numero > 0);
create unique index if not exists uq_estudio_proyectos_user_numero on estudio_proyectos(user_id, numero) where numero is not null;
