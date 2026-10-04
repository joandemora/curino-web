-- =============================================================
-- /partners v2 — nuevas preguntas del formulario (2026-10)
-- =============================================================
-- El formulario pasa a ser para gente que empieza de cero y se elimina
-- la pregunta de inversion. Preguntas v2:
--   1. situacion_actual  ¿Cual es tu situacion ahora?
--   2. experiencia       ¿Tienes experiencia en alguno de estos campos?
--   3. dedicacion        ¿Cuanto tiempo podrias dedicarle?
--   4. inicio            ¿Cuando quieres empezar?
-- cualificado = inicio <> 'informandome'.
-- perfil_one_to_one = dedicacion = 'tiempo_completo'.
--
-- Las columnas v1 (p1_dedicacion, p2_situacion, p2_instagram_web,
-- p3_inicio, p4_inversion) se conservan para las filas ya guardadas y
-- porque la Edge Function acepta ambos formatos durante la transicion.
--
-- Idempotente.

alter table partners_solicitudes add column if not exists situacion_actual text;
alter table partners_solicitudes add column if not exists experiencia text;
alter table partners_solicitudes add column if not exists dedicacion text;
alter table partners_solicitudes add column if not exists inicio text;
alter table partners_solicitudes add column if not exists perfil_one_to_one boolean not null default false;

alter table partners_solicitudes drop constraint if exists partners_solicitudes_situacion_actual_check;
alter table partners_solicitudes add constraint partners_solicitudes_situacion_actual_check
  check (situacion_actual in ('cuenta_ajena', 'autonomo_negocio', 'cambio_profesional', 'estudiando'));

alter table partners_solicitudes drop constraint if exists partners_solicitudes_experiencia_check;
alter table partners_solicitudes add constraint partners_solicitudes_experiencia_check
  check (experiencia in ('reformas_carpinteria', 'interiorismo_arquitectura', 'ventas_atencion', 'desde_cero'));

alter table partners_solicitudes drop constraint if exists partners_solicitudes_dedicacion_check;
alter table partners_solicitudes add constraint partners_solicitudes_dedicacion_check
  check (dedicacion in ('1_2_horas', 'media_jornada', 'tiempo_completo'));

alter table partners_solicitudes drop constraint if exists partners_solicitudes_inicio_check;
alter table partners_solicitudes add constraint partners_solicitudes_inicio_check
  check (inicio in ('noviembre', 'proximos_meses', 'informandome'));

-- segmento: valores v2 + los de v1 para filas historicas
alter table partners_solicitudes drop constraint if exists partners_solicitudes_segmento_check;
alter table partners_solicitudes add constraint partners_solicitudes_segmento_check
  check (segmento in ('cualificado', 'informandose', 'necesita_semanas', 'sin_presupuesto'));

-- cta_final: añade el WhatsApp del one-to-one desde la pantalla final
alter table partners_solicitudes drop constraint if exists partners_solicitudes_cta_final_check;
alter table partners_solicitudes add constraint partners_solicitudes_cta_final_check
  check (cta_final in ('checkout', 'whatsapp', 'whatsapp_one_to_one'));

create index if not exists idx_partners_solicitudes_one_to_one
  on partners_solicitudes(perfil_one_to_one) where perfil_one_to_one;
