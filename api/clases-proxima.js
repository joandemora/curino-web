// /api/clases-proxima.js
//
// Devuelve la próxima clase abierta desde la vista pública `clases_public`.
// Consumido por la landing /clases para renderizar fecha, plazas y precio.
//
// La vista NO expone meet_url ni datos de comprador — solo id, fecha,
// duración, plazas_totales/ocupadas y precio_cents. Se consulta con la
// anon key (RLS permite SELECT sobre la vista).
//
// Desde 2026-10 devuelve también `plazas_restantes` de la edición activa
// (RPC plazas_intensivo_disponibles: solo un entero, incluye ediciones
// 'agotada' → 0). null si no hay edición activa o la RPC falla; la
// landing muestra entonces el texto genérico de plazas limitadas.
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
    return jsonResponse({ clase: null, plazas_restantes: null }, 200);
  }

  const headers = {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'apikey': SUPABASE_ANON_KEY,
    'Accept': 'application/json'
  };

  const [clase, plazas_restantes] = await Promise.all([
    loadClase(headers),
    loadPlazasRestantes(headers)
  ]);
  return jsonResponse({ clase, plazas_restantes }, 200);
}

async function loadClase(headers) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/clases_public?select=id,fecha,duracion_min,plazas_totales,plazas_ocupadas,precio_cents&limit=1`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const t = await res.text();
      console.error('clases-proxima: supabase error', res.status, t);
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error('clases-proxima error:', err);
    return null;
  }
}

async function loadPlazasRestantes(headers) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/plazas_intensivo_disponibles`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!res.ok) {
      console.error('clases-proxima: rpc plazas error', res.status, await res.text());
      return null;
    }
    const n = await res.json();
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch (err) {
    console.error('clases-proxima: rpc plazas threw', err);
    return null;
  }
}
