// supabase/functions/create-seller-onboarding-link/index.ts
//
// Edge Function: crea (o reutiliza) una cuenta Stripe Connect Express para el
// usuario autenticado, y devuelve una URL hosted de onboarding.
//
// Input: POST sin body (la identidad va en el JWT del Authorization header)
//
// Output (200):
//   { "url": "https://connect.stripe.com/express/...", "expires_at": 1234567890 }
//
// Errores:
//   401 - no autenticado
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

    // 2. Cliente service_role para escribir en seller_accounts
    const supabaseAdminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Inicializar Stripe
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient()
    });

    // 4. Buscar si ya existe seller_account para este user
    const { data: existing, error: selectError } = await supabaseAdminClient
      .from('seller_accounts')
      .select('stripe_account_id, onboarding_status, charges_enabled')
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

      // 5b. Persistir en BD
      const { error: insertError } = await supabaseAdminClient
        .from('seller_accounts')
        .insert({
          user_id: user.id,
          stripe_account_id: stripeAccountId,
          onboarding_status: 'pending',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false
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

    // 6. Crear AccountLink (URL hosted de onboarding)
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
