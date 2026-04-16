const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check Stripe key
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not defined in environment variables');
    return res.status(500).json({ error: 'Stripe no configurado en el servidor' });
  }

  // Parse body manually if needed (Vercel may not auto-parse)
  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      if (typeof body === 'string') {
        body = JSON.parse(body);
      } else {
        // Read raw body
        const chunks = [];
        await new Promise((resolve, reject) => {
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', resolve);
          req.on('error', reject);
        });
        body = JSON.parse(Buffer.concat(chunks).toString());
      }
    } catch (parseErr) {
      console.error('Body parse error:', parseErr.message);
      console.error('Raw body type:', typeof req.body);
      return res.status(400).json({ error: 'No se pudo leer el cuerpo de la petición' });
    }
  }

  console.log('Checkout request body:', JSON.stringify(body));

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { ancho, alto, fondo, material, interior, puertas, precio, user_id, customer_email,
      shipping_name, shipping_line, shipping_city, shipping_postal,
      shipping_province, shipping_country, shipping_phone } = body;

    // Validate required fields
    if (!ancho || !alto || !fondo || !precio) {
      console.error('Missing fields:', { ancho, alto, fondo, precio });
      return res.status(400).json({
        error: 'Faltan campos obligatorios',
        detail: { ancho: !!ancho, alto: !!alto, fondo: !!fondo, precio: !!precio }
      });
    }

    // Validate price is a positive number
    const precioNum = parseFloat(precio);
    if (isNaN(precioNum) || precioNum < 100 || precioNum > 200000) {
      console.error('Invalid price:', precio, '→', precioNum);
      return res.status(400).json({ error: 'Precio no válido: ' + precio });
    }

    const description = `Armario ${ancho}×${alto}×${fondo}cm — ${material || 'Wengue'}`;
    const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || 'https://casacurino.com';

    console.log('Creating Stripe session:', { description, precioNum, origin, customer_email });

    // Find or create Stripe customer (required for customer_balance / bank transfer)
    const email = customer_email || '';
    let customer;
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        customer = existing.data[0];
      } else {
        customer = await stripe.customers.create({
          email,
          name: shipping_name || '',
          metadata: { user_id: user_id || '' },
        });
      }
    } else {
      customer = await stripe.customers.create({
        metadata: { user_id: user_id || '' },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: 'eur',
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Armario a medida Curino',
              description: description,
            },
            unit_amount: Math.round(precioNum * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        ancho: String(ancho),
        alto: String(alto),
        fondo: String(fondo),
        material: material || '',
        interior: interior || '',
        puertas: puertas || '',
        precio_eur: String(precioNum),
        user_id: user_id || '',
        shipping_name: shipping_name || '',
        shipping_line: shipping_line || '',
        shipping_city: shipping_city || '',
        shipping_postal: shipping_postal || '',
        shipping_province: shipping_province || '',
        shipping_country: shipping_country || '',
        shipping_phone: shipping_phone || '',
      },
      success_url: `${origin}/configurador-armarios-vestidores/confirmacion/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout/`,
    });

    console.log('Stripe session created:', session.id);
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('=== STRIPE ERROR ===');
    console.error('Type:', err.type);
    console.error('Code:', err.code);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    console.error('Raw:', JSON.stringify(err, null, 2));
    return res.status(500).json({
      error: 'Error al crear la sesión de pago',
      detail: err.message
    });
  }
};
