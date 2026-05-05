// assets/js/library-dxf.js
//
// Helper para obtener DXFs/JSONs de library_items vía Edge Function.
// El bucket library-dxfs es privado desde Fase A; los DXFs no se pueden
// descargar directamente por URL pública. Esta función llama a la Edge
// Function get-library-dxf-url que valida acceso (vía RPC can_download)
// y devuelve una signed URL temporal (TTL 5 min).

(function (global) {
  'use strict';

  // SUPABASE_URL ya está disponible globalmente en los HTMLs que cargan este helper
  // (definido junto con la inicialización del cliente Supabase).
  function getEdgeFunctionUrl() {
    if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL) {
      throw new Error('SUPABASE_URL is not defined');
    }
    return SUPABASE_URL + '/functions/v1/get-library-dxf-url';
  }

  /**
   * Obtiene una signed URL para un library_item.
   * @param {string} itemId - UUID del library_item
   * @param {string|null} viewKey - 'top' | 'side' | 'front' | 'back' | null (null = dxf_url principal)
   * @returns {Promise<string>} signed URL válida durante ~5 minutos
   */
  async function getSignedUrl(itemId, viewKey) {
    if (!itemId) {
      throw new Error('library-dxf.getSignedUrl: itemId is required');
    }

    // Obtener JWT del usuario actual desde el cliente Supabase global
    if (typeof _supabase === 'undefined' || !_supabase) {
      throw new Error('library-dxf: _supabase client is not initialized');
    }
    const { data: { session }, error: sessionError } = await _supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('library-dxf: user is not authenticated');
    }

    const response = await fetch(getEdgeFunctionUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        library_item_id: itemId,
        view: viewKey || null
      })
    });

    if (!response.ok) {
      let errorMsg = 'HTTP ' + response.status;
      try {
        const errBody = await response.json();
        if (errBody && errBody.error) errorMsg = errBody.error;
      } catch (_) {}
      throw new Error('library-dxf.getSignedUrl failed: ' + errorMsg);
    }

    const data = await response.json();
    if (!data.url) {
      throw new Error('library-dxf.getSignedUrl: response missing url');
    }
    return data.url;
  }

  /**
   * Hace un fetch del DXF/JSON de un library_item, obteniendo primero la signed URL.
   * Devuelve la Response del fetch (no parseada). Interfaz compatible con fetch().
   * @param {string} itemId
   * @param {string|null} viewKey
   * @returns {Promise<Response>}
   */
  async function fetchLibraryItem(itemId, viewKey) {
    const signedUrl = await getSignedUrl(itemId, viewKey);
    return fetch(signedUrl);
  }

  /**
   * Si el usuario logueado aún no ha "reclamado" este library_item gratis,
   * inserta una row en purchases (user_id, library_item_id, order_id=null).
   * Idempotente: la tabla tiene UNIQUE(user_id, library_item_id), así que
   * inserts duplicados fallan silenciosamente con error 23505 que ignoramos.
   *
   * IMPORTANTE: solo llamar para items con price_cents === 0. La policy RLS
   * "Users claim free library_items" valida en BD que el item esté published
   * y sea gratis; este check en cliente es solo para no hacer round-trip
   * inútil cuando el item es de pago.
   *
   * @param {string} itemId
   * @returns {Promise<void>}
   */
  async function ensureFreeLibraryClaim(itemId) {
    if (!itemId) {
      throw new Error('library-dxf.ensureFreeLibraryClaim: itemId is required');
    }
    if (typeof _supabase === 'undefined' || !_supabase) {
      throw new Error('library-dxf: _supabase client is not initialized');
    }

    const { data: { user }, error: userError } = await _supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('library-dxf: user is not authenticated');
    }

    const { error: insertError } = await _supabase
      .from('purchases')
      .insert({
        user_id: user.id,
        library_item_id: itemId,
        order_id: null
      });

    if (insertError) {
      // 23505 = unique violation = ya existía la row, todo OK
      if (insertError.code === '23505') {
        return;
      }
      // Cualquier otro error sí es problema
      throw new Error('library-dxf.ensureFreeLibraryClaim failed: ' + (insertError.message || insertError.code));
    }
  }

  global.LibraryDxf = {
    getSignedUrl: getSignedUrl,
    fetchLibraryItem: fetchLibraryItem,
    ensureFreeLibraryClaim: ensureFreeLibraryClaim
  };

})(typeof window !== 'undefined' ? window : globalThis);
