// supabase/functions/stripe-webhook/index.ts
//
// Edge Function: recibe webhooks de Stripe y persiste cambios en BD.
//
// Eventos manejados:
//   - account.updated: sincroniza seller_accounts con datos de Stripe
//   - account.application.deauthorized: marca cuenta como disabled
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

Deno.serve(async (req) => {
  // Stripe siempre manda POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

    if (!stripeSecretKey || !webhookSecret) {
      console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
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
    let event: Stripe.Event;

    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        webhookSecret,
        undefined,
        Stripe.createSubtleCryptoProvider()
      );
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return new Response('Invalid signature', { status: 400 });
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
