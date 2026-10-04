// supabase/functions/clases-checkout/index.ts
//
// Edge Function: crea Stripe Checkout Session para reservar una plaza en
// una clase en directo. Producto inline (price_data), sin login (invitado).
//
// Desde 2026-10 vende el Intensivo Curino Partners (990 EUR, aforo 20,
// pago unico solo con tarjeta) desde el formulario de /partners/. Sin
// casilla de renuncia al desistimiento: la politica es devolucion del
// 100 % si se cancela antes de la primera clase (FAQ de la landing).
//
// Flow:
//   1. Body: { clase_id, nombre, email, telefono?, event_id,
//              utm_source?, utm_medium?, utm_campaign?, solicitud_id?,
//              fbc?, fbp?, ad_consent?, country?, client_ip?, client_ua? }
//      Los campos de atribucion viajan a metadata para que stripe-webhook
//      mande Purchase por CAPI deduplicado con el mismo event_id.
//   2. Verifica clase abierta + plazas disponibles con service_role.
//   3. Crea Stripe Checkout Session con price_data y metadata.purpose='clase'.
//   4. Devuelve { checkout_url }.
//
// La inscripcion se persiste desde stripe-webhook al recibir
// checkout.session.completed, no aqui. Idempotencia y refund automatico
// viven en el handler del webhook.
//
// verify_jwt=false (invitado). Registrado en supabase/config.toml.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import Stripe from 'https://esm.sh/stripe@17.3.0?target=deno'
import { adConsentAllowed } from '../_shared/meta-capi.ts'

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceKey) {
      console.error('clases-checkout: missing required env vars');
      return jsonResponse({ error: 'server_misconfigured' }, 500);
    }

    // 1. Body + validacion
    const body = await req.json().catch(() => ({}));
    const clase_id = trimSlice(body?.clase_id, 64);
    const nombre = trimSlice(body?.nombre, 120);
    const email = trimSlice(body?.email, 200).toLowerCase();
    const telefono = trimSlice(body?.telefono, 40);
    const utm_source = trimSlice(body?.utm_source);
    const utm_medium = trimSlice(body?.utm_medium);
    const utm_campaign = trimSlice(body?.utm_campaign);
    const event_id = trimSlice(body?.event_id, 64);
    const solicitud_id = trimSlice(body?.solicitud_id, 64);
    const fbc = trimSlice(body?.fbc, 400);
    const fbp = trimSlice(body?.fbp, 200);
    const ad_consent = body?.ad_consent === true ? 'true' : (body?.ad_consent === false ? 'false' : '');
    const country = trimSlice(body?.country, 2).toUpperCase();
    const client_ip = trimSlice(body?.client_ip, 64);
    const client_ua = trimSlice(body?.client_ua, 400);
    // Sin consentimiento publicitario no guardamos identificadores de
    // atribucion en Stripe (y el webhook no mandara Purchase por CAPI).
    const capiOk = adConsentAllowed(
      ad_consent === 'true' ? true : (ad_consent === 'false' ? false : null),
      country || null
    );

    if (!UUID_RE.test(clase_id)) return jsonResponse({ error: 'invalid_clase_id' }, 400);
    if (nombre.length < 2) return jsonResponse({ error: 'invalid_nombre' }, 400);
    if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);
    if (!UUID_RE.test(event_id)) return jsonResponse({ error: 'invalid_event_id' }, 400);

    // 2. Verificar clase con service_role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: clase, error: claseError } = await supabase
      .from('clases')
      .select('id, fecha, precio_cents, plazas_totales, plazas_ocupadas, estado')
      .eq('id', clase_id)
      .maybeSingle();

    if (claseError) {
      console.error('clases-checkout: error loading clase', claseError);
      return jsonResponse({ error: 'internal_error' }, 500);
    }
    if (!clase) return jsonResponse({ error: 'clase_not_found' }, 404);
    if (clase.estado !== 'abierta') return jsonResponse({ error: 'clase_not_open' }, 409);
    if (clase.plazas_ocupadas >= clase.plazas_totales) {
      return jsonResponse({ error: 'clase_full' }, 409);
    }

    // 3. Stripe session
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient()
    });

    const claseFechaLegible = (() => {
      try {
        return new Intl.DateTimeFormat('es-ES', {
          weekday: 'long', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit', hour12: false,
          timeZone: 'Europe/Madrid'
        }).format(new Date(clase.fecha));
      } catch { return clase.fecha; }
    })();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Intensivo Curino Partners',
            description: `4 semanas, 8 clases en directo por Zoom (grabadas). Inicio: ${claseFechaLegible} (hora peninsular).`
          },
          unit_amount: clase.precio_cents
        },
        quantity: 1
      }],
      customer_email: email,
      success_url: `${siteUrl}/partners/gracias/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/partners/#solicitud`,
      metadata: {
        purpose: 'clase',
        clase_id,
        nombre,
        telefono,
        desistimiento_renunciado: 'false',
        event_id,
        utm_source,
        utm_medium,
        utm_campaign,
        solicitud_id,
        ad_consent,
        country,
        fbc: capiOk ? fbc : '',
        fbp: capiOk ? fbp : '',
        client_ip: capiOk ? client_ip : '',
        client_ua: capiOk ? client_ua : ''
      }
    });

    return jsonResponse({ checkout_url: session.url, session_id: session.id }, 200);

  } catch (err: any) {
    console.error('clases-checkout error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
