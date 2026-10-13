-- =============================================================
-- Estudio Curino · unidad «créditos» (2026-10)
-- =============================================================
-- 1 crédito = 0,01 $ de coste real de IA. La contabilidad interna sigue en
-- dólares de coste real (estudio_uso.coste_usd, credito_mensual_usd,
-- estudio_saldo.usd, packs[].usd, plan_usd); la web del alumno, emails,
-- facturas y condiciones muestran créditos (= usd × 100). Así los saldos de
-- prueba ya quedan convertidos sin tocar datos.
-- Nuevas cifras (editables en el admin):
--   crédito incluido 500 créditos/mes (5 $), packs 10 € → 90, 25 € → 225,
--   50 € → 450 créditos, plan 79 €/mes con 700 créditos.
-- multiplicador y eur_usd solo sirven en el admin para sugerir créditos por
-- precio (precio sin IVA × eur_usd ÷ (0,01 × multiplicador)) y ver el margen.
-- Idempotente.

alter table estudio_config add column if not exists multiplicador numeric(6,2) not null default 10;
alter table estudio_config add column if not exists eur_usd numeric(6,4) not null default 1.08;

alter table estudio_config alter column credito_mensual_usd set default 5;
alter table estudio_config alter column plan_eur set default 79;
alter table estudio_config alter column plan_usd set default 7;
alter table estudio_config alter column packs set default
  '[{"id":"p10","eur":10,"usd":0.9},{"id":"p25","eur":25,"usd":2.25},{"id":"p50","eur":50,"usd":4.5}]'::jsonb;

update estudio_config set
  credito_mensual_usd = 5,
  plan_eur = 79,
  plan_usd = 7,
  packs = '[{"id":"p10","eur":10,"usd":0.9},{"id":"p25","eur":25,"usd":2.25},{"id":"p50","eur":50,"usd":4.5}]'::jsonb,
  updated_at = now()
where id = 1;
