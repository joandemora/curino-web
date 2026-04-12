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
    const { ancho, alto, fondo, material, interior, puertas, precio } = body;

    // Validate required fields
    if (!ancho || !alto || !fondo || !precio) {
      console.error('Missing fields:', { ancho, alto, fondo, precio });
      return res.status(400).json({
        error: 'Faltan campos obligatorios',
        detail: { ancho: !!ancho, alto: !!alto, fondo: !!fondo, precio: !!precio }
      });
    }

    // Validate price is a positive number
    const precioNum = parseInt(precio, 10);
    if (isNaN(precioNum) || precioNum < 100 || precioNum > 50000) {
      console.error('Invalid price:', precio, '→', precioNum);
      return res.status(400).json({ error: 'Precio no válido: ' + precio });
    }

    // Server-side price validation
    const area = (ancho / 100) * (alto / 100);
    const basePrice = 1200 + area * 320;
    console.log('Price validation:', { precioNum, basePrice, area, min: basePrice * 0.5, max: basePrice * 3 });

    if (precioNum < basePrice * 0.5 || precioNum > basePrice * 3) {
      return res.status(400).json({
        error: 'Precio fuera de rango válido',
        detail: { precio: precioNum, base: Math.round(basePrice) }
      });
    }

    const description = `Armario ${ancho}×${alto}×${fondo}cm — ${material || 'Wengue'}`;
    const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || 'https://casacurino.com';

    console.log('Creating Stripe session:', { description, precioNum, origin });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: 'eur',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Armario a medida Curino',
              description: description,
            },
            unit_amount: precioNum * 100,
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
      },
      success_url: `${origin}/configurador-armarios-vestidores/confirmacion/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/configurador-armarios-vestidores/`,
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
