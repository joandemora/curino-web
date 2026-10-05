// supabase/functions/cal-webhook/index.ts
//
// Webhook de Cal.com (llamada de admision de Curino Partners). Firma:
// cabecera x-cal-signature-256 = HMAC-SHA256 hex del cuerpo con el secret
// CAL_WEBHOOK_SECRET (el mismo que se pone en Cal.com al crear el webhook).
//
// - BOOKING_CREATED / BOOKING_RESCHEDULED → en el contacto: llamada_at,
//   llamada_estado 'reservada', llamada_uid y estado
//   del CRM «interesado» (salvo si ya «compro»). Quien reserva sale de la
//   secuencia (partners_secuencias.sale_llamada).
// - BOOKING_CANCELLED → llamada_estado 'cancelada' (si es su reserva vigente).
// El contacto se busca por metadata.solicitud_id (lo pone el calendario
// embebido) o por email. Si no existe, se crea (origen 'cal.com', sin
// consentimientos: no entra en ninguna secuencia).
// Cada evento queda en partners_webhook_log (tipo 'cal.<evento>').
// verify_jwt=false (Cal.com no manda JWT).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

// deno-lint-ignore no-explicit-any
type Any = any;
const enc = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIJOS = ['+351', '+34', '+33', '+39', '+44', '+49', '+52', '+54', '+56', '+57', '+51', '+1'];

async function firmaValida(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get('CAL_WEBHOOK_SECRET');
  const sig = (req.headers.get('x-cal-signature-256') || '').trim().toLowerCase();
  if (!secret || !sig) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// Valor de una respuesta del formulario de reserva (string u objeto).
function resp(p: Any, k: string): string {
  const v = p?.responses?.[k];
  const x = v && typeof v === 'object' && 'value' in v ? v.value : v;
  if (x && typeof x === 'object') return [x.firstName, x.lastName].filter(Boolean).join(' ');
  return String(x ?? '').trim();
}
function partirTelefono(t: string): { prefijo: string; numero: string } {
  const limpio = t.replace(/[^\d+]/g, '');
  const pre = PREFIJOS.find((p) => limpio.startsWith(p));
  if (pre) return { prefijo: pre, numero: limpio.slice(pre.length) };
  return { prefijo: '+34', numero: limpio.replace(/^\+/, '') };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const body = await req.text();
  if (!(await firmaValida(req, body))) return new Response('invalid signature', { status: 401 });
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let ev: Any;
  try { ev = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }
  const trigger = String(ev?.triggerEvent || '');
  const p = ev?.payload || {};
  const log = (resultado: string) => supa.from('partners_webhook_log')
    .insert({ tipo: `cal.${trigger.toLowerCase()}`, resend_id: p?.uid || null, resultado }).then(() => {}, () => {});

  try {
    if (!['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'].includes(trigger)) {
      await log('ignorado'); return new Response('ignored');
    }
    const email = String(resp(p, 'email') || p?.attendees?.[0]?.email || '').toLowerCase();
    const metaId = String(p?.metadata?.solicitud_id || '');
    let sol: Any = null;
    if (UUID_RE.test(metaId)) {
      const { data } = await supa.from('partners_solicitudes').select('*').eq('id', metaId).maybeSingle();
      sol = data;
    }
    if (!sol && email) {
      const { data } = await supa.from('partners_solicitudes').select('*').eq('email', email).order('created_at', { ascending: false }).limit(1);
      sol = data?.[0] || null;
    }
    const ahora = new Date().toISOString();

    if (trigger === 'BOOKING_CANCELLED') {
      if (!sol) { await log('sin_contacto'); return new Response('ok'); }
      if (sol.llamada_uid && p?.uid && sol.llamada_uid !== p.uid) { await log('otra_reserva'); return new Response('ok'); }
      await supa.from('partners_solicitudes').update({ llamada_estado: 'cancelada', llamada_actualizada_at: ahora }).eq('id', sol.id);
      await log('cancelada'); return new Response('ok');
    }

    // Reserva nueva o reprogramada
    const datos: Record<string, unknown> = {
      llamada_at: p?.startTime || null, llamada_estado: 'reservada', llamada_uid: p?.uid || null, llamada_actualizada_at: ahora
    };
    if (sol) {
      if (sol.crm_estado !== 'compro') { datos.crm_estado = 'interesado'; datos.crm_actualizado_at = ahora; }
      await supa.from('partners_solicitudes').update(datos).eq('id', sol.id);
      await log(trigger === 'BOOKING_RESCHEDULED' ? 'reprogramada' : 'reservada');
      return new Response('ok');
    }
    if (!email) { await log('sin_email'); return new Response('ok'); }
    const tel = partirTelefono(resp(p, 'attendeePhoneNumber') || p?.attendees?.[0]?.phoneNumber || '');
    const { error } = await supa.from('partners_solicitudes').insert({
      ...datos,
      nombre: resp(p, 'name') || p?.attendees?.[0]?.name || email,
      email, telefono_prefijo: tel.prefijo, telefono: tel.numero || '-',
      edit_token: crypto.randomUUID(), origen: 'cal.com', crm_estado: 'interesado', crm_actualizado_at: ahora,
      crm_notas: 'Creado desde una reserva de Cal.com (no pasó por el formulario).'
    });
    if (error) { console.error('cal-webhook: insert', error); await log('error_alta'); return new Response('error', { status: 500 }); }
    await log('alta_contacto');
    return new Response('ok');
  } catch (e) {
    console.error('cal-webhook error', e);
    return new Response('error', { status: 500 });
  }
});
