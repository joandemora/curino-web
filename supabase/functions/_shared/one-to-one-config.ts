// supabase/functions/_shared/one-to-one-config.ts
//
// One-to-one Curino Partners · 3 meses. Única fuente del precio que se cobra
// (partners-formaciones) y del que se muestra (/partners/formaciones lo
// recibe de la API). Factura ONE-AAAA-NNNNNN (2.471,07 + 518,93 IVA).

export const ONE_TO_ONE = {
  nombre: 'One-to-one Curino Partners · 3 meses',
  descripcion: '12 sesiones individuales por Zoom en 3 meses + WhatsApp directo con Juan de Mora.',
  precioCents: 299000          // 2.990 € IVA incluido
} as const;

// Casilla de Stripe (art. 103 a TRLGDCU): inicio inmediato a petición del
// cliente; si desiste en 14 días paga la parte proporcional ya prestada.
export const ONE_TO_ONE_TERMINOS = 'Solicito que el servicio comience de inmediato. Sé que puedo desistir en 14 días naturales y que, si lo hago, pagaré la parte proporcional de las sesiones ya realizadas. Acepto las [condiciones de contratación](https://casacurino.com/partners/condiciones/#one-to-one).';
