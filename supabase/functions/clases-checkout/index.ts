// supabase/functions/clases-checkout/index.ts
//
// Edge Function: crea Stripe Checkout Session para reservar una plaza en
// una clase en directo. Producto inline (price_data), sin login (invitado).
//
// Desde 2026-10 vende el Intensivo Curino Partners (990 EUR, aforo por fila
// en clases.plazas_totales: 3 en la 1a edicion, 20 por defecto,
// pago unico solo con tarjeta) desde el formulario de /partners/. Sin
// Sin devoluciones (2026-10): Checkout exige marcar la casilla de
// condiciones (consent_collection.terms_of_service = 'required') con el
// texto de solicitud de entrega inmediata y renuncia expresa al derecho de
// desistimiento (art. 103 m TRLGDCU). Requiere la URL de condiciones
// configurada en el panel de Stripe (Ajustes > Datos públicos). El webhook
// guarda la aceptación en la inscripción.
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
    // Enlaces personales (/partners/formaciones con token): email prellenado
    // en Stripe. OJO: Stripe lo muestra BLOQUEADO (no editable).
    const prefill_email = body?.prefill_email === true;
    // Sin consentimiento publicitario no guardamos identificadores de
    // atribucion en Stripe (y el webhook no mandara Purchase por CAPI).
    const capiOk = adConsentAllowed(
      ad_consent === 'true' ? true : (ad_consent === 'false' ? false : null),
      country || null
    );

    if (!UUID_RE.test(clase_id)) return jsonResponse({ error: 'invalid_clase_id' }, 400);
    // sin_formulario: compra desde /partners/formaciones sin token de lead;
    // Stripe pide nombre (facturacion) y email, el webhook los toma de ahi.
    const sin_formulario = body?.sin_formulario === true;
    if (!sin_formulario && nombre.length < 2) return jsonResponse({ error: 'invalid_nombre' }, 400);
    if (!sin_formulario && !EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);
    if (!UUID_RE.test(event_id)) return jsonResponse({ error: 'invalid_event_id' }, 400);

    // 2. Verificar clase con service_role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: clase, error: claseError } = await supabase
      .from('clases')
      .select('id, fecha, precio_cents, plazas_totales, plazas_ocupadas, estado, titulo, fecha_confirmada')
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

    // Fecha legible solo si la edicion tiene fecha valida; si no, la
    // descripcion del producto en Stripe no menciona el inicio.
    const claseFechaLegible = (() => {
      // Fecha provisional (fecha_confirmada = false): no se muestra.
      if (!clase.fecha || clase.fecha_confirmada === false) return null;
      const d = new Date(clase.fecha);
      if (isNaN(d.getTime())) return null;
      try {
        return new Intl.DateTimeFormat('es-ES', {
          weekday: 'long', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit', hour12: false,
          timeZone: 'Europe/Madrid'
        }).format(d);
      } catch { return null; }
    })();
    const descripcion = claseFechaLegible
      ? `4 clases en directo por Zoom, una por semana. Inicio: ${claseFechaLegible} (hora peninsular).`
      : '4 clases en directo por Zoom, una por semana.';

    // Pago unico: tarjeta (con Apple Pay / Google Pay) + Link. Sin metodos
    // a plazos. Checkout pide direccion de facturacion siempre y NIF/CIF
    // opcional (el comprador marca "compro como empresa"); con NIF el
    // webhook emite factura completa.
    // Email y telefono: visibles y obligatorios en Checkout. No se pasa
    // customer_email ni customer (ambos dejan el email prellenado pero
    // BLOQUEADO): el comprador lo escribe y puede corregirlo. El webhook usa
    // customer_details.email/.phone; los del formulario van en metadata
    // solo como referencia.
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      payment_method_types: ['card', 'link'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            // titulo solo existe en ediciones especiales (p. ej. pruebas ocultas).
            name: (clase.titulo && String(clase.titulo).trim()) || 'Intensivo Curino Partners',
            description: descripcion
          },
          unit_amount: clase.precio_cents
        },
        quantity: 1
      }],
      ...(prefill_email ? { customer_email: email } : {}),
      customer_creation: 'always',
      phone_number_collection: { enabled: true },
      consent_collection: { terms_of_service: 'required' },
      custom_text: {
        terms_of_service_acceptance: {
          message: 'Solicito recibir de inmediato el contenido del curso y el acceso al grupo, y acepto que al hacerlo pierdo mi derecho de desistimiento. Acepto las [condiciones de contratación](https://casacurino.com/partners/condiciones/).'
        }
      },
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      success_url: `${siteUrl}/partners/gracias/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/partners/#solicitud`,
      metadata: {
        purpose: 'clase',
        clase_id,
        nombre,
        telefono,
        email_formulario: email,
        // La renuncia real es la casilla de Checkout (session.consent).
        desistimiento_renunciado: 'checkout_consent',
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
    };

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(params);
    } catch (err: any) {
      // Si Link no esta activado en la cuenta, Stripe rechaza el tipo
      // 'link': reintentamos solo con tarjeta para no bloquear la venta.
      const msg = String(err?.message || '');
      if (err?.type === 'StripeInvalidRequestError' && /link/i.test(msg)) {
        console.warn('clases-checkout: link no disponible, reintento solo con card:', msg);
        session = await stripe.checkout.sessions.create({ ...params, payment_method_types: ['card'] });
      } else {
        throw err;
      }
    }

    return jsonResponse({ checkout_url: session.url, session_id: session.id }, 200);

  } catch (err: any) {
    console.error('clases-checkout error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
