// supabase/functions/stripe-webhook/index.ts
//
// Edge Function: recibe webhooks de Stripe y persiste cambios en BD.
//
// Eventos manejados:
//   - account.updated: sincroniza seller_accounts con datos de Stripe
//   - account.application.deauthorized: marca cuenta como disabled
//   - checkout.session.completed: persiste marketplace_orders + purchases
//     con números de factura, tras compra exitosa de pieza marketplace
//   - resto: log y 200 (ignorados pero no fallan)
//
// Seguridad:
//   - Valida firma con stripe.webhooks.constructEventAsync()
//   - El webhook signing secret se configura en Supabase secrets como STRIPE_WEBHOOK_SECRET
//
// IMPORTANTE: esta function NO valida JWT (verify_jwt=false en config.toml)
// porque Stripe no manda JWT, solo la firma del webhook. Hay que añadir esta
// excepción en supabase/config.toml manualmente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import Stripe from 'https://esm.sh/stripe@17.3.0?target=deno'
import {
  generateBuyerInvoicePdf,
  generateSellerInvoicePdf,
  uploadInvoicePdf,
  sendInvoiceEmail,
  buyerEmailHtml,
  sellerEmailHtml,
  OrderData
} from '../_shared/invoices.ts'

Deno.serve(async (req) => {
  // Stripe siempre manda POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;

    if (!stripeSecretKey) {
      console.error('Missing STRIPE_SECRET_KEY');
      return new Response('Server configuration error', { status: 500 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient()
    });

    // 1. Validar firma del webhook
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      console.error('Missing stripe-signature header');
      return new Response('Missing signature', { status: 400 });
    }

    const body = await req.text();
    let event: Stripe.Event | null = null;

    // Stripe distingue webhooks de plataforma (Tu cuenta) de webhooks de Connect
    // (cuentas conectadas Express). Cada uno tiene su propio signing secret.
    // Probamos ambos en orden + un fallback al secret legacy de Fase B.
    const platformSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_PLATFORM');
    const connectSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT');
    const legacySecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    const subtleProvider = Stripe.createSubtleCryptoProvider();

    if (platformSecret) {
      try {
        event = await stripe.webhooks.constructEventAsync(
          body, signature, platformSecret, undefined, subtleProvider
        );
      } catch (_err) { /* siguiente */ }
    }

    if (!event && connectSecret) {
      try {
        event = await stripe.webhooks.constructEventAsync(
          body, signature, connectSecret, undefined, subtleProvider
        );
      } catch (_err) { /* siguiente */ }
    }

    if (!event && legacySecret) {
      try {
        event = await stripe.webhooks.constructEventAsync(
          body, signature, legacySecret, undefined, subtleProvider
        );
      } catch (_err) { /* siguiente */ }
    }

    if (!event) {
      console.error('Stripe webhook: signature did not match any configured secret');
      return new Response('Invalid signature', { status: 401 });
    }

    console.log(`Received event: ${event.type} (id: ${event.id})`);

    // 2. Manejar eventos
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await handleAccountUpdated(supabase, account);
        break;
      }

      case 'account.application.deauthorized': {
        const account = event.data.object as Stripe.Account;
        await handleAccountDeauthorized(supabase, account);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(supabase, stripe, session);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
        // Devolvemos 200 para que Stripe no reintente
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('Unexpected error:', err);
    // Devolvemos 200 igualmente para que Stripe no reintente eternamente
    // ante errores nuestros (a costa de perder el evento, pero log queda).
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

async function handleAccountUpdated(
  supabase: ReturnType<typeof createClient>,
  account: Stripe.Account
) {
  // Determinar onboarding_status según flags de Stripe
  let onboardingStatus: string;
  if (account.requirements?.disabled_reason) {
    onboardingStatus = 'restricted';
  } else if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
    onboardingStatus = 'active';
  } else {
    onboardingStatus = 'pending';
  }

  // Extraer datos legales
  const legalName = account.business_type === 'individual'
    ? `${account.individual?.first_name ?? ''} ${account.individual?.last_name ?? ''}`.trim() || null
    : account.company?.name ?? null;

  const taxId = account.business_type === 'individual'
    ? account.individual?.id_number ?? null
    : account.company?.tax_id ?? null;

  const address = account.business_type === 'individual'
    ? account.individual?.address
    : account.company?.address;

  const updateData: Record<string, unknown> = {
    onboarding_status: onboardingStatus,
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
    details_submitted: account.details_submitted ?? false,
    business_type: account.business_type ?? null,
    country: account.country ?? null,
    legal_name: legalName,
    tax_id: taxId,
  };

  if (address) {
    updateData.address_line1 = address.line1 ?? null;
    updateData.address_line2 = address.line2 ?? null;
    updateData.address_city = address.city ?? null;
    updateData.address_postal_code = address.postal_code ?? null;
    updateData.address_state = address.state ?? null;
  }

  const { error } = await supabase
    .from('seller_accounts')
    .update(updateData)
    .eq('stripe_account_id', account.id);

  if (error) {
    console.error(`Error updating seller_account ${account.id}:`, error);
    throw error;
  }

  console.log(`Updated seller_account ${account.id}: status=${onboardingStatus}, charges=${account.charges_enabled}, payouts=${account.payouts_enabled}`);
}

async function handleAccountDeauthorized(
  supabase: ReturnType<typeof createClient>,
  account: Stripe.Account
) {
  const { error } = await supabase
    .from('seller_accounts')
    .update({
      onboarding_status: 'disabled',
      charges_enabled: false,
      payouts_enabled: false,
    })
    .eq('stripe_account_id', account.id);

  if (error) {
    console.error(`Error deauthorizing seller_account ${account.id}:`, error);
    throw error;
  }

  console.log(`Deauthorized seller_account ${account.id}`);
}

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  session: Stripe.Checkout.Session
) {
  const itemId = session.metadata?.curino_item_id;
  const buyerId = session.metadata?.curino_buyer_id;
  const sellerId = session.metadata?.curino_seller_id;
  const sellerIsAdmin = session.metadata?.curino_seller_is_admin === 'true';
  const commissionPct = parseInt(session.metadata?.curino_commission_pct || '30');

  if (!itemId || !buyerId || !sellerId) {
    console.error('checkout.session.completed missing metadata:', session.id);
    return;
  }

  // Idempotencia: si ya existe un marketplace_order con este session_id, skip
  const { data: existing } = await supabase
    .from('marketplace_orders')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  if (existing) {
    console.log(`Order already exists for session ${session.id}`);
    return;
  }

  const { data: item } = await supabase
    .from('library_items')
    .select('id, name, description, price_cents')
    .eq('id', itemId)
    .maybeSingle();

  if (!item) {
    console.error(`Item ${itemId} not found for session ${session.id}`);
    return;
  }

  const totalCents = session.amount_total ?? item.price_cents;
  const taxRatePct = 21;
  const baseCents = Math.round(totalCents / (1 + taxRatePct / 100));
  const taxCents = totalCents - baseCents;
  const commissionCents = sellerIsAdmin ? totalCents : Math.round(totalCents * commissionPct / 100);

  const buyerCountry = session.customer_details?.address?.country || null;
  const buyerEmail = session.customer_details?.email || session.customer_email || null;
  const currentYear = new Date().getFullYear();

  // Asignar números de factura.
  // La RPC assign_invoice_number usa parámetros nombrados p_type/p_year
  // (no type/year). Valores válidos del tipo: 'simplified' (factura simplificada
  // al comprador) y 'auto_invoice' (auto-factura en nombre del seller). NO 'auto'.
  // Antes del fix: ambas llamadas fallaban silenciosamente y los invoice numbers
  // quedaban NULL en marketplace_orders.
  const { data: simplifiedNum, error: simplifiedError } = await supabase.rpc('assign_invoice_number', {
    p_type: 'simplified',
    p_year: currentYear
  });
  if (simplifiedError) {
    console.error('Error assigning simplified invoice number:', simplifiedError);
  }

  // Auto-factura solo si seller NO es admin. Curino vendiendo directo no
  // necesita auto-factura (no hay tercero al que facturar en su nombre).
  let autoNum: string | null = null;
  if (!sellerIsAdmin) {
    const { data: an, error: autoError } = await supabase.rpc('assign_invoice_number', {
      p_type: 'auto_invoice',
      p_year: currentYear
    });
    if (autoError) {
      console.error('Error assigning auto invoice number:', autoError);
    } else {
      autoNum = an;
    }
  }

  // INSERT marketplace_order
  const { data: orderData, error: orderError } = await supabase
    .from('marketplace_orders')
    .insert({
      stripe_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent,
      buyer_id: buyerId,
      seller_id: sellerId,
      library_item_id: itemId,
      amount_cents: totalCents,
      base_cents: baseCents,
      tax_amount_cents: taxCents,
      tax_rate_pct: taxRatePct,
      tax_country: 'ES',
      commission_cents: commissionCents,
      currency: 'eur',
      status: 'paid',
      buyer_country: buyerCountry,
      buyer_email_snapshot: buyerEmail,
      item_name_snapshot: item.name,
      item_description_snapshot: item.description,
      invoice_simplified_number: simplifiedNum,
      auto_invoice_number: autoNum,
      invoice_year: currentYear
    })
    .select('id')
    .single();

  if (orderError) {
    console.error('Error inserting marketplace_order:', orderError);
    throw orderError;
  }

  // INSERT purchase (idempotente con UNIQUE constraint)
  const { error: purchaseError } = await supabase
    .from('purchases')
    .insert({
      user_id: buyerId,
      library_item_id: itemId,
      order_id: orderData.id
    });

  if (purchaseError && !purchaseError.message.includes('duplicate')) {
    console.error('Error inserting purchase:', purchaseError);
    throw purchaseError;
  }

  console.log(`Order completed: ${orderData.id}, item ${itemId}, buyer ${buyerId}`);

  // === FASE E: Generar PDFs de facturas + enviar emails ===
  // Si falla la generación o envío, NO revertimos el order — solo logueamos.
  // El order ya está persistido y la pieza disponible para el comprador.
  try {
    const orderForInvoice: OrderData = {
      id: orderData.id,
      amount_cents: totalCents,
      base_cents: baseCents,
      tax_amount_cents: taxCents,
      tax_rate_pct: taxRatePct,
      commission_cents: commissionCents,
      invoice_simplified_number: simplifiedNum,
      auto_invoice_number: autoNum,
      invoice_year: currentYear,
      buyer_email_snapshot: buyerEmail || '',
      item_name_snapshot: item.name,
      item_description_snapshot: item.description,
      created_at: new Date().toISOString(),
      buyer_id: buyerId,
      seller_id: sellerId,
      library_item_id: itemId
    };

    // Datos del seller para la auto-factura. Para sellers externos vienen
    // de seller_accounts (populado por handleAccountUpdated tras Stripe
    // onboarding) + email vía auth admin API. Para admin sellers (Curino
    // vendiendo directo) usamos los defaults del ISSUER constant.
    let sellerEmail: string | null = null;
    let sellerLegalName: string | null = null;
    let sellerTaxId: string | null = null;
    let sellerAddress: string | null = null;

    if (!sellerIsAdmin) {
      const { data: sellerAccount } = await supabase
        .from('seller_accounts')
        .select('legal_name, tax_id, address_line1, address_line2, address_city, address_postal_code')
        .eq('user_id', sellerId)
        .maybeSingle();

      if (sellerAccount) {
        sellerLegalName = sellerAccount.legal_name;
        sellerTaxId = sellerAccount.tax_id;
        const addrParts = [
          sellerAccount.address_line1,
          sellerAccount.address_line2,
          sellerAccount.address_postal_code,
          sellerAccount.address_city
        ].filter(Boolean);
        sellerAddress = addrParts.length > 0 ? addrParts.join(', ') : null;
      }

      // Email vía auth admin API (auth.users no es accesible vía .from()).
      try {
        const { data: authUser } = await (supabase.auth as any).admin.getUserById(sellerId);
        sellerEmail = authUser?.user?.email || null;
      } catch (err) {
        console.error('Error fetching seller email:', err);
      }
    }

    // Generar PDF del comprador (siempre).
    const buyerPdf = await generateBuyerInvoicePdf(orderForInvoice);
    await uploadInvoicePdf(supabase, orderData.id, 'buyer', buyerPdf);

    // Email comprador
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';
    const configuradorUrl = `${siteUrl}/configurador-2d/`;
    if (buyerEmail) {
      await sendInvoiceEmail(
        buyerEmail,
        `Tu compra en Curino — ${item.name}`,
        buyerEmailHtml(orderForInvoice, configuradorUrl),
        buyerPdf,
        `factura-${simplifiedNum}.pdf`
      );
    }

    // Auto-factura + email al seller solo si NO es admin (Curino vendiendo directo
    // no genera auto-factura). El auto_invoice_number tampoco se asignó arriba en
    // ese caso, así que aquí ni siquiera tocamos seller.pdf.
    if (!sellerIsAdmin) {
      const sellerPdf = await generateSellerInvoicePdf(orderForInvoice, {
        email: sellerEmail || '',
        legal_name: sellerLegalName,
        tax_id: sellerTaxId,
        address: sellerAddress
      });
      await uploadInvoicePdf(supabase, orderData.id, 'seller', sellerPdf);

      if (sellerEmail) {
        await sendInvoiceEmail(
          sellerEmail,
          `Has vendido una pieza en Curino — ${item.name}`,
          sellerEmailHtml(orderForInvoice),
          sellerPdf,
          `auto-factura-${autoNum}.pdf`
        );
      }
    }

    console.log(`Invoices generated and emails sent for order ${orderData.id}`);
  } catch (invoiceError) {
    console.error(`Invoice generation failed for order ${orderData.id}:`, invoiceError);
  }
}
