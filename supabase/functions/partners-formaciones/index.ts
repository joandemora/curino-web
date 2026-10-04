// supabase/functions/partners-formaciones/index.ts
//
// Backend de /partners/formaciones (todas las formaciones) y de los enlaces
// de los emails de seguimiento. Invocada desde /api/partners-formaciones
// (anon key), que añade pais, IP y user-agent.
//
// Acciones (body.action):
//   'info'     { token? } → precios y disponibilidad. Con token valido de un
//              lead: su nombre y, si tiene la oferta de la sesion activa,
//              precio 60 € + hora de caducidad (calculado en servidor).
//   'checkout' { producto: 'sesion'|'intensivo', token?, event_id, utm_*,
//              ad_consent, fbc, fbp } → { checkout_url }. Con token: email
//              prellenado en Stripe (bloqueado). Sin token: Stripe pide los
//              datos. El precio de la sesion SIEMPRE se calcula aqui.
//   'baja'     { token } → no mas emails de seguimiento.
//
// Secrets: PARTNERS_LEAD_SECRET (token), STRIPE_SECRET_KEY, SUPABASE_ANON_KEY.
// verify_jwt=false.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import Stripe from 'https://esm.sh/stripe@17.3.0?target=deno'
import { verifyLeadToken } from '../_shared/lead-token.ts'
import { SESION, precioSesion } from '../_shared/sesion-config.ts'
import { adConsentAllowed } from '../_shared/meta-capi.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max = 480) => (v == null ? '' : String(v).trim().slice(0, max));

const SESION_TERMINOS = 'Solicito que la sesión y la entrega de los recursos iniciales comiencen de inmediato, y acepto que pierdo mi derecho de desistimiento una vez prestado el servicio. Acepto las [condiciones de contratación](https://casacurino.com/partners/condiciones/).';

// deno-lint-ignore no-explicit-any
async function intensivoInfo(supabase: any) {
  const { data: clase } = await supabase
    .from('clases')
    .select('id, precio_cents, plazas_totales, plazas_ocupadas, estado')
    .eq('tipo', 'directo').eq('oculta', false).in('estado', ['abierta', 'agotada'])
    .gt('fecha', new Date().toISOString())
    .order('fecha', { ascending: true }).limit(1).maybeSingle();
  if (!clase) return { disponible: false, clase_id: null, precio_cents: 99000, plazas_restantes: null, plazas_totales: null };
  const libres = Math.max(0, clase.plazas_totales - clase.plazas_ocupadas);
  return {
    disponible: clase.estado === 'abierta' && libres > 0,
    clase_id: clase.estado === 'abierta' ? clase.id : null,
    precio_cents: clase.precio_cents,
    plazas_restantes: libres,
    plazas_totales: clase.plazas_totales
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Baja en un clic (RFC 8058): cabecera List-Unsubscribe de los emails
    // comerciales → POST ?accion=baja&t=<token> (cuerpo form, sin JSON).
    const url = new URL(req.url);
    if (url.searchParams.get('accion') === 'baja') {
      const id = await verifyLeadToken(url.searchParams.get('t'));
      if (!id) return json({ error: 'invalid_token' }, 400);
      await supabase.from('partners_solicitudes').update({ baja_at: new Date().toISOString(), motivo_baja: 'enlace' })
        .eq('id', id).is('baja_at', null);
      return json({ ok: true });
    }
    const body = await req.json().catch(() => ({}));
    const action = str(body?.action, 12);

    // Lead (opcional) a partir del token firmado
    const leadId = await verifyLeadToken(str(body?.token, 120));
    // deno-lint-ignore no-explicit-any
    let lead: any = null;
    if (leadId) {
      const { data } = await supabase
        .from('partners_solicitudes')
        .select('id, nombre, email, telefono_prefijo, telefono, oferta_sesion_enviada_at, sesion_comprada_at, pagado_at, baja_at, utm_source, utm_medium, utm_campaign, fbclid')
        .eq('id', leadId).maybeSingle();
      lead = data;
    }

    if (action === 'info') {
      const p = precioSesion(lead?.oferta_sesion_enviada_at);
      return json({
        lead: lead ? { nombre: String(lead.nombre || '').split(' ')[0], identificado: true } : null,
        sesion: {
          // Activacion por partes: sin el flag la sesion sale como "Proximamente".
          activa: Deno.env.get('PARTNERS_SEGUIMIENTO_SESION_ACTIVO') === 'true',
          nombre: SESION.nombre,
          precio_normal_cents: SESION.precioNormalCents,
          precio_oferta_cents: SESION.precioOfertaCents,
          precio_cents: p.precio_cents,
          precio_tipo: p.precio_tipo,
          oferta_expira_at: p.oferta_expira_at,
          ahora: new Date().toISOString(),     // para corregir el reloj del navegador
          comprada: !!lead?.sesion_comprada_at
        },
        intensivo: await intensivoInfo(supabase)
      });
    }

    if (action === 'baja') {
      if (!lead) return json({ error: 'invalid_token' }, 400);
      if (!lead.baja_at) {
        await supabase.from('partners_solicitudes').update({ baja_at: new Date().toISOString(), motivo_baja: 'enlace' }).eq('id', lead.id);
      }
      return json({ ok: true });
    }

    if (action === 'checkout') {
      const producto = str(body?.producto, 12);
      const eventId = UUID_RE.test(str(body?.event_id, 64)) ? str(body?.event_id, 64) : crypto.randomUUID();
      const utm = {
        utm_source: str(body?.utm_source) || lead?.utm_source || '',
        utm_medium: str(body?.utm_medium) || lead?.utm_medium || '',
        utm_campaign: str(body?.utm_campaign) || lead?.utm_campaign || ''
      };
      const nombre = lead?.nombre ? String(lead.nombre) : '';
      const email = lead?.email ? String(lead.email) : '';
      const telefono = lead ? `${lead.telefono_prefijo || ''}${lead.telefono || ''}` : '';
      const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';
      const tokenQs = lead ? `?t=${encodeURIComponent(str(body?.token, 120))}` : '';

      if (lead) {
        await supabase.from('partners_solicitudes')
          .update({ checkout_iniciado_at: new Date().toISOString() })
          .eq('id', lead.id).is('checkout_iniciado_at', null);
      }

      if (producto === 'intensivo') {
        const info = await intensivoInfo(supabase);
        if (!info.disponible || !info.clase_id) return json({ error: 'clase_full' }, 409);
        // Reutiliza clases-checkout (misma sesion de Stripe que /partners).
        const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
        const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/clases-checkout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${anon}`, 'apikey': anon, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clase_id: info.clase_id, nombre, email, telefono, event_id: eventId,
            ...utm, solicitud_id: lead?.id || '',
            fbc: str(body?.fbc, 400), fbp: str(body?.fbp, 200),
            ad_consent: typeof body?.ad_consent === 'boolean' ? body.ad_consent : null,
            country: str(body?.country, 2), client_ip: str(body?.client_ip, 64), client_ua: str(body?.client_ua, 400),
            prefill_email: !!email,
            sin_formulario: !lead
          })
        });
        const d = await r.json().catch(() => ({}));
        return json(d, r.status);
      }

      if (producto === 'sesion') {
        if (Deno.env.get('PARTNERS_SEGUIMIENTO_SESION_ACTIVO') !== 'true') return json({ error: 'sesion_no_disponible' }, 409);
        const p = precioSesion(lead?.oferta_sesion_enviada_at);
        const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
          apiVersion: '2024-12-18.acacia', httpClient: Stripe.createFetchHttpClient()
        });
        const adConsent = typeof body?.ad_consent === 'boolean' ? body.ad_consent : null;
        const capiOk = adConsentAllowed(adConsent, str(body?.country, 2) || null);
        const params: Stripe.Checkout.SessionCreateParams = {
          mode: 'payment',
          payment_method_types: ['card', 'link'],
          line_items: [{
            price_data: {
              currency: 'eur',
              product_data: { name: SESION.nombre, description: SESION.descripcion },
              unit_amount: p.precio_cents
            },
            quantity: 1
          }],
          ...(email ? { customer_email: email } : {}),
          customer_creation: 'always',
          phone_number_collection: { enabled: true },
          billing_address_collection: 'required',
          tax_id_collection: { enabled: true },
          consent_collection: { terms_of_service: 'required' },
          custom_text: { terms_of_service_acceptance: { message: SESION_TERMINOS } },
          success_url: `${siteUrl}/partners/formaciones/gracias/?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${siteUrl}/partners/formaciones/${tokenQs}`,
          metadata: {
            purpose: 'sesion',
            solicitud_id: lead?.id || '',
            nombre, telefono, email_formulario: email,
            precio_tipo: p.precio_tipo,
            event_id: eventId,
            ...utm,
            ad_consent: adConsent === true ? 'true' : (adConsent === false ? 'false' : ''),
            country: str(body?.country, 2),
            fbc: capiOk ? str(body?.fbc, 400) : '',
            fbp: capiOk ? str(body?.fbp, 200) : '',
            client_ip: capiOk ? str(body?.client_ip, 64) : '',
            client_ua: capiOk ? str(body?.client_ua, 400) : ''
          }
        };
        let session: Stripe.Checkout.Session;
        try {
          session = await stripe.checkout.sessions.create(params);
        } catch (err: any) {
          if (err?.type === 'StripeInvalidRequestError' && /link/i.test(String(err?.message || ''))) {
            session = await stripe.checkout.sessions.create({ ...params, payment_method_types: ['card'] });
          } else { throw err; }
        }
        return json({ checkout_url: session.url, session_id: session.id, precio_cents: p.precio_cents, precio_tipo: p.precio_tipo, event_id: eventId });
      }

      return json({ error: 'invalid_producto' }, 400);
    }

    return json({ error: 'invalid_action' }, 400);
  } catch (err: any) {
    console.error('partners-formaciones error:', err);
    return json({ error: 'internal_error' }, 500);
  }
});
