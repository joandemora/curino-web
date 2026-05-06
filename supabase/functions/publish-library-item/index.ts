// supabase/functions/publish-library-item/index.ts
//
// Edge Function: crea row en library_items para una pieza recién subida por un seller.
//
// Flujo:
//   1. Frontend sube DXF a library-dxfs/<user_id>/<uuid>.dxf vía Supabase Client.
//   2. Frontend llama a esta function con { uuid, name, description, price_cents, dxf_path, category, subcategory }.
//   3. Esta function valida, verifica que el archivo existe, y crea la row.
//
// Validaciones:
//   - JWT user válido.
//   - Campos requeridos: uuid (formato UUID), name (max 100), price_cents (0 OR 150-300),
//     dxf_path, category (uno de VALID_CATEGORIES), subcategory (válida para esa category).
//   - dxf_path debe empezar por <user_id>/ (defensa anti-path-traversal).
//   - Archivo existe en Storage.
//   - Si price>0 y user no es admin: is_seller_active(user.id) debe ser true.
//
// Triggers de BD que se aplican automáticamente al INSERT:
//   - validate_paid_item_requires_active_seller
//   - enforce_max_items_per_seller (admin exento)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

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

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const VALID_CATEGORIES = ['asientos', 'mesas', 'almacenamiento', 'iluminacion', 'decoracion', 'exterior', 'otros'];

const SUBCATEGORIES_BY_CATEGORY: Record<string, string[]> = {
  asientos: ['sofas', 'sillas', 'butacas', 'taburetes'],
  mesas: ['mesa-comedor', 'mesa-centro', 'escritorio', 'mesilla'],
  almacenamiento: ['estanteria', 'armario', 'cajonera', 'vitrina'],
  iluminacion: ['lampara-techo', 'lampara-mesa', 'lampara-pie'],
  decoracion: ['cuadros', 'jarrones', 'espejos', 'plantas'],
  exterior: ['silla-exterior', 'mesa-exterior', 'parasol', 'jardineras'],
  otros: ['otros']
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1. Validar JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'auth_required' }, 401);
    }

    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: 'auth_required' }, 401);
    }

    // 2. Parsear body
    const body = await req.json().catch(() => ({}));
    const { uuid, name, description, price_cents, dxf_path, category, subcategory } = body;

    // 3. Validar campos
    if (!uuid || !isValidUuid(uuid)) {
      return jsonResponse({ error: 'invalid_uuid' }, 400);
    }
    if (!name || typeof name !== 'string' || name.length > 100 || name.trim().length === 0) {
      return jsonResponse({ error: 'invalid_name' }, 400);
    }
    if (description && (typeof description !== 'string' || description.length > 500)) {
      return jsonResponse({ error: 'invalid_description' }, 400);
    }
    if (typeof price_cents !== 'number' || !Number.isInteger(price_cents)) {
      return jsonResponse({ error: 'invalid_price' }, 400);
    }
    if (price_cents !== 0 && (price_cents < 150 || price_cents > 300)) {
      return jsonResponse({ error: 'invalid_price' }, 400);
    }
    if (!dxf_path || typeof dxf_path !== 'string') {
      return jsonResponse({ error: 'invalid_dxf_path' }, 400);
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return jsonResponse({ error: 'invalid_category' }, 400);
    }
    const validSubcats = SUBCATEGORIES_BY_CATEGORY[category];
    if (!subcategory || !validSubcats || !validSubcats.includes(subcategory)) {
      return jsonResponse({ error: 'invalid_subcategory' }, 400);
    }

    // 4. Anti path-traversal: dxf_path debe empezar por <user_id>/
    if (!dxf_path.startsWith(`${user.id}/`)) {
      return jsonResponse({ error: 'invalid_dxf_path_prefix' }, 400);
    }

    // 5. Cliente con service_role para operaciones de escritura
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // 6. Verificar que el archivo existe en Storage
    const { data: fileData, error: downloadError } = await supabaseService
      .storage
      .from('library-dxfs')
      .download(dxf_path);

    if (downloadError || !fileData) {
      return jsonResponse({ error: 'file_not_found', detail: downloadError?.message }, 400);
    }

    // 7. Verificar rol admin
    const { data: roleData } = await supabaseUserClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    const isAdmin = roleData?.role === 'admin';

    // 8. Si price>0 y no es admin, validar seller activo
    if (price_cents > 0 && !isAdmin) {
      const { data: isActiveData, error: rpcError } = await supabaseService
        .rpc('is_seller_active', { uid: user.id });

      if (rpcError) {
        console.error('RPC is_seller_active error:', rpcError);
        return jsonResponse({ error: 'internal_error' }, 500);
      }

      if (!isActiveData) {
        // Limpiar archivo huérfano antes de fallar
        await supabaseService.storage.from('library-dxfs').remove([dxf_path]);
        return jsonResponse({ error: 'seller_not_active' }, 403);
      }
    }

    // 9. Construir dxf_url (formato consistente con get-library-dxf-url de Fase A.5)
    const dxfUrl = `${supabaseUrl}/storage/v1/object/public/library-dxfs/${dxf_path}`;

    // 10. INSERT row
    const { data: insertedItem, error: insertError } = await supabaseService
      .from('library_items')
      .insert({
        id: uuid,
        seller_id: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        price_cents,
        status: 'published',
        dxf_url: dxfUrl,
        category,
        subcategory
      })
      .select('id, status, dxf_url')
      .single();

    if (insertError) {
      console.error('INSERT error:', insertError);

      // Limpiar archivo huérfano
      await supabaseService.storage.from('library-dxfs').remove([dxf_path]);

      // Mapear error específico para que el frontend lo muestre bien
      const errMsg = insertError.message.toLowerCase();
      if (errMsg.includes('max_items_per_seller') || errMsg.includes('5')) {
        return jsonResponse({ error: 'max_items_reached' }, 400);
      }
      if (errMsg.includes('paid_item_requires_active_seller')) {
        return jsonResponse({ error: 'seller_not_active' }, 403);
      }
      return jsonResponse({ error: 'insert_failed', detail: insertError.message }, 400);
    }

    return jsonResponse({
      item_id: insertedItem.id,
      status: insertedItem.status,
      dxf_url: insertedItem.dxf_url
    }, 200);

  } catch (err: any) {
    console.error('Unexpected error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
