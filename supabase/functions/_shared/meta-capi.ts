// supabase/functions/_shared/meta-capi.ts
//
// Envio server-side de eventos a Meta Conversions API (CAPI).
// Complementa los tags del Pixel que viven en GTM (GTM-NZR7NNTC):
// el navegador y el servidor mandan el mismo `event_id` y Meta
// deduplica por (event_name, event_id).
//
// No-op silencioso si falta el secret META_CAPI_TOKEN: el codigo puede
// desplegarse antes de tener el token y no rompe nada.
//
// Secrets (dashboard Supabase → Edge Functions → Secrets):
//   META_CAPI_TOKEN        token de acceso del dataset (obligatorio)
//   META_PIXEL_ID          por defecto 31730930696551488
//   META_TEST_EVENT_CODE   opcional, para validar en "Probar eventos"
//   META_GRAPH_VERSION     opcional, por defecto v23.0
//
// Consentimiento: se replica el Consent Mode v2 de la web. Solo se envia
// si el usuario acepto publicidad (ad_consent=true) o si no hay decision
// y el pais NO esta en la region con default denied (EEE+UK+CH).

const DENIED_BY_DEFAULT = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO',
  'GB','CH'
]);

export function adConsentAllowed(adConsent: boolean | null, country: string | null): boolean {
  if (adConsent === true) return true;
  if (adConsent === false) return false;
  // Sin decision: default granted fuera de la region; sin pais → denied.
  return !!country && !DENIED_BY_DEFAULT.has(country.toUpperCase());
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface MetaEvent {
  eventName: 'Lead' | 'Purchase' | 'InitiateCheckout' | 'Contact';
  eventId: string;
  eventSourceUrl: string;
  email?: string | null;
  phone?: string | null;      // E.164 o digitos con prefijo pais
  firstName?: string | null;
  country?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  clientIp?: string | null;
  clientUa?: string | null;
  customData?: Record<string, unknown>;
}

export async function sendMetaEvent(ev: MetaEvent): Promise<void> {
  const token = Deno.env.get('META_CAPI_TOKEN');
  if (!token) return;
  const pixelId = Deno.env.get('META_PIXEL_ID') || '31730930696551488';
  const version = Deno.env.get('META_GRAPH_VERSION') || 'v23.0';
  const testCode = Deno.env.get('META_TEST_EVENT_CODE');

  const userData: Record<string, unknown> = {};
  if (ev.email) userData.em = [await sha256(ev.email.trim().toLowerCase())];
  const phoneDigits = (ev.phone || '').replace(/\D/g, '');
  if (phoneDigits) userData.ph = [await sha256(phoneDigits)];
  const fn = (ev.firstName || '').trim().split(/\s+/)[0]?.toLowerCase();
  if (fn) userData.fn = [await sha256(fn)];
  if (ev.country) userData.country = [await sha256(ev.country.toLowerCase())];
  if (ev.fbc) userData.fbc = ev.fbc;
  if (ev.fbp) userData.fbp = ev.fbp;
  if (ev.clientIp) userData.client_ip_address = ev.clientIp;
  if (ev.clientUa) userData.client_user_agent = ev.clientUa;

  const payload: Record<string, unknown> = {
    data: [{
      event_name: ev.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: ev.eventId,
      action_source: 'website',
      event_source_url: ev.eventSourceUrl,
      user_data: userData,
      custom_data: ev.customData || {}
    }]
  };
  if (testCode) payload.test_event_code = testCode;

  const res = await fetch(
    `https://graph.facebook.com/${version}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  if (!res.ok) {
    console.error('meta-capi: error', ev.eventName, res.status, await res.text());
  }
}
