// /api/clases-checkout.js
//
// Proxy Vercel Edge → Supabase Edge Function `clases-checkout`.
// Encapsula la URL de la function y la anon key para el frontend.
// Valida el body en Node antes de reenviar (defensa en profundidad).

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
  const desistimiento_renunciado = body?.desistimiento_renunciado === true;
  const event_id = trim(body?.event_id, 64);
  const utm_source = trim(body?.utm_source);
  const utm_medium = trim(body?.utm_medium);
  const utm_campaign = trim(body?.utm_campaign);

  if (!UUID_RE.test(clase_id)) return jsonResponse({ error: 'invalid_clase_id' }, 400);
  if (nombre.length < 2) return jsonResponse({ error: 'invalid_nombre' }, 400);
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);
  if (!desistimiento_renunciado) return jsonResponse({ error: 'desistimiento_required' }, 400);
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
        desistimiento_renunciado: true,
        event_id, utm_source, utm_medium, utm_campaign
      })
    });

    const data = await upstream.json().catch(() => ({}));
    return jsonResponse(data, upstream.status);
  } catch (err) {
    console.error('clases-checkout proxy error:', err);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
}
