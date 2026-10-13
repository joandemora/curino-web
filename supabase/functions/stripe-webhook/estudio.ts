// supabase/functions/stripe-webhook/estudio.ts
//
// Estudio Curino · cobros con Stripe (F5, 2026-10). Lo llama index.ts:
//   checkout.session.completed / async_payment_succeeded
//     purpose 'estudio_pack' → handleEstudioPack: compra + saldo (+usd) + factura EST
//     purpose 'estudio_plan' → handleEstudioPlanCheckout: cliente y suscripción
//   invoice.paid (suscripción con metadata.purpose 'estudio_plan')
//     → handleEstudioInvoicePaid: cuota del plan con factura EST (una por invoice)
//   customer.subscription.created / updated / deleted
//     → handleEstudioSubscription: estado y fin del periodo
//   charge.refunded → handleEstudioRefunded: rectificativa R-EST y, en packs, saldo (−usd)
// Idempotencia: stripe_session_id / stripe_invoice_id únicos; rectificativas por stripe_refund_id.
// Importes con IVA (21 %) incluido, como el resto de productos de Partners.

import Stripe from 'https://esm.sh/stripe@17.3.0?target=deno'
import {
  generateClaseInvoicePdf, generateClaseRectificativaPdf, uploadPdfToInvoices, formatStripeAddress,
  resendSend, escapeHtml, pdfBytesToBase64
} from '../_shared/clase-invoices.ts'

// deno-lint-ignore no-explicit-any
type Any = any;
const URL_ESTUDIO = 'https://www.casacurino.com/partners/estudio/';
const fmtEur = (c: number) => (c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export const esPurposeEstudio = (p: string) => p === 'estudio_pack' || p === 'estudio_plan';

async function userIdPorEmail(supabase: Any, email: string): Promise<string | null> {
  const r = await supabase.rpc('estudio_alumnos', { p_email: email });
  return (Array.isArray(r.data) && r.data[0]?.user_id) || null;
}

async function guardarCliente(supabase: Any, userId: string | null, customer: string | null) {
  if (!userId || !customer) return;
  await supabase.from('estudio_clientes_stripe').upsert({ user_id: userId, customer_id: customer }, { onConflict: 'user_id', ignoreDuplicates: true });
}

async function facturaYEmail(supabase: Any, compra: Any, o: { concepto: string; asunto: string; parrafo: string; nombre: string; direccion: string[] }) {
  const numero = compra.invoice_number || `EST-${String(compra.id).slice(0, 8)}`;
  const pdf = await generateClaseInvoicePdf({
    id: String(compra.id), clase_id: '', clase_fecha: String(compra.created_at), nombre: o.nombre, email: compra.email,
    amount_paid_cents: compra.importe_cents, invoice_number: numero, created_at: String(compra.created_at),
    buyer_nombre_fiscal: compra.cliente_nombre_fiscal, buyer_nif: compra.cliente_nif, buyer_direccion: o.direccion, concepto: o.concepto
  });
  const path = await uploadPdfToInvoices(supabase, `estudio/${compra.id}.pdf`, pdf);
  await supabase.from('estudio_compras').update({ pdf_url: path }).eq('id', compra.id);
  const nombreCorto = (o.nombre || '').split(' ')[0];
  await resendSend({
    from: 'Curino <noreply@casacurino.com>', to: [compra.email], reply_to: 'info@casacurino.com', subject: o.asunto,
    html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a1a1a">
<h2 style="margin:0 0 12px">Estudio Curino</h2><p>Hola${nombreCorto ? ' ' + escapeHtml(nombreCorto) : ''},</p><p>${o.parrafo}</p>
<p><a href="${URL_ESTUDIO}" style="display:inline-block;background:#161616;color:#fff;font-weight:bold;padding:12px 22px;text-decoration:none;border-radius:8px">Ir al Estudio</a></p>
<p>Adjunto la factura (N.º ${escapeHtml(numero)}).</p>
<p style="font-size:12px;color:#888;margin-top:30px">SISTEMA &amp; CURINO SLU · <a href="https://www.casacurino.com/aviso-legal/" style="color:#888">Aviso legal</a></p></body></html>`,
    attachments: [{ filename: `factura-${numero}.pdf`, content: pdfBytesToBase64(pdf) }]
  });
  try {
    await resendSend({
      from: 'Curino Partners — Ventas <noreply@casacurino.com>', to: ['info@casacurino.com'], reply_to: compra.email,
      subject: `Estudio · ${compra.tipo === 'pack' ? 'pack de crédito' : 'cuota del plan'}: ${compra.email}`,
      html: `<p>${escapeHtml(compra.email)} · ${fmtEur(compra.importe_cents)} · factura ${escapeHtml(numero)}${compra.tipo === 'pack' ? ` · +${compra.usd} $ de crédito IA` : ''}</p>`
    });
  } catch (e) { console.error('estudio: aviso info@ fallo', e); }
}

// ── Pack de crédito ─────────────────────────────────────────────
export async function handleEstudioPack(supabase: Any, session: Stripe.Checkout.Session) {
  const md = session.metadata || {};
  const cd = session.customer_details;
  const email = String(md.email || cd?.email || '').toLowerCase();
  const usd = Number(md.usd || 0);
  const amount = session.amount_total ?? 0;
  if (!email || !(usd > 0) || amount <= 0) { console.error('estudio_pack: datos insuficientes', session.id); return; }
  const { data: ya } = await supabase.from('estudio_compras').select('id').eq('stripe_session_id', session.id).maybeSingle();
  if (ya) { console.log(`estudio_pack: ${session.id} ya registrado`); return; }
  const userId = /^[0-9a-f-]{36}$/i.test(md.user_id || '') ? md.user_id : await userIdPorEmail(supabase, email);
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  await guardarCliente(supabase, userId, customer);
  const taxId = (cd?.tax_ids || []).find((t: Any) => t && t.value)?.value || null;
  const direccion = formatStripeAddress(cd?.address);
  const { data: num, error: e1 } = await supabase.rpc('assign_invoice_number', { p_type: 'est', p_year: new Date().getFullYear() });
  if (e1) console.error('estudio_pack: número de factura', e1);
  const terminos = session.consent?.terms_of_service === 'accepted';
  const { data: compra, error } = await supabase.from('estudio_compras').insert({
    user_id: userId, email, tipo: 'pack', pack_id: md.pack_id || null, usd, importe_cents: amount,
    stripe_session_id: session.id, stripe_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
    terminos_aceptados: terminos, factura_tipo: taxId ? 'completa' : 'simplificada',
    cliente_nombre_fiscal: (cd?.name || '').trim() || null, cliente_nif: taxId, cliente_direccion: direccion.length ? direccion.join(' · ') : null,
    invoice_number: num
  }).select('*').single();
  if (error || !compra) { console.error('estudio_pack: insert fallo', session.id, error); return; }
  await supabase.from('estudio_saldo').insert({ user_id: userId, email, usd, motivo: 'pack', compra_id: compra.id });
  console.log(`estudio_pack: ${compra.id} +${usd} $ para ${email}`);
  try {
    await facturaYEmail(supabase, compra, {
      concepto: `Estudio Curino: pack de crédito IA (${usd} $)`, asunto: 'Crédito añadido a tu Estudio Curino',
      parrafo: `Hemos añadido <b>${usd} $</b> de crédito IA a tu Estudio. No caduca: se usa cuando se agota el crédito incluido de cada mes.`,
      nombre: (cd?.name || email), direccion
    });
  } catch (e) { console.error('estudio_pack: factura/email fallo', compra.id, e); }
}

// ── Plan mensual ────────────────────────────────────────────────
async function guardarSuscripcion(supabase: Any, sub: Stripe.Subscription, emailMeta?: string, userMeta?: string) {
  const md = sub.metadata || {};
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  let userId = /^[0-9a-f-]{36}$/i.test(userMeta || md.user_id || '') ? (userMeta || md.user_id) : null;
  if (!userId && customer) userId = (await supabase.from('estudio_clientes_stripe').select('user_id').eq('customer_id', customer).maybeSingle()).data?.user_id ?? null;
  const email = String(emailMeta || md.email || '').toLowerCase();
  if (!userId) { console.error('estudio_plan: suscripción sin usuario', sub.id); return; }
  await guardarCliente(supabase, userId, customer);
  // deno-lint-ignore no-explicit-any
  const fin = (sub as any).current_period_end ?? (sub.items?.data?.[0] as any)?.current_period_end ?? null;
  const fila: Any = {
    user_id: userId, stripe_customer_id: customer, stripe_subscription_id: sub.id, estado: sub.status,
    current_period_end: fin ? new Date(fin * 1000).toISOString() : null, cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString()
  };
  if (email) fila.email = email;
  const { data: ya } = await supabase.from('estudio_suscripciones').select('email').eq('user_id', userId).maybeSingle();
  if (!ya && !fila.email) { const u = await supabase.auth.admin.getUserById(userId); fila.email = String(u.data?.user?.email || '').toLowerCase(); }
  const r = ya ? await supabase.from('estudio_suscripciones').update(fila).eq('user_id', userId) : await supabase.from('estudio_suscripciones').insert(fila);
  if (r.error) console.error('estudio_plan: guardar suscripción', r.error);
  else console.log(`estudio_plan: ${sub.id} ${sub.status} (${email || userId})`);
}

export async function handleEstudioPlanCheckout(supabase: Any, stripe: Stripe, session: Stripe.Checkout.Session) {
  const md = session.metadata || {};
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subId) { console.error('estudio_plan: checkout sin suscripción', session.id); return; }
  const sub = await stripe.subscriptions.retrieve(subId);
  await guardarSuscripcion(supabase, sub, md.email, md.user_id);
}

export async function handleEstudioSubscription(supabase: Any, sub: Stripe.Subscription) {
  if ((sub.metadata || {}).purpose !== 'estudio_plan') return;
  await guardarSuscripcion(supabase, sub);
}

export async function handleEstudioInvoicePaid(supabase: Any, stripe: Stripe, invoice: Stripe.Invoice) {
  // deno-lint-ignore no-explicit-any
  const inv = invoice as any;
  const subId: string | null = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id ?? inv.parent?.subscription_details?.subscription ?? null;
  if (!subId) return;
  const sub = await stripe.subscriptions.retrieve(subId);
  if ((sub.metadata || {}).purpose !== 'estudio_plan') return;
  const amount = invoice.amount_paid ?? 0;
  if (amount <= 0) return;
  const { data: ya } = await supabase.from('estudio_compras').select('id').eq('stripe_invoice_id', invoice.id).maybeSingle();
  if (ya) return;
  await guardarSuscripcion(supabase, sub);
  const md = sub.metadata || {};
  const email = String(md.email || invoice.customer_email || '').toLowerCase();
  const userId = /^[0-9a-f-]{36}$/i.test(md.user_id || '') ? md.user_id : null;
  const taxId = (invoice.customer_tax_ids || []).find((t: Any) => t && t.value)?.value || null;
  const direccion = formatStripeAddress(invoice.customer_address as Any);
  const { data: num } = await supabase.rpc('assign_invoice_number', { p_type: 'est', p_year: new Date().getFullYear() });
  const { data: compra, error } = await supabase.from('estudio_compras').insert({
    user_id: userId, email, tipo: 'plan', usd: 0, importe_cents: amount, stripe_invoice_id: invoice.id,
    stripe_payment_intent: typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id ?? null,
    stripe_subscription_id: sub.id, terminos_aceptados: true, factura_tipo: taxId ? 'completa' : 'simplificada',
    cliente_nombre_fiscal: (invoice.customer_name || '').trim() || null, cliente_nif: taxId,
    cliente_direccion: direccion.length ? direccion.join(' · ') : null, invoice_number: num
  }).select('*').single();
  if (error || !compra) { console.error('estudio_plan: cuota insert fallo', invoice.id, error); return; }
  try {
    await facturaYEmail(supabase, compra, {
      concepto: 'Estudio Curino: plan mensual (acceso y crédito IA mensual)', asunto: 'Tu plan del Estudio Curino',
      parrafo: invoice.billing_reason === 'subscription_create'
        ? 'Tu plan mensual del Estudio ya está activo. Puedes gestionarlo (tarjeta, facturas o baja) desde «Créditos y plan».'
        : 'Hemos renovado tu plan mensual del Estudio.',
      nombre: invoice.customer_name || email, direccion
    });
  } catch (e) { console.error('estudio_plan: factura/email fallo', compra.id, e); }
}

// ── Reembolsos ──────────────────────────────────────────────────
export async function handleEstudioRefunded(supabase: Any, stripe: Stripe, charge: Stripe.Charge, paymentIntent: string) {
  const { data: compra } = await supabase.from('estudio_compras').select('*').eq('stripe_payment_intent', paymentIntent).maybeSingle();
  if (!compra) return;
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 }).catch(() => null);
  for (const rf of refunds?.data || []) {
    if (rf.status === 'failed' || rf.status === 'canceled') continue;
    try {
      const { data: claimed } = await supabase.from('facturas_rectificativas_clase').upsert({
        stripe_refund_id: rf.id, stripe_charge_id: charge.id, estudio_compra_id: compra.id, serie: 'est',
        importe_cents: rf.amount, factura_original: compra.invoice_number || `EST-${String(compra.id).slice(0, 8)}`,
        factura_original_fecha: compra.created_at, comprador_nombre: compra.cliente_nombre_fiscal || compra.email,
        comprador_email: compra.email, comprador_nif: compra.cliente_nif, comprador_direccion: compra.cliente_direccion
      }, { onConflict: 'stripe_refund_id', ignoreDuplicates: true }).select('id');
      const { data: row } = await supabase.from('facturas_rectificativas_clase').select('*').eq('stripe_refund_id', rf.id).single();
      if (!row || (!(claimed && claimed.length) && row.invoice_number && row.pdf_url)) continue;
      let numero = row.invoice_number as string | null;
      if (!numero) {
        const { data: n } = await supabase.rpc('assign_invoice_number', { p_type: 'est_rect', p_year: new Date().getFullYear() });
        const { data: upd } = await supabase.from('facturas_rectificativas_clase').update({ invoice_number: n }).eq('id', row.id).is('invoice_number', null).select('invoice_number');
        numero = (upd && upd[0]?.invoice_number) || n;
      }
      const pdf = await generateClaseRectificativaPdf({
        invoice_number: String(numero), fecha: row.created_at, factura_original: row.factura_original,
        factura_original_fecha: row.factura_original_fecha, motivo: row.motivo, importe_cents: row.importe_cents,
        comprador_nombre: row.comprador_nombre, comprador_email: row.comprador_email, comprador_nif: row.comprador_nif,
        comprador_direccion: row.comprador_direccion ? String(row.comprador_direccion).split(' · ') : [],
        concepto: compra.tipo === 'pack' ? `Estudio Curino: pack de crédito IA (${compra.usd} $)` : 'Estudio Curino: plan mensual'
      });
      const path = await uploadPdfToInvoices(supabase, `estudio/${compra.id}-rect-${rf.id}.pdf`, pdf);
      await supabase.from('facturas_rectificativas_clase').update({ pdf_url: path }).eq('id', row.id);
      console.log(`estudio: rectificativa ${numero} para ${compra.id}`);
    } catch (e) { console.error('estudio: rectificativa fallo', rf.id, e); }
  }
  const total = charge.refunded === true || (charge.amount_refunded ?? 0) >= (charge.amount ?? Infinity);
  if (!total) {
    await supabase.from('estudio_compras').update({ importe_reembolsado_cents: charge.amount_refunded ?? 0 }).eq('id', compra.id);
    return;
  }
  const { data: upd } = await supabase.from('estudio_compras')
    .update({ estado: 'reembolsada', reembolsada_at: new Date().toISOString(), importe_reembolsado_cents: charge.amount_refunded ?? compra.importe_cents })
    .eq('id', compra.id).eq('estado', 'pagada').select('id');
  // Pack reembolsado: se retira su crédito (el saldo nunca baja de 0 al mostrarse)
  if (upd && upd.length && compra.tipo === 'pack' && Number(compra.usd) > 0) {
    await supabase.from('estudio_saldo').insert({ user_id: compra.user_id, email: compra.email, usd: -Number(compra.usd), motivo: 'reembolso', compra_id: compra.id });
  }
}
