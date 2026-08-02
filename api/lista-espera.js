// /api/lista-espera.js
//
// Proxy Vercel Edge → Supabase Edge Function `lista-espera-relay`.
// Reenvía el email y el user-agent + IP para que la Edge haga rate
// limit y honeypot check.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    console.error('lista-espera: SUPABASE_ANON_KEY missing');
    return jsonResponse({ error: 'server_not_configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const email = String(body?.email || '').trim().toLowerCase().slice(0, 200);
  const website = String(body?.website || '');

  if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);

  // Reenvía IP y UA para que la Edge Function haga rate limit
  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const realIp = request.headers.get('x-real-ip') || '';
  const userAgent = request.headers.get('user-agent') || '';

  try {
    const upstream = await fetch(`${SUPABASE_URL}/functions/v1/lista-espera-relay`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'X-Forwarded-For': forwardedFor,
        'X-Real-IP': realIp,
        'User-Agent': userAgent
      },
      body: JSON.stringify({ email, website })
    });
    const data = await upstream.json().catch(() => ({}));
    return jsonResponse(data, upstream.status);
  } catch (err) {
    console.error('lista-espera proxy error:', err);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
}
