// supabase/functions/magazine-relay-contact/index.ts
//
// Recibe POST con { article_id, sender_name, sender_email, message }
// desde la Vercel Edge Function /api/revista/contact-author.
// Carga el artículo con service_role para acceder a author_contact_email
// (campo privado no expuesto en la vista pública), envía dos emails Resend:
//   1) al autor con el mensaje del lector y reply-to = sender_email
//   2) confirmación al sender_email
//
// No requiere user logueado: el público lee el detalle del artículo sin
// auth y debe poder escribir al autor. La anon key del Authorization
// header es suficiente para que Supabase deje pasar la invocación.

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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';

    const { article_id, sender_name, sender_email, message } = await req.json().catch(() => ({}));

    if (!article_id || !sender_name || !sender_email || !message) {
      return jsonResponse({ error: 'missing_fields' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender_email)) {
      return jsonResponse({ error: 'invalid_email' }, 400);
    }
    if (String(message).length > 5000 || String(sender_name).length > 200) {
      return jsonResponse({ error: 'too_long' }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: article } = await supabase
      .from('magazine_articles')
      .select('id, title, slug, type, author_first_name, author_contact_email, status')
      .eq('id', article_id)
      .maybeSingle();

    if (!article) return jsonResponse({ error: 'article_not_found' }, 404);
    if (article.status !== 'published') {
      return jsonResponse({ error: 'article_not_available' }, 400);
    }
    if (!article.author_contact_email) {
      return jsonResponse({ error: 'author_email_missing' }, 400);
    }

    const seccionMap: Record<string, string> = {
      proyecto: 'proyectos', material: 'materiales', articulo: 'articulos',
      noticia: 'noticias', entrevista: 'entrevistas'
    };
    const seccion = seccionMap[article.type] || article.type;
    const articleUrl = `${siteUrl}/revista/${seccion}/${article.slug}/`;

    const messageHtml = escapeHtml(message).replace(/\n/g, '<br>');
    const authorName = article.author_first_name || 'autor/a';

    // Email 1: al autor (con reply-to = sender_email para que pueda responder directamente)
    const toAuthorHtml = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Nuevo mensaje desde tu artículo en Curino Revista</h2>
  <p>Hola ${escapeHtml(authorName)},</p>
  <p>Has recibido un mensaje de un lector sobre tu artículo <a href="${articleUrl}"><strong>${escapeHtml(article.title)}</strong></a>:</p>
  <table cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;width:100%;background:#f6f5ee;border-radius:8px">
    <tr><td style="padding:18px 22px">
      <p style="margin:0 0 6px;font-size:13px;color:#666"><strong>De:</strong> ${escapeHtml(sender_name)} &lt;${escapeHtml(sender_email)}&gt;</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:12px 0">
      <p style="margin:0;font-size:15px;line-height:1.6;color:#222">${messageHtml}</p>
    </td></tr>
  </table>
  <p>Para responderle, simplemente <strong>responde a este email</strong> — llegará directamente a su buzón.</p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">SISTEMA &amp; CURINO SLU — Equipo Curino.</p>
</body>
</html>`;

    const r1 = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Curino Revista <noreply@casacurino.com>',
        to: [article.author_contact_email],
        reply_to: sender_email,
        subject: `Nuevo mensaje sobre "${article.title}" — Curino Revista`,
        html: toAuthorHtml
      })
    });

    if (!r1.ok) {
      const t = await r1.text();
      console.error('Resend (to author) error:', r1.status, t);
      return jsonResponse({ error: 'email_to_author_failed', detail: t }, 500);
    }

    // Email 2: confirmación al sender (no bloqueante — si falla, igualmente devolvemos ok)
    const toSenderHtml = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Tu mensaje ha sido enviado</h2>
  <p>Hola ${escapeHtml(sender_name)},</p>
  <p>Hemos reenviado tu mensaje a ${escapeHtml(authorName)} sobre el artículo <a href="${articleUrl}"><strong>${escapeHtml(article.title)}</strong></a>. Te contactará directamente si lo considera oportuno.</p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">SISTEMA &amp; CURINO SLU — Este email es automático, no responder.</p>
</body>
</html>`;

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Curino Revista <noreply@casacurino.com>',
          to: [sender_email],
          subject: 'Tu mensaje ha sido enviado — Curino Revista',
          html: toSenderHtml
        })
      });
    } catch (e) {
      console.error('Resend (to sender) failed (non-blocking):', e);
    }

    return jsonResponse({ ok: true });

  } catch (err: any) {
    console.error('magazine-relay-contact error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});

function escapeHtml(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
