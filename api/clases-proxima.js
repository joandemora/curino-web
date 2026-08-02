// /api/clases-proxima.js
//
// Devuelve la próxima clase abierta desde la vista pública `clases_public`.
// Consumido por la landing /clases para renderizar fecha, plazas y precio.
//
// La vista NO expone meet_url ni datos de comprador — solo id, fecha,
// duración, plazas_totales/ocupadas y precio_cents. Se consulta con la
// anon key (RLS permite SELECT sobre la vista).
//
// Cache corta en el edge para aliviar picos de tráfico desde IG sin
// quedar más de 30s desactualizada.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      ...extraHeaders
    }
  });
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  if (!SUPABASE_ANON_KEY) {
    console.error('clases-proxima: SUPABASE_ANON_KEY missing');
    return jsonResponse({ clase: null }, 200);
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/clases_public?select=id,fecha,duracion_min,plazas_totales,plazas_ocupadas,precio_cents&limit=1`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Accept': 'application/json'
      }
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('clases-proxima: supabase error', res.status, t);
      return jsonResponse({ clase: null }, 200);
    }
    const rows = await res.json();
    const clase = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    return jsonResponse({ clase }, 200);
  } catch (err) {
    console.error('clases-proxima error:', err);
    return jsonResponse({ clase: null }, 200);
  }
}
