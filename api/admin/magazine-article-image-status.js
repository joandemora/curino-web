// /api/admin/magazine-article-image-status.js
//
// POST → actualiza el review_status de una imagen sugerida concreta
// dentro del array suggested_images de un artículo de Revista
// generado por IA.
//
// Body: { article_id: uuid, image_index: int, review_status: string }
//
// review_status válidos (en español, alineados con el trigger SQL
// trg_check_ai_article_images que vive en producción y busca
// literal 'pendiente'):
//   - 'pendiente'        → default, bloquea publicación
//   - 'ok'               → revisada, OK para usar
//   - 'sustituir'        → revisada, hay que cambiarla por otra
//   - 'pedir_permiso'    → revisada, contactar al autor
//   - 'descartar'        → revisada, no se usará
//
// Cualquier valor distinto de 'pendiente' desbloquea esa imagen del
// guard de publicación.
//
// Respuesta: { suggested_images: [...] } con el array completo
// actualizado, para que el panel lateral del editor pueda recargar
// el contador "Quedan X sin revisar" sin tener que refetchear el
// artículo entero.
//
// Auth admin (Bearer Supabase + check user_roles.role='admin').

const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 30 };

const VALID_STATUSES = ['pendiente', 'ok', 'sustituir', 'pedir_permiso', 'descartar'];
const UUID_RE = /^[0-9a-f-]{36}$/i;

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', (c) => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    console.error('[ai-generator] image-status: missing supabase env');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return res.status(401).json({ error: 'auth_required' });
  }

  let userId;
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'auth_required' });
    userId = user.id;
  } catch (err) {
    console.error('[ai-generator] image-status auth', err);
    return res.status(401).json({ error: 'auth_required' });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();
    if (!roleRow || roleRow.role !== 'admin') {
      return res.status(403).json({ error: 'admin_only' });
    }
  } catch (err) {
    console.error('[ai-generator] image-status role', err);
    return res.status(500).json({ error: 'auth_check_failed' });
  }

  // --- Body ---
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }

  const articleId = body.article_id;
  if (typeof articleId !== 'string' || !UUID_RE.test(articleId)) {
    return res.status(400).json({ error: 'invalid_article_id' });
  }

  const imageIndex = Number.isFinite(body.image_index) ? Math.floor(body.image_index) : -1;
  if (imageIndex < 0) {
    return res.status(400).json({ error: 'invalid_image_index' });
  }

  const reviewStatus = typeof body.review_status === 'string' ? body.review_status : '';
  if (!VALID_STATUSES.includes(reviewStatus)) {
    return res.status(400).json({
      error: 'invalid_review_status',
      detail: 'Permitidos: ' + VALID_STATUSES.join(', ')
    });
  }

  // --- Update ---
  try {
    const { data: article, error: loadErr } = await admin
      .from('magazine_articles')
      .select('id, suggested_images, ai_generated')
      .eq('id', articleId)
      .maybeSingle();
    if (loadErr) {
      console.error('[ai-generator] image-status load', loadErr);
      return res.status(500).json({ error: 'load_failed' });
    }
    if (!article) {
      return res.status(404).json({ error: 'article_not_found' });
    }
    if (article.ai_generated !== true) {
      return res.status(400).json({ error: 'not_ai_generated', detail: 'Sólo los artículos generados por IA tienen panel de revisión.' });
    }
    const arr = Array.isArray(article.suggested_images) ? article.suggested_images.slice() : [];
    if (imageIndex >= arr.length) {
      return res.status(400).json({ error: 'image_index_out_of_range', detail: 'Index ' + imageIndex + ' fuera de ' + arr.length });
    }

    arr[imageIndex] = Object.assign({}, arr[imageIndex], { review_status: reviewStatus });

    const { data: updated, error: updErr } = await admin
      .from('magazine_articles')
      .update({ suggested_images: arr, updated_at: new Date().toISOString() })
      .eq('id', articleId)
      .select('suggested_images')
      .single();
    if (updErr) {
      console.error('[ai-generator] image-status update', updErr);
      return res.status(500).json({ error: 'update_failed', detail: updErr.message });
    }

    return res.status(200).json({ suggested_images: updated.suggested_images || [] });
  } catch (err) {
    console.error('[ai-generator] image-status', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
