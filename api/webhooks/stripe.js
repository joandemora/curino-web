const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

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
    const meta = session.metadata || {};

    console.log('=== NUEVO PEDIDO CURINO ===');
    console.log('Session ID:', session.id);
    console.log('Email:', session.customer_details?.email);
    console.log('Metadata:', JSON.stringify(meta));

    // Save order to Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (supabaseUrl && supabaseKey && meta.user_id) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { error } = await supabase.from('orders').insert({
          user_id: meta.user_id,
          configuracion: {
            ancho: meta.ancho ? Number(meta.ancho) : null,
            alto: meta.alto ? Number(meta.alto) : null,
            fondo: meta.fondo ? Number(meta.fondo) : null,
            material: meta.material || null,
            interior: meta.interior || null,
            puertas: meta.puertas || null,
          },
          precio: session.amount_total / 100,
          estado: 'pagado',
        });

        if (error) {
          console.error('Supabase insert error:', error.message);
        } else {
          console.log('Order saved to Supabase for user:', meta.user_id);
        }
      } catch (dbErr) {
        console.error('Supabase connection error:', dbErr.message);
      }
    } else {
      console.log('Order not saved to DB —', !supabaseUrl ? 'missing SUPABASE_URL' : !supabaseKey ? 'missing SUPABASE_SECRET_KEY' : 'missing user_id in metadata');
    }

    console.log('==========================');
  }

  return res.status(200).json({ received: true });
};
