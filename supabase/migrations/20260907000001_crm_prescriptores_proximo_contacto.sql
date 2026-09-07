-- =============================================================
-- Fix: crm_prescriptores.proximo_contacto
-- =============================================================
-- La cola de llamadas (admin/crm/index.html, PR #177) lee y escribe
-- este campo sobre crm_prescriptores para ordenar los callbacks
-- comprometidos por el SDR (SELECT, .order() y UPDATE en el flujo
-- "volver_a_llamar"). El schema original (20260906000001) sólo lo
-- había creado en crm_llamadas, y la cola rompe en producción con
-- "column crm_prescriptores.proximo_contacto does not exist".
--
-- Solución: añadirlo también en crm_prescriptores. Fecha (no timestamp)
-- porque el SDR compromete un día, no una hora.

alter table crm_prescriptores
  add column if not exists proximo_contacto date;

-- La cola ordena por este campo y filtra `<= hoy` para separar los
-- callbacks vencidos del resto. La mayoría de prescriptores nunca
-- tendrán fecha (índice parcial para mantenerlo pequeño).
create index if not exists idx_crm_prescriptores_proximo_contacto
  on crm_prescriptores(proximo_contacto)
  where proximo_contacto is not null;
