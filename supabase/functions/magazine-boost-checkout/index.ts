// supabase/functions/magazine-boost-checkout/index.ts
//
// Edge Function: Stripe Checkout Session para comprar un boost
// (promoción temporal) de un artículo published. Productos inline
// (price_data), sin productos persistentes en Stripe.
//
// Flow:
//   1. Auth user (Bearer JWT).
//   2. Body: { article_id: uuid, type: 'section_cover' | 'main_page' }.
//   3. Validar: artículo published y pertenece al user.
//   4. Crear Stripe Checkout Session con metadata.purpose='magazine_boost'.
//   5. El webhook stripe-webhook (handleMagazineBoostCompleted) inserta
//      la row en magazine_boosts tras confirmación de pago.

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

// Precios fijos del boost (cents EUR). Mantener sincronizado con la UI.
const BOOST_PRICES: Record<string, number> = {
  section_cover: 5500,  // 55€ portada de sección
  main_page: 12500      // 125€ página principal
};

const BOOST_LABELS: Record<string, string> = {
  section_cover: 'Portada de sección',
  main_page: 'Página principal'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
    const { article_id, type } = await req.json().catch(() => ({}));
    if (!article_id || typeof article_id !== 'string') {
      return jsonResponse({ error: 'invalid_article_id' }, 400);
    }
    if (!type || !BOOST_PRICES[type]) {
      return jsonResponse({ error: 'invalid_boost_type' }, 400);
    }

    // Validar artículo (service role: bypass RLS para la lectura)
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    const { data: article } = await supabaseService
      .from('magazine_articles')
      .select('id, user_id, title, status')
      .eq('id', article_id)
      .maybeSingle();

    if (!article) return jsonResponse({ error: 'article_not_found' }, 404);
    if (article.user_id !== user.id) return jsonResponse({ error: 'forbidden' }, 403);
    if (article.status !== 'published') return jsonResponse({ error: 'article_not_published' }, 400);

    // Prevenir doble boost (mismo article + mismo type en estado activo o queued)
    const { data: existing } = await supabaseService
      .from('magazine_boosts')
      .select('id, status')
      .eq('article_id', article_id)
      .eq('type', type)
      .in('status', ['queued', 'active'])
      .maybeSingle();
    if (existing) {
      return jsonResponse({ error: 'boost_already_exists', detail: 'status: ' + existing.status }, 400);
    }

    const unitAmount = BOOST_PRICES[type];
    const typeLabel = BOOST_LABELS[type];

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient()
    });

    const successUrl = `${siteUrl}/mi-cuenta/revista/?boost=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${siteUrl}/mi-cuenta/revista/?boost=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Boost ${typeLabel} — Revista Curino`,
            description: `Promoción de "${article.title}" durante 15 días.`
          },
          unit_amount: unitAmount
        },
        quantity: 1
      }],
      customer_email: user.email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        purpose: 'magazine_boost',
        user_id: user.id,
        article_id: article.id,
        boost_type: type
      }
    });

    return jsonResponse({ checkout_url: session.url, session_id: session.id }, 200);

  } catch (err: any) {
    console.error('magazine-boost-checkout error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
