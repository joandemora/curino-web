// supabase/functions/presupuesto-form-relay/index.ts
//
// Recibe POST con los datos validados de una solicitud de presupuesto
// (ya insertada en la tabla presupuesto_solicitudes por el endpoint
// Vercel /api/solicitar-presupuesto) y envía dos emails Resend:
//   1) a info@casacurino.com con todos los datos del formulario y signed
//      URLs de los adjuntos
//   2) confirmación al solicitante (no bloqueante)
//
// Patrón replicado de magazine-relay-contact: el secreto RESEND_API_KEY
// vive aquí (Deno.env), no en Vercel.
//
// Payload esperado:
//   {
//     id: string (uuid de la solicitud ya insertada),
//     nombre, email, telefono, tipo_proyecto, mensaje,
//     archivos: [{ name, signed_url, size, type }]
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const TIPO_PROYECTO_LABELS: Record<string, string> = {
  'cocina': 'Cocina',
  'armarios-vestidores': 'Armarios y vestidores',
  'bano': 'Baño',
  'integral': 'Proyecto integral',
  'otro': 'Otro'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function escapeHtml(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('RESEND_API_KEY missing in environment');
      return jsonResponse({ error: 'resend_not_configured' }, 500);
    }

    const payload = await req.json().catch(() => ({}));
    const {
      id,
      nombre,
      email,
      telefono,
      tipo_proyecto,
      mensaje,
      archivos
    } = payload || {};

    if (!nombre || !email) {
      return jsonResponse({ error: 'missing_fields' }, 400);
    }

    const safeNombre = escapeHtml(String(nombre));
    const safeEmail = escapeHtml(String(email));
    const safeTel = telefono ? escapeHtml(String(telefono)) : '—';
    const tipoLabel = tipo_proyecto && TIPO_PROYECTO_LABELS[tipo_proyecto]
      ? TIPO_PROYECTO_LABELS[tipo_proyecto]
      : (tipo_proyecto ? escapeHtml(String(tipo_proyecto)) : '—');
    const safeMensaje = mensaje
      ? escapeHtml(String(mensaje)).replace(/\n/g, '<br>')
      : '<em>(Sin mensaje)</em>';

    const adjuntosList = Array.isArray(archivos) ? archivos : [];
    const adjuntosHtml = adjuntosList.length === 0
      ? '<p style="margin:0;color:#888">Sin adjuntos.</p>'
      : '<ul style="margin:0;padding-left:1.2rem">' + adjuntosList.map((a: any) => {
          const name = escapeHtml(String(a?.name || 'archivo'));
          const url = String(a?.signed_url || '#');
          const sizeKb = a?.size ? Math.round(Number(a.size) / 1024) + ' KB' : '';
          return `<li style="margin-bottom:.4rem"><a href="${url}" target="_blank" rel="noopener" style="color:#cc785c">${name}</a>${sizeKb ? ` <span style="color:#888;font-size:12px">(${sizeKb})</span>` : ''}</li>`;
        }).join('') + '</ul>';

    // ── Email 1: a info@casacurino.com ─────────────────────────────────────
    const adminHtml = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #222;">
  <h2 style="margin:0 0 8px;color:#000">Nueva solicitud de presupuesto</h2>
  <p style="margin:0 0 18px;color:#666;font-size:13px">Recibida desde /solicitar-presupuesto/ — ID: ${escapeHtml(String(id || '—'))}</p>

  <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f6f5ee;border-radius:8px;margin-bottom:18px">
    <tr><td style="padding:18px 22px">
      <p style="margin:0 0 8px"><strong>Nombre:</strong> ${safeNombre}</p>
      <p style="margin:0 0 8px"><strong>Email:</strong> <a href="mailto:${safeEmail}" style="color:#cc785c">${safeEmail}</a></p>
      <p style="margin:0 0 8px"><strong>Teléfono:</strong> ${safeTel}</p>
      <p style="margin:0 0 8px"><strong>Tipo de proyecto:</strong> ${tipoLabel}</p>
    </td></tr>
  </table>

  <h3 style="margin:0 0 8px;font-size:14px;color:#000;text-transform:uppercase;letter-spacing:.08em">Mensaje</h3>
  <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:16px;margin-bottom:18px;font-size:15px;line-height:1.6">
    ${safeMensaje}
  </div>

  <h3 style="margin:0 0 8px;font-size:14px;color:#000;text-transform:uppercase;letter-spacing:.08em">Adjuntos</h3>
  ${adjuntosHtml}

  <p style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;color:#888;font-size:12px">
    Las URLs de adjuntos caducan en 7 días. Para gestionar la solicitud entra a la tabla
    <code>presupuesto_solicitudes</code> (Supabase).
  </p>

  <p style="font-size:12px;color:#888;margin-top:12px">SISTEMA &amp; CURINO SLU — Notificación automática.</p>
</body>
</html>`;

    const r1 = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Curino — Solicitudes <noreply@casacurino.com>',
        to: ['info@casacurino.com'],
        reply_to: String(email),
        subject: `Nueva solicitud de presupuesto — ${nombre}`,
        html: adminHtml
      })
    });

    if (!r1.ok) {
      const t = await r1.text();
      console.error('Resend (admin) error:', r1.status, t);
      return jsonResponse({ error: 'email_to_admin_failed', detail: t }, 500);
    }

    // ── Email 2: confirmación al solicitante (no bloqueante) ───────────────
    const confirmHtml = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #222;">
  <h2 style="margin:0 0 12px;color:#000">Hemos recibido tu solicitud</h2>
  <p>Hola ${safeNombre},</p>
  <p>Gracias por contactar con <strong>Curino</strong>. Hemos recibido tu solicitud de presupuesto y nuestro equipo la revisará en breve. Te contactaremos en los próximos días laborables para concretar una visita técnica o resolver cualquier duda.</p>
  <p>Si necesitas añadir información, puedes responder a este email directamente.</p>
  <p style="margin-top:24px">— Equipo Curino</p>
  <p style="font-size:12px;color:#888;margin-top:24px;padding-top:12px;border-top:1px solid #eee">
    SISTEMA &amp; CURINO SLU — Este email es automático.
  </p>
</body>
</html>`;

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Curino <noreply@casacurino.com>',
          to: [String(email)],
          subject: 'Hemos recibido tu solicitud — Curino',
          html: confirmHtml
        })
      });
    } catch (e) {
      console.error('Resend (confirmation) failed (non-blocking):', e);
    }

    return jsonResponse({ ok: true });

  } catch (err: any) {
    console.error('presupuesto-form-relay error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
