// supabase/functions/notify-takedown/index.ts
//
// Envía email al seller cuando admin hace takedown de su pieza.
// Llamada desde el frontend admin tras resolve_report con action='takedown'.

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

    // Auth: requiere user admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'auth_required' }, 401);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: 'auth_required' }, 401);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (roleData?.role !== 'admin') return jsonResponse({ error: 'admin_only' }, 403);

    const { item_id, reason, admin_notes } = await req.json().catch(() => ({}));
    if (!item_id) return jsonResponse({ error: 'invalid_item_id' }, 400);

    // Cargar pieza
    const { data: item } = await supabase
      .from('library_items')
      .select('id, name, seller_id')
      .eq('id', item_id)
      .maybeSingle();
    if (!item) return jsonResponse({ error: 'item_not_found' }, 404);

    // Cargar email del seller
    const { data: sellerAuth } = await (supabase.auth as any).admin.getUserById(item.seller_id);
    const sellerEmail = sellerAuth?.user?.email;
    if (!sellerEmail) return jsonResponse({ error: 'seller_email_not_found' }, 404);

    // Mapeo de razones a texto legible
    const reasonLabels: Record<string, string> = {
      copyright: 'Infracción de copyright',
      inappropriate: 'Contenido inapropiado',
      incorrect_info: 'Información incorrecta',
      other: 'Otra razón'
    };
    const reasonLabel = reasonLabels[reason] || reason;

    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Pieza retirada del marketplace</h2>
  <p>Hola,</p>
  <p>Tu pieza <strong>${item.name}</strong> ha sido retirada del marketplace de Curino tras la revisión de un report.</p>
  <p><strong>Motivo:</strong> ${reasonLabel}</p>
  ${admin_notes ? `<p><strong>Notas del equipo:</strong> ${admin_notes}</p>` : ''}
  <p>Si crees que es un error o quieres más información, contacta con nosotros respondiendo a este email o escribiendo a <a href="mailto:hola@casacurino.com">hola@casacurino.com</a>.</p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">SISTEMA & CURINO SLU — Equipo Curino.</p>
</body>
</html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Curino <noreply@casacurino.com>',
        to: [sellerEmail],
        subject: `Pieza retirada del marketplace — ${item.name}`,
        html
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Resend error:', response.status, text);
      return jsonResponse({ error: 'email_send_failed', detail: text }, 500);
    }

    return jsonResponse({ ok: true, sent_to: sellerEmail }, 200);

  } catch (err: any) {
    console.error('notify-takedown error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
