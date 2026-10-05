// /api/partners-solicitud.js
//
// Proxy Vercel Edge → Supabase Edge Function `partners-solicitud`
// (formulario multipaso de /partners/). Encapsula la URL de la function y
// la anon key, y añade pais (x-vercel-ip-country), IP y user-agent del
// visitante para el rate limit y el Lead por CAPI. La validacion completa
// vive en la Edge Function; aqui solo se filtra lo grosero.
//
// Ocupa el slot de la antigua /api/curso-checkout (curso de 90 EUR
// retirado en 2026-10) para no sumar rutas al cap de Vercel.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const ACTIONS = new Set(['start', 'step', 'cta', 'evento', 'fallo']);

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
  if (request.method === 'OPTIONS') return jsonResponse(null, 200);
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  if (!SUPABASE_ANON_KEY) {
    console.error('partners-solicitud: SUPABASE_ANON_KEY missing');
    return jsonResponse({ error: 'server_not_configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  if (!body || typeof body !== 'object' || !ACTIONS.has(body.action)) {
    return jsonResponse({ error: 'invalid_action' }, 400);
  }

  // Campos de servidor: nunca se aceptan del cliente.
  const forwarded = {
    ...body,
    country: String(request.headers.get('x-vercel-ip-country') || '').slice(0, 2),
    client_ip: String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64),
    client_ua: String(request.headers.get('user-agent') || '').slice(0, 500)
  };

  try {
    const upstream = await fetch(`${SUPABASE_URL}/functions/v1/partners-solicitud`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(forwarded)
    });
    const data = await upstream.json().catch(() => ({}));
    return jsonResponse(data, upstream.status);
  } catch (err) {
    console.error('partners-solicitud proxy error:', err);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
}
