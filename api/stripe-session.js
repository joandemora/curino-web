// api/stripe-session.js
//
// Endpoint server-side que devuelve los datos mínimos de una Checkout Session
// de Stripe (importe, moneda, transaction_id) para que la página de
// confirmación pueda disparar el evento GA4 'purchase' vía dataLayer + GTM.
//
// Diseño:
//   - GET /api/stripe-session?session_id=cs_xxx
//   - Usa STRIPE_SECRET_KEY (server-side, nunca expuesta al cliente) para
//     verificar la sesión directamente contra Stripe. No confía en datos
//     que envíe el cliente más allá del session_id.
//   - Devuelve {paid:true, transaction_id, amount_total, currency} SOLO si
//     session.payment_status === 'paid'. Si no, devuelve {paid:false} sin
//     más datos — evita falsos positivos con session_id inventados.
//   - NUNCA devuelve campos sensibles del cliente (email, dirección,
//     metadata personal, payment_intent_id). Solo lo justo para analytics.
//
// Aislamiento del flujo de pago: este endpoint es READ-ONLY contra Stripe.
// No toca Supabase, no modifica nada, no afecta al cobro. Si falla por
// cualquier motivo (Stripe caído, key mal, session inexistente), la
// página de confirmación se carga normal y simplemente no se dispara el
// evento de analytics.

const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  // CORS — mismo patrón que api/checkout.js
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ paid: false });
  }

  // Si Stripe no está configurado en Vercel, log y respuesta segura.
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('stripe-session: STRIPE_SECRET_KEY no configurada');
    return res.status(200).json({ paid: false });
  }

  // Validación estricta del session_id.
  // Formato Stripe: 'cs_' + alfanumérico + '_' (typical: 66-69 chars).
  // Restringimos a [A-Za-z0-9_] y max 200 chars para evitar abuso.
  const sessionId = (req.query && req.query.session_id) ? String(req.query.session_id) : '';
  if (!sessionId
      || !sessionId.startsWith('cs_')
      || sessionId.length > 200
      || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return res.status(400).json({ paid: false });
  }

  const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Solo consideramos pagada una sesión con payment_status === 'paid'.
    // El webhook server-side maneja 'unpaid' y otros estados; aquí solo
    // disparamos analytics para compras confirmadas.
    if (session.payment_status !== 'paid') {
      return res.status(200).json({ paid: false });
    }

    // amount_total viene en céntimos (Stripe). Lo devolvemos en la unidad
    // base de la moneda (EUR), que es lo que GA4 espera en `value`.
    // amount_total puede ser 0 (cupón 100% válido — el webhook lo acepta).
    // Si por algún motivo es null/undefined o negativo, no disparamos
    // analytics (devolvemos paid:false sin filtrar el detalle).
    const amountTotalCents = session.amount_total;
    if (amountTotalCents == null || amountTotalCents < 0) {
      console.error('stripe-session: amount_total inválido', sessionId, amountTotalCents);
      return res.status(200).json({ paid: false });
    }

    // Respuesta mínima — SOLO lo necesario para el evento purchase de GA4.
    // No exponemos: customer_email, customer_details, shipping, payment_intent,
    // metadata, line_items, ni nada del cliente.
    return res.status(200).json({
      paid: true,
      transaction_id: session.id,
      amount_total: amountTotalCents / 100,
      currency: (session.currency || 'eur').toUpperCase()
    });
  } catch (err) {
    // Stripe puede lanzar:
    //   - StripeInvalidRequestError: session no existe (id mal formado tras
    //     pasar nuestra regex, o de otro account, etc.).
    //   - StripeAuthenticationError: STRIPE_SECRET_KEY incorrecta.
    //   - StripeConnectionError / StripeAPIError: Stripe caído.
    // En todos los casos, log server-side y respuesta neutra al cliente
    // (paid:false) sin filtrar internals. El cliente no debe poder
    // distinguir "session no existe" de "Stripe caído" para no facilitar
    // probing.
    console.error('stripe-session error:', err && err.type, err && err.message);
    return res.status(200).json({ paid: false });
  }
};
