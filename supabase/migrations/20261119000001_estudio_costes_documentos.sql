-- =============================================================
-- Estudio Curino · los costes salen de los documentos
-- =============================================================
-- - Un coste es un documento «Factura proveedor» o «Presupuesto proveedor»
--   con su importe (base) y su «tipo de coste» (lista editable por usuario en
--   Tarifa: estudio_tarifas.tipos_coste; null = lista inicial).
-- - Un presupuesto de proveedor cuenta mientras ninguna factura lo sustituya
--   (sustituido_por → la factura). 0 € = sin importe (margen no fiable).
-- - Documento de coste sin archivo: path / mime null, bytes 0.
-- - estudio_proyectos.costes_v2: los proyectos que ya existían siguen con las
--   reglas de antes (facturas de proveedor + costes manuales) hasta que se
--   migran con estudio_migrar_costes(usuario); los nuevos nacen con true.
-- - estudio_migrar_costes(): cada coste manual → documento de coste sin
--   archivo (importe, fecha, concepto, tipo); en los proyectos con alguna
--   factura de proveedor, sus presupuestos de proveedor quedan sustituidos por
--   la primera factura (la de fecha más antigua) para que los totales no
--   cambien; los documentos de proveedor sin tipo pasan a «Otros». Los costes
--   manuales y los cobros NO se borran (estudio_costes.migrado_a marca el
--   documento creado).
-- Idempotente.

alter table estudio_ficheros alter column path drop not null;
alter table estudio_ficheros alter column mime drop not null;
alter table estudio_ficheros drop constraint if exists estudio_ficheros_bytes_check;
alter table estudio_ficheros add constraint estudio_ficheros_bytes_check check (bytes >= 0);
alter table estudio_ficheros add column if not exists tipo_coste text;
alter table estudio_ficheros add column if not exists concepto text;
alter table estudio_ficheros add column if not exists sustituido_por uuid references estudio_ficheros(id) on delete set null;
alter table estudio_ficheros add column if not exists coste_origen uuid;
alter table estudio_costes add column if not exists migrado_a uuid;
alter table estudio_tarifas add column if not exists tipos_coste jsonb;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estudio_proyectos' and column_name = 'costes_v2') then
    alter table estudio_proyectos add column costes_v2 boolean not null default false;   -- existentes: reglas de antes hasta migrar
    alter table estudio_proyectos alter column costes_v2 set default true;                -- nuevos: costes desde documentos
  end if;
end $$;

create or replace function estudio_migrar_costes(p_user uuid) returns table(costes_migrados int, presupuestos_sustituidos int, proyectos int)
language plpgsql security definer set search_path = public as $$
declare n1 int; n2 int; n3 int;
begin
  -- 1) Costes manuales → documentos de coste sin archivo (factura de proveedor)
  with nuevos as (
    insert into estudio_ficheros (proyecto_id, user_id, path, nombre, mime, bytes, subido, tipo, fecha, base, notas, tipo_coste, concepto, coste_origen)
    select c.proyecto_id, c.user_id, null,
           coalesce(nullif(c.concepto, ''), case c.categoria when 'materiales' then 'Materiales' when 'mano_obra' then 'Mano de obra' when 'transporte' then 'Transporte' when 'montaje' then 'Montaje' else 'Otros' end),
           null, 0, true, 'factura_proveedor', c.fecha, c.importe, 'Coste manual migrado a documento',
           case c.categoria when 'materiales' then 'Tablero/material' when 'mano_obra' then 'Fabricación/taller' when 'transporte' then 'Transporte' when 'montaje' then 'Montaje' else 'Otros' end,
           c.concepto, c.id
      from estudio_costes c join estudio_proyectos p on p.id = c.proyecto_id
     where p.user_id = p_user and not p.costes_v2 and c.migrado_a is null
    returning id, coste_origen)
  update estudio_costes c set migrado_a = n.id from nuevos n where c.id = n.coste_origen;
  get diagnostics n1 = row_count;
  -- 2) Presupuestos de proveedor en proyectos con alguna factura de proveedor (de antes): sustituidos por la primera
  update estudio_ficheros pp
     set sustituido_por = (select f.id from estudio_ficheros f
                            where f.proyecto_id = pp.proyecto_id and f.tipo = 'factura_proveedor' and f.coste_origen is null
                            order by f.fecha nulls last, f.created_at limit 1)
    from estudio_proyectos p
   where p.id = pp.proyecto_id and p.user_id = p_user and not p.costes_v2
     and pp.tipo = 'presupuesto_proveedor' and pp.sustituido_por is null
     and exists (select 1 from estudio_ficheros f where f.proyecto_id = pp.proyecto_id and f.tipo = 'factura_proveedor' and f.coste_origen is null);
  get diagnostics n2 = row_count;
  -- 3) Documentos de proveedor sin tipo de coste → «Otros»
  update estudio_ficheros f set tipo_coste = 'Otros'
    from estudio_proyectos p
   where p.id = f.proyecto_id and p.user_id = p_user and not p.costes_v2
     and f.tipo in ('factura_proveedor', 'presupuesto_proveedor') and f.tipo_coste is null;
  -- 4) Los proyectos del usuario pasan a las reglas nuevas
  update estudio_proyectos set costes_v2 = true where user_id = p_user and not costes_v2;
  get diagnostics n3 = row_count;
  return query select n1, n2, n3;
end $$;
revoke all on function estudio_migrar_costes(uuid) from public, anon, authenticated;
