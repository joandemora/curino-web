// supabase/functions/get-library-dxf-url/index.ts
//
// Edge Function: devuelve una signed URL temporal para descargar un DXF/JSON
// de un library_item, validando previamente que el usuario tiene acceso vía
// el RPC can_download().
//
// Input (JSON body):
//   {
//     "library_item_id": "uuid",
//     "view": "top" | "side" | "front" | "back" | null  // null = dxf_url principal
//   }
//
// Output (200):
//   { "url": "https://...", "expires_in": 300 }
//
// Errores:
//   401 - no autenticado
//   403 - no tiene acceso (can_download = false)
//   404 - library_item no existe o la view solicitada no existe
//   400 - input mal formado

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutos

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Validar input
    const body = await req.json().catch(() => null);
    if (!body || typeof body.library_item_id !== 'string') {
      return jsonResponse({ error: 'Missing library_item_id' }, 400);
    }
    const itemId = body.library_item_id;
    const view = body.view ?? null; // null = dxf_url principal

    if (view !== null && !['top', 'side', 'front', 'back'].includes(view)) {
      return jsonResponse({ error: 'Invalid view' }, 400);
    }

    // 2. Validar auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    // Cliente con el JWT del usuario (para validar identidad)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseUserClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'Invalid token' }, 401);
    }

    // 3. Validar acceso vía RPC can_download
    const { data: canDownload, error: rpcError } = await supabaseUserClient
      .rpc('can_download', { uid: user.id, item_id: itemId });

    if (rpcError) {
      console.error('RPC can_download error:', rpcError);
      return jsonResponse({ error: 'Authorization check failed' }, 500);
    }

    if (!canDownload) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    // 4. Cliente service_role para leer library_items y generar signed URL
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: item, error: itemError } = await supabaseAdminClient
      .from('library_items')
      .select('dxf_url, views')
      .eq('id', itemId)
      .single();

    if (itemError || !item) {
      return jsonResponse({ error: 'Item not found' }, 404);
    }

    // 5. Extraer el path del Storage de la URL guardada
    let publicUrl: string | null = null;
    if (view === null) {
      publicUrl = item.dxf_url;
    } else {
      publicUrl = item.views?.[view]?.dxf_url ?? null;
    }

    if (!publicUrl) {
      return jsonResponse({ error: `View ${view ?? 'main'} not available for this item` }, 404);
    }

    // Las URLs públicas tienen formato:
    //   https://<ref>.supabase.co/storage/v1/object/public/library-dxfs/<path>
    // Extraemos el path tras '/library-dxfs/'
    const marker = '/library-dxfs/';
    const markerIdx = publicUrl.indexOf(marker);
    if (markerIdx === -1) {
      return jsonResponse({ error: 'Stored URL is not a library-dxfs URL' }, 500);
    }
    const storagePath = publicUrl.substring(markerIdx + marker.length);

    // 6. Generar signed URL
    const { data: signedData, error: signedError } = await supabaseAdminClient
      .storage
      .from('library-dxfs')
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (signedError || !signedData) {
      console.error('createSignedUrl error:', signedError);
      return jsonResponse({ error: 'Failed to generate signed URL' }, 500);
    }

    return jsonResponse({
      url: signedData.signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
