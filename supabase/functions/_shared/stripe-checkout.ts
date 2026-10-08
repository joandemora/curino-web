// supabase/functions/_shared/stripe-checkout.ts
//
// Creación de sesiones de Stripe Checkout de Partners (Intensivo,
// One-to-one, Sesión 1:1 y enlaces de pago del CRM) con métodos de pago
// explícitos: tarjeta (+ Apple/Google Pay), Link y Klarna. No se usan los
// métodos dinámicos del dashboard para no mostrar métodos diferidos (SEPA,
// transferencias…) sin decidirlo.
// Si Stripe rechaza un método (no activado en la cuenta, importe fuera de
// límites…), se reintenta sin él para no bloquear la venta.
// Pagos que quedan pendientes (payment_status 'unpaid'): el webhook no da de
// alta ni factura hasta checkout.session.async_payment_succeeded.

import Stripe from 'https://esm.sh/stripe@17.3.0?target=deno'

export const METODOS_PAGO = ['card', 'link', 'klarna'] as const;

export async function crearSesionCheckout(stripe: Stripe, params: Stripe.Checkout.SessionCreateParams, etiqueta: string): Promise<Stripe.Checkout.Session> {
  let metodos: string[] = [...METODOS_PAGO];
  for (let intento = 0; intento < METODOS_PAGO.length; intento++) {
    try {
      return await stripe.checkout.sessions.create({ ...params, payment_method_types: metodos as Stripe.Checkout.SessionCreateParams.PaymentMethodType[] });
    } catch (err: any) {
      const msg = String(err?.message || '');
      const fallido = err?.type === 'StripeInvalidRequestError' ? metodos.find((m) => m !== 'card' && new RegExp(m, 'i').test(msg)) : undefined;
      if (!fallido) throw err;
      console.warn(`${etiqueta}: método ${fallido} no disponible, reintento sin él:`, msg);
      metodos = metodos.filter((m) => m !== fallido);
    }
  }
  return await stripe.checkout.sessions.create({ ...params, payment_method_types: ['card'] });
}
