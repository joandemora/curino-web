-- =============================================================
-- Intensivo Curino Partners — reembolsos + datos de facturacion
-- =============================================================
-- 1. Reembolsos (charge.refunded en stripe-webhook):
--    - Columnas de registro en inscripciones.
--    - RPC liberar_plaza_clase(): en una sola transaccion pasa la
--      inscripcion de 'pagada' a 'reembolsada', resta 1 plaza (nunca
--      por debajo de 0) y reabre la edicion si estaba 'agotada' y aun
--      no ha empezado. Idempotente por la guarda estado = 'pagada': si
--      el mismo evento llega dos veces, la segunda no hace nada.
-- 2. Facturacion: datos del comprador que recoge Stripe Checkout
--    (billing_address_collection + tax_id_collection) para emitir
--    factura completa (con NIF) o simplificada.
--
-- No cambia la logica de venta ni incrementar_plaza_clase(). Idempotente.

-- -------------------------------------------------------------
-- 1. Columnas
-- -------------------------------------------------------------
alter table inscripciones add column if not exists importe_reembolsado_cents int not null default 0
  check (importe_reembolsado_cents >= 0);
alter table inscripciones add column if not exists reembolsada_at timestamptz;
alter table inscripciones add column if not exists refund_email_sent_at timestamptz;

alter table inscripciones add column if not exists factura_tipo text
  check (factura_tipo in ('simplificada', 'completa'));
alter table inscripciones add column if not exists cliente_nombre_fiscal text;
alter table inscripciones add column if not exists cliente_nif text;
alter table inscripciones add column if not exists cliente_direccion text;

create index if not exists idx_inscripciones_payment_intent on inscripciones(stripe_payment_intent);

-- -------------------------------------------------------------
-- 2. RPC liberar_plaza_clase (reembolso total)
-- -------------------------------------------------------------
-- Devuelve la inscripcion actualizada si este llamada la ha pasado a
-- 'reembolsada' (y por tanto ha liberado la plaza). NULL si ya estaba
-- reembolsada (reintento del webhook) o no existe.
create or replace function liberar_plaza_clase(p_inscripcion_id uuid, p_importe_reembolsado_cents int)
returns inscripciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ins inscripciones%rowtype;
begin
  update inscripciones
    set estado = 'reembolsada',
        reembolsada_at = now(),
        importe_reembolsado_cents = greatest(importe_reembolsado_cents, coalesce(p_importe_reembolsado_cents, 0))
    where id = p_inscripcion_id
      and estado = 'pagada'
    returning * into v_ins;

  if not found then
    return null;
  end if;

  update clases
    set plazas_ocupadas = greatest(plazas_ocupadas - 1, 0),
        -- Solo se reabre si estaba agotada y la edicion aun no ha empezado:
        -- clases_public lista toda fila 'abierta', tambien las pasadas.
        estado = case when estado = 'agotada' and fecha > now() then 'abierta' else estado end
    where id = v_ins.clase_id;

  return v_ins;
end;
$$;

revoke all on function liberar_plaza_clase(uuid, int) from public, anon, authenticated;
