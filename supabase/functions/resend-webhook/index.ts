// supabase/functions/resend-webhook/index.ts
//
// Webhook de Resend (estado de los emails). Firma Svix verificada con el
// secret RESEND_WEBHOOK_SECRET ("whsec_…", lo da Resend al crear el webhook).
//
// - email.delivered        → partners_emails.estado = 'entregado'
// - email.delivery_delayed → 'retrasado'
// - email.opened           → 'abierto' + abierto_at (si Resend lo envia)
// - email.clicked          → clicado_at (no cambia el estado; requiere el
//                            seguimiento de clics activado en Resend)
// - email.bounced          → 'rebotado'; si es permanente, baja del contacto
//                            (partners_solicitudes.baja_at + motivo 'rebote')
// - email.complained       → 'queja' + baja del contacto (motivo 'queja')
// La baja por rebote/queja aplica a cualquier email del dominio (tambien
// confirmaciones, secuencia…), porque el destinatario no es valido o no
// quiere recibir correo. Corta comerciales Y de servicio.
// La cuenta de Resend tambien envia emails de otros dominios (tikout.io): los
// eventos cuyo remitente no es @casacurino.com se ignoran con 200 (sin error
// ni reintentos) y nunca dan de baja a nadie.
// verify_jwt=false (Resend no manda JWT).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const enc = new TextEncoder();
function b64ToBytes(b64: string) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
async function firmaValida(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const id = req.headers.get('svix-id'), ts = req.headers.get('svix-timestamp'), sig = req.headers.get('svix-signature');
  if (!secret || !id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // 5 min
  const key = await crypto.subtle.importKey('raw', b64ToBytes(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${ts}.${body}`)));
  let bin = ''; for (const b of mac) bin += String.fromCharCode(b);
  const esperado = btoa(bin);
  return sig.split(' ').some((p) => p.split(',')[1] === esperado);
}

const ORDEN: Record<string, number> = { enviado: 0, retrasado: 1, entregado: 2, abierto: 3, rebotado: 4, queja: 5, error: 5 };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const body = await req.text();
  if (!(await firmaValida(req, body))) return new Response('invalid signature', { status: 401 });
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // deno-lint-ignore no-explicit-any
  let ev: any;
  try { ev = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }
  const tipo = String(ev?.type || '');
  const d = ev?.data || {};
  // Solo emails enviados desde casacurino.com
  const remitente = String(d.from || '').toLowerCase();
  const registrar = (resultado: string) => supa.from('partners_webhook_log')
    .insert({ tipo, resend_id: d.email_id || d.id || null, resultado }).then(() => {}, () => {});
  if (remitente && !/@casacurino\.com>?\s*$/.test(remitente)) { await registrar('ignorado_dominio'); return new Response('ignored'); }
  const resendId = d.email_id || d.id || null;
  const destinatario = String((Array.isArray(d.to) ? d.to[0] : d.to) || '').toLowerCase();
  const ahora = new Date().toISOString();

  const nuevo = ({ 'email.delivered': 'entregado', 'email.delivery_delayed': 'retrasado', 'email.opened': 'abierto',
    'email.bounced': 'rebotado', 'email.complained': 'queja' } as Record<string, string>)[tipo];

  try {
    let resultado = 'sin_email';
    if (tipo === 'email.clicked' && resendId) {
      const { data: c } = await supa.from('partners_emails').update({ clicado_at: ahora }).eq('resend_id', resendId).is('clicado_at', null).select('id');
      if ((c || []).length) resultado = 'actualizado';
    }
    if (nuevo && resendId) {
      const { data: fila } = await supa.from('partners_emails').select('id, estado').eq('resend_id', resendId).maybeSingle();
      if (fila && (ORDEN[nuevo] ?? 0) >= (ORDEN[fila.estado] ?? 0)) {
        const upd: Record<string, unknown> = { estado: nuevo, estado_at: ahora };
        if (nuevo === 'abierto') upd.abierto_at = ahora;
        await supa.from('partners_emails').update(upd).eq('id', fila.id);
        resultado = 'actualizado';
      } else if (fila && nuevo === 'abierto') {
        await supa.from('partners_emails').update({ abierto_at: ahora }).eq('id', fila.id).is('abierto_at', null);
        resultado = 'actualizado';
      } else if (fila) resultado = 'sin_cambio';
    }
    await registrar(resultado);
    // Baja por rebote permanente o queja de spam
    const permanente = tipo === 'email.bounced' && String(d?.bounce?.type || '').toLowerCase() !== 'transient';
    if ((permanente || tipo === 'email.complained') && destinatario) {
      const motivo = tipo === 'email.complained' ? 'queja' : 'rebote';
      await supa.from('partners_solicitudes').update({ baja_at: ahora, motivo_baja: motivo }).eq('email', destinatario);
      console.log(`resend-webhook: baja por ${motivo}`);
    }
  } catch (e) {
    console.error('resend-webhook error', e);
    return new Response('error', { status: 500 });
  }
  return new Response('ok');
});
