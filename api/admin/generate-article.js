// /api/admin/generate-article.js
//
// POST — Genera un artículo de Revista vía Claude (Anthropic API).
//
// Sólo accesible para el admin de Curino. La fila resultante en
// magazine_articles queda en status='draft' para que el admin la
// revise/edite antes de publicar desde /admin/revista/publicar/.
//
// Pasos:
//  1. Auth admin (Bearer token Supabase + check user_roles).
//  2. Validar body: 'topic' y 'type' son obligatorios. 'type' debe
//     existir en magazine_article_types con active=true.
//  3. Cargar ai_generator_config + fila del tipo (default_word_count,
//     type_guidance).
//  4. Rate limit horario + monthly cap en EUR.
//  5. Insert fila ai_article_generations con status='pending'.
//  6. Fetch fuentes URL en paralelo (Promise.allSettled + timeout 10s).
//  7. Llamar Anthropic API /v1/messages componiendo system prompt =
//     base + bloque específico del tipo (type_guidance[type]).
//  8. Parsear JSON estricto del modelo.
//  9. Insert magazine_articles (status='draft', type=<recibido>,
//     ai_generated=true).
// 10. Update ai_article_generations a status='success' con métricas.
// 11. Devolver { article_id, slug, generation_id, urls_failed, cost_estimate_usd, suggested_images_count }.
//
// Errores: try/catch por paso. Siempre que se ha creado la fila de
// generación, antes de devolver error se actualiza con status='failed'
// + error_message para auditoría.

const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 300 };

const ADMIN_UUID = 'a36ca0a3-4b67-413f-ac0f-f2ddb69ae008';
const EUR_USD_RATE = 1.08; // 1 EUR = 1.08 USD (tasa fija para conversión cap)
const URL_FETCH_TIMEOUT_MS = 10_000;
const MAX_URLS = 5;
const MAX_HTML_BYTES = 1_500_000; // 1.5 MB por URL
const MAX_TEXT_PER_URL = 12_000;  // caracteres tras limpieza
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Precios por modelo (USD por 1M tokens) — actualizar si Anthropic cambia tarifa.
const MODEL_PRICING = {
  'claude-opus-4-7':       { input: 5,  output: 25 },
  'claude-sonnet-4-6':     { input: 3,  output: 15 },
  // Fallback genérico por familia para futuras versiones
  'opus':   { input: 5,  output: 25 },
  'sonnet': { input: 3,  output: 15 }
};

function priceFor(model) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  if (model && model.includes('opus')) return MODEL_PRICING.opus;
  if (model && model.includes('sonnet')) return MODEL_PRICING.sonnet;
  return MODEL_PRICING['claude-opus-4-7'];
}

function logErr(step, err) {
  console.error('[ai-generator]', step, err && (err.stack || err.message || err));
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

function stripHtmlToText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\/?(?:nav|header|footer|aside|form|iframe|svg|noscript)[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
       .replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

async function fetchUrlText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CurinoBot/1.0; +https://casacurino.com)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(t);
    if (!res.ok) throw new Error('http_' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) throw new Error('not_html');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) throw new Error('too_large');
    const text = stripHtmlToText(Buffer.from(buf).toString('utf8'));
    return text.slice(0, MAX_TEXT_PER_URL);
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

function buildUserMessage({ topic, angle, extraInstructions, wordCount, sources, relatedPiece }) {
  const parts = [];
  parts.push('BRIEF DEL ARTÍCULO');
  parts.push('');
  parts.push('Tema: ' + topic);
  if (angle) parts.push('Ángulo: ' + angle);
  if (extraInstructions) parts.push('Instrucciones extra: ' + extraInstructions);
  parts.push('Longitud objetivo: ~' + wordCount + ' palabras');
  parts.push('');

  if (relatedPiece) {
    parts.push('PIEZA RELACIONADA YA PUBLICADA EN CURINO (puedes referenciarla):');
    parts.push('- ' + (relatedPiece.title || '') + ' (id=' + relatedPiece.id + ', slug=' + relatedPiece.slug + ')');
    parts.push('');
  }

  if (sources && sources.length) {
    parts.push('FUENTES EXTERNAS (texto extraído):');
    sources.forEach((s, i) => {
      parts.push('--- FUENTE ' + (i + 1) + ': ' + s.url);
      parts.push(s.text || '(sin texto extraído)');
      parts.push('');
    });
  }

  parts.push('Devuelve EXCLUSIVAMENTE el JSON estricto descrito en el system prompt. Sin texto adicional ni bloques markdown.');
  return parts.join('\n');
}

function extractJsonFromText(text) {
  if (!text) return null;
  // Quitar fences markdown si Claude los añadiera por accidente.
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Intento directo
  try { return JSON.parse(t); } catch (_) { /* sigue */ }
  // Localizar primer { y último } por fallback
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try { return JSON.parse(t.slice(first, last + 1)); } catch { return null; }
}

function clampString(v, max) {
  if (typeof v !== 'string') return null;
  return v.trim().slice(0, max);
}

function slugify(base) {
  if (typeof base !== 'string') return '';
  return base
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
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

  // --- 0. ENV ---
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    logErr('config', 'missing supabase env');
    return res.status(500).json({ error: 'server_misconfigured', detail: 'supabase env missing' });
  }
  if (!ANTHROPIC_API_KEY) {
    logErr('config', 'missing ANTHROPIC_API_KEY');
    return res.status(500).json({ error: 'server_misconfigured', detail: 'anthropic key missing' });
  }

  // --- 1. AUTH ADMIN ---
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

  // --- 2. BODY ---
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const topic = clampString(body.topic, 500);
  if (!topic) return res.status(400).json({ error: 'missing_topic' });

  const typeId = typeof body.type === 'string' ? body.type.trim() : '';
  if (!typeId) return res.status(400).json({ error: 'missing_type' });

  const angle = clampString(body.angle, 1000);
  const extraInstructions = clampString(body.extra_instructions, 2000);
  const relatedPieceId = typeof body.related_piece_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.related_piece_id)
    ? body.related_piece_id : null;

  let sourceUrls = [];
  if (Array.isArray(body.source_urls)) {
    sourceUrls = body.source_urls
      .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
      .slice(0, MAX_URLS);
  }

  // --- 3. CONFIG + TIPO + LÍMITES ---
  const [{ data: config, error: cfgErr }, { data: typeRow, error: typeErr }] = await Promise.all([
    admin.from('ai_generator_config').select('*').eq('id', 1).maybeSingle(),
    admin.from('magazine_article_types').select('*').eq('id', typeId).eq('active', true).maybeSingle()
  ]);
  if (cfgErr || !config) {
    logErr('config-load', cfgErr || 'no row');
    return res.status(500).json({ error: 'config_missing' });
  }
  if (typeErr) {
    logErr('type-load', typeErr);
    return res.status(500).json({ error: 'type_check_failed' });
  }
  if (!typeRow) {
    return res.status(400).json({ error: 'invalid_type', detail: 'Tipo desconocido o inactivo: ' + typeId });
  }

  const wordCount = Number.isFinite(body.word_count) && body.word_count > 100 && body.word_count < 5000
    ? Math.round(body.word_count)
    : Number(typeRow.default_word_count || config.default_word_count);

  const typeGuidance = (config.type_guidance && typeof config.type_guidance === 'object')
    ? (config.type_guidance[typeId] || '')
    : '';

  // Rate limit horario
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: lastHourCount, error: rlErr } = await admin
    .from('ai_article_generations')
    .select('id', { count: 'exact', head: true })
    .eq('admin_uuid', userId)
    .gte('created_at', oneHourAgo);
  if (rlErr) {
    logErr('rate-limit-query', rlErr);
    return res.status(500).json({ error: 'rate_limit_check_failed' });
  }
  if ((lastHourCount || 0) >= config.hourly_rate_limit) {
    return res.status(429).json({
      error: 'rate_limited',
      detail: 'Has alcanzado el límite por hora (' + config.hourly_rate_limit + ').'
    });
  }

  // Monthly cap
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { data: monthRows, error: monErr } = await admin
    .from('ai_article_generations')
    .select('cost_estimate_usd')
    .gte('created_at', monthStart.toISOString())
    .eq('status', 'success');
  if (monErr) {
    logErr('month-query', monErr);
    return res.status(500).json({ error: 'month_check_failed' });
  }
  const monthUsd = (monthRows || []).reduce((acc, r) => acc + Number(r.cost_estimate_usd || 0), 0);
  const monthEur = monthUsd / EUR_USD_RATE;
  if (monthEur >= Number(config.monthly_cap_eur)) {
    return res.status(402).json({
      error: 'monthly_cap_reached',
      detail: 'Cap mensual alcanzado: ' + monthEur.toFixed(2) + ' / ' + Number(config.monthly_cap_eur).toFixed(2) + ' EUR.'
    });
  }

  // --- 4. INSERT generación pending ---
  const { data: genRow, error: genErr } = await admin
    .from('ai_article_generations')
    .insert({
      admin_uuid: userId,
      brief_topic: topic,
      brief_angle: angle,
      brief_source_urls: sourceUrls,
      brief_related_piece_id: relatedPieceId,
      brief_extra_instructions: extraInstructions,
      model_used: config.active_model,
      article_type: typeId,
      status: 'pending'
    })
    .select('id')
    .single();
  if (genErr || !genRow) {
    logErr('insert-generation', genErr);
    return res.status(500).json({ error: 'generation_insert_failed' });
  }
  const generationId = genRow.id;

  const failGeneration = async (errCode, detail, httpCode, rawPayload) => {
    try {
      await admin.from('ai_article_generations').update({
        status: 'failed',
        error_message: (errCode || '') + (detail ? (': ' + String(detail).slice(0, 500)) : ''),
        raw_response: rawPayload || null
      }).eq('id', generationId);
    } catch (e) {
      logErr('fail-update', e);
    }
    return res.status(httpCode || 500).json({ error: errCode, detail, generation_id: generationId });
  };

  // --- 5. FETCH URLs ---
  const urlsFailed = [];
  const sources = [];
  if (sourceUrls.length > 0) {
    const results = await Promise.allSettled(sourceUrls.map((u) => fetchUrlText(u)));
    results.forEach((r, i) => {
      const u = sourceUrls[i];
      if (r.status === 'fulfilled' && r.value && r.value.length > 50) {
        sources.push({ url: u, text: r.value });
      } else {
        urlsFailed.push(u);
      }
    });
    if (sourceUrls.length > 0 && sources.length === 0) {
      return failGeneration('all_urls_failed', 'Ninguna URL pudo descargarse o extraerse.', 400);
    }
  }

  // --- 6. ANTHROPIC ---
  const relatedPiece = relatedPieceId ? await (async () => {
    try {
      const { data } = await admin
        .from('magazine_articles')
        .select('id, title, slug')
        .eq('id', relatedPieceId)
        .maybeSingle();
      return data || null;
    } catch (e) { return null; }
  })() : null;

  const userMsg = buildUserMessage({
    topic, angle, extraInstructions, wordCount, sources, relatedPiece
  });

  // Componer system prompt: base + bloque específico del tipo.
  let systemPrompt = config.system_prompt + '\n\nTIPO DE ARTÍCULO A GENERAR: ' + typeId;
  if (typeGuidance) {
    systemPrompt += '\n\nINSTRUCCIONES ESPECÍFICAS PARA ESTE TIPO:\n' + typeGuidance;
  }

  let claudeRaw;
  let claudeJson;
  try {
    const apiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.active_model,
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    claudeRaw = await apiRes.text();
    if (!apiRes.ok) {
      logErr('anthropic-http', apiRes.status + ' ' + claudeRaw.slice(0, 500));
      return failGeneration('anthropic_error', 'HTTP ' + apiRes.status, 502, { http_status: apiRes.status, body: claudeRaw });
    }
    try { claudeJson = JSON.parse(claudeRaw); }
    catch (e) {
      logErr('anthropic-parse', e);
      return failGeneration('anthropic_invalid_response', 'No se pudo parsear la respuesta de Anthropic', 502, { body: claudeRaw });
    }
  } catch (err) {
    logErr('anthropic-fetch', err);
    return failGeneration('anthropic_fetch_failed', err && err.message, 502);
  }

  // --- 7. PARSE JSON del modelo ---
  const contentBlocks = Array.isArray(claudeJson.content) ? claudeJson.content : [];
  const textBlock = contentBlocks.find((b) => b && b.type === 'text');
  const modelText = textBlock ? textBlock.text : '';
  const parsed = extractJsonFromText(modelText);
  if (!parsed || typeof parsed !== 'object') {
    return failGeneration('model_json_invalid', 'El modelo no devolvió JSON parseable.', 502, claudeJson);
  }

  const usage = claudeJson.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const px = priceFor(config.active_model);
  const costUsd = (inputTokens * px.input + outputTokens * px.output) / 1_000_000;
  const costUsdRounded = Math.round(costUsd * 10000) / 10000;

  // --- 8. INSERT artículo ---
  const title = clampString(parsed.title, 200) || topic.slice(0, 80);
  const metaDescription = clampString(parsed.meta_description, 320);
  const contentHtml = typeof parsed.content_html === 'string' ? parsed.content_html : '';
  const suggestedImages = Array.isArray(parsed.suggested_images) ? parsed.suggested_images : [];
  const externalRefs = Array.isArray(parsed.external_references) ? parsed.external_references : [];

  // Slug único: parte del propuesto por el modelo o lo derivamos del título.
  let baseSlug = slugify(parsed.slug || title);
  if (!baseSlug) baseSlug = 'articulo-' + Date.now();
  let slug = baseSlug;
  for (let i = 1; i < 50; i++) {
    const { data: clash } = await admin
      .from('magazine_articles')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!clash) break;
    slug = baseSlug + '-' + i;
  }

  const { data: articleRow, error: artErr } = await admin
    .from('magazine_articles')
    .insert({
      user_id: ADMIN_UUID,
      title,
      slug,
      type: typeId,
      content_html: contentHtml,
      meta_description: metaDescription,
      status: 'draft',
      author_first_name: 'Curino',
      author_last_name: '',
      author_contact_email: null,
      edited_by_admin: false,
      ai_generated: true,
      ai_generation_id: generationId,
      suggested_images: suggestedImages,
      external_references: externalRefs,
      admin_notes: 'Generado por IA. Generation ID: ' + generationId
    })
    .select('id, slug')
    .single();
  if (artErr || !articleRow) {
    logErr('insert-article', artErr);
    return failGeneration('article_insert_failed', artErr && artErr.message, 500, claudeJson);
  }

  // --- 9. UPDATE generación success ---
  try {
    await admin.from('ai_article_generations').update({
      status: 'success',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_estimate_usd: costUsdRounded,
      article_id: articleRow.id,
      urls_failed: urlsFailed,
      raw_response: claudeJson
    }).eq('id', generationId);
  } catch (err) {
    logErr('update-success', err);
    // El artículo ya está creado; no devolvemos error.
  }

  // --- 10. RESPONSE ---
  return res.status(200).json({
    article_id: articleRow.id,
    slug: articleRow.slug,
    generation_id: generationId,
    urls_failed: urlsFailed,
    cost_estimate_usd: costUsdRounded,
    suggested_images_count: suggestedImages.length
  });
};
