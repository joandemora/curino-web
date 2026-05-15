// supabase/functions/magazine-notify-published/index.ts
//
// Envía email al autor cuando el admin publica su artículo en Revista Curino.
// Llamada desde /admin/revista/moderacion/ tras publish_magazine_article.
//
// No re-valida admin: el panel ya lo hizo y el RPC publish_magazine_article
// requiere admin. Esta función solo orquesta el email.

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';

    // Auth: requiere user con sesión (el panel admin antes ya validó rol).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'auth_required' }, 401);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: 'auth_required' }, 401);

    const { article_id } = await req.json().catch(() => ({}));
    if (!article_id) return jsonResponse({ error: 'invalid_article_id' }, 400);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cargar artículo con todos los campos relevantes.
    const { data: article } = await supabase
      .from('magazine_articles')
      .select('id, title, slug, type, author_first_name, author_contact_email, status')
      .eq('id', article_id)
      .maybeSingle();

    if (!article) return jsonResponse({ error: 'article_not_found' }, 404);
    if (article.status !== 'published') {
      return jsonResponse({ error: 'article_not_published', detail: 'status: ' + article.status }, 400);
    }

    const recipient = article.author_contact_email;
    if (!recipient) return jsonResponse({ error: 'author_email_missing' }, 400);

    const firstName = article.author_first_name || 'autor/a';
    const articleUrl = `${siteUrl}/revista/${encodeURIComponent(article.type)}/${encodeURIComponent(article.slug || article.id)}/`;

    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Tu artículo ya está publicado</h2>
  <p>Hola ${firstName},</p>
  <p>Tu artículo <strong>${article.title}</strong> ya está disponible en Curino Revista.</p>
  <p><a href="${articleUrl}" style="display: inline-block; background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Ver artículo</a></p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">Si tienes preguntas, contáctanos en <a href="mailto:info@casacurino.com">info@casacurino.com</a>.</p>
  <p style="font-size: 12px; color: #888;">SISTEMA &amp; CURINO SLU — Equipo Curino.</p>
</body>
</html>`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Curino <noreply@casacurino.com>',
        to: [recipient],
        subject: `Tu artículo en Curino Revista ya está publicado — ${article.title}`,
        html
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Resend error:', resp.status, text);
      return jsonResponse({ error: 'email_send_failed', detail: text }, 500);
    }

    return jsonResponse({ ok: true, sent_to: recipient }, 200);

  } catch (err: any) {
    console.error('magazine-notify-published error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
