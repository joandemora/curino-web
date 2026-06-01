// /api/config.js
//
// Edge function. Devuelve las claves públicas que el cliente necesita
// para bootstrap (Supabase + Google Maps). El response queda
// BYTE-IDÉNTICO al endpoint Node anterior:
//   - status 200
//   - Content-Type: application/json; charset=utf-8
//   - Cache-Control: public, max-age=3600
//   - Access-Control-Allow-Origin: *
//   - body: {"supabaseUrl":"...","supabaseAnonKey":"...","googleMapsApiKey":"..."}
//
// Se eligió Edge para liberar 1 slot del cap de funciones Node-serverless
// del plan Hobby (12). NO añadir auth, DB, fs/Buffer/crypto/Stripe aquí —
// rompería la compatibilidad Edge.

export const config = { runtime: 'edge' };

export default function handler() {
  const body = JSON.stringify({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
