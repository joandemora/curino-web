// supabase/functions/_shared/issuer.ts
//
// Datos fiscales del emisor de facturas. Único punto de verdad para código
// nuevo. Los 4 módulos legacy que aún declaran ISSUER inline
// (_shared/invoices.ts, _shared/magazine-invoices.ts,
// _shared/armario-invoices.ts, backfill-invoice/index.ts) no se
// refactorizan aquí para evitar riesgo — se anota como deuda técnica.
//
// email es el visible en el pie del PDF fiscal y como reply_to. El
// remitente técnico Resend es siempre 'Curino <noreply@casacurino.com>'
// por dominio verificado.

export const ISSUER = {
  name: 'SISTEMA & CURINO SLU',
  taxId: 'ESB24788580',
  address: 'Carrer de Balmes 252, 5-2',
  city: '08006 Barcelona, España',
  email: 'info@casacurino.com'
} as const;
