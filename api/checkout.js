const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { ancho, alto, fondo, material, interior, puertas, precio } = req.body;

    // Validate required fields
    if (!ancho || !alto || !fondo || !precio) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    // Validate price is a positive number
    const precioNum = parseInt(precio, 10);
    if (isNaN(precioNum) || precioNum < 100 || precioNum > 50000) {
      return res.status(400).json({ error: 'Precio no válido' });
    }

    // Server-side price validation
    // Base price calculation (must match client-side calcPrice)
    const area = (ancho / 100) * (alto / 100);
    const basePrice = 1200 + area * 320;
    // Allow 20% tolerance for material/interior variations
    if (precioNum < basePrice * 0.5 || precioNum > basePrice * 3) {
      return res.status(400).json({ error: 'Precio fuera de rango válido' });
    }

    const description = `Armario ${ancho}×${alto}×${fondo}cm — ${material || 'Wengue'}`;

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
              images: ['https://casacurino.com/assets/imagenes/logo-curino.svg'],
            },
            unit_amount: precioNum * 100, // Stripe uses cents
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
      success_url: `${req.headers.origin || 'https://casacurino.com'}/configurador-armarios-vestidores/confirmacion/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://casacurino.com'}/configurador-armarios-vestidores/`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    return res.status(500).json({ error: 'Error al crear la sesión de pago' });
  }
};
