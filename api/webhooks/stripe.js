const Stripe = require('stripe');

// Disable body parsing — Stripe needs the raw body for signature verification
module.exports.config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];

    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } else {
      // If no webhook secret configured, parse directly (dev only)
      event = JSON.parse(rawBody.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const order = {
      id: session.id,
      email: session.customer_details?.email,
      amount: session.amount_total / 100,
      currency: session.currency,
      status: session.payment_status,
      metadata: session.metadata,
      created: new Date(session.created * 1000).toISOString(),
    };

    // Log the order (replace with database insert in production)
    console.log('=== NUEVO PEDIDO CURINO ===');
    console.log(JSON.stringify(order, null, 2));
    console.log('==========================');

    // TODO: Send confirmation email
    // TODO: Save to database
    // TODO: Notify admin via Slack/email
  }

  return res.status(200).json({ received: true });
};
