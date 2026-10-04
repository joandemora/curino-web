-- =============================================================
-- inscripciones: aceptación de condiciones + renuncia al desistimiento
-- =============================================================
-- Desde 2026-10 no hay devoluciones: Stripe Checkout exige la casilla de
-- condiciones (consent_collection.terms_of_service = 'required') con la
-- solicitud de entrega inmediata y la renuncia expresa al desistimiento
-- (art. 103 m TRLGDCU). stripe-webhook guarda aquí session.consent y la
-- fecha/hora en que se procesa la compra (Stripe no da hora propia del
-- consentimiento; es la del pago completado).
--
-- Idempotente.

alter table inscripciones add column if not exists terminos_aceptados boolean not null default false;
alter table inscripciones add column if not exists terminos_aceptados_at timestamptz;
