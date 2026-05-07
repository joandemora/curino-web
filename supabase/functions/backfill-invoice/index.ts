// supabase/functions/backfill-invoice/index.ts
//
// Edge Function de uso puntual: regenera PDFs + reenvía emails
// para un marketplace_order existente que no los tenga (o los tenga corruptos).
//
// Solo accesible vía service_role key (sin auth de user).
// Body: { order_id: string, force_resend?: boolean }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import {
  generateBuyerInvoicePdf,
  generateSellerInvoicePdf,
  uploadInvoicePdf,
  sendInvoiceEmail,
  buyerEmailHtml,
  sellerEmailHtml
} from '../_shared/invoices.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    // Auth: el header Authorization tiene que ser un JWT válido (anon key)
    // para pasar el gateway de Supabase, que lo valida ANTES de llegar a
    // este código. El secret real de auth viaja en un header custom
    // X-Backfill-Secret que controla quién puede ejecutar el backfill.
    //
    // Razón del header custom: la JWT service_role del Dashboard no siempre
    // coincide con el valor que ven las Edge Functions (Supabase tiene dos
    // sistemas de keys — JWT legacy + sb_secret_xxx — conviviendo). Un
    // BACKFILL_SECRET independiente evita depender de cuál esté activo.
    const customSecret = req.headers.get('X-Backfill-Secret');
    const expectedKey = Deno.env.get('BACKFILL_SECRET');
    if (!expectedKey) {
      return jsonResponse({ error: 'backfill_not_configured' }, 500);
    }
    if (!customSecret || customSecret !== expectedKey) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }

    const { order_id, force_resend } = await req.json().catch(() => ({}));
    if (!order_id || typeof order_id !== 'string') {
      return jsonResponse({ error: 'invalid_order_id' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cargar el order
    const { data: order, error: orderError } = await supabase
      .from('marketplace_orders')
      .select('*')
      .eq('id', order_id)
      .maybeSingle();

    if (orderError || !order) {
      return jsonResponse({ error: 'order_not_found' }, 404);
    }

    // Validar que tiene los invoice numbers asignados
    if (!order.invoice_simplified_number || !order.auto_invoice_number) {
      return jsonResponse({
        error: 'invoice_numbers_missing',
        detail: 'Order must have invoice numbers assigned before backfill'
      }, 400);
    }

    // Determinar si seller es admin
    const { data: sellerRoleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', order.seller_id)
      .maybeSingle();
    const sellerIsAdmin = sellerRoleData?.role === 'admin';

    // Construir orderForInvoice
    const orderForInvoice = {
      id: order.id,
      amount_cents: order.amount_cents,
      base_cents: order.base_cents,
      tax_amount_cents: order.tax_amount_cents,
      tax_rate_pct: order.tax_rate_pct,
      commission_cents: order.commission_cents,
      invoice_simplified_number: order.invoice_simplified_number,
      auto_invoice_number: order.auto_invoice_number,
      invoice_year: order.invoice_year,
      buyer_email_snapshot: order.buyer_email_snapshot || '',
      item_name_snapshot: order.item_name_snapshot || '(sin nombre)',
      item_description_snapshot: order.item_description_snapshot,
      created_at: order.created_at,
      buyer_id: order.buyer_id,
      seller_id: order.seller_id,
      library_item_id: order.library_item_id
    };

    // Cargar datos del seller (igual que en stripe-webhook).
    const ISSUER = {
      name: 'SISTEMA & CURINO SLU',
      taxId: 'ESB24788580',
      address: 'Carrer de Balmes 252, 5-2'
    };

    const { data: sellerAccount } = await supabase
      .from('seller_accounts')
      .select('legal_name, tax_id, address_line1, address_line2, address_city, address_postal_code')
      .eq('user_id', order.seller_id)
      .maybeSingle();

    const sellerAddrParts = [
      sellerAccount?.address_line1,
      sellerAccount?.address_line2,
      sellerAccount?.address_postal_code,
      sellerAccount?.address_city
    ].filter(Boolean);
    const sellerAddr = sellerAddrParts.length > 0 ? sellerAddrParts.join(', ') : null;

    let sellerEmail = '';
    try {
      const { data: sellerAuth } = await (supabase.auth as any).admin.getUserById(order.seller_id);
      sellerEmail = sellerAuth?.user?.email || '';
    } catch (err) {
      console.error('Error fetching seller email:', err);
    }

    const sellerData = {
      email: sellerEmail,
      legal_name: sellerAccount?.legal_name || ISSUER.name,
      tax_id: sellerAccount?.tax_id || ISSUER.taxId,
      address: sellerAddr || ISSUER.address
    };

    // Generar PDF del comprador (siempre).
    const buyerPdf = await generateBuyerInvoicePdf(orderForInvoice);
    await uploadInvoicePdf(supabase, order.id, 'buyer', buyerPdf);

    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';
    const configuradorUrl = `${siteUrl}/configurador-2d/`;

    const result: Record<string, any> = {
      order_id: order.id,
      pdfs_uploaded: sellerIsAdmin ? ['buyer.pdf'] : ['buyer.pdf', 'seller.pdf'],
      emails_sent: []
    };

    // Email comprador
    if (order.buyer_email_snapshot) {
      await sendInvoiceEmail(
        order.buyer_email_snapshot,
        `Tu compra en Curino — ${order.item_name_snapshot}`,
        buyerEmailHtml(orderForInvoice, configuradorUrl),
        buyerPdf,
        `factura-${order.invoice_simplified_number}.pdf`
      );
      result.emails_sent.push({ to: order.buyer_email_snapshot, type: 'buyer' });
    }

    // Auto-factura + email al seller solo si NO es admin (Curino vendiendo
    // directo no genera auto-factura).
    if (!sellerIsAdmin) {
      const sellerPdf = await generateSellerInvoicePdf(orderForInvoice, sellerData);
      await uploadInvoicePdf(supabase, order.id, 'seller', sellerPdf);

      if (sellerEmail) {
        await sendInvoiceEmail(
          sellerEmail,
          `Has vendido una pieza en Curino — ${order.item_name_snapshot}`,
          sellerEmailHtml(orderForInvoice),
          sellerPdf,
          `auto-factura-${order.auto_invoice_number}.pdf`
        );
        result.emails_sent.push({ to: sellerEmail, type: 'seller' });
      } else {
        result.seller_email_skipped = 'no_seller_email';
      }
    } else {
      result.seller_email_skipped = 'seller_is_admin';
    }

    return jsonResponse(result, 200);

  } catch (err: any) {
    console.error('backfill-invoice error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
