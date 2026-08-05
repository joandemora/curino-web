// supabase/functions/curso-acceso/index.ts
//
// Edge Function: valida el access_token del enlace del email de
// confirmacion y devuelve los 4 videos del curso + nombre del
// comprador. Invocada desde /clases/acceso/?t=<token>.
//
// Contrato:
//   Body: { token: string }
//   Respuesta 200 siempre (nunca 404 al usuario):
//     { ok: true,  comprador: {nombre}, videos: [{titulo, url_embed}, ...] }
//     { ok: false, error: 'invalid_token' }
//
// verify_jwt=false. Invocada desde /api/curso-acceso con anon key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

// ============================================================
// VIDEOS DEL CURSO -- PENDIENTES DE GRABAR
// ============================================================
// Cuando esten subidos a Vimeo como "Private + Domain-restricted"
// para casacurino.com, sustituir null por la URL de embed:
//   'https://player.vimeo.com/video/XXXXXXX?h=HASH&title=0&byline=0&portrait=0'
// El hash h= es la unlisted key privada del video.
//
// Mientras cualquier url_embed sea null, la pagina /clases/acceso/
// muestra ese bloque con "Disponible proximamente" pero sigue
// renderizando los 4 titulos y el resto de la pagina normal.
// Nunca 404, ni al usuario ni al buyer que ya pago.
// ============================================================
const VIDEOS: Array<{ titulo: string; url_embed: string | null }> = [
  { titulo: 'El negocio por dentro',                 url_embed: null },
  { titulo: 'Los materiales que tienes que conocer', url_embed: null },
  { titulo: 'Cómo se pone precio a un proyecto',     url_embed: null },
  { titulo: 'Preguntas y cierre',                    url_embed: null }
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// base64url: [A-Za-z0-9_-], 43 chars = 32 bytes.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function firstName(fullName: string): string {
  const parts = String(fullName || '').trim().split(/\s+/);
  return parts[0] || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('curso-acceso: missing env');
      return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || '').trim();

    // Cualquier fallo de validacion o BD devuelve { ok: false }
    // con HTTP 200 -- la pagina /clases/acceso/ debe pintar el
    // mensaje amable. Nunca 404 seco.
    if (!TOKEN_RE.test(token)) {
      return jsonResponse({ ok: false, error: 'invalid_token' }, 200);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: inscripcion, error } = await supabase
      .from('inscripciones_curso')
      .select('nombre, estado')
      .eq('access_token', token)
      .maybeSingle();

    if (error) {
      console.error('curso-acceso: db error', error);
      return jsonResponse({ ok: false, error: 'invalid_token' }, 200);
    }
    if (!inscripcion || inscripcion.estado !== 'pagada') {
      return jsonResponse({ ok: false, error: 'invalid_token' }, 200);
    }

    return jsonResponse({
      ok: true,
      comprador: { nombre: firstName(inscripcion.nombre) },
      videos: VIDEOS
    }, 200);

  } catch (err: any) {
    console.error('curso-acceso error:', err);
    return jsonResponse({ ok: false, error: 'internal_error' }, 200);
  }
});
