-- Bucket invoices para almacenar PDFs de facturas
-- Privado (no public read), acceso solo vía signed URL o RLS policy.

insert into storage.buckets (id, name, public)
  values ('invoices', 'invoices', false)
  on conflict (id) do nothing;

-- RLS: el comprador puede leer su factura simplificada
-- (path: invoices/<order_id>/buyer.pdf donde order.buyer_id = auth.uid())
create policy "Buyer can read own invoice"
  on storage.objects for select
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] in (
      select id::text from marketplace_orders where buyer_id = auth.uid()
    )
    and name like '%/buyer.pdf'
  );

-- RLS: el seller puede leer su auto-factura
-- (path: invoices/<order_id>/seller.pdf donde order.seller_id = auth.uid())
create policy "Seller can read own invoice"
  on storage.objects for select
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] in (
      select id::text from marketplace_orders where seller_id = auth.uid()
    )
    and name like '%/seller.pdf'
  );

-- RLS: admin puede leer cualquier factura
create policy "Admin can read all invoices"
  on storage.objects for select
  using (
    bucket_id = 'invoices'
    and exists (
      select 1 from user_roles where user_id = auth.uid() and role = 'admin'
    )
  );

-- RLS: solo service_role puede insertar PDFs (vía Edge Function)
-- No hace falta policy explícita porque Edge Function usa SUPABASE_SERVICE_ROLE_KEY que bypasea RLS.
