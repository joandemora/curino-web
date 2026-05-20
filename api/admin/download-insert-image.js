// /api/admin/download-insert-image.js
//
// POST → descarga una imagen desde una URL pública (que el admin
// pega en el panel lateral del editor de un artículo generado por
// IA), la sube al bucket 'magazine-articles' de Supabase Storage
// y devuelve la URL pública resultante para que el frontend la
// inserte en el editor TipTap.
//
// Body: { article_id: uuid, image_index: int, image_url: string }
//
// Lógica:
//   1. Auth admin (Bearer Supabase + check user_roles.role='admin').
//   2. Validar image_url: http(s), termina en jpg|jpeg|png|webp|avif
//      (o Content-Type de la respuesta es image/*).
//   3. Fetch con timeout 15s + límite 10MB.
//   4. Subir al bucket con service_role (bypasea RLS):
//        path = 'ai-inserted/<article_id>/<ts>-<rand>.<ext>'.
//   5. Cargar metadatos de la imagen sugerida desde el artículo
//      (photographer, author_studio, source_url) para registro de
//      trazabilidad.
//   6. INSERT en ai_inserted_images.
//   7. Devolver { public_url, stored_path }.
//
// La decisión legal de qué imagen insertar es del admin. Este
// endpoint sólo ejecuta lo que el admin valida y deja log.

const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 60 };

const UUID_RE = /^[0-9a-f-]{36}$/i;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif'
};
const BUCKET = 'magazine-articles';

function logErr(step, err) {
  console.error('[ai-image-insert]', step, err && (err.stack || err.message || err));
}

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

function isValidUrl(u) {
  if (typeof u !== 'string') return false;
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch { return false; }
}

function randomId() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
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
    logErr('config', 'missing supabase env');
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
    logErr('auth', err);
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
    logErr('role-check', err);
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

  const imageUrl = body.image_url;
  if (!isValidUrl(imageUrl)) {
    return res.status(400).json({ error: 'invalid_image_url' });
  }

  // --- Cargar artículo y datos de la imagen sugerida para trazabilidad ---
  let article;
  try {
    const { data, error } = await admin
      .from('magazine_articles')
      .select('id, suggested_images, ai_generated')
      .eq('id', articleId)
      .maybeSingle();
    if (error) throw error;
    article = data;
  } catch (err) {
    logErr('load-article', err);
    return res.status(500).json({ error: 'load_article_failed' });
  }
  if (!article) return res.status(404).json({ error: 'article_not_found' });
  if (article.ai_generated !== true) {
    return res.status(400).json({ error: 'not_ai_generated' });
  }
  const imgs = Array.isArray(article.suggested_images) ? article.suggested_images : [];
  if (imageIndex >= imgs.length) {
    return res.status(400).json({ error: 'image_index_out_of_range' });
  }
  const suggested = imgs[imageIndex] || {};

  // --- Descargar la imagen ---
  let buf;
  let mime;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const fres = await fetch(imageUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CurinoBot/1.0; +https://casacurino.com)',
        'Accept': 'image/*'
      }
    });
    clearTimeout(t);
    if (!fres.ok) {
      logErr('fetch-http', fres.status + ' ' + imageUrl);
      return res.status(400).json({ error: 'image_fetch_failed', detail: 'HTTP ' + fres.status });
    }
    const ct = (fres.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!ALLOWED_MIMES.includes(ct)) {
      return res.status(400).json({
        error: 'invalid_image_type',
        detail: 'La URL no apunta a una imagen válida (Content-Type: ' + (ct || 'desconocido') + ').'
      });
    }
    mime = ct;

    // Lee con límite explícito de tamaño.
    const ab = await fres.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      return res.status(400).json({
        error: 'image_too_large',
        detail: 'Imagen mayor de 10 MB (' + Math.round(ab.byteLength / 1024 / 1024) + ' MB).'
      });
    }
    buf = Buffer.from(ab);
  } catch (err) {
    logErr('fetch', err);
    const aborted = err && err.name === 'AbortError';
    return res.status(400).json({
      error: aborted ? 'image_fetch_timeout' : 'image_fetch_failed',
      detail: err && err.message
    });
  }

  // --- Subir al bucket ---
  const ext = MIME_TO_EXT[mime] || 'jpg';
  const storedPath = 'ai-inserted/' + articleId + '/' + Date.now() + '-' + randomId() + '.' + ext;
  try {
    const { error: upErr } = await admin
      .storage
      .from(BUCKET)
      .upload(storedPath, buf, {
        contentType: mime,
        cacheControl: '3600',
        upsert: false
      });
    if (upErr) {
      logErr('upload', upErr);
      return res.status(500).json({ error: 'upload_failed', detail: upErr.message });
    }
  } catch (err) {
    logErr('upload-throw', err);
    return res.status(500).json({ error: 'upload_failed' });
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(storedPath);
  const publicUrl = (pub && pub.publicUrl) || null;
  if (!publicUrl) {
    // Si por lo que sea Supabase no devuelve URL, la construimos a mano con
    // el mismo formato canónico para que el SSR la transforme igual.
    // /storage/v1/object/public/<bucket>/<path>
  }
  const finalPublicUrl = publicUrl || (SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + storedPath);

  // --- Log de trazabilidad ---
  try {
    await admin.from('ai_inserted_images').insert({
      article_id: articleId,
      image_index: imageIndex,
      original_url: imageUrl,
      stored_path: storedPath,
      photographer: suggested.photographer || null,
      author_studio: suggested.author_studio || null,
      source_url: suggested.source_url || null,
      inserted_by: userId
    });
  } catch (err) {
    // No bloqueamos la inserción si el log falla; lo dejamos en consola.
    logErr('log-insert', err);
  }

  return res.status(200).json({
    public_url: finalPublicUrl,
    stored_path: storedPath
  });
};
