// supabase/functions/create-seller-onboarding-link/index.ts
//
// Edge Function: crea (o reutiliza) una cuenta Stripe Connect Express para el
// usuario autenticado, y devuelve una URL hosted de onboarding.
//
// Input: POST con JSON body opcional:
//   { "auto_invoice_consent": true | false }
//   La identidad va en el JWT del Authorization header.
//
// Output (200):
//   { "url": "https://connect.stripe.com/express/...", "expires_at": 1234567890 }
//
// Errores:
//   401 - no autenticado
//   403 - admin de Curino (no puede tener cuenta Express)
//   500 - error de Stripe o BD

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import Stripe from 'https://esm.sh/stripe@17.3.0?target=deno'
import { corsHeaders } from '../_shared/cors.ts'

const RETURN_URL = 'https://casacurino.com/cuenta/vendedor/?onboarding=completed';
const REFRESH_URL = 'https://casacurino.com/cuenta/vendedor/?onboarding=refresh';
const TOS_URL = 'https://casacurino.com/terminos-marketplace/';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Validar auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')!;

    if (!stripeSecretKey || !stripeSecretKey.startsWith('sk_')) {
      console.error('STRIPE_SECRET_KEY missing or invalid');
      return jsonResponse({ error: 'Server configuration error' }, 500);
    }

    // Cliente con JWT del usuario para validar identidad
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseUserClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    // 2. Parse body opcional: el frontend manda auto_invoice_consent=true cuando
    //    el usuario marca el checkbox de auto-factura antes del CTA.
    const body = await req.json().catch(() => ({}));
    const autoInvoiceConsent = body?.auto_invoice_consent === true;
    const consentIp = autoInvoiceConsent ? (req.headers.get('x-forwarded-for') ?? null) : null;

    // 3. Salvaguarda: admin de Curino no puede crear cuenta Stripe Express.
    //    Curino S.L. vende sus propias piezas directamente sin Connect (caso especial admin).
    //    Si un admin quisiera vender como persona física, debe usar otra cuenta de usuario
    //    separada (otro email).
    const { data: roleData } = await supabaseUserClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (roleData?.role === 'admin') {
      return jsonResponse({
        error: 'Los administradores de Curino venden directamente sin necesidad de cuenta Stripe Express. Si quieres vender como persona física, usa una cuenta de usuario separada.'
      }, 403);
    }

    // 4. Cliente service_role para escribir en seller_accounts
    const supabaseAdminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 5. Inicializar Stripe
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient()
    });

    // 6. Buscar si ya existe seller_account para este user
    const { data: existing, error: selectError } = await supabaseAdminClient
      .from('seller_accounts')
      .select('stripe_account_id, onboarding_status, charges_enabled, auto_invoice_consent')
      .eq('user_id', user.id)
      .maybeSingle();

    if (selectError) {
      console.error('DB select error:', selectError);
      return jsonResponse({ error: 'Database error' }, 500);
    }

    let stripeAccountId: string;

    if (existing?.stripe_account_id) {
      // Reutilizar cuenta existente
      stripeAccountId = existing.stripe_account_id;

      // Persistir consentimiento si llega ahora (true) y antes era false/null.
      // Idempotente: re-marcar en BD un consentimiento ya guardado no causa daño.
      if (autoInvoiceConsent && !existing.auto_invoice_consent) {
        const { error: updateError } = await supabaseAdminClient
          .from('seller_accounts')
          .update({
            auto_invoice_consent: true,
            auto_invoice_consent_ip: consentIp
          })
          .eq('user_id', user.id);
        if (updateError) {
          console.error('DB update error (consent):', updateError);
          // No bloqueamos el flujo: el usuario puede seguir al onboarding;
          // el consentimiento se reintentará al próximo POST si vuelve.
        }
      }
    } else {
      // 5a. Crear cuenta Stripe Express nueva
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        business_type: 'individual',  // El usuario lo puede cambiar en el onboarding
        metadata: {
          curino_user_id: user.id
        },
        tos_acceptance: {
          service_agreement: 'full'
        },
        settings: {
          payouts: {
            schedule: { interval: 'daily' }
          }
        }
      });

      stripeAccountId = account.id;

      // 5b. Persistir en BD (incluye consentimiento de auto-factura si fue marcado)
      const { error: insertError } = await supabaseAdminClient
        .from('seller_accounts')
        .insert({
          user_id: user.id,
          stripe_account_id: stripeAccountId,
          onboarding_status: 'pending',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          auto_invoice_consent: autoInvoiceConsent,
          auto_invoice_consent_ip: consentIp
        });

      if (insertError) {
        console.error('DB insert error:', insertError);
        // Importante: si falla el insert pero la cuenta Stripe ya se creó,
        // queda huérfana. Stripe no permite borrar cuentas Express vía API
        // si tienen actividad, pero es seguro intentarlo aquí porque está vacía.
        try {
          await stripe.accounts.del(stripeAccountId);
        } catch (_) {}
        return jsonResponse({ error: 'Failed to persist seller account' }, 500);
      }
    }

    // 7. Crear AccountLink (URL hosted de onboarding)
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      return_url: RETURN_URL,
      refresh_url: REFRESH_URL,
      type: 'account_onboarding',
      collection_options: {
        fields: 'eventually_due'
      }
    });

    return jsonResponse({
      url: accountLink.url,
      expires_at: accountLink.expires_at
    });

  } catch (err: any) {
    console.error('Unexpected error:', err);
    const msg = err?.message || 'Internal server error';
    return jsonResponse({ error: msg }, 500);
  }
});

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
