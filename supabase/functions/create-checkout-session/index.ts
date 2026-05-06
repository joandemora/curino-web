// supabase/functions/create-checkout-session/index.ts
//
// Edge Function: crea sesión de Stripe Checkout para compra de pieza marketplace.
//
// Flow:
//   1. Frontend llama con { item_id }.
//   2. Validar JWT user.
//   3. Cargar library_item: precio, seller, datos.
//   4. Si seller_id es admin → destination charge a la cuenta plataforma (Curino vende directamente).
//   5. Si seller_id es seller externo → destination charge con transfer_data al stripe_account_id del seller.
//   6. application_fee_amount = 30% del precio (comisión Curino, configurable en marketplace_config).
//   7. Devolver URL de la sesión.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import Stripe from 'https://esm.sh/stripe@17.3.0?target=deno'

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';

    // 1. Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'auth_required' }, 401);

    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: 'auth_required' }, 401);

    // 2. Body
    const { item_id } = await req.json().catch(() => ({}));
    if (!item_id || typeof item_id !== 'string') {
      return jsonResponse({ error: 'invalid_item_id' }, 400);
    }

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Cargar item
    const { data: item, error: itemError } = await supabaseService
      .from('library_items')
      .select('id, name, description, price_cents, seller_id, status')
      .eq('id', item_id)
      .maybeSingle();

    if (itemError || !item) return jsonResponse({ error: 'item_not_found' }, 404);
    if (item.status !== 'published') return jsonResponse({ error: 'item_not_available' }, 400);
    if (item.price_cents === 0) return jsonResponse({ error: 'item_is_free' }, 400);
    if (item.seller_id === user.id) return jsonResponse({ error: 'cannot_buy_own_item' }, 400);

    // 4. Verificar si ya lo compró
    const { data: existingPurchase } = await supabaseService
      .from('purchases')
      .select('id')
      .eq('user_id', user.id)
      .eq('library_item_id', item_id)
      .maybeSingle();

    if (existingPurchase) {
      return jsonResponse({ error: 'already_purchased' }, 400);
    }

    // 5. Determinar si seller es admin (Curino vende directo)
    const { data: sellerRoleData } = await supabaseService
      .from('user_roles')
      .select('role')
      .eq('user_id', item.seller_id)
      .maybeSingle();

    const sellerIsAdmin = sellerRoleData?.role === 'admin';

    // 6. Cargar config de comisión (marketplace_config: key/value jsonb).
    //    Default 30% si la fila no existe.
    const { data: configData } = await supabaseService
      .from('marketplace_config')
      .select('value')
      .eq('key', 'commission_pct')
      .maybeSingle();

    const commissionPct = configData?.value
      ? parseInt(String(configData.value), 10)
      : 30;

    // 7. Si seller no es admin, cargar stripe_account_id
    let sellerStripeAccountId: string | null = null;
    if (!sellerIsAdmin) {
      const { data: sellerAccount } = await supabaseService
        .from('seller_accounts')
        .select('stripe_account_id, charges_enabled')
        .eq('user_id', item.seller_id)
        .maybeSingle();

      if (!sellerAccount || !sellerAccount.charges_enabled) {
        return jsonResponse({ error: 'seller_cannot_receive_payments' }, 400);
      }
      sellerStripeAccountId = sellerAccount.stripe_account_id;
    }

    // 8. Crear sesión Stripe Checkout
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient()
    });

    const successUrl = `${siteUrl}/configurador-2d/?purchase_completed=${item_id}`;
    const cancelUrl = `${siteUrl}/configurador-2d/?purchase_cancelled=${item_id}`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: item.name,
            description: item.description || undefined
          },
          unit_amount: item.price_cents
        },
        quantity: 1
      }],
      customer_email: user.email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        curino_item_id: item.id,
        curino_buyer_id: user.id,
        curino_seller_id: item.seller_id,
        curino_seller_is_admin: sellerIsAdmin ? 'true' : 'false',
        curino_commission_pct: String(commissionPct)
      }
    };

    // Si seller es externo, transfer_data + application_fee
    if (!sellerIsAdmin && sellerStripeAccountId) {
      const applicationFee = Math.round(item.price_cents * commissionPct / 100);
      sessionParams.payment_intent_data = {
        application_fee_amount: applicationFee,
        transfer_data: {
          destination: sellerStripeAccountId
        }
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return jsonResponse({
      url: session.url,
      session_id: session.id
    }, 200);

  } catch (err: any) {
    console.error('create-checkout-session error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
