-- =============================================================
-- Seed mínimo para probar el CRM en local o staging.
-- =============================================================
-- Ejecutar a mano en el SQL Editor de Supabase (o `psql`).
-- Contiene:
--   Cliente 1 "Carpintería Demo" (obj 2): 3 prescriptores, 2 llamadas,
--     1 reunión agendada este mes (semáforo ámbar mes actual),
--     2 reuniones agendadas + celebradas el mes pasado (semáforo verde).
--   Cliente 2 "Fusteria Segona" (obj 2): 2 prescriptores, 3 llamadas
--     este mes, 0 reuniones (semáforo rojo mes actual → garantía activada).
--
-- Ejecutable varias veces si vaciás las tablas antes; no es idempotente
-- por email/nombre (inserta duplicados si se corre encima).
--
-- NO ejecutar en producción.

do $$
declare
  v_cliente_id   uuid;
  v_cliente2_id  uuid;
  v_presc_1      uuid;
  v_presc_2      uuid;
  v_presc_3      uuid;
  v_presc2_1     uuid;
  v_presc2_2     uuid;
  v_llamada_1    uuid;
  v_llamada_2    uuid;
  -- mes pasado a mitad de mes (evita bordes por diferencias de días)
  v_past_month timestamptz := (date_trunc('month', current_date) - interval '15 days');
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

  -- 2 reuniones celebradas el mes pasado para Cliente 1 → GREEN
  -- (creamos también con created_at en el mes pasado, porque la vista
  --  agrupa reuniones_agendadas por date_trunc('month', created_at))
  insert into crm_reuniones (
    prescriptor_id, cliente_id, llamada_id,
    fecha_reunion, estado, resultado_cliente,
    valor_estimado, notas_sdr, created_at
  ) values
    (v_presc_1, v_cliente_id, null, v_past_month + interval '2 days',
     'celebrada', 'proyecto_en_curso', 18000,
     'Cerró proyecto de armario vestidor.', v_past_month),
    (v_presc_2, v_cliente_id, null, v_past_month + interval '9 days',
     'celebrada', 'presupuesto_enviado', 6500,
     'Pidió presupuesto para cocina.', v_past_month + interval '3 days');

  -- ============================================================
  -- Cliente 2: Fusteria Segona (semáforo ROJO mes actual)
  -- ============================================================
  insert into crm_clientes (
    nombre, nif, persona_contacto, email, telefono,
    poblacion, territorio, cuota_mensual, estado,
    fecha_alta, objetivo_reuniones_mes, notas
  )
  values (
    'Fusteria Segona SL', 'B11111111', 'Anna Puig',
    'anna@fusteriasegona.cat', '620000000',
    'Valencia', 'Comunidad Valenciana', 1700, 'piloto',
    current_date, 2,
    'Segundo cliente demo: llega el mes con 0 reuniones para probar el rojo de garantía.'
  )
  returning id into v_cliente2_id;

  insert into crm_prescriptores (
    nombre_estudio, tipo, persona_contacto, telefono,
    ciudad, territorio, estado, cliente_asignado, fuente
  )
  values (
    'Estudio Delta Arquitectura', 'arquitecto', 'Marc Sanchis',
    '610000010', 'Valencia', 'Comunidad Valenciana',
    'en_cadencia', v_cliente2_id, 'COAV listado'
  )
  returning id into v_presc2_1;

  insert into crm_prescriptores (
    nombre_estudio, tipo, email, telefono,
    ciudad, territorio, estado, cliente_asignado
  )
  values (
    'Epsilon Interiorisme', 'interiorista', 'hola@epsilonint.com',
    '610000011', 'Alicante', 'Comunidad Valenciana',
    'frio', v_cliente2_id
  )
  returning id into v_presc2_2;

  -- 3 llamadas este mes, 0 reuniones → embudo con ratio 0
  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, notas)
  values
    (v_presc2_1, v_cliente2_id, now() - interval '4 days', 'no_contesta', null),
    (v_presc2_1, v_cliente2_id, now() - interval '2 days', 'conversacion', 'Pide que le enviemos catálogo.'),
    (v_presc2_2, v_cliente2_id, now() - interval '1 day',  'buzon', null);
end $$;
