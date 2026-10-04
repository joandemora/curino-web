// /api/clases-checkout.js
//
// Proxy Vercel Edge → Supabase Edge Function `clases-checkout`.
// Encapsula la URL de la function y la anon key para el frontend.
// Valida el body en Node antes de reenviar (defensa en profundidad).
// Añade pais (x-vercel-ip-country), IP y user-agent del comprador para
// el Purchase por CAPI que manda stripe-webhook (solo con ad_consent).

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function trim(v, max = 480) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  if (!SUPABASE_ANON_KEY) {
    console.error('clases-checkout: SUPABASE_ANON_KEY missing');
    return jsonResponse({ error: 'server_not_configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const clase_id = trim(body?.clase_id, 64);
  const nombre = trim(body?.nombre, 120);
  const email = trim(body?.email, 200).toLowerCase();
  const telefono = trim(body?.telefono, 40);
  const event_id = trim(body?.event_id, 64);
  const utm_source = trim(body?.utm_source);
  const utm_medium = trim(body?.utm_medium);
  const utm_campaign = trim(body?.utm_campaign);
  const solicitud_id = trim(body?.solicitud_id, 64);
  const fbc = trim(body?.fbc, 400);
  const fbp = trim(body?.fbp, 200);
  const ad_consent = typeof body?.ad_consent === 'boolean' ? body.ad_consent : null;
  const country = trim(request.headers.get('x-vercel-ip-country'), 2);
  const client_ip = trim((request.headers.get('x-forwarded-for') || '').split(',')[0], 64);
  const client_ua = trim(request.headers.get('user-agent'), 400);

  if (!UUID_RE.test(clase_id)) return jsonResponse({ error: 'invalid_clase_id' }, 400);
  if (nombre.length < 2) return jsonResponse({ error: 'invalid_nombre' }, 400);
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);
  if (!UUID_RE.test(event_id)) return jsonResponse({ error: 'invalid_event_id' }, 400);

  try {
    const upstream = await fetch(`${SUPABASE_URL}/functions/v1/clases-checkout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clase_id, nombre, email, telefono,
        event_id, utm_source, utm_medium, utm_campaign,
        solicitud_id, fbc, fbp, ad_consent, country, client_ip, client_ua
      })
    });

    const data = await upstream.json().catch(() => ({}));
    return jsonResponse(data, upstream.status);
  } catch (err) {
    console.error('clases-checkout proxy error:', err);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
}
