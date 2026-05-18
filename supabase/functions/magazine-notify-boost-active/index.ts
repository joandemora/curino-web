// supabase/functions/magazine-notify-boost-active/index.ts
//
// Envía email al autor cuando un boost en cola pasa a 'active' tras
// activate_boost_queue(). Recibe { boost_ids: uuid[] }.
//
// No requiere user logueado: lo llama el frontend público fire-and-forget
// tras la activación lazy con anon key. Para evitar duplicados de email
// si dos visitas casi simultáneas disparan la misma activación,
// solo manda email a boosts cuyo starts_at >= now() - 5 min (spec G4).

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

const ARTICLE_TYPE_LABELS: Record<string, string> = {
  proyecto: 'Proyectos', material: 'Materiales', articulo: 'Artículos',
  noticia: 'Noticias', entrevista: 'Entrevistas'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') || 'https://casacurino.com';

    const { boost_ids } = await req.json().catch(() => ({}));
    if (!Array.isArray(boost_ids) || boost_ids.length === 0) {
      return jsonResponse({ error: 'invalid_boost_ids' }, 400);
    }
    // Limitar tamaño defensivo
    const ids = boost_ids.slice(0, 100);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: boosts, error } = await supabase
      .from('magazine_boosts')
      .select('id, type, status, starts_at, ends_at, article_id, magazine_articles!inner(title, type, slug, author_first_name, author_contact_email)')
      .in('id', ids);
    if (error) {
      console.error('notify-boost-active: query error', error);
      return jsonResponse({ error: 'query_failed' }, 500);
    }

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    let sent = 0;
    const errors: string[] = [];

    for (const b of (boosts || []) as any[]) {
      if (b.status !== 'active') continue;
      if (!b.starts_at || new Date(b.starts_at).getTime() < fiveMinAgo) continue;
      const article = b.magazine_articles;
      if (!article || !article.author_contact_email) continue;

      const typeLabel = b.type === 'main_page' ? 'Página principal' : 'Portada de sección';
      const zoneLabel = b.type === 'main_page'
        ? 'la página principal de Revista'
        : `la portada de ${ARTICLE_TYPE_LABELS[article.type] || article.type}`;
      const endsAtLabel = b.ends_at ? new Date(b.ends_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
      const firstName = article.author_first_name || 'autor/a';

      const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Tu boost está activo</h2>
  <p>Hola ${escapeHtml(firstName)},</p>
  <p>Tu boost <strong>${escapeHtml(typeLabel)}</strong> ya está promocionando tu artículo <strong>${escapeHtml(article.title)}</strong> en ${escapeHtml(zoneLabel)} hasta el ${endsAtLabel}.</p>
  <p><a href="${siteUrl}/mi-cuenta/revista/" style="display: inline-block; background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Ver mis publicaciones</a></p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">SISTEMA &amp; CURINO SLU — Este email es automático, no responder.</p>
</body>
</html>`;

      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Curino <noreply@casacurino.com>',
            to: [article.author_contact_email],
            subject: `Tu boost está activo — ${article.title}`,
            html
          })
        });
        if (resp.ok) sent++;
        else errors.push(`${b.id}: ${resp.status}`);
      } catch (e: any) {
        errors.push(`${b.id}: ${e?.message || 'error'}`);
      }
    }

    return jsonResponse({ ok: true, sent, total: boosts?.length || 0, errors: errors.length ? errors : undefined });

  } catch (err: any) {
    console.error('magazine-notify-boost-active error:', err);
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
