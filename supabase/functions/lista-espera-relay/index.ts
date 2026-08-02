// supabase/functions/lista-espera-relay/index.ts
//
// Edge Function: captura email para lista de espera cuando no hay clase
// abierta. Se invoca server-to-server desde /api/lista-espera.js.
//
// Hardening:
//   - Honeypot: campo `website` debe venir vacio o ausente.
//   - Rate limit trivial: max 3 inserts por hash IP en la ultima hora.
//   - Email regex basica.
//   - No confirma ni envia email al usuario para no revelar existencia
//     del sistema anti-spam.
//
// verify_jwt=false (invocado desde el proxy Vercel con anon key).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('lista-espera-relay: missing env');
      return jsonResponse({ error: 'server_misconfigured' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase().slice(0, 200);
    const website = String(body?.website || '').trim();  // honeypot
    const userAgent = String(req.headers.get('user-agent') || '').slice(0, 500);
    const clientIp = String(
      req.headers.get('x-forwarded-for') ||
      req.headers.get('x-real-ip') ||
      ''
    ).split(',')[0].trim();

    // Honeypot: si `website` viene relleno, devolvemos ok silencioso
    // para no dar pistas al bot (pero no insertamos nada).
    if (website.length > 0) {
      console.log('lista-espera-relay: honeypot triggered');
      return jsonResponse({ ok: true }, 200);
    }

    if (!EMAIL_RE.test(email)) {
      return jsonResponse({ error: 'invalid_email' }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const ipHash = clientIp ? await sha256(clientIp) : null;

    // Rate limit: >3 inserts desde la misma IP en la ultima hora → rechazo
    if (ipHash) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('lista_espera')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', oneHourAgo);
      if ((count ?? 0) >= 3) {
        return jsonResponse({ error: 'rate_limited' }, 429);
      }
    }

    const { error: insertError } = await supabase
      .from('lista_espera')
      .insert({ email, ip_hash: ipHash, user_agent: userAgent });

    if (insertError) {
      console.error('lista-espera-relay: insert failed', insertError);
      return jsonResponse({ error: 'internal_error' }, 500);
    }

    return jsonResponse({ ok: true }, 200);

  } catch (err: any) {
    console.error('lista-espera-relay error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
