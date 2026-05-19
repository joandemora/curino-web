// /api/admin/generator-config.js
//
// GET  → devuelve la fila actual de ai_generator_config + las 5 últimas
//        entradas de ai_generator_config_history.
// PUT  → actualiza la fila id=1. El trigger SQL trg_ai_generator_config_history
//        guarda automáticamente los valores anteriores en history.
//
// Sólo accesible al admin de Curino (check user_roles).

const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 30 };

const HISTORY_LIMIT = 5;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    console.error('[ai-generator] generator-config: missing supabase env');
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
    console.error('[ai-generator] generator-config auth', err);
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
    console.error('[ai-generator] generator-config role', err);
    return res.status(500).json({ error: 'auth_check_failed' });
  }

  // GET
  if (req.method === 'GET') {
    try {
      const [{ data: config, error: cfgErr }, { data: history, error: histErr }] = await Promise.all([
        admin.from('ai_generator_config').select('*').eq('id', 1).maybeSingle(),
        admin
          .from('ai_generator_config_history')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(HISTORY_LIMIT)
      ]);
      if (cfgErr) {
        console.error('[ai-generator] generator-config GET cfg', cfgErr);
        return res.status(500).json({ error: 'config_load_failed' });
      }
      if (histErr) {
        console.error('[ai-generator] generator-config GET hist', histErr);
        return res.status(500).json({ error: 'history_load_failed' });
      }
      return res.status(200).json({ config: config || null, history: history || [] });
    } catch (err) {
      console.error('[ai-generator] generator-config GET', err);
      return res.status(500).json({ error: 'internal_error' });
    }
  }

  // PUT
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }

  const update = { updated_at: new Date().toISOString(), updated_by: userId };
  if (typeof body.system_prompt === 'string' && body.system_prompt.trim().length > 0) {
    update.system_prompt = body.system_prompt;
  }
  if (Number.isFinite(body.default_word_count) && body.default_word_count > 100 && body.default_word_count < 5000) {
    update.default_word_count = Math.round(body.default_word_count);
  }
  if (typeof body.active_model === 'string' && body.active_model.length > 0 && body.active_model.length < 100) {
    update.active_model = body.active_model;
  }
  if (Number.isFinite(body.monthly_cap_eur) && body.monthly_cap_eur >= 0 && body.monthly_cap_eur < 100000) {
    update.monthly_cap_eur = Number(body.monthly_cap_eur);
  }
  if (Number.isFinite(body.hourly_rate_limit) && body.hourly_rate_limit > 0 && body.hourly_rate_limit < 1000) {
    update.hourly_rate_limit = Math.round(body.hourly_rate_limit);
  }

  // Si sólo viene updated_at/updated_by, no hay nada que cambiar.
  const fieldKeys = Object.keys(update).filter((k) => k !== 'updated_at' && k !== 'updated_by');
  if (fieldKeys.length === 0) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }

  try {
    const { data, error } = await admin
      .from('ai_generator_config')
      .update(update)
      .eq('id', 1)
      .select('*')
      .single();
    if (error) {
      console.error('[ai-generator] generator-config PUT', error);
      return res.status(500).json({ error: 'config_update_failed', detail: error.message });
    }
    return res.status(200).json({ config: data });
  } catch (err) {
    console.error('[ai-generator] generator-config PUT', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
