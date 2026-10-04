// supabase/functions/_shared/sesion-config.ts
//
// "Sesion 1:1 con Juan · 30 min": precios y ventana de oferta. Unica fuente
// de verdad del precio que se cobra (partners-formaciones) y del que se
// muestra (/partners/formaciones lo recibe de la API, nunca lo calcula).

export const SESION = {
  nombre: 'Sesión 1:1 con Juan · 30 min',
  descripcion: 'Videollamada de 30 minutos con Juan de Mora + recursos iniciales para empezar en el sector.',
  precioOfertaCents: 6000,     // 60 € IVA incluido
  precioNormalCents: 15000,    // 150 € IVA incluido
  ofertaHoras: 3               // desde partners_solicitudes.oferta_sesion_enviada_at
} as const;

// Precio vigente para un lead segun la hora de envio de la oferta (servidor).
export function precioSesion(ofertaEnviadaAt: string | null | undefined, ahora = Date.now()): {
  precio_cents: number;
  precio_tipo: 'oferta' | 'normal';
  oferta_expira_at: string | null;
} {
  if (ofertaEnviadaAt) {
    const expira = new Date(ofertaEnviadaAt).getTime() + SESION.ofertaHoras * 3600_000;
    if (!isNaN(expira) && ahora < expira) {
      return { precio_cents: SESION.precioOfertaCents, precio_tipo: 'oferta', oferta_expira_at: new Date(expira).toISOString() };
    }
  }
  return { precio_cents: SESION.precioNormalCents, precio_tipo: 'normal', oferta_expira_at: null };
}
