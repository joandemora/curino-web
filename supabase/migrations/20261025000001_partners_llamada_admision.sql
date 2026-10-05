-- =============================================================
-- Partners · embudo con llamada de admisión (2026-10)
-- =============================================================
-- - Pregunta 5 del formulario: inversion ('si' | 'si_organizarme' |
--   'no_por_ahora'). Cualificado = inicio <> 'informandome' y
--   inversion <> 'no_por_ahora' (segmento 'sin_presupuesto' si no la tiene).
-- - Llamada de admisión (Cal.com, webhook cal-webhook): llamada_at,
--   llamada_estado ('reservada' | 'cancelada'), llamada_uid, origen
--   ('formulario' | 'cal.com' si la reserva llega de alguien que no estaba).
-- - Secuencias: sale_llamada (quien reserva llamada sale) y condición de
--   paso req_cualificado. Emails 1, 2 y 4 → «Reservar mi llamada de
--   admisión» ({enlace_llamada}), sin precios ni enlaces de pago.
-- - Intensivo de octubre: 1.650 € (precio_cents 165000).
-- Idempotente.

alter table partners_solicitudes add column if not exists inversion text;
alter table partners_solicitudes drop constraint if exists partners_solicitudes_inversion_check;
alter table partners_solicitudes add constraint partners_solicitudes_inversion_check
  check (inversion in ('si', 'si_organizarme', 'no_por_ahora'));
alter table partners_solicitudes add column if not exists llamada_at timestamptz;
alter table partners_solicitudes add column if not exists llamada_estado text;
alter table partners_solicitudes drop constraint if exists partners_solicitudes_llamada_estado_check;
alter table partners_solicitudes add constraint partners_solicitudes_llamada_estado_check
  check (llamada_estado in ('reservada', 'cancelada'));
alter table partners_solicitudes add column if not exists llamada_uid text;
alter table partners_solicitudes add column if not exists llamada_actualizada_at timestamptz;
alter table partners_solicitudes add column if not exists origen text not null default 'formulario';

alter table partners_secuencias add column if not exists sale_llamada boolean not null default true;
alter table partners_secuencia_pasos add column if not exists req_cualificado boolean not null default false;

-- Precio del intensivo de octubre
update clases set precio_cents = 165000 where id = 'c682f70b-74e8-431e-b0b2-6c44f71f87ea' and precio_cents = 99000;

-- Pasos 1, 2 y 4: solo cualificados y con la llamada de admisión
update partners_secuencia_pasos set req_cualificado = true
 where id in ('5e9a0001-0000-4000-8000-000000000011', '5e9a0001-0000-4000-8000-000000000012', '5e9a0001-0000-4000-8000-000000000014');

update partners_secuencia_pasos set
  asunto = '{nombre}, reserva tu llamada de admisión',
  cuerpo = $b$Hola {nombre},

Te escribo por si se te cerró la página después de rellenar la solicitud del Intensivo Curino Partners.

El último paso es una llamada de admisión de 20 minutos conmigo: vemos tu caso y si puedes acceder a una de las plazas de la edición de octubre.

Te recuerdo lo que incluye el intensivo:
· 4 clases en directo por Zoom conmigo, una por semana.
· El negocio, producto y producción, diseño y presupuesto, y cómo vender y entregar.
· Plantilla de presupuesto, contrato de venta, catálogo y acceso al CAD de Curino.
· El grupo de WhatsApp de tu promoción.

Elige el día y la hora que mejor te vengan:

[[Reservar mi llamada de admisión]]({enlace_llamada})

Si tienes cualquier duda, respóndeme a este email o [escríbeme por WhatsApp]({enlace_whatsapp}).$b$,
  updated_at = now()
 where id = '5e9a0001-0000-4000-8000-000000000011' and cuerpo like '%({enlace_plaza})%';

update partners_secuencia_pasos set
  cuerpo = replace(cuerpo, $b$Si lo tienes claro, aquí tienes tu plaza:

[[Reservar mi plaza]]({enlace_plaza})$b$, $b$Si lo tienes claro, reserva tu llamada de admisión y lo vemos juntos:

[[Reservar mi llamada de admisión]]({enlace_llamada})$b$),
  updated_at = now()
 where id = '5e9a0001-0000-4000-8000-000000000012' and cuerpo like '%({enlace_plaza})%';

update partners_secuencia_pasos set
  cuerpo = replace(cuerpo, $b$Aquí tienes todas las formaciones, por si quieres empezar por el intensivo o con una sesión conmigo:

[[Ver las formaciones]]({enlace_formaciones})$b$, $b$Si quieres una de ellas, reserva tu llamada de admisión y vemos si encaja contigo:

[[Reservar mi llamada de admisión]]({enlace_llamada})$b$),
  updated_at = now()
 where id = '5e9a0001-0000-4000-8000-000000000014' and cuerpo like '%({enlace_formaciones})%';
