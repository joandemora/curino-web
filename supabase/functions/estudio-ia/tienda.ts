// supabase/functions/estudio-ia/tienda.ts
//
// Estudio Curino · «Créditos y plan» con Stripe (cuenta SISTEMA & CURINO).
//   'creditos'      → packs y plan (precios de estudio_config), saldo, crédito del mes,
//                     suscripción y compras del usuario.
//   'comprar_pack'  { pack_id } → Stripe Checkout (pago único) → webhook estudio_pack.
//   'comprar_plan'  → Stripe Checkout en modo suscripción → webhook estudio_plan.
//   'portal'        → Customer Portal de Stripe (tarjeta, facturas, baja).
//   'stripe_diagnostico' (admin, solo lectura) → eventos suscritos en los webhooks
//                     y si hay una configuración activa del Customer Portal.
// Precios con IVA incluido. El cobro y las facturas (EST) los hace stripe-webhook.

import Stripe from 'https://esm.sh/stripe@17.3.0?target=deno'
import type { EstadoAlumno } from './acceso.ts'

// deno-lint-ignore no-explicit-any
type Any = any;
const SITE = 'https://www.casacurino.com';
const VOLVER = `${SITE}/partners/estudio/#creditos`;
export const EVENTOS_NECESARIOS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'charge.refunded', 'invoice.paid', 'invoice.payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'
];

const ACCIONES = new Set(['creditos', 'comprar_pack', 'comprar_plan', 'portal', 'stripe_diagnostico', 'stripe_eventos_estudio']);
export const esAccionTienda = (a: string) => ACCIONES.has(a);
/** Acciones que puede usar un antiguo alumno sin acceso activo (para suscribirse). */
export const accionSinAcceso = (a: string) => a === 'creditos' || a === 'comprar_plan' || a === 'portal';

function stripe(): Stripe {
  return new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-12-18.acacia', httpClient: Stripe.createFetchHttpClient() });
}

async function clienteStripe(supa: Any, s: Stripe, userId: string, email: string): Promise<string> {
  const { data } = await supa.from('estudio_clientes_stripe').select('customer_id').eq('user_id', userId).maybeSingle();
  if (data?.customer_id) return data.customer_id;
  const c = await s.customers.create({ email, metadata: { user_id: userId, origen: 'estudio' } });
  await supa.from('estudio_clientes_stripe').insert({ user_id: userId, customer_id: c.id });
  return c.id;
}

const COND = 'https://casacurino.com/partners/condiciones/#estudio';
const consentimiento = (tipo: 'pack' | 'plan') => ({
  consent_collection: { terms_of_service: 'required' as const },
  custom_text: {
    terms_of_service_acceptance: {
      message: tipo === 'pack'
        ? `Solicito recibir el crédito de inmediato y acepto que con ello pierdo el derecho de desistimiento. Acepto las [condiciones del Estudio Curino](${COND}).`
        : `Solicito que el plan empiece de inmediato. Sé que puedo desistir en 14 días y que, si lo hago, pagaré la parte proporcional del periodo disfrutado. Acepto las [condiciones del Estudio Curino](${COND}).`
    }
  }
});

export async function accionTienda(action: string, o: {
  supa: Any; userId: string; email: string; esAdmin: boolean; cfg: Any; alumno: EstadoAlumno | null; body: Any;
  json: (b: unknown, s?: number) => Response;
}): Promise<Response> {
  const { supa, userId, email, cfg, alumno, body, json } = o;
  const packs: { id: string; eur: number; usd: number }[] = Array.isArray(cfg?.packs) ? cfg.packs : [];

  if (action === 'stripe_diagnostico') {
    if (!o.esAdmin) return json({ error: 'forbidden' }, 403);
    const s = stripe();
    const [hooks, portales] = await Promise.all([
      s.webhookEndpoints.list({ limit: 20 }).catch((e: Error) => ({ error: e.message })),
      s.billingPortal.configurations.list({ limit: 10, active: true }).catch((e: Error) => ({ error: e.message }))
    ]);
    const lista = (hooks as Any).data ?? [];
    const nuestro = lista.filter((h: Any) => /stripe-webhook/.test(h.url));
    const suscritos = new Set<string>(nuestro.flatMap((h: Any) => h.enabled_events));
    return json({
      webhooks: lista.map((h: Any) => ({ url: h.url, estado: h.status, eventos: h.enabled_events })),
      faltan: suscritos.has('*') ? [] : EVENTOS_NECESARIOS.filter((e) => !suscritos.has(e)),
      portal_activo: ((portales as Any).data ?? []).length > 0,
      error: (hooks as Any).error || (portales as Any).error || null
    });
  }

  if (action === 'stripe_eventos_estudio') {
    // Admin, solo lectura: últimos eventos de Stripe del Estudio (pagos, reembolsos) y si quedan entregas pendientes.
    if (!o.esAdmin) return json({ error: 'forbidden' }, 403);
    const s = stripe();
    const todos = await s.events.list({ limit: 100, created: { gte: Math.floor(Date.now() / 1000) - 3 * 86400 } }).autoPagingToArray({ limit: 500 });
    const tipos: Record<string, number> = {};
    for (const e of todos) tipos[e.type] = (tipos[e.type] ?? 0) + 1;
    const out = todos.filter((e) => {
      const ob: Any = e.data.object;
      return ob?.metadata?.purpose?.startsWith?.('estudio') || ob?.subscription_details?.metadata?.purpose === 'estudio_plan' || e.type === 'charge.refunded' || e.type.startsWith('checkout.session');
    }).map((e) => {
      const ob: Any = e.data.object;
      return { id: e.id, tipo: e.type, creado: new Date(e.created * 1000).toISOString(), pendientes: e.pending_webhooks, objeto: ob?.id, purpose: ob?.metadata?.purpose ?? null, pago: ob?.payment_status ?? ob?.status ?? null, importe: ob?.amount_total ?? ob?.amount ?? null, reembolsado: ob?.amount_refunded ?? null, pi: ob?.payment_intent ?? null };
    });
    return json({ eventos: out, tipos, total: todos.length });
  }

  if (action === 'creditos') {
    const [{ data: sus }, { data: compras }] = await Promise.all([
      supa.from('estudio_suscripciones').select('estado, current_period_end, cancel_at_period_end').eq('user_id', userId).maybeSingle(),
      supa.from('estudio_compras').select('id, tipo, usd, importe_cents, estado, invoice_number, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(24)
    ]);
    return json({
      packs, plan: { eur: Number(cfg?.plan_eur ?? 29), usd: Number(cfg?.plan_usd ?? 15) },
      saldo: Number(alumno?.saldo_usd ?? 0),
      credito: alumno ? { usd: alumno.credito_usd, gastado: Math.round(alumno.gastado_usd * 100) / 100, restante: Math.max(0, Math.round((alumno.credito_usd - alumno.gastado_usd) * 100) / 100) } : null,
      acceso: alumno ? { activo: alumno.activo, hasta: alumno.acceso_hasta, productos: alumno.productos } : null,
      suscripcion: sus ?? null, compras: compras ?? []
    });
  }

  if (action === 'comprar_pack') {
    if (!alumno?.activo) return json({ error: 'Los packs de crédito son para alumnos con acceso activo al Estudio.' }, 403);
    const pack = packs.find((p) => p.id === String(body?.pack_id || ''));
    if (!pack || !(pack.eur > 0) || !(pack.usd > 0)) return json({ error: 'Pack no disponible.' }, 400);
    const s = stripe();
    const customer = await clienteStripe(supa, s, userId, email);
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: Math.round(pack.eur * 100), product_data: {
        name: `Estudio Curino · Pack de crédito IA (${pack.usd} $)`,
        description: 'Crédito para la IA del Estudio Curino (alzados desde planos y textos de presupuesto). No caduca.'
      } } }],
      billing_address_collection: 'required', tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      ...consentimiento('pack'),
      success_url: `${VOLVER}/ok`, cancel_url: VOLVER,
      metadata: { purpose: 'estudio_pack', user_id: userId, email, pack_id: pack.id, usd: String(pack.usd) },
      payment_intent_data: { metadata: { purpose: 'estudio_pack', user_id: userId, pack_id: pack.id } }
    };
    let session: Stripe.Checkout.Session;
    try { session = await s.checkout.sessions.create({ ...params, payment_method_types: ['card', 'link'] }); }
    catch { session = await s.checkout.sessions.create({ ...params, payment_method_types: ['card'] }); }
    return json({ url: session.url });
  }

  if (action === 'comprar_plan') {
    if (!alumno?.puede_suscribirse) return json({ error: 'El plan es para alumnos y antiguos alumnos de Curino Partners.' }, 403);
    const { data: sus } = await supa.from('estudio_suscripciones').select('estado, current_period_end').eq('user_id', userId).maybeSingle();
    if (sus && ['active', 'trialing', 'past_due'].includes(sus.estado)) return json({ error: 'Ya tienes el plan activo: gestiónalo desde «Gestionar mi suscripción».' }, 400);
    const eur = Number(cfg?.plan_eur ?? 29), usd = Number(cfg?.plan_usd ?? 15);
    const s = stripe();
    const customer = await clienteStripe(supa, s, userId, email);
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: Math.round(eur * 100), recurring: { interval: 'month' }, product_data: {
        name: `Estudio Curino · Plan mensual (${usd} $ de crédito IA al mes)`
      } } }],
      billing_address_collection: 'required', tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      ...consentimiento('plan'),
      success_url: `${VOLVER}/ok`, cancel_url: VOLVER,
      metadata: { purpose: 'estudio_plan', user_id: userId, email },
      subscription_data: { metadata: { purpose: 'estudio_plan', user_id: userId, email } }
    };
    let session: Stripe.Checkout.Session;
    try { session = await s.checkout.sessions.create({ ...params, payment_method_types: ['card', 'link'] }); }
    catch { session = await s.checkout.sessions.create({ ...params, payment_method_types: ['card'] }); }
    return json({ url: session.url });
  }

  if (action === 'portal') {
    const { data: c } = await supa.from('estudio_clientes_stripe').select('customer_id').eq('user_id', userId).maybeSingle();
    if (!c?.customer_id) return json({ error: 'Aún no tienes compras ni suscripción en el Estudio.' }, 400);
    try {
      const p = await stripe().billingPortal.sessions.create({ customer: c.customer_id, return_url: VOLVER });
      return json({ url: p.url });
    } catch (e) {
      console.error('estudio portal:', (e as Error).message);
      return json({ error: 'La gestión de la suscripción no está disponible ahora mismo. Escríbenos a info@casacurino.com.' }, 503);
    }
  }
  return json({ error: 'accion_desconocida' }, 400);
}
