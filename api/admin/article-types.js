// /api/admin/article-types.js
//
// GET → lista los tipos editoriales activos de la Revista, ordenados
// por sort_order. Pensado para que el frontend admin rellene el
// dropdown del formulario del generador IA.
//
// Sólo accesible al admin de Curino (check user_roles).
//
// POST/PUT/DELETE: no implementados — los tipos se gestionan
// directamente en la tabla magazine_article_types desde Supabase.

const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 30 };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    console.error('[ai-generator] article-types: missing supabase env');
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
    console.error('[ai-generator] article-types auth', err);
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
    console.error('[ai-generator] article-types role', err);
    return res.status(500).json({ error: 'auth_check_failed' });
  }

  try {
    const { data: types, error } = await admin
      .from('magazine_article_types')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('[ai-generator] article-types query', error);
      return res.status(500).json({ error: 'types_query_failed' });
    }
    return res.status(200).json({ article_types: types || [] });
  } catch (err) {
    console.error('[ai-generator] article-types', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
