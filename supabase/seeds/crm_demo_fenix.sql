-- =============================================================
-- Seed DEMO: Armaris Fènix SL — cuenta comercial para carpinterías
-- =============================================================
-- Cliente ficticio pero verosímil para enseñar el portal "Curino
-- Partners" a carpinterías reales. TODO es contenido inventado y
-- vinculado a UN solo cliente + UN solo usuario, para poder borrarlo
-- de un tiro (ver bloque de limpieza al final).
--
-- Contenido:
--   Cliente:      1 fila en crm_clientes (activo, cuota 1700, obj 2/mes,
--                 fecha_alta hace ~4 meses, user_id vinculado).
--   Prescriptores:18 estudios/despachos ficticios del área de Barcelona,
--                 con emails de dominio .example para que nunca choquen
--                 con contactos reales, cliente_asignado = Fènix.
--   Reuniones:    11 en 4 meses (mes1:2, mes2:3, mes3:3, mes4:3);
--                 4 proyecto_en_curso suman 77.300 € firmados; 1 no_show;
--                 3 agendadas en el mes en curso.
--   Llamadas:     11 con resultado 'reunion_agendada' (una por cada
--                 reunión, enlazadas por llamada_id) + ~200 de fondo
--                 con distribución realista (mayoría no_contesta/buzon/
--                 recepcion, ~12% conversaciones, algunas volver_a_llamar).
--
-- Ejecución:
--   1. Crear el usuario `armaris.fenix.demo@casacurino.com` via Admin API
--      (email_confirm=true, password fuerte). Sin ese paso previo este
--      seed falla en el primer SELECT.
--   2. Pegar este archivo en el SQL Editor de Supabase con service_role.
--
-- NO ejecutar dos veces sin limpiar antes → crearía duplicados de todo.

do $$
declare
  v_user_id     uuid;
  v_cliente_id  uuid;
  v_mes1        timestamptz := date_trunc('month', now()) - interval '3 months';
  v_mes2        timestamptz := date_trunc('month', now()) - interval '2 months';
  v_mes3        timestamptz := date_trunc('month', now()) - interval '1 month';
  v_mes4        timestamptz := date_trunc('month', now());

  -- Prescriptores (18) — el estado refleja su historia particular
  v_p1  uuid; v_p2  uuid; v_p3  uuid; v_p4  uuid; v_p5  uuid; v_p6  uuid;
  v_p7  uuid; v_p8  uuid; v_p9  uuid; v_p10 uuid; v_p11 uuid; v_p12 uuid;
  v_p13 uuid; v_p14 uuid; v_p15 uuid; v_p16 uuid; v_p17 uuid; v_p18 uuid;

  -- 11 llamadas que dispararon las reuniones (la fecha de estas llamadas
  -- es el momento de agenda; la reunión ocurre unos días después)
  v_lla1  uuid; v_lla2  uuid; v_lla3  uuid; v_lla4  uuid; v_lla5  uuid;
  v_lla6  uuid; v_lla7  uuid; v_lla8  uuid; v_lla9  uuid; v_lla10 uuid;
  v_lla11 uuid;

  -- Helpers para el bulk de llamadas de fondo
  v_prescs uuid[];
  v_d      date;
  v_ts     timestamptz;
  v_hh     int;
  v_mm     int;
  v_r      double precision;
  v_res    text;
  v_i      int;
begin
  -- 1. Localizar usuario demo (falla claramente si no existe)
  select id into v_user_id
    from auth.users
   where lower(email) = 'armaris.fenix.demo@casacurino.com';
  if v_user_id is null then
    raise exception 'auth user armaris.fenix.demo@casacurino.com no encontrado. Crea el usuario via Admin API antes de correr este seed.';
  end if;

  -- 2. Cliente Armaris Fènix SL --------------------------------
  insert into crm_clientes (
    nombre, nif, persona_contacto, email, telefono,
    poblacion, territorio, cuota_mensual, estado,
    fecha_alta, objetivo_reuniones_mes, notas, user_id,
    created_at, updated_at
  )
  values (
    'Armaris Fènix SL', 'B99999901', 'Marc Vallès',
    'armaris.fenix.demo@casacurino.com', '930000001',
    'Barcelona', 'Barcelona', 1700, 'activo',
    (v_mes1 + interval '3 days')::date, 2,
    'Cuenta DEMO ficticia — para enseñar el portal Curino Partners. Historial de 4 meses fabricado. Borrar con el bloque de limpieza del final del seed.',
    v_user_id,
    v_mes1 + interval '3 days',
    v_mes4 + interval '1 day'
  )
  returning id into v_cliente_id;

  -- 3. Prescriptores (18) --------------------------------------
  -- Nombres claramente ficticios; emails con dominio .example para que
  -- nunca colisionen con contactos reales y los duplicados de import
  -- futuros los detecten sin fricción.

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, instagram, web, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Estudi Nord Arquitectura', 'arquitecto', 'Laia Puig', 'laia@estudinord.example', '610100001', 'Barcelona', 'Barcelona', '@estudinord', 'https://estudinord.example', 'activo', v_cliente_id, 'Instagram', 'DEMO Fènix — proyecto vivienda unifamiliar en Sant Gervasi.', v_mes1 + interval '1 day', v_mes1 + interval '10 days')
    returning id into v_p1;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Taller Vermell Interiors', 'interiorista', 'Núria Bellver', 'nuria@tallervermell.example', '610100002', 'Barcelona', 'Barcelona', 'contactado', v_cliente_id, 'COAC listado', 'DEMO Fènix — presupuesto cocina + isla enviado.', v_mes1 + interval '2 days', v_mes1 + interval '22 days')
    returning id into v_p2;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Praça Estudi', 'arquitecto', 'Pau Rocabert', 'pau@pracaestudi.example', '610100003', 'Sabadell', 'Barcelona', 'activo', v_cliente_id, 'Referido', 'DEMO Fènix — proyecto interiorismo local Rambla Sabadell.', v_mes1 + interval '20 days', v_mes2 + interval '10 days')
    returning id into v_p3;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Costa Interiorisme', 'interiorista', 'Elena Costa', 'elena@costainterior.example', '610100004', 'Sant Cugat del Vallès', 'Barcelona', 'contactado', v_cliente_id, 'Web', 'DEMO Fènix — presupuesto vestidor enviado.', v_mes1 + interval '25 days', v_mes2 + interval '18 days')
    returning id into v_p4;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, telefono, ciudad, territorio, estado, cliente_asignado, notas, created_at, updated_at)
    values ('Grup Vives Constructors', 'constructora', 'Josep Vives', '610100005', 'Terrassa', 'Barcelona', 'descartado', v_cliente_id, 'DEMO Fènix — no_show a la reunión, sin respuesta posterior.', v_mes2 + interval '2 days', v_mes2 + interval '26 days')
    returning id into v_p5;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Estudi Migdia', 'arquitecto', 'Berta Solé', 'berta@estudimigdia.example', '610100006', 'Badalona', 'Barcelona', 'contactado', v_cliente_id, 'COAC listado', 'DEMO Fènix — presupuesto cocina reforma integral.', v_mes2 + interval '20 days', v_mes3 + interval '11 days')
    returning id into v_p6;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, notas, created_at, updated_at)
    values ('Mestral Disseny', 'interiorista', 'Marc Ferrer', 'marc@mestraldisseny.example', '610100007', 'Sant Just Desvern', 'Barcelona', 'contactado', v_cliente_id, 'DEMO Fènix — múltiples conversaciones, valorando encargarle.', v_mes2 + interval '5 days', v_mes3 + interval '20 days')
    returning id into v_p7;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, telefono, ciudad, territorio, estado, cliente_asignado, notas, created_at, updated_at)
    values ('Camí Ral Arquitectes', 'arquitecto', 'Anna Codina', '610100008', 'Granollers', 'Barcelona', 'en_cadencia', v_cliente_id, 'DEMO Fènix — habla poco al teléfono, pide dossier por email.', v_mes2 + interval '10 days', v_mes4 - interval '3 days')
    returning id into v_p8;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Habitat Sant Andreu', 'constructora', 'Sergi Coll', 'sergi@habitatsantandreu.example', '610100009', 'Barcelona', 'Barcelona', 'activo', v_cliente_id, 'Referido', 'DEMO Fènix — proyecto edificio rehabilitación 4 plantas.', v_mes3 + interval '2 days', v_mes3 + interval '20 days')
    returning id into v_p9;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Sala 12 Interiorisme', 'interiorista', 'Cristina Vives', 'cristina@sala12.example', '610100010', 'Barcelona', 'Barcelona', 'activo', v_cliente_id, 'Web', 'DEMO Fènix — proyecto de armarios en 3 viviendas de un promotor.', v_mes3 + interval '15 days', v_mes3 + interval '29 days')
    returning id into v_p10;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Ponent Estudi Arquitectura', 'arquitecto', 'Roger Vidal', 'roger@ponent.example', '610100011', 'Vilafranca del Penedès', 'Barcelona', 'reunion', v_cliente_id, 'COAC listado', 'DEMO Fènix — reunión agendada este mes, primer contacto.', v_mes3 + interval '25 days', v_mes4 + interval '2 days')
    returning id into v_p11;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Volta Catalana Interiors', 'interiorista', 'Mireia Aguilar', 'mireia@voltacatalana.example', '610100012', 'Barcelona', 'Barcelona', 'reunion', v_cliente_id, 'Instagram', 'DEMO Fènix — reunión agendada, interesada en armarios a medida.', v_mes3 + interval '20 days', v_mes4 + interval '4 days')
    returning id into v_p12;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, notas, created_at, updated_at)
    values ('Ferrer & Bosch Arquitectes', 'arquitecto', 'Jordi Ferrer', 'jordi@ferrerbosch.example', '610100013', 'Sant Cugat del Vallès', 'Barcelona', 'reunion', v_cliente_id, 'DEMO Fènix — reunión agendada, refiere un proyecto grande.', v_mes4 - interval '10 days', v_mes4 + interval '6 days')
    returning id into v_p13;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, telefono, ciudad, territorio, estado, cliente_asignado, notas, created_at, updated_at)
    values ('Nou Espai Estudi', 'interiorista', 'Marta Riera', '610100014', 'Mataró', 'Barcelona', 'en_cadencia', v_cliente_id, 'DEMO Fènix — le enviamos catálogo, sin cita todavía.', v_mes2 + interval '18 days', v_mes4 - interval '5 days')
    returning id into v_p14;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, email, telefono, ciudad, territorio, estado, cliente_asignado, fuente, notas, created_at, updated_at)
    values ('Alba Rovira Arquitectura', 'arquitecto', 'Alba Rovira', 'alba@albarovira.example', '610100015', 'Sitges', 'Barcelona', 'contactado', v_cliente_id, 'COAC listado', 'DEMO Fènix — habló con Marc, valorando incluirnos en su próxima obra.', v_mes3 + interval '3 days', v_mes4 - interval '8 days')
    returning id into v_p15;

  insert into crm_prescriptores (nombre_estudio, tipo, telefono, ciudad, territorio, estado, cliente_asignado, notas, created_at, updated_at)
    values ('Puig i Cadafalch Constructors', 'constructora', '610100016', 'Barcelona', 'Barcelona', 'frio', v_cliente_id, 'DEMO Fènix — llamado dos veces, sin respuesta.', v_mes3 + interval '25 days', v_mes4 - interval '2 days')
    returning id into v_p16;

  insert into crm_prescriptores (nombre_estudio, tipo, telefono, ciudad, territorio, estado, cliente_asignado, notas, created_at, updated_at)
    values ('Estudi Sur', 'interiorista', '610100017', 'L''Hospitalet de Llobregat', 'Barcelona', 'frio', v_cliente_id, 'DEMO Fènix — solo una llamada de contacto inicial.', v_mes4 - interval '15 days', v_mes4 - interval '10 days')
    returning id into v_p17;

  insert into crm_prescriptores (nombre_estudio, tipo, persona_contacto, telefono, ciudad, territorio, estado, cliente_asignado, notas, created_at, updated_at)
    values ('Petitcomte Interiorisme', 'interiorista', 'Marta Petit', '610100018', 'Barcelona', 'Barcelona', 'no_molestar', v_cliente_id, 'DEMO Fènix — pidió expresamente que no le volvamos a llamar.', v_mes3 + interval '10 days', v_mes3 + interval '15 days')
    returning id into v_p18;

  -- 4. 11 llamadas con resultado 'reunion_agendada' ------------
  -- La fecha de estas llamadas es el día en que el SDR agenda la reunión.
  -- Cada reunión posterior queda enlazada por llamada_id.

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p1, v_cliente_id, v_mes1 + interval '5 days'  + interval '10 hours 20 minutes', 'reunion_agendada', 480, 'Laia interesada, cierra reunión presencial en el estudio.', v_mes1 + interval '5 days' + interval '10 hours 20 minutes')
    returning id into v_lla1;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p2, v_cliente_id, v_mes1 + interval '18 days' + interval '11 hours 45 minutes', 'reunion_agendada', 540, 'Núria pide reunión para ver muestras de material.', v_mes1 + interval '18 days' + interval '11 hours 45 minutes')
    returning id into v_lla2;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p3, v_cliente_id, v_mes2 + interval '3 days'  + interval '9 hours 40 minutes',  'reunion_agendada', 360, 'Pau acepta cita en obra Rambla Sabadell.', v_mes2 + interval '3 days' + interval '9 hours 40 minutes')
    returning id into v_lla3;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p4, v_cliente_id, v_mes2 + interval '10 days' + interval '16 hours 15 minutes', 'reunion_agendada', 420, 'Elena quiere ver acabados en showroom.', v_mes2 + interval '10 days' + interval '16 hours 15 minutes')
    returning id into v_lla4;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p5, v_cliente_id, v_mes2 + interval '18 days' + interval '12 hours 30 minutes', 'reunion_agendada', 300, 'Josep confirma reunión con la constructora.', v_mes2 + interval '18 days' + interval '12 hours 30 minutes')
    returning id into v_lla5;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p6, v_cliente_id, v_mes3 + interval '4 days'  + interval '10 hours 5 minutes',  'reunion_agendada', 450, 'Berta quiere presupuesto de cocina reforma.', v_mes3 + interval '4 days' + interval '10 hours 5 minutes')
    returning id into v_lla6;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p9, v_cliente_id, v_mes3 + interval '12 days' + interval '17 hours 20 minutes', 'reunion_agendada', 600, 'Sergi trae plano de rehabilitación 4 plantas, quiere presupuesto conjunto.', v_mes3 + interval '12 days' + interval '17 hours 20 minutes')
    returning id into v_lla7;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p10, v_cliente_id, v_mes3 + interval '22 days' + interval '11 hours 10 minutes', 'reunion_agendada', 720, 'Cristina lidera 3 viviendas para un promotor. Reunión conjunta con arquitecta.', v_mes3 + interval '22 days' + interval '11 hours 10 minutes')
    returning id into v_lla8;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p11, v_cliente_id, v_mes4 + interval '2 days'  + interval '10 hours 30 minutes', 'reunion_agendada', 480, 'Roger cierra fecha para conocerse.', v_mes4 + interval '2 days' + interval '10 hours 30 minutes')
    returning id into v_lla9;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p12, v_cliente_id, v_mes4 + interval '4 days'  + interval '15 hours 45 minutes', 'reunion_agendada', 540, 'Mireia interesada en armarios a medida para clientes premium.', v_mes4 + interval '4 days' + interval '15 hours 45 minutes')
    returning id into v_lla10;

  insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
    values (v_p13, v_cliente_id, v_mes4 + interval '6 days'  + interval '12 hours 20 minutes', 'reunion_agendada', 660, 'Jordi menciona proyecto grande, quiere reunirse antes de recomendarnos.', v_mes4 + interval '6 days' + interval '12 hours 20 minutes')
    returning id into v_lla11;

  -- 5. Reuniones (11) ------------------------------------------
  -- Distribución: mes1:2  mes2:3  mes3:3  mes4:3 (agendadas).
  -- 4 proyecto_en_curso (22.000, 14.500, 9.800, 31.000 = 77.300 €).
  -- 3 presupuesto_enviado. 1 no_show. 3 agendadas (mes actual). Resto pendiente.

  insert into crm_reuniones (prescriptor_id, cliente_id, llamada_id, fecha_reunion, estado, resultado_cliente, valor_estimado, notas_sdr, notas_cliente, created_at, updated_at) values
    -- Mes 1 (2)
    (v_p1,  v_cliente_id, v_lla1,  v_mes1 + interval '12 days' + interval '11 hours',  'celebrada', 'proyecto_en_curso', 22000, 'Reunión presencial. Cerró proyecto vivienda unifamiliar.',   'Laia firmó orden 3 armarios + vestidor. Entrega 8 semanas.', v_mes1 + interval '5 days'  + interval '10 hours 25 minutes', v_mes1 + interval '13 days')
   ,(v_p2,  v_cliente_id, v_lla2,  v_mes1 + interval '25 days' + interval '17 hours',  'celebrada', 'presupuesto_enviado', null, 'Reunión en el taller de Núria. Le pasamos presupuesto cocina.', 'Presupuesto enviado, esperando respuesta.',                  v_mes1 + interval '18 days' + interval '11 hours 50 minutes', v_mes1 + interval '26 days')
    -- Mes 2 (3)
   ,(v_p3,  v_cliente_id, v_lla3,  v_mes2 + interval '8 days'  + interval '11 hours',  'celebrada', 'proyecto_en_curso', 14500, 'Visita a obra Rambla Sabadell. Cierra local completo.',      'Pau firmó local completo. Instalación en 6 semanas.',        v_mes2 + interval '3 days'  + interval '9 hours 45 minutes',  v_mes2 + interval '9 days')
   ,(v_p4,  v_cliente_id, v_lla4,  v_mes2 + interval '17 days' + interval '10 hours',  'celebrada', 'presupuesto_enviado', null, 'Elena vio muestras. Le enviamos presupuesto vestidor.',       'Presupuesto vestidor enviado.',                              v_mes2 + interval '10 days' + interval '16 hours 20 minutes', v_mes2 + interval '18 days')
   ,(v_p5,  v_cliente_id, v_lla5,  v_mes2 + interval '25 days' + interval '12 hours',  'no_show',   'pendiente',            null, 'Josep no apareció. Llamado 2 veces sin respuesta.',           null,                                                          v_mes2 + interval '18 days' + interval '12 hours 35 minutes', v_mes2 + interval '26 days')
    -- Mes 3 (3)
   ,(v_p6,  v_cliente_id, v_lla6,  v_mes3 + interval '10 days' + interval '10 hours',  'celebrada', 'presupuesto_enviado', null, 'Reunión en showroom. Enviado presupuesto cocina reforma.',    'Presupuesto cocina enviado.',                                v_mes3 + interval '4 days'  + interval '10 hours 10 minutes', v_mes3 + interval '11 days')
   ,(v_p9,  v_cliente_id, v_lla7,  v_mes3 + interval '18 days' + interval '17 hours',  'celebrada', 'proyecto_en_curso',  9800, 'Sergi trajo plano de rehabilitación. Firmó parcial.',          'Firmado parcial: puertas interiores del edificio. Resto pdte.', v_mes3 + interval '12 days' + interval '17 hours 25 minutes', v_mes3 + interval '19 days')
   ,(v_p10, v_cliente_id, v_lla8,  v_mes3 + interval '27 days' + interval '11 hours',  'celebrada', 'proyecto_en_curso', 31000, 'Reunión conjunta con arquitecta. Cierran 3 viviendas.',       'Cristina firmó los 3 lotes.',                                v_mes3 + interval '22 days' + interval '11 hours 15 minutes', v_mes3 + interval '28 days')
    -- Mes 4 en curso (3 agendadas)
   ,(v_p11, v_cliente_id, v_lla9,  now() + interval '4 days'  + interval '11 hours',   'agendada',  'pendiente',            null, 'Roger acepta reunión en el estudio.',                          null,                                                          v_mes4 + interval '2 days'  + interval '10 hours 35 minutes', v_mes4 + interval '2 days'  + interval '10 hours 35 minutes')
   ,(v_p12, v_cliente_id, v_lla10, now() + interval '8 days'  + interval '16 hours',   'agendada',  'pendiente',            null, 'Mireia pide vernos con muestras de acabados premium.',         null,                                                          v_mes4 + interval '4 days'  + interval '15 hours 50 minutes', v_mes4 + interval '4 days'  + interval '15 hours 50 minutes')
   ,(v_p13, v_cliente_id, v_lla11, now() + interval '13 days' + interval '13 hours',   'agendada',  'pendiente',            null, 'Jordi quiere reunión previa antes de recomendar en el proyecto grande.', null,                                              v_mes4 + interval '6 days'  + interval '12 hours 25 minutes', v_mes4 + interval '6 days'  + interval '12 hours 25 minutes')
  ;

  -- 6. Bulk background llamadas (~200) --------------------------
  -- Distribución realista:
  --   60% no_contesta / 15% buzon / 10% recepcion / 7% volver_a_llamar
  --   6% conversacion (+11 previas de 'reunion_agendada' = ~12% total conv+reu)
  --   2% no_interesado
  -- Fechas: días laborables (lun-vie), horas 9-13 y 15-18h.
  v_prescs := array[v_p1,v_p2,v_p3,v_p4,v_p5,v_p6,v_p7,v_p8,v_p9,v_p10,v_p11,v_p12,v_p13,v_p14,v_p15,v_p16,v_p17,v_p18];

  for v_i in 1..200 loop
    -- Día aleatorio en los últimos ~118 días (cubre 4 meses aprox)
    v_d := (now()::date - (floor(random() * 118))::int);
    -- Salta fines de semana (0=domingo, 6=sábado)
    if extract(dow from v_d) in (0, 6) then
      continue;
    end if;
    -- Horario laboral 9-18h saltando la hora de comer 14-15h
    v_hh := 9 + floor(random() * 9)::int;   -- 9..17
    if v_hh = 14 then v_hh := 15; end if;
    v_mm := floor(random() * 60)::int;
    v_ts := v_d::timestamptz + make_interval(hours => v_hh, mins => v_mm);
    -- Distribución de resultado
    v_r := random();
    if    v_r < 0.60 then v_res := 'no_contesta';
    elsif v_r < 0.75 then v_res := 'buzon';
    elsif v_r < 0.85 then v_res := 'recepcion';
    elsif v_r < 0.92 then v_res := 'volver_a_llamar';
    elsif v_r < 0.98 then v_res := 'conversacion';
    else                  v_res := 'no_interesado';
    end if;
    insert into crm_llamadas (prescriptor_id, cliente_id, fecha, resultado, duracion_segundos, notas, created_at)
      values (v_prescs[1 + floor(random() * 18)::int], v_cliente_id, v_ts, v_res,
              case when v_res in ('conversacion','recepcion') then 60 + floor(random() * 300)::int else null end,
              null,
              v_ts);
  end loop;

end $$;

-- =============================================================
-- LIMPIEZA — descomentar y ejecutar para borrar TODO lo del demo Fènix.
-- =============================================================
-- Orden: llamadas → reuniones → prescriptores → cliente → usuario.
-- Todo se ancla en el cliente Fènix o en el usuario demo, así que si
-- alguna FK futura se olvida, el cliente/usuario detendrá el borrado
-- con un error claro en lugar de dejar huérfanos.
--
-- do $$
-- declare
--   v_user_id    uuid;
--   v_cliente_id uuid;
-- begin
--   select id into v_user_id
--     from auth.users
--    where lower(email) = 'armaris.fenix.demo@casacurino.com';
--   select id into v_cliente_id
--     from crm_clientes where nombre = 'Armaris Fènix SL' and user_id = v_user_id;
--
--   if v_cliente_id is not null then
--     delete from crm_reuniones     where cliente_id = v_cliente_id;
--     delete from crm_llamadas      where cliente_id = v_cliente_id;
--     delete from crm_prescriptores where cliente_asignado = v_cliente_id;
--     delete from crm_clientes      where id = v_cliente_id;
--   end if;
-- end $$;
--
-- -- Y por último el usuario auth (fuera del DO porque usa Admin API o
-- -- una función security definer; desde el SQL Editor con service_role
-- -- funciona la sentencia directa):
-- delete from auth.users where lower(email) = 'armaris.fenix.demo@casacurino.com';
