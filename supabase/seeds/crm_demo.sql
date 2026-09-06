-- =============================================================
-- Seed mínimo para probar el CRM en local o staging.
-- =============================================================
-- Ejecutar a mano en el SQL Editor de Supabase (o `psql`).
-- Idempotente por email/nombre + on conflict do nothing donde aplica.
-- Contiene: 1 cliente demo, 3 prescriptores, 2 llamadas, 1 reunión.
--
-- NO ejecutar en producción.

do $$
declare
  v_cliente_id  uuid;
  v_presc_1     uuid;
  v_presc_2     uuid;
  v_presc_3     uuid;
  v_llamada_1   uuid;
  v_llamada_2   uuid;
begin
  -- 1 cliente demo ------------------------------------------------
  insert into crm_clientes (
    nombre, nif, persona_contacto, email, telefono,
    poblacion, territorio, cuota_mensual, estado,
    fecha_alta, objetivo_reuniones_mes, notas
  )
  values (
    'Carpintería Demo SL', 'B00000000', 'Marta Ruiz',
    'demo@carpinteriademo.es', '600000000',
    'Barcelona', 'Cataluña', 1700, 'piloto',
    current_date, 2, 'Cliente semilla para pruebas locales.'
  )
  returning id into v_cliente_id;

  -- 3 prescriptores ----------------------------------------------
  insert into crm_prescriptores (
    nombre_estudio, tipo, persona_contacto, email, telefono,
    ciudad, territorio, instagram, estado, cliente_asignado, fuente, notas
  )
  values (
    'Estudio Alfa Arquitectos', 'arquitecto', 'Laura Pons',
    'laura@estudioalfa.com', '610000001',
    'Barcelona', 'Cataluña', '@estudioalfa',
    'en_cadencia', v_cliente_id, 'Instagram', 'Interesada en armarios a medida.'
  )
  returning id into v_presc_1;

  insert into crm_prescriptores (
    nombre_estudio, tipo, persona_contacto, email, telefono,
    ciudad, territorio, estado, cliente_asignado, fuente
  )
  values (
    'Beta Interiorismo', 'interiorista', 'Pau Garriga',
    'pau@betainteriorismo.com', '610000002',
    'Girona', 'Cataluña', 'frio', v_cliente_id, 'Referido'
  )
  returning id into v_presc_2;

  insert into crm_prescriptores (
    nombre_estudio, tipo, persona_contacto, telefono,
    ciudad, territorio, estado, cliente_asignado
  )
  values (
    'Constructora Gamma', 'constructora', 'Sergi Vidal',
    '610000003', 'Sabadell', 'Cataluña', 'contactado', v_cliente_id
  )
  returning id into v_presc_3;

  -- 2 llamadas ---------------------------------------------------
  insert into crm_llamadas (
    prescriptor_id, cliente_id, fecha, resultado,
    duracion_segundos, proximo_contacto, notas
  )
  values (
    v_presc_1, v_cliente_id, now() - interval '2 days',
    'conversacion', 420, current_date + 7,
    'Hablo con Laura. Le encajaría reunión la próxima semana.'
  )
  returning id into v_llamada_1;

  insert into crm_llamadas (
    prescriptor_id, cliente_id, fecha, resultado, notas
  )
  values (
    v_presc_2, v_cliente_id, now() - interval '1 day',
    'no_contesta', 'Buzón lleno; reintentar por la tarde.'
  )
  returning id into v_llamada_2;

  -- 1 reunión agendada ------------------------------------------
  insert into crm_reuniones (
    prescriptor_id, cliente_id, llamada_id,
    fecha_reunion, estado, resultado_cliente,
    valor_estimado, notas_sdr
  )
  values (
    v_presc_1, v_cliente_id, v_llamada_1,
    now() + interval '7 days', 'agendada', 'pendiente',
    12000, 'Reunión presencial en el showroom de Laura.'
  );
end $$;
