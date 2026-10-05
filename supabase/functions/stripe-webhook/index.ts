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
import { sendMetaEvent, adConsentAllowed } from '../_shared/meta-capi.ts'
import { sendSesionConfirmationEmail } from '../_shared/sesion-emails.ts'
import { SESION } from '../_shared/sesion-config.ts'
import { ONE_TO_ONE } from '../_shared/one-to-one-config.ts'
import { sendOneToOneWelcomeEmail, sendOneToOneAvisoEmail } from '../_shared/one-to-one-emails.ts'
import {
  generateBuyerInvoicePdf,
  generateSellerInvoicePdf,
  uploadInvoicePdf,
  sendInvoiceEmail,
  buyerEmailHtml,
  sellerEmailHtml,
  OrderData
} from '../_shared/invoices.ts'
import {
  generateMagazineInvoicePdf,
  uploadMagazineInvoicePdf,
  sendMagazinePurchaseEmail,
  generateMagazineBoostInvoicePdf,
  uploadMagazineBoostInvoicePdf,
  sendMagazineBoostEmail,
  MagazinePurchaseData,
  MagazineBoostInvoiceData
} from '../_shared/magazine-invoices.ts'
import {
  generateArmarioInvoicePdf,
  uploadArmarioInvoicePdf,
  sendArmarioPurchaseEmail,
  ArmarioOrderData
} from '../_shared/armario-invoices.ts'
import {
  generateClaseInvoicePdf,
  uploadClaseInvoicePdf,
  sendClaseConfirmationEmail,
  sendClaseRefundEmail,
  sendClaseRefundConfirmationEmail,
  formatStripeAddress,
  generateClaseRectificativaPdf,
  uploadClaseRectificativaPdf,
  uploadPdfToInvoices,
  resendSend,
  escapeHtml,
  ClaseInvoiceData,
  ClaseInfo
} from '../_shared/clase-invoices.ts'
import {
  generateCursoInvoicePdf,
  uploadCursoInvoicePdf,
  sendCursoConfirmationEmail,
  CursoInvoiceData
} from '../_shared/curso-invoices.ts'

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
        // Routing por metadata.purpose:
        //   'magazine_package' → paquete de créditos de Revista (G2)
        //   'magazine_boost'   → boost/promoción de Revista (G4)
        //   'armario'          → pedido del configurador de armarios (H3)
        //   'clase'            → plaza en clase en directo (INACTIVA en el
        //                        producto publico; se conserva para futuras
        //                        mentorias 1-1)
        //   'curso'            → compra del curso pregrabado (landing /partners)
        //   resto              → marketplace (compatible con Fase D sin purpose)
        const purpose = session.metadata?.purpose;
        if (purpose === 'magazine_package') {
          await handleMagazinePackageCompleted(supabase, session);
        } else if (purpose === 'magazine_boost') {
          await handleMagazineBoostCompleted(supabase, session);
        } else if (purpose === 'armario') {
          await handleArmarioCompleted(supabase, session);
        } else if (purpose === 'clase') {
          await handleClaseCompleted(supabase, stripe, session);
        } else if (purpose === 'sesion') {
          await handleSesionCompleted(supabase, session);
        } else if (purpose === 'one_to_one') {
          await handleOneToOneCompleted(supabase, session);
        } else if (purpose === 'curso') {
          await handleCursoCompleted(supabase, session);
        } else {
          await handleCheckoutCompleted(supabase, stripe, session);
        }
        break;
      }

      // Reembolsos del Intensivo (inscripciones). Otros productos: no-op.
      // OJO: el evento aun no esta suscrito en el endpoint de Stripe.
      case 'charge.refunded': {
        await handleChargeRefunded(supabase, stripe, event.data.object as Stripe.Charge);
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

// ============================================================================
// REVISTA (Fase G2): compra de paquetes de publicaciones.
//
// metadata esperada en la session:
//   purpose = 'magazine_package'
//   user_id = <uuid>
//   package_size = '1' | '2' | '6'
//
// Acciones:
//   1. Idempotencia: skip si magazine_purchases.stripe_session_id ya existe.
//   2. Insert magazine_purchases con invoice_number (RPC assign_invoice_number).
//   3. Insert magazine_credits (FIFO al consumir, expira en 12 meses).
//   4. Generar PDF + subir a 'invoices/magazine/<purchase_id>.pdf'.
//   5. Update magazine_purchases.pdf_url con el path.
//   6. Enviar email Resend al user con factura adjunta.
//
// Errores en pasos 4-6 NO revierten la compra: créditos ya acreditados,
// solo se loguea el fallo de factura/email.
// ============================================================================
async function handleMagazinePackageCompleted(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  const userId = session.metadata?.user_id;
  const packageSize = parseInt(session.metadata?.package_size || '0', 10);

  if (!userId || ![1, 2, 6].includes(packageSize)) {
    console.error('magazine: missing or invalid metadata for session', session.id);
    return;
  }

  // 1. Idempotencia
  const { data: existing } = await supabase
    .from('magazine_purchases')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  if (existing) {
    console.log(`magazine: purchase already exists for session ${session.id}`);
    return;
  }

  const amountPaidCents = session.amount_total ?? 0;
  if (amountPaidCents <= 0) {
    console.error('magazine: invalid amount_total for session', session.id);
    return;
  }

  const buyerEmail = session.customer_details?.email || session.customer_email || '';
  const currentYear = new Date().getFullYear();

  // 2. Asignar número de factura. Usamos 'magazine' (serie propia
  // REVISTA-XXXX-NNNNNN) para diferenciar fiscalmente las facturas de
  // paquetes de revista de las del marketplace.
  const { data: invoiceNum, error: invErr } = await supabase.rpc('assign_invoice_number', {
    p_type: 'magazine',
    p_year: currentYear
  });
  if (invErr) {
    console.error('magazine: error assigning invoice number:', invErr);
  }

  // 3. Insert magazine_purchases
  const { data: purchase, error: purchaseError } = await supabase
    .from('magazine_purchases')
    .insert({
      user_id: userId,
      package_size: packageSize,
      amount_paid_cents: amountPaidCents,
      stripe_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent,
      invoice_number: invoiceNum
    })
    .select('id, created_at')
    .single();

  if (purchaseError || !purchase) {
    console.error('magazine: error inserting purchase:', purchaseError);
    throw purchaseError;
  }

  // 4. Insert magazine_credits (expira en 12 meses)
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 12);

  const { error: creditsError } = await supabase
    .from('magazine_credits')
    .insert({
      user_id: userId,
      purchase_id: purchase.id,
      credits_total: packageSize,
      credits_remaining: packageSize,
      expires_at: expiresAt.toISOString()
    });

  if (creditsError) {
    console.error('magazine: error inserting credits:', creditsError);
    throw creditsError;
  }

  console.log(`magazine: purchase ${purchase.id} + ${packageSize} credits granted to ${userId}`);

  // 5+6. Factura PDF + email (best-effort)
  try {
    const purchaseData: MagazinePurchaseData = {
      id: purchase.id,
      user_id: userId,
      package_size: packageSize,
      amount_paid_cents: amountPaidCents,
      invoice_number: invoiceNum || `MAG-${purchase.id.slice(0, 8)}`,
      buyer_email: buyerEmail,
      created_at: purchase.created_at
    };

    const pdfBytes = await generateMagazineInvoicePdf(purchaseData);
    const pdfPath = await uploadMagazineInvoicePdf(supabase, purchase.id, pdfBytes);

    await supabase
      .from('magazine_purchases')
      .update({ pdf_url: pdfPath })
      .eq('id', purchase.id);

    if (buyerEmail) {
      const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';
      const magazineUrl = `${siteUrl}/mi-cuenta/revista/`;
      await sendMagazinePurchaseEmail(buyerEmail, purchaseData, pdfBytes, magazineUrl);
    }

    console.log(`magazine: invoice + email sent for purchase ${purchase.id}`);
  } catch (invoiceError) {
    console.error(`magazine: invoice/email generation failed for purchase ${purchase.id}:`, invoiceError);
  }
}

// ============================================================================
// REVISTA G4: compra de boost/promoción temporal de 15 días.
//
// metadata esperada en la session:
//   purpose = 'magazine_boost'
//   user_id = <uuid>
//   article_id = <uuid>
//   boost_type = 'section_cover' | 'main_page'
//
// Acciones:
//   1. Idempotencia: skip si magazine_boosts.stripe_session_id ya existe.
//   2. Calcular slots libres en la zona (article.type para section_cover,
//      global para main_page). 3 slots por zona.
//      Si <3 activos → status='active', starts_at=now(), ends_at=now()+15d
//      Si >=3 activos → status='queued' (sin starts_at/ends_at).
//   3. Insert magazine_boosts con invoice_number (RPC assign_invoice_number
//      con tipo 'magazine', misma serie que paquetes G2).
//   4. Generar PDF de factura + subir a invoices/magazine-boost/<id>.pdf.
//   5. Update magazine_boosts.pdf_url con el path.
//   6. Enviar email Resend (active vs queued con texto distinto).
// ============================================================================
const BOOST_SLOTS_PER_ZONE = 3;
const BOOST_PRICES_CENTS: Record<string, number> = { section_cover: 5500, main_page: 12500 };
const ARTICLE_TYPE_TO_SECCION: Record<string, string> = {
  proyecto: 'proyectos', material: 'materiales', articulo: 'articulos',
  noticia: 'noticias', entrevista: 'entrevistas'
};
const ARTICLE_TYPE_LABELS: Record<string, string> = {
  proyecto: 'Proyectos', material: 'Materiales', articulo: 'Artículos',
  noticia: 'Noticias', entrevista: 'Entrevistas'
};

async function handleMagazineBoostCompleted(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  const userId = session.metadata?.user_id;
  const articleId = session.metadata?.article_id;
  const boostType = session.metadata?.boost_type;

  if (!userId || !articleId || !boostType || !BOOST_PRICES_CENTS[boostType]) {
    console.error('boost: missing or invalid metadata for session', session.id);
    return;
  }

  // 1. Idempotencia
  const { data: existing } = await supabase
    .from('magazine_boosts')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();
  if (existing) {
    console.log(`boost: row already exists for session ${session.id}`);
    return;
  }

  const amountPaidCents = session.amount_total ?? BOOST_PRICES_CENTS[boostType];
  const buyerEmail = session.customer_details?.email || session.customer_email || '';
  const currentYear = new Date().getFullYear();

  // 2. Cargar artículo (para article.type necesario en slot counting + email)
  const { data: article } = await supabase
    .from('magazine_articles')
    .select('id, title, type, status, user_id')
    .eq('id', articleId)
    .maybeSingle();
  if (!article) {
    console.error(`boost: article ${articleId} not found for session ${session.id}`);
    return;
  }

  // 3. Contar slots ocupados en la zona
  let activeCount = 0;
  if (boostType === 'section_cover') {
    const { data: activeBoosts } = await supabase
      .from('magazine_boosts')
      .select('id, article_id, magazine_articles!inner(type)')
      .eq('type', 'section_cover')
      .eq('status', 'active')
      .eq('magazine_articles.type', article.type);
    activeCount = (activeBoosts || []).length;
  } else {
    const { count } = await supabase
      .from('magazine_boosts')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'main_page')
      .eq('status', 'active');
    activeCount = count ?? 0;
  }

  const willBeActive = activeCount < BOOST_SLOTS_PER_ZONE;
  const startsAt = willBeActive ? new Date().toISOString() : null;
  const endsAt = willBeActive
    ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const status = willBeActive ? 'active' : 'queued';

  // 4. Asignar invoice number (serie 'magazine' compartida con paquetes G2)
  const { data: invoiceNum, error: invErr } = await supabase.rpc('assign_invoice_number', {
    p_type: 'magazine',
    p_year: currentYear
  });
  if (invErr) {
    console.error('boost: error assigning invoice number:', invErr);
  }

  // 5. Insert magazine_boosts
  const { data: boost, error: boostError } = await supabase
    .from('magazine_boosts')
    .insert({
      article_id: articleId,
      user_id: userId,
      type: boostType,
      amount_paid_cents: amountPaidCents,
      stripe_session_id: session.id,
      starts_at: startsAt,
      ends_at: endsAt,
      status,
      invoice_number: invoiceNum
    })
    .select('id, created_at')
    .single();

  if (boostError || !boost) {
    console.error('boost: error inserting magazine_boosts:', boostError);
    throw boostError;
  }

  console.log(`boost: ${boost.id} created (status=${status}) for article ${articleId}`);

  // 6. Factura PDF + email (best-effort)
  try {
    const invoiceData: MagazineBoostInvoiceData = {
      boost_id: boost.id,
      article_title: article.title,
      boost_type: boostType as 'section_cover' | 'main_page',
      amount_paid_cents: amountPaidCents,
      invoice_number: invoiceNum || `BOOST-${boost.id.slice(0, 8)}`,
      buyer_email: buyerEmail,
      created_at: boost.created_at
    };

    const pdfBytes = await generateMagazineBoostInvoicePdf(invoiceData);
    const pdfPath = await uploadMagazineBoostInvoicePdf(supabase, boost.id, pdfBytes);
    await supabase.from('magazine_boosts').update({ pdf_url: pdfPath }).eq('id', boost.id);

    if (buyerEmail) {
      const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';
      const magazineUrl = `${siteUrl}/mi-cuenta/revista/`;
      const zoneLabel = boostType === 'main_page'
        ? 'la página principal de Revista'
        : `la portada de ${ARTICLE_TYPE_LABELS[article.type] || article.type}`;
      await sendMagazineBoostEmail(buyerEmail, invoiceData, status as 'active' | 'queued', endsAt, zoneLabel, pdfBytes, magazineUrl);
    }

    console.log(`boost: invoice + email sent for ${boost.id}`);
  } catch (invoiceError) {
    console.error(`boost: invoice/email failed for ${boost.id}:`, invoiceError);
  }
}

// ============================================================================
// ARMARIOS (Fase H3): pedido del configurador armarios-vestidores.
//
// metadata esperada en la session:
//   purpose = 'armario'
//   ancho, alto, fondo, material, interior, puertas (detalle del armario)
//   precio_eur (precio bruto enviado por frontend, referencia)
//   user_id (uuid o '' si invitado)
//   shipping_name, shipping_line, shipping_city, shipping_postal,
//   shipping_province, shipping_country, shipping_phone, shipping_nif
//   billing_name, billing_line, billing_city, billing_postal, billing_nif
//
// Acciones:
//   1. Idempotencia: skip si armario_orders.stripe_session_id ya existe.
//   2. Calcular base/IVA al 21% sobre session.amount_total.
//   3. Asignar invoice_number (serie AR-, RPC assign_invoice_number).
//   4. Insert armario_orders.
//
// NO se genera PDF ni email en esta fase (eso es H4/H5). Errores en el
// INSERT solo se loguean (NO se lanza excepción para evitar reintentos
// infinitos del webhook por nuestro lado; Stripe ya cobró, perder la
// fila pero mantener Stripe Dashboard como fuente de verdad es preferible
// a un retry storm).
// ============================================================================
async function handleArmarioCompleted(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  // 1. Idempotencia
  const { data: existing } = await supabase
    .from('armario_orders')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  if (existing) {
    console.log(`armario: order already exists for session ${session.id}`);
    return;
  }

  // 2. Importes (céntimos) y desglose base/IVA al 21%.
  //
  // Aceptamos amount_total = 0 (cupón 100%): Stripe completa la session
  // sin cobro y dispara checkout.session.completed con amount_total=0 y
  // payment_status='no_payment_required'. Es un pedido legítimo y debe
  // registrarse con su factura a 0€.
  //
  // Rechazamos:
  //   - null/undefined: dato faltante → evento espurio.
  //   - < 0: imposible en una session válida.
  //   - payment_status fuera de {paid, no_payment_required}: sesión no
  //     completada (unpaid, etc.).
  if (session.amount_total == null) {
    console.error('armario: missing amount_total for session', session.id);
    return;
  }
  const amountTotalCents = session.amount_total;
  if (amountTotalCents < 0) {
    console.error('armario: negative amount_total for session', session.id, amountTotalCents);
    return;
  }
  const paymentStatus = session.payment_status;
  if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
    console.error('armario: payment_status not settled for session', session.id, paymentStatus);
    return;
  }
  const amountDiscountCents = session.total_details?.amount_discount ?? 0;
  const taxRatePct = 21;
  // Con amountTotalCents=0 ambos dan 0 (compra 100% descontada).
  const baseCents = Math.round(amountTotalCents / (1 + taxRatePct / 100));
  const taxAmountCents = amountTotalCents - baseCents;

  // 3. Metadata: configuración del armario + dirección
  const meta = session.metadata ?? {};
  const rawUserId = meta.user_id ?? '';
  const userId = rawUserId.length > 0 ? rawUserId : null;
  const precioBrutoEur = parseFloat(meta.precio_eur ?? '') || null;
  const buyerEmail = session.customer_details?.email || session.customer_email || null;
  const currentYear = new Date().getFullYear();

  // safeParseJson: si meta.modules_json viene truncado (límite 500 chars
  // de Stripe metadata) o malformado, devolvemos [] en vez de romper el
  // handler. La compra ya está cobrada; perder el desglose por módulo es
  // aceptable a cambio de no fallar el INSERT.
  function safeParseJson(s: string): unknown {
    if (!s) return [];
    try { return JSON.parse(s); } catch { return []; }
  }

  // Fase H10: si la session tiene client_reference_id, leer el carrito
  // completo persistido en armario_checkout_drafts. Si lo hay, los datos
  // del primer armario van por metadata (fallback H8) Y además el array
  // de N armarios va en configuracion.items.
  // Si no hay draft (cliente legacy, error al insertar, draft borrado por
  // cron) → configuracion sin .items, solo con el detalle del primer
  // armario por metadata. Compatible con el admin/factura sin items.
  const draftId = session.client_reference_id || null;
  let draftItems: unknown[] | null = null;
  if (draftId) {
    const { data: draft, error: draftErr } = await supabase
      .from('armario_checkout_drafts')
      .select('items')
      .eq('id', draftId)
      .maybeSingle();
    if (draftErr) {
      console.error('armario: error reading draft', draftId, draftErr);
    } else if (draft && Array.isArray(draft.items) && draft.items.length > 0) {
      draftItems = draft.items as unknown[];
    } else {
      console.warn('armario: draft not found or empty for', draftId);
    }
  }

  const configuracion: Record<string, unknown> = {
    ancho: meta.ancho ?? '',
    alto: meta.alto ?? '',
    fondo: meta.fondo ?? '',
    material: meta.material ?? '',
    interior: meta.interior ?? '',
    puertas: meta.puertas ?? '',
    // Detalle de puertas (Fase H8) — capturado del configurador vía /checkout/.
    // Vacíos en pedidos previos a H8; el admin tiene fallback al string `puertas`.
    door_tipo: meta.door_tipo ?? '',
    door_color: meta.door_color ?? '',
    door_marco: meta.door_marco ?? '',
    door_textil: meta.door_textil ?? '',
    door_travesano: meta.door_travesano ?? '',
    modules: safeParseJson(meta.modules_json ?? '')
  };
  if (draftItems) {
    configuracion.items = draftItems;
  }

  // 4. Número de factura (serie AR-YYYY-NNNNNN)
  const { data: invoiceNumber, error: invErr } = await supabase.rpc('assign_invoice_number', {
    p_type: 'armario',
    p_year: currentYear
  });
  if (invErr) {
    console.error('armario: error assigning invoice number:', invErr);
  }

  // 5. INSERT armario_orders
  const { data: order, error: orderError } = await supabase
    .from('armario_orders')
    .insert({
      user_id: userId,
      stripe_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent,
      amount_total_cents: amountTotalCents,
      amount_discount_cents: amountDiscountCents,
      precio_bruto_eur: precioBrutoEur,
      base_cents: baseCents,
      tax_amount_cents: taxAmountCents,
      tax_rate_pct: taxRatePct,
      currency: 'eur',
      status: 'paid',
      configuracion,
      shipping_name: meta.shipping_name || null,
      shipping_line: meta.shipping_line || null,
      shipping_city: meta.shipping_city || null,
      shipping_postal: meta.shipping_postal || null,
      shipping_province: meta.shipping_province || null,
      shipping_country: meta.shipping_country || null,
      shipping_phone: meta.shipping_phone || null,
      shipping_nif: meta.shipping_nif || null,
      billing_name: meta.billing_name || null,
      billing_line: meta.billing_line || null,
      billing_city: meta.billing_city || null,
      billing_postal: meta.billing_postal || null,
      billing_nif: meta.billing_nif || null,
      buyer_email_snapshot: buyerEmail,
      invoice_number: invoiceNumber,
      invoice_year: currentYear,
      paid_at: new Date().toISOString()
    })
    .select('id')
    .single();

  if (orderError || !order) {
    console.error('armario: error inserting order for session', session.id, orderError);
    return;
  }

  console.log(`armario: order ${order.id} created for session ${session.id} (invoice ${invoiceNumber})`);

  // Borrar el draft tras INSERT exitoso (best-effort). Si falla, el cron
  // de limpieza (o borrado manual desde Studio) lo recogerá. NO bloquea
  // el resto del handler (PDF/email).
  if (draftId) {
    const { error: delErr } = await supabase
      .from('armario_checkout_drafts')
      .delete()
      .eq('id', draftId);
    if (delErr) {
      console.error('armario: failed to delete draft', draftId, delErr);
    }
  }

  // 6. Factura PDF (best-effort, NO bloquea la compra si falla).
  // Estructura idéntica al patrón de magazine: try/catch externo, errores
  // solo se loguean. El pedido ya está en BD; si el PDF falla, Stripe
  // tampoco reintenta porque el webhook seguirá devolviendo 200.
  try {
    const orderData: ArmarioOrderData = {
      id: order.id,
      invoice_number: invoiceNumber || `AR-FALLBACK-${order.id.slice(0, 8)}`,
      paid_at: new Date().toISOString(),
      amount_total_cents: amountTotalCents,
      amount_discount_cents: amountDiscountCents,
      base_cents: baseCents,
      tax_amount_cents: taxAmountCents,
      tax_rate_pct: taxRatePct,
      configuracion,
      shipping_name: meta.shipping_name ?? '',
      shipping_line: meta.shipping_line ?? '',
      shipping_city: meta.shipping_city ?? '',
      shipping_postal: meta.shipping_postal ?? '',
      shipping_nif: meta.shipping_nif ?? '',
      billing_name: meta.billing_name ?? '',
      billing_line: meta.billing_line ?? '',
      billing_city: meta.billing_city ?? '',
      billing_postal: meta.billing_postal ?? '',
      billing_nif: meta.billing_nif ?? '',
      buyer_email: buyerEmail ?? ''
    };

    const pdfBytes = await generateArmarioInvoicePdf(orderData);
    const pdfPath = await uploadArmarioInvoicePdf(supabase, order.id, pdfBytes);

    await supabase
      .from('armario_orders')
      .update({ pdf_url: pdfPath })
      .eq('id', order.id);

    console.log(`armario: invoice PDF generated and uploaded for order ${order.id} → ${pdfPath}`);

    // Email de confirmación al cliente con la factura adjunta.
    // Best-effort dentro del mismo try/catch: si Resend falla solo
    // se loguea (ya hay try interno en sendArmarioPurchaseEmail).
    // Reutilizamos pdfBytes ya generado, no regeneramos.
    await sendArmarioPurchaseEmail(orderData, pdfBytes);
  } catch (invoiceError) {
    console.error(`armario: invoice PDF/email failed for order ${order.id}:`, invoiceError);
  }
}

// ============================================================================
// CLASES: venta de plaza en clase en directo (fosil, sin landing publica
// tras el pivot a /partners; se conserva para futuras mentorias 1-1).
//
// metadata esperada en la session:
//   purpose = 'clase'
//   clase_id = <uuid>
//   nombre = <string>
//   telefono = <string opcional>
//   desistimiento_renunciado = 'true'
//   event_id = <uuid — compartido con dataLayer para dedup GA4/futuro>
//   utm_source, utm_medium, utm_campaign = <opcionales>
//
// Acciones:
//   1. Idempotencia: skip si inscripciones.stripe_session_id ya existe.
//   2. Incremento atómico de plaza via RPC incrementar_plaza_clase.
//      - Si null → clase agotada entre checkout y webhook. Refund
//        automático via stripe.refunds.create y email al comprador.
//   3. Asigna invoice_number (CLASE-YYYY-NNNNNN).
//   4. Inserta fila en inscripciones (estado='pagada').
//   5. Best-effort: PDF factura + upload al bucket + email con Meet
//      + factura adjunta. Fallos aquí solo se loguean (no revierten
//      la compra ni el incremento).
// ============================================================================
async function handleClaseCompleted(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  session: Stripe.Checkout.Session
) {
  const claseId = session.metadata?.clase_id;
  // Sin formulario (/partners/formaciones sin token): nombre de Stripe.
  const nombre = session.metadata?.nombre || session.customer_details?.name || '';
  // Contacto: manda lo que el comprador confirma en Checkout (email y
  // telefono obligatorios alli). Lo del formulario queda como referencia.
  const telefonoFormulario = session.metadata?.telefono || null;
  const telefono = session.customer_details?.phone || telefonoFormulario;
  const emailFormulario = (session.metadata?.email_formulario || '').toLowerCase() || null;
  // Renuncia al desistimiento: casilla obligatoria de condiciones en
  // Checkout (consent_collection). Se guarda la marca y la fecha/hora.
  const terminosAceptados = session.consent?.terms_of_service === 'accepted';
  const desistimientoRenunciado = terminosAceptados || session.metadata?.desistimiento_renunciado === 'true';
  const eventId = session.metadata?.event_id || null;
  const utmSource = session.metadata?.utm_source || null;
  const utmMedium = session.metadata?.utm_medium || null;
  const utmCampaign = session.metadata?.utm_campaign || null;

  const buyerEmail = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  const amountPaidCents = session.amount_total ?? 0;

  if (!claseId || !nombre || !buyerEmail) {
    console.error('clase: missing metadata for session', session.id);
    return;
  }
  if (amountPaidCents <= 0) {
    console.error('clase: invalid amount_total for session', session.id);
    return;
  }

  // 1. Idempotencia — si ya existe la inscripción para este session_id,
  // salimos sin hacer nada (evita refund en retries de webhooks).
  const { data: existing } = await supabase
    .from('inscripciones')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  if (existing) {
    console.log(`clase: inscripcion already exists for session ${session.id}`);
    return;
  }

  // 2. Incremento atómico de plaza. Si la clase se llenó entre el
  // checkout y este webhook, la RPC devuelve NULL → refund automático.
  const { data: claseAfter, error: incError } = await supabase
    .rpc('incrementar_plaza_clase', { p_clase_id: claseId });

  if (incError) {
    console.error(`clase: incrementar_plaza_clase failed for ${claseId}`, incError);
    return;
  }

  if (!claseAfter) {
    // Se agotó entre checkout y webhook → refund automático + email.
    console.warn(`clase: sold out mid-checkout for session ${session.id}, refunding`);
    try {
      const paymentIntent = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
      if (paymentIntent) {
        await stripe.refunds.create({ payment_intent: paymentIntent });
      }
      await sendClaseRefundEmail(buyerEmail, nombre);
    } catch (refundErr) {
      console.error(`clase: refund/email failed for session ${session.id}`, refundErr);
    }
    return;
  }

  // 3. Numero de factura CLASE-YYYY-NNNNNN
  const currentYear = new Date().getFullYear();
  const { data: invoiceNum, error: invErr } = await supabase.rpc('assign_invoice_number', {
    p_type: 'clase',
    p_year: currentYear
  });
  if (invErr) {
    console.error('clase: error assigning invoice number:', invErr);
  }

  // 4. Insertar inscripcion
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);

  // Datos de facturacion recogidos por Checkout (billing_address_collection
  // + tax_id_collection). Con NIF/CIF → factura completa.
  const cd = session.customer_details;
  const taxId = (cd?.tax_ids || []).find((t: Stripe.Checkout.Session.CustomerDetails.TaxId) => t && t.value)?.value || null;
  const nombreFiscal = (cd?.name || '').trim() || null;
  const direccionLineas = formatStripeAddress(cd?.address);

  const { data: inscripcion, error: insError } = await supabase
    .from('inscripciones')
    .insert({
      clase_id: claseId,
      factura_tipo: taxId ? 'completa' : 'simplificada',
      cliente_nombre_fiscal: nombreFiscal,
      cliente_nif: taxId,
      cliente_direccion: direccionLineas.length ? direccionLineas.join(' · ') : null,
      nombre,
      email: buyerEmail,
      telefono,
      telefono_formulario: telefonoFormulario && telefonoFormulario !== telefono ? telefonoFormulario : null,
      email_formulario: emailFormulario,
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntentId,
      importe_cents: amountPaidCents,
      desistimiento_renunciado: desistimientoRenunciado,
      terminos_aceptados: terminosAceptados,
      terminos_aceptados_at: terminosAceptados ? new Date().toISOString() : null,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      estado: 'pagada',
      invoice_number: invoiceNum,
      event_id: eventId
    })
    .select('id, created_at')
    .single();

  if (insError || !inscripcion) {
    console.error(`clase: insert inscripcion failed for session ${session.id}`, insError);
    // No refund aquí: la plaza YA se incrementó y el pago está hecho.
    // Un error del INSERT (constraint, disponibilidad DB) requiere
    // intervención humana; el refund automático solo aplica al caso
    // legítimo de "agotada mid-checkout".
    return;
  }

  console.log(`clase: inscripcion ${inscripcion.id} confirmed for ${buyerEmail}`);

  // 4b. Best-effort: enlazar la solicitud de /partners/ con la compra
  // (seguimiento comercial) y Purchase por CAPI deduplicado con el
  // event_id del dataLayer de /partners/gracias/.
  await linkPartnersSolicitud(supabase, session, String(inscripcion.id), buyerEmail);
  await sendClasePurchaseCapi(session, buyerEmail, nombre, telefono, amountPaidCents, eventId);

  // 5. Best-effort: PDF factura + email con Meet + factura adjunta.
  try {
    const claseInfo: ClaseInfo = {
      id: claseAfter.id,
      fecha: claseAfter.fecha,
      duracion_min: claseAfter.duracion_min,
      meet_url: claseAfter.meet_url,
      fecha_confirmada: (claseAfter as { fecha_confirmada?: boolean }).fecha_confirmada !== false
    };

    const invoiceData: ClaseInvoiceData = {
      id: inscripcion.id,
      clase_id: claseAfter.id,
      clase_fecha: claseAfter.fecha,
      clase_fecha_confirmada: (claseAfter as { fecha_confirmada?: boolean }).fecha_confirmada !== false,
      nombre,
      email: buyerEmail,
      amount_paid_cents: amountPaidCents,
      invoice_number: invoiceNum || `CLASE-${inscripcion.id.slice(0, 8)}`,
      created_at: String(inscripcion.created_at),
      buyer_nombre_fiscal: nombreFiscal,
      buyer_nif: taxId,
      buyer_direccion: direccionLineas
    };

    const pdfBytes = await generateClaseInvoicePdf(invoiceData);
    const pdfPath = await uploadClaseInvoicePdf(supabase, inscripcion.id, pdfBytes);

    await supabase
      .from('inscripciones')
      .update({ pdf_url: pdfPath })
      .eq('id', inscripcion.id);

    await sendClaseConfirmationEmail(
      buyerEmail, nombre, claseInfo, pdfBytes, invoiceData.invoice_number
    );

    await supabase
      .from('inscripciones')
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq('id', inscripcion.id);

    console.log(`clase: invoice + confirmation sent for inscripcion ${inscripcion.id}`);
  } catch (invoiceError) {
    console.error(`clase: invoice/email failed for inscripcion ${inscripcion.id}`, invoiceError);
  }
}

// ============================================================================
// CHARGE.REFUNDED — reembolsos del Intensivo (tabla inscripciones).
//
// - Factura rectificativa (serie R-CLASE) por cada reembolso de Stripe del
//   cargo, por su importe (total o parcial). Idempotente por
//   stripe_refund_id (UNIQUE en facturas_rectificativas_clase): un evento
//   repetido no crea otro documento ni consume otro numero.
// - Total (charge.refunded = true): RPC liberar_plaza_clase pasa la
//   inscripcion de 'pagada' a 'reembolsada', resta 1 plaza (min. 0) y
//   reabre la edicion si estaba agotada y no ha empezado. Idempotente por
//   la guarda estado='pagada'. Email de confirmacion con la rectificativa.
// - Parcial: registra importe_reembolsado_cents + rectificativa; no libera
//   plaza ni envia email.
// - Cargos sin inscripcion (otros productos, reembolso automatico por
//   "agotada mid-checkout"): no-op.
// ============================================================================
type Rectificativa = { invoice_number: string; pdfBytes: Uint8Array };

async function emitirRectificativaClase(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  ins: any,
  refund: Stripe.Refund,
  chargeId: string
): Promise<Rectificativa | null> {
  if (!ins.invoice_number) {
    console.error(`rectificativa: inscripcion ${ins.id} sin factura original; no se emite`);
    return null;
  }
  const direccion = ins.cliente_direccion ? String(ins.cliente_direccion).split(' · ') : [];

  // 1. Reclamar el refund (UNIQUE). Si ya existe y esta completa → nada.
  const { data: claimed, error: claimErr } = await supabase
    .from('facturas_rectificativas_clase')
    .upsert({
      stripe_refund_id: refund.id,
      stripe_charge_id: chargeId,
      inscripcion_id: ins.id,
      importe_cents: refund.amount,
      factura_original: ins.invoice_number,
      factura_original_fecha: ins.created_at,
      comprador_nombre: ins.cliente_nombre_fiscal || ins.nombre,
      comprador_email: ins.email,
      comprador_nif: ins.cliente_nif,
      comprador_direccion: ins.cliente_direccion
    }, { onConflict: 'stripe_refund_id', ignoreDuplicates: true })
    .select('id');
  if (claimErr) {
    console.error('rectificativa: error reclamando refund', refund.id, claimErr);
    return null;
  }
  const { data: row } = await supabase
    .from('facturas_rectificativas_clase')
    .select('*')
    .eq('stripe_refund_id', refund.id)
    .single();
  if (!row) return null;
  if (!(claimed && claimed.length) && row.invoice_number && row.pdf_url) {
    console.log(`rectificativa: ${row.invoice_number} ya emitida para refund ${refund.id}`);
    return null;
  }

  // 2. Numero (solo si aun no tiene; reintento tras fallo parcial).
  let number = row.invoice_number as string | null;
  if (!number) {
    const { data: n, error: nErr } = await supabase.rpc('assign_invoice_number', {
      p_type: 'clase_rect',
      p_year: new Date().getFullYear()
    });
    if (nErr || !n) {
      console.error('rectificativa: error asignando numero', refund.id, nErr);
      return null;
    }
    const { data: upd } = await supabase
      .from('facturas_rectificativas_clase')
      .update({ invoice_number: n })
      .eq('id', row.id)
      .is('invoice_number', null)
      .select('invoice_number');
    number = (upd && upd[0]?.invoice_number) || null;
    if (!number) {
      // Otra ejecucion concurrente gano: usar su numero.
      const { data: again } = await supabase
        .from('facturas_rectificativas_clase').select('invoice_number').eq('id', row.id).single();
      number = again?.invoice_number || null;
      if (!number) return null;
    }
  }

  // 3. PDF + storage
  const pdfBytes = await generateClaseRectificativaPdf({
    invoice_number: number,
    fecha: row.created_at,
    factura_original: row.factura_original,
    factura_original_fecha: row.factura_original_fecha,
    motivo: row.motivo,
    importe_cents: row.importe_cents,
    comprador_nombre: row.comprador_nombre,
    comprador_email: row.comprador_email,
    comprador_nif: row.comprador_nif,
    comprador_direccion: direccion
  });
  const path = await uploadClaseRectificativaPdf(supabase, String(ins.id), refund.id, pdfBytes);
  await supabase.from('facturas_rectificativas_clase').update({ pdf_url: path }).eq('id', row.id);
  console.log(`rectificativa: ${number} emitida (${row.importe_cents} cents) para inscripcion ${ins.id}`);
  return { invoice_number: number, pdfBytes };
}

async function handleChargeRefunded(
  // deno-lint-ignore no-explicit-any
  supabase: any,   // cliente sin tipos generados (igual que el resto del webhook)
  stripe: Stripe,
  charge: Stripe.Charge
) {
  const paymentIntent = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!paymentIntent) return;

  const { data: ins, error } = await supabase
    .from('inscripciones')
    .select('id, nombre, email, estado, importe_cents, importe_reembolsado_cents, refund_email_sent_at, invoice_number, created_at, cliente_nombre_fiscal, cliente_nif, cliente_direccion')
    .eq('stripe_payment_intent', paymentIntent)
    .maybeSingle();
  if (error) {
    console.error('refund: error buscando inscripcion', paymentIntent, error);
    return;
  }
  if (!ins) {
    // ¿Es una Sesion 1:1 o un One-to-one?
    await handleSesionRefunded(supabase, stripe, charge, paymentIntent);
    await handleOneToOneRefunded(supabase, stripe, charge, paymentIntent);
    return;
  }

  const refunded = charge.amount_refunded ?? 0;
  const isFull = charge.refunded === true || refunded >= (charge.amount ?? Infinity);

  // Rectificativas: una por refund de Stripe (el objeto Charge del evento no
  // trae la lista de refunds en las versiones actuales de la API).
  const nuevas: Rectificativa[] = [];
  try {
    const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
    for (const rf of refunds.data) {
      if (rf.status === 'failed' || rf.status === 'canceled') continue;
      try {
        const r = await emitirRectificativaClase(supabase, ins, rf, charge.id);
        if (r) nuevas.push(r);
      } catch (rErr) {
        console.error('rectificativa: fallo emitiendo', rf.id, rErr);
      }
    }
  } catch (listErr) {
    console.error('refund: error listando refunds del cargo', charge.id, listErr);
  }

  if (!isFull) {
    if (refunded > (ins.importe_reembolsado_cents ?? 0)) {
      const { error: upErr } = await supabase
        .from('inscripciones')
        .update({ importe_reembolsado_cents: refunded })
        .eq('id', ins.id);
      if (upErr) console.error('refund: error registrando parcial', ins.id, upErr);
    }
    console.log(`refund: parcial ${refunded} en inscripcion ${ins.id} (plaza no liberada)`);
    return;
  }

  const { data: liberada, error: rpcErr } = await supabase
    .rpc('liberar_plaza_clase', { p_inscripcion_id: ins.id, p_importe_reembolsado_cents: refunded });
  if (rpcErr) {
    console.error('refund: liberar_plaza_clase fallo', ins.id, rpcErr);
    return;
  }
  if (!liberada) {
    console.log(`refund: inscripcion ${ins.id} ya estaba reembolsada (evento repetido)`);
    return;
  }

  console.log(`refund: inscripcion ${ins.id} reembolsada, plaza liberada`);
  {
    const { data: sol } = await supabase.from('partners_solicitudes').select('id').eq('inscripcion_id', ins.id).maybeSingle();
    if (sol) await crmMarcarReembolso(supabase, sol.id);
  }
  try {
    await sendClaseRefundConfirmationEmail(String(ins.email), String(ins.nombre), refunded, nuevas);
    await supabase
      .from('inscripciones')
      .update({ refund_email_sent_at: new Date().toISOString() })
      .eq('id', ins.id);
  } catch (mailErr) {
    console.error('refund: email de confirmacion fallo', ins.id, mailErr);
  }
}

// ============================================================================
// SESION 1:1 (purpose = 'sesion', /partners/formaciones)
//
// Idempotencia por sesiones_1a1.stripe_session_id (UNIQUE + SELECT previo).
// Factura SESION-AAAA-NNNNNN (completa con NIF o simplificada), PDF en
// invoices/sesiones/<id>.pdf, email con recursos adjuntos + enlace de
// reserva (SESION_RESERVA_URL). Marca sesion_comprada_at en la solicitud
// (cancela el email de la oferta de sesion de la secuencia).
// ============================================================================
async function handleSesionCompleted(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  session: Stripe.Checkout.Session
) {
  const md = session.metadata || {};
  const cd = session.customer_details;
  const buyerEmail = (cd?.email || session.customer_email || '').toLowerCase();
  const nombre = md.nombre || cd?.name || '';
  const telefonoFormulario = md.telefono || null;
  const telefono = cd?.phone || telefonoFormulario;
  const amount = session.amount_total ?? 0;
  if (!buyerEmail || amount <= 0) {
    console.error('sesion: datos insuficientes', session.id);
    return;
  }

  const { data: existing } = await supabase
    .from('sesiones_1a1').select('id').eq('stripe_session_id', session.id).maybeSingle();
  if (existing) {
    console.log(`sesion: ${session.id} ya registrada`);
    return;
  }

  const terminos = session.consent?.terms_of_service === 'accepted';
  const taxId = (cd?.tax_ids || []).find((t: Stripe.Checkout.Session.CustomerDetails.TaxId) => t && t.value)?.value || null;
  const direccion = formatStripeAddress(cd?.address);
  const { data: invoiceNum, error: invErr } = await supabase.rpc('assign_invoice_number', {
    p_type: 'sesion', p_year: new Date().getFullYear()
  });
  if (invErr) console.error('sesion: error asignando factura', invErr);
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
  const solicitudId = /^[0-9a-f-]{36}$/i.test(md.solicitud_id || '') ? md.solicitud_id : null;

  const { data: ses, error: insErr } = await supabase
    .from('sesiones_1a1')
    .insert({
      solicitud_id: solicitudId,
      nombre: nombre || buyerEmail,
      email: buyerEmail,
      telefono,
      email_formulario: (md.email_formulario || '').toLowerCase() || null,
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntentId,
      importe_cents: amount,
      precio_tipo: md.precio_tipo === 'oferta' ? 'oferta' : 'normal',
      terminos_aceptados: terminos,
      terminos_aceptados_at: terminos ? new Date().toISOString() : null,
      factura_tipo: taxId ? 'completa' : 'simplificada',
      cliente_nombre_fiscal: (cd?.name || '').trim() || null,
      cliente_nif: taxId,
      cliente_direccion: direccion.length ? direccion.join(' · ') : null,
      invoice_number: invoiceNum,
      event_id: md.event_id || null,
      utm_source: md.utm_source || null,
      utm_medium: md.utm_medium || null,
      utm_campaign: md.utm_campaign || null
    })
    .select('id, created_at').single();
  if (insErr || !ses) {
    console.error('sesion: insert fallo', session.id, insErr);
    return;
  }
  console.log(`sesion: ${ses.id} confirmada (${amount} cents, ${md.precio_tipo})`);

  // Solicitud: sesion comprada (por id o, si no hay, por email)
  try {
    const q = supabase.from('partners_solicitudes').update({ sesion_comprada_at: new Date().toISOString(), crm_estado: 'compro', crm_actualizado_at: new Date().toISOString() });
    if (solicitudId) await q.eq('id', solicitudId); else await q.eq('email', buyerEmail);
  } catch (e) { console.error('sesion: link solicitud fallo', e); }

  await sendClasePurchaseCapi(session, buyerEmail, nombre, telefono, amount, md.event_id || null, 'sesion-1a1', '/partners/formaciones/gracias/');

  try {
    const numero = invoiceNum || `SESION-${String(ses.id).slice(0, 8)}`;
    const pdf = await generateClaseInvoicePdf({
      id: String(ses.id), clase_id: '', clase_fecha: String(ses.created_at),
      nombre: nombre || buyerEmail, email: buyerEmail, amount_paid_cents: amount,
      invoice_number: numero, created_at: String(ses.created_at),
      buyer_nombre_fiscal: (cd?.name || '').trim() || null, buyer_nif: taxId, buyer_direccion: direccion,
      concepto: `${SESION.nombre} (videollamada + recursos iniciales)`
    });
    const path = await uploadPdfToInvoices(supabase, `sesiones/${ses.id}.pdf`, pdf);
    await supabase.from('sesiones_1a1').update({ pdf_url: path }).eq('id', ses.id);
    await sendSesionConfirmationEmail(supabase, buyerEmail, nombre || 'hola', pdf, numero);
    await supabase.from('sesiones_1a1').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', ses.id);
  } catch (e) {
    console.error('sesion: factura/email fallo', ses.id, e);
  }
}

// Reembolso de una Sesion 1:1: rectificativa R-SESION por refund (idempotente
// por stripe_refund_id) y, si es total, estado 'reembolsada' + email.
async function handleSesionRefunded(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  stripe: Stripe,
  charge: Stripe.Charge,
  paymentIntent: string
) {
  const { data: ses } = await supabase
    .from('sesiones_1a1').select('*').eq('stripe_payment_intent', paymentIntent).maybeSingle();
  if (!ses) return; // no es una sesion
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 }).catch(() => null);
  for (const rf of refunds?.data || []) {
    if (rf.status === 'failed' || rf.status === 'canceled') continue;
    try {
      const { data: claimed } = await supabase.from('facturas_rectificativas_clase').upsert({
        stripe_refund_id: rf.id, stripe_charge_id: charge.id, sesion_id: ses.id, serie: 'sesion',
        importe_cents: rf.amount, factura_original: ses.invoice_number || `SESION-${String(ses.id).slice(0, 8)}`,
        factura_original_fecha: ses.created_at, comprador_nombre: ses.cliente_nombre_fiscal || ses.nombre,
        comprador_email: ses.email, comprador_nif: ses.cliente_nif, comprador_direccion: ses.cliente_direccion
      }, { onConflict: 'stripe_refund_id', ignoreDuplicates: true }).select('id');
      const { data: row } = await supabase.from('facturas_rectificativas_clase').select('*').eq('stripe_refund_id', rf.id).single();
      if (!row || (!(claimed && claimed.length) && row.invoice_number && row.pdf_url)) continue;
      let numero = row.invoice_number as string | null;
      if (!numero) {
        const { data: n } = await supabase.rpc('assign_invoice_number', { p_type: 'sesion_rect', p_year: new Date().getFullYear() });
        const { data: upd } = await supabase.from('facturas_rectificativas_clase')
          .update({ invoice_number: n }).eq('id', row.id).is('invoice_number', null).select('invoice_number');
        numero = (upd && upd[0]?.invoice_number) || n;
      }
      const pdf = await generateClaseRectificativaPdf({
        invoice_number: String(numero), fecha: row.created_at, factura_original: row.factura_original,
        factura_original_fecha: row.factura_original_fecha, motivo: row.motivo, importe_cents: row.importe_cents,
        comprador_nombre: row.comprador_nombre, comprador_email: row.comprador_email, comprador_nif: row.comprador_nif,
        comprador_direccion: row.comprador_direccion ? String(row.comprador_direccion).split(' · ') : [],
        concepto: SESION.nombre
      });
      const path = await uploadPdfToInvoices(supabase, `sesiones/${ses.id}-rect-${rf.id}.pdf`, pdf);
      await supabase.from('facturas_rectificativas_clase').update({ pdf_url: path }).eq('id', row.id);
      console.log(`sesion: rectificativa ${numero} emitida para ${ses.id}`);
    } catch (e) { console.error('sesion: rectificativa fallo', rf.id, e); }
  }
  const total = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? Infinity);
  if (!total) {
    await supabase.from('sesiones_1a1').update({ importe_reembolsado_cents: charge.amount_refunded ?? 0 }).eq('id', ses.id);
    return;
  }
  const { data: upd } = await supabase.from('sesiones_1a1')
    .update({ estado: 'reembolsada', reembolsada_at: new Date().toISOString(), importe_reembolsado_cents: charge.amount_refunded ?? ses.importe_cents })
    .eq('id', ses.id).eq('estado', 'pagada').select('id');
  if (upd && upd.length) {
    if (ses.solicitud_id) await crmMarcarReembolso(supabase, ses.solicitud_id);
    try {
      await resendSend({
        from: 'Curino <noreply@casacurino.com>', to: [ses.email], reply_to: 'info@casacurino.com',
        subject: `Reembolso confirmado — ${SESION.nombre}`,
        html: `<p>Hola ${escapeHtml(ses.nombre)},</p><p>Hemos procesado el reembolso de tu ${escapeHtml(SESION.nombre)}. Lo verás en 5-10 días hábiles en el mismo método de pago.</p><p>Un abrazo,<br>Juan de Mora</p>`
      });
    } catch (e) { console.error('sesion: email reembolso fallo', e); }
  }
}

// ============================================================================
// ONE-TO-ONE 3 MESES (purpose = 'one_to_one', /partners/formaciones)
//
// Idempotencia por one_to_one_compras.stripe_session_id (UNIQUE + SELECT).
// Factura ONE-AAAA-NNNNNN (completa con NIF o simplificada), PDF en
// invoices/one-to-one/<id>.pdf, email de bienvenida (agendar primera sesion
// + WhatsApp) y aviso a info@. Marca one_to_one_comprado_at y «compro».
// ============================================================================
async function handleOneToOneCompleted(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  session: Stripe.Checkout.Session
) {
  const md = session.metadata || {};
  const cd = session.customer_details;
  const buyerEmail = (cd?.email || session.customer_email || '').toLowerCase();
  const nombre = md.nombre || cd?.name || '';
  const telefono = cd?.phone || md.telefono || null;
  const amount = session.amount_total ?? 0;
  if (!buyerEmail || amount <= 0) { console.error('one_to_one: datos insuficientes', session.id); return; }

  const { data: existing } = await supabase.from('one_to_one_compras').select('id').eq('stripe_session_id', session.id).maybeSingle();
  if (existing) { console.log(`one_to_one: ${session.id} ya registrada`); return; }

  const terminos = session.consent?.terms_of_service === 'accepted';
  const taxId = (cd?.tax_ids || []).find((t: Stripe.Checkout.Session.CustomerDetails.TaxId) => t && t.value)?.value || null;
  const direccion = formatStripeAddress(cd?.address);
  const { data: invoiceNum, error: invErr } = await supabase.rpc('assign_invoice_number', { p_type: 'one', p_year: new Date().getFullYear() });
  if (invErr) console.error('one_to_one: error asignando factura', invErr);
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);
  const solicitudId = /^[0-9a-f-]{36}$/i.test(md.solicitud_id || '') ? md.solicitud_id : null;

  const { data: one, error: insErr } = await supabase.from('one_to_one_compras').insert({
    solicitud_id: solicitudId, nombre: nombre || buyerEmail, email: buyerEmail, telefono,
    email_formulario: (md.email_formulario || '').toLowerCase() || null,
    stripe_session_id: session.id, stripe_payment_intent: paymentIntentId, importe_cents: amount,
    terminos_aceptados: terminos, terminos_aceptados_at: terminos ? new Date().toISOString() : null,
    factura_tipo: taxId ? 'completa' : 'simplificada', cliente_nombre_fiscal: (cd?.name || '').trim() || null,
    cliente_nif: taxId, cliente_direccion: direccion.length ? direccion.join(' · ') : null, invoice_number: invoiceNum,
    event_id: md.event_id || null, utm_source: md.utm_source || null, utm_medium: md.utm_medium || null, utm_campaign: md.utm_campaign || null
  }).select('id, created_at').single();
  if (insErr || !one) { console.error('one_to_one: insert fallo', session.id, insErr); return; }
  console.log(`one_to_one: ${one.id} confirmado (${amount} cents)`);

  try {
    const ahora = new Date().toISOString();
    const q = supabase.from('partners_solicitudes').update({ one_to_one_comprado_at: ahora, crm_estado: 'compro', crm_actualizado_at: ahora });
    if (solicitudId) await q.eq('id', solicitudId); else await q.eq('email', buyerEmail);
  } catch (e) { console.error('one_to_one: link solicitud fallo', e); }

  await sendClasePurchaseCapi(session, buyerEmail, nombre, telefono, amount, md.event_id || null, 'one-to-one', '/partners/formaciones/gracias/');

  const numero = invoiceNum || `ONE-${String(one.id).slice(0, 8)}`;
  try {
    const pdf = await generateClaseInvoicePdf({
      id: String(one.id), clase_id: '', clase_fecha: String(one.created_at),
      nombre: nombre || buyerEmail, email: buyerEmail, amount_paid_cents: amount,
      invoice_number: numero, created_at: String(one.created_at),
      buyer_nombre_fiscal: (cd?.name || '').trim() || null, buyer_nif: taxId, buyer_direccion: direccion,
      concepto: `${ONE_TO_ONE.nombre} (12 sesiones individuales por Zoom + WhatsApp directo)`
    });
    const path = await uploadPdfToInvoices(supabase, `one-to-one/${one.id}.pdf`, pdf);
    await supabase.from('one_to_one_compras').update({ pdf_url: path }).eq('id', one.id);
    await sendOneToOneWelcomeEmail(buyerEmail, nombre || buyerEmail, pdf, numero);
    await supabase.from('one_to_one_compras').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', one.id);
  } catch (e) { console.error('one_to_one: factura/email fallo', one.id, e); }
  try {
    await sendOneToOneAvisoEmail({ nombre: nombre || buyerEmail, email: buyerEmail, telefono, importe_cents: amount, invoice_number: numero, id: String(one.id) });
    await supabase.from('one_to_one_compras').update({ aviso_enviado_at: new Date().toISOString() }).eq('id', one.id);
  } catch (e) { console.error('one_to_one: aviso info@ fallo', one.id, e); }
}

// Reembolso de un One-to-one: rectificativa R-ONE por refund (idempotente
// por stripe_refund_id) y, si es total, estado 'reembolsada' + email. Un
// reembolso parcial (p. ej. desistimiento con sesiones ya hechas) solo
// registra el importe devuelto.
async function handleOneToOneRefunded(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  stripe: Stripe,
  charge: Stripe.Charge,
  paymentIntent: string
) {
  const { data: one } = await supabase.from('one_to_one_compras').select('*').eq('stripe_payment_intent', paymentIntent).maybeSingle();
  if (!one) return;
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 }).catch(() => null);
  for (const rf of refunds?.data || []) {
    if (rf.status === 'failed' || rf.status === 'canceled') continue;
    try {
      const { data: claimed } = await supabase.from('facturas_rectificativas_clase').upsert({
        stripe_refund_id: rf.id, stripe_charge_id: charge.id, one_to_one_id: one.id, serie: 'one',
        importe_cents: rf.amount, factura_original: one.invoice_number || `ONE-${String(one.id).slice(0, 8)}`,
        factura_original_fecha: one.created_at, comprador_nombre: one.cliente_nombre_fiscal || one.nombre,
        comprador_email: one.email, comprador_nif: one.cliente_nif, comprador_direccion: one.cliente_direccion
      }, { onConflict: 'stripe_refund_id', ignoreDuplicates: true }).select('id');
      const { data: row } = await supabase.from('facturas_rectificativas_clase').select('*').eq('stripe_refund_id', rf.id).single();
      if (!row || (!(claimed && claimed.length) && row.invoice_number && row.pdf_url)) continue;
      let numero = row.invoice_number as string | null;
      if (!numero) {
        const { data: n } = await supabase.rpc('assign_invoice_number', { p_type: 'one_rect', p_year: new Date().getFullYear() });
        const { data: upd } = await supabase.from('facturas_rectificativas_clase')
          .update({ invoice_number: n }).eq('id', row.id).is('invoice_number', null).select('invoice_number');
        numero = (upd && upd[0]?.invoice_number) || n;
      }
      const pdf = await generateClaseRectificativaPdf({
        invoice_number: String(numero), fecha: row.created_at, factura_original: row.factura_original,
        factura_original_fecha: row.factura_original_fecha, motivo: row.motivo, importe_cents: row.importe_cents,
        comprador_nombre: row.comprador_nombre, comprador_email: row.comprador_email, comprador_nif: row.comprador_nif,
        comprador_direccion: row.comprador_direccion ? String(row.comprador_direccion).split(' · ') : [],
        concepto: ONE_TO_ONE.nombre
      });
      const path = await uploadPdfToInvoices(supabase, `one-to-one/${one.id}-rect-${rf.id}.pdf`, pdf);
      await supabase.from('facturas_rectificativas_clase').update({ pdf_url: path }).eq('id', row.id);
      console.log(`one_to_one: rectificativa ${numero} emitida para ${one.id}`);
    } catch (e) { console.error('one_to_one: rectificativa fallo', rf.id, e); }
  }
  const total = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? Infinity);
  if (!total) {
    await supabase.from('one_to_one_compras').update({ importe_reembolsado_cents: charge.amount_refunded ?? 0 }).eq('id', one.id);
    return;
  }
  const { data: upd } = await supabase.from('one_to_one_compras')
    .update({ estado: 'reembolsada', reembolsada_at: new Date().toISOString(), importe_reembolsado_cents: charge.amount_refunded ?? one.importe_cents })
    .eq('id', one.id).eq('estado', 'pagada').select('id');
  if (upd && upd.length) {
    if (one.solicitud_id) await crmMarcarReembolso(supabase, one.solicitud_id);
    try {
      await resendSend({
        from: 'Curino <noreply@casacurino.com>', to: [one.email], reply_to: 'info@casacurino.com',
        subject: `Reembolso confirmado — ${ONE_TO_ONE.nombre}`,
        html: `<p>Hola ${escapeHtml(one.nombre)},</p><p>Hemos procesado el reembolso de tu ${escapeHtml(ONE_TO_ONE.nombre)}. Lo verás en 5-10 días hábiles en el mismo método de pago.</p><p>Un abrazo,<br>Juan de Mora</p>`
      });
    } catch (e) { console.error('one_to_one: email reembolso fallo', e); }
  }
}

// CRM: tras un reembolso TOTAL, el contacto pasa a "descartado" con nota
// automatica "Reembolsado (fecha)", salvo que le quede otra compra pagada.
async function crmMarcarReembolso(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  solicitudId: string
) {
  try {
    const { data: sol } = await supabase.from('partners_solicitudes')
      .select('id, crm_notas, inscripcion_id').eq('id', solicitudId).maybeSingle();
    if (!sol) return;
    const [{ data: insPagada }, { data: sesPagada }, { data: onePagado }] = await Promise.all([
      sol.inscripcion_id
        ? supabase.from('inscripciones').select('id').eq('id', sol.inscripcion_id).eq('estado', 'pagada').maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('sesiones_1a1').select('id').eq('solicitud_id', solicitudId).eq('estado', 'pagada').limit(1).maybeSingle(),
      supabase.from('one_to_one_compras').select('id').eq('solicitud_id', solicitudId).eq('estado', 'pagada').limit(1).maybeSingle()
    ]);
    if (insPagada || sesPagada || onePagado) return; // otra compra sigue activa: manda "compro"
    const fecha = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
    const nota = `Reembolsado (${fecha})`;
    await supabase.from('partners_solicitudes').update({
      crm_estado: 'descartado',
      crm_notas: sol.crm_notas ? `${sol.crm_notas}\n${nota}` : nota,
      crm_actualizado_at: new Date().toISOString()
    }).eq('id', solicitudId);
  } catch (e) { console.error('crm: marcar reembolso fallo', solicitudId, e); }
}

async function linkPartnersSolicitud(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
  inscripcionId: string,
  buyerEmail: string
) {
  try {
    const solicitudId = session.metadata?.solicitud_id || '';
    // CRM: una compra siempre pasa el contacto a "compro" (aunque estuviera descartado).
    const update = { inscripcion_id: inscripcionId, pagado_at: new Date().toISOString(), crm_estado: 'compro', crm_actualizado_at: new Date().toISOString() };
    const q = supabase.from('partners_solicitudes').update(update);
    const { error } = /^[0-9a-f-]{36}$/i.test(solicitudId)
      ? await q.eq('id', solicitudId)
      : await q.eq('email', buyerEmail);
    if (error) console.error('clase: link partners_solicitudes failed', error);
  } catch (err) {
    console.error('clase: link partners_solicitudes threw', err);
  }
}

async function sendClasePurchaseCapi(
  session: Stripe.Checkout.Session,
  buyerEmail: string,
  nombre: string,
  telefono: string | null,
  amountPaidCents: number,
  eventId: string | null,
  contentId = 'intensivo-partners',
  sourcePath = '/partners/gracias/'
) {
  try {
    const md = session.metadata || {};
    const adConsent = md.ad_consent === 'true' ? true : (md.ad_consent === 'false' ? false : null);
    if (!eventId || !adConsentAllowed(adConsent, md.country || null)) return;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';
    await sendMetaEvent({
      eventName: 'Purchase',
      eventId,
      eventSourceUrl: `${siteUrl}${sourcePath}`,
      email: buyerEmail,
      phone: telefono,
      firstName: nombre,
      country: md.country || null,
      fbc: md.fbc || null,
      fbp: md.fbp || null,
      clientIp: md.client_ip || null,
      clientUa: md.client_ua || null,
      customData: {
        value: amountPaidCents / 100,
        currency: (session.currency || 'eur').toUpperCase(),
        content_ids: [contentId],
        content_type: 'product',
        num_items: 1
      }
    });
  } catch (err) {
    console.error('clase: CAPI Purchase failed', err);
  }
}

// ============================================================================
// CURSO: compra del curso pregrabado (landing /partners).
//
// metadata esperada en la session:
//   purpose = 'curso'
//   nombre = <string>
//   telefono = <string opcional>
//   desistimiento_renunciado = 'true'
//   event_id = <uuid — compartido con dataLayer>
//   utm_source, utm_medium, utm_campaign = <opcionales>
//
// Acciones:
//   1. Idempotencia: skip si inscripciones_curso.stripe_session_id
//      ya existe.
//   2. Generar access_token (base64url 32B = 43 chars) con
//      crypto.getRandomValues. UNIQUE en la tabla + regex en
//      curso-acceso previene colisiones y probing.
//   3. Asigna invoice_number CURSO-YYYY-NNNNNN.
//   4. Inserta fila en inscripciones_curso (estado='pagada').
//   5. Best-effort: PDF factura + upload al bucket + email con
//      enlace de acceso (SITE_URL/partners/acceso/?t=<token>) +
//      factura adjunta. Fallos aqui solo se loguean.
//
// NO hay refund automatico (no hay agotamiento: es contenido
// digital ilimitado). NO hay recordatorios (no hay fecha).
// ============================================================================
function generateAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function handleCursoCompleted(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  const nombre = session.metadata?.nombre;
  const telefono = session.metadata?.telefono || null;
  const desistimientoRenunciado = session.metadata?.desistimiento_renunciado === 'true';
  const eventId = session.metadata?.event_id || null;
  const utmSource = session.metadata?.utm_source || null;
  const utmMedium = session.metadata?.utm_medium || null;
  const utmCampaign = session.metadata?.utm_campaign || null;

  const buyerEmail = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  const amountPaidCents = session.amount_total ?? 0;

  if (!nombre || !buyerEmail) {
    console.error('curso: missing metadata for session', session.id);
    return;
  }
  if (amountPaidCents <= 0) {
    console.error('curso: invalid amount_total for session', session.id);
    return;
  }

  // 1. Idempotencia
  const { data: existing } = await supabase
    .from('inscripciones_curso')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  if (existing) {
    console.log(`curso: inscripcion already exists for session ${session.id}`);
    return;
  }

  // 2. Token de acceso
  const accessToken = generateAccessToken();

  // 3. Numero de factura CURSO-YYYY-NNNNNN
  const currentYear = new Date().getFullYear();
  const { data: invoiceNum, error: invErr } = await supabase.rpc('assign_invoice_number', {
    p_type: 'curso',
    p_year: currentYear
  });
  if (invErr) {
    console.error('curso: error assigning invoice number:', invErr);
  }

  // 4. Insertar inscripcion
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);

  const { data: inscripcion, error: insError } = await supabase
    .from('inscripciones_curso')
    .insert({
      nombre,
      email: buyerEmail,
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntentId,
      importe_cents: amountPaidCents,
      desistimiento_renunciado: desistimientoRenunciado,
      access_token: accessToken,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      estado: 'pagada',
      invoice_number: invoiceNum,
      event_id: eventId
    })
    .select('id, created_at')
    .single();

  if (insError || !inscripcion) {
    console.error(`curso: insert inscripcion failed for session ${session.id}`, insError);
    return;
  }

  console.log(`curso: inscripcion ${inscripcion.id} confirmed for ${buyerEmail}`);

  // 5. Best-effort: PDF factura + email con enlace de acceso + factura adjunta
  try {
    const invoiceData: CursoInvoiceData = {
      id: inscripcion.id,
      nombre,
      email: buyerEmail,
      amount_paid_cents: amountPaidCents,
      invoice_number: invoiceNum || `CURSO-${inscripcion.id.slice(0, 8)}`,
      created_at: inscripcion.created_at
    };

    const pdfBytes = await generateCursoInvoicePdf(invoiceData);
    const pdfPath = await uploadCursoInvoicePdf(supabase, inscripcion.id, pdfBytes);

    await supabase
      .from('inscripciones_curso')
      .update({ pdf_url: pdfPath })
      .eq('id', inscripcion.id);

    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';
    const accessUrl = `${siteUrl}/partners/acceso/?t=${accessToken}`;

    await sendCursoConfirmationEmail(
      buyerEmail, nombre, accessUrl, pdfBytes, invoiceData.invoice_number
    );

    await supabase
      .from('inscripciones_curso')
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq('id', inscripcion.id);

    console.log(`curso: invoice + confirmation sent for inscripcion ${inscripcion.id}`);
  } catch (invoiceError) {
    console.error(`curso: invoice/email failed for inscripcion ${inscripcion.id}`, invoiceError);
  }
}
