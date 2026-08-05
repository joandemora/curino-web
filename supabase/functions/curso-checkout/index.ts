// supabase/functions/curso-checkout/index.ts
//
// Edge Function: crea Stripe Checkout Session para comprar el
// curso pregrabado. Producto inline (price_data), invitado sin
// login. Comprable 24/7 -- sin verificacion de plazas ni de fecha.
//
// Flow:
//   1. Body: { nombre, email, telefono?, desistimiento_renunciado,
//              event_id, utm_source?, utm_medium?, utm_campaign? }
//   2. Crea Stripe Checkout Session con price_data y
//      metadata.purpose='curso'.
//   3. Devuelve { checkout_url }.
//
// La inscripcion en inscripciones_curso se persiste desde
// stripe-webhook (handleCursoCompleted) tras el pago confirmado,
// no aqui. El access_token tambien se genera alli.
//
// verify_jwt=false (invitado). Registrado en supabase/config.toml.

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimSlice(s: unknown, max = 480): string {
  if (s == null) return '';
  return String(s).trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';
    const priceCents = parseInt(Deno.env.get('CURSO_PRICE_CENTS') || '9000', 10);

    if (!stripeSecretKey) {
      console.error('curso-checkout: STRIPE_SECRET_KEY missing');
      return jsonResponse({ error: 'server_misconfigured' }, 500);
    }
    if (!priceCents || priceCents <= 0) {
      console.error('curso-checkout: invalid CURSO_PRICE_CENTS', priceCents);
      return jsonResponse({ error: 'server_misconfigured' }, 500);
    }

    // Body + validacion
    const body = await req.json().catch(() => ({}));
    const nombre = trimSlice(body?.nombre, 120);
    const email = trimSlice(body?.email, 200).toLowerCase();
    const telefono = trimSlice(body?.telefono, 40);
    const desistimiento_renunciado = body?.desistimiento_renunciado === true;
    const utm_source = trimSlice(body?.utm_source);
    const utm_medium = trimSlice(body?.utm_medium);
    const utm_campaign = trimSlice(body?.utm_campaign);
    const event_id = trimSlice(body?.event_id, 64);

    if (nombre.length < 2) return jsonResponse({ error: 'invalid_nombre' }, 400);
    if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);
    if (!desistimiento_renunciado) return jsonResponse({ error: 'desistimiento_required' }, 400);
    if (!UUID_RE.test(event_id)) return jsonResponse({ error: 'invalid_event_id' }, 400);

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient()
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Curso Curino: vender carpintería a medida sin ser carpintero',
            description: 'Curso online. 4 clases pregrabadas. Acceso sin caducidad.'
          },
          unit_amount: priceCents
        },
        quantity: 1
      }],
      customer_email: email,
      success_url: `${siteUrl}/partners/gracias/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/partners/`,
      metadata: {
        purpose: 'curso',
        nombre,
        telefono,
        desistimiento_renunciado: 'true',
        event_id,
        utm_source,
        utm_medium,
        utm_campaign
      }
    });

    return jsonResponse({ checkout_url: session.url, session_id: session.id }, 200);

  } catch (err: any) {
    console.error('curso-checkout error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
