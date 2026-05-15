// supabase/functions/magazine-checkout/index.ts
//
// Edge Function: crea sesión de Stripe Checkout para compra de paquetes
// de publicaciones de Revista Curino. Productos inline (price_data),
// sin productos persistentes en Stripe Dashboard.
//
// Flow:
//   1. Auth user (Bearer JWT).
//   2. Body: { package_size: 1 | 2 | 6 }.
//   3. Crear Stripe Checkout Session con price_data inline.
//   4. metadata.purpose = 'magazine_package' para que stripe-webhook
//      detecte y procese vía handleMagazinePackageCompleted.
//   5. Return { checkout_url }.
//
// No insertamos magazine_purchases ni magazine_credits aquí — el webhook
// lo hace tras confirmación de pago, garantizando idempotencia y exactitud
// del importe pagado.

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

// Mapa de precios. Coincide con la card del listado /mi-cuenta/revista/.
// Mantener sincronizado con la UI manualmente — no hay tabla de precios en BD.
const PACKAGE_PRICES: Record<number, number> = {
  1: 9900,
  2: 15900,
  6: 38600
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'auth_required' }, 401);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: 'auth_required' }, 401);

    // Body
    const { package_size } = await req.json().catch(() => ({}));
    const packageSize = Number(package_size);
    if (![1, 2, 6].includes(packageSize)) {
      return jsonResponse({ error: 'invalid_package_size' }, 400);
    }

    const unitAmount = PACKAGE_PRICES[packageSize];
    const packageLabel = packageSize === 1 ? '1 publicación' : `${packageSize} publicaciones`;

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient()
    });

    const successUrl = `${siteUrl}/mi-cuenta/revista/?purchase=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${siteUrl}/mi-cuenta/revista/?purchase=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Revista Curino — Paquete ${packageLabel}`,
            description: 'Créditos para publicar artículos en la Revista Curino. Caducan a los 12 meses.'
          },
          unit_amount: unitAmount
        },
        quantity: 1
      }],
      customer_email: user.email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        purpose: 'magazine_package',
        user_id: user.id,
        package_size: String(packageSize)
      }
    });

    return jsonResponse({ checkout_url: session.url, session_id: session.id }, 200);

  } catch (err: any) {
    console.error('magazine-checkout error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
