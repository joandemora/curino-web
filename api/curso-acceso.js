// /api/curso-acceso.js
//
// Proxy Vercel Edge → Supabase Edge Function `curso-acceso`.
// Recibe { token } de la página /partners/acceso/?t=<token>.
// La Edge Function siempre devuelve HTTP 200 (nunca 404 al
// usuario); el body dice { ok: true | false } y la página lo pinta.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// base64url: [A-Za-z0-9_-], 43 chars = 32 bytes.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

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
    console.error('curso-acceso: SUPABASE_ANON_KEY missing');
    return jsonResponse({ ok: false, error: 'server_not_configured' }, 200);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_token' }, 200);
  }

  const token = String(body?.token || '').trim();
  if (!TOKEN_RE.test(token)) {
    return jsonResponse({ ok: false, error: 'invalid_token' }, 200);
  }

  try {
    const upstream = await fetch(`${SUPABASE_URL}/functions/v1/curso-acceso`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token })
    });
    const data = await upstream.json().catch(() => ({ ok: false, error: 'invalid_token' }));
    return jsonResponse(data, 200);
  } catch (err) {
    console.error('curso-acceso proxy error:', err);
    return jsonResponse({ ok: false, error: 'internal_error' }, 200);
  }
}
