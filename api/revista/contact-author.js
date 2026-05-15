// /api/revista/contact-author.js
//
// Edge Function de Vercel que recibe el formulario de contacto del
// detalle de artículo y lo reenvía a la Edge Function de Supabase
// magazine-relay-contact (que tiene service_role para leer
// author_contact_email — campo privado no expuesto en la vista pública).
//
// Esta capa intermedia evita exponer el ANON KEY o forzar al usuario
// a un dominio distinto; el formulario hace POST a esta ruta del mismo
// origen y nosotros hacemos el server-to-server con la anon key.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

export default async function handler(request) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { article_id, sender_name, sender_email, message } = body || {};
  if (!article_id || !sender_name || !sender_email || !message) {
    return jsonResponse({ error: 'missing_fields' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender_email)) {
    return jsonResponse({ error: 'invalid_email' }, 400);
  }
  if (String(message).length > 5000 || String(sender_name).length > 200) {
    return jsonResponse({ error: 'too_long' }, 400);
  }

  try {
    const relayRes = await fetch(`${SUPABASE_URL}/functions/v1/magazine-relay-contact`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ article_id, sender_name, sender_email, message })
    });

    const data = await relayRes.json().catch(() => ({}));
    return jsonResponse(data, relayRes.status);
  } catch (err) {
    console.error('contact-author relay error', err);
    return jsonResponse({ error: 'relay_failed' }, 500);
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
