// /api/admin/generator-history.js
//
// GET → histórico paginado de ai_article_generations para la pantalla
// /admin/revista/generador/historico/.
//
// Query params (todos opcionales):
//   status     - pending | success | failed
//   month      - YYYY-MM (mes UTC). Ej: '2026-05'
//   type       - id de magazine_article_types (article_type)
//   page       - 1..N (default 1)
//   page_size  - 1..100 (default 20)
//
// Respuesta:
//   { generations: [...], total: N, page, page_size }
//
// NO devuelve raw_response (puede ser MB). Si haces falta el JSON
// completo úsalo desde Supabase Studio o crea un endpoint específico.
//
// Auth admin (Bearer Supabase + check user_roles.role='admin').

const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 30 };

const VALID_STATUS = ['pending', 'success', 'failed'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const SELECT_COLS = [
  'id',
  'created_at',
  'admin_uuid',
  'brief_topic',
  'article_type',
  'model_used',
  'input_tokens',
  'output_tokens',
  'cost_estimate_usd',
  'status',
  'error_message',
  'article_id',
  'urls_failed'
].join(',');

function parseMonth(m) {
  if (typeof m !== 'string') return null;
  const match = m.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) return null;
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

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
    console.error('[ai-generator] generator-history: missing supabase env');
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
    console.error('[ai-generator] generator-history auth', err);
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
    console.error('[ai-generator] generator-history role', err);
    return res.status(500).json({ error: 'auth_check_failed' });
  }

  // --- Parse query ---
  const q = req.query || {};
  const status = typeof q.status === 'string' && VALID_STATUS.includes(q.status) ? q.status : null;
  const monthRange = parseMonth(q.month);
  if (q.month && !monthRange) {
    return res.status(400).json({ error: 'invalid_month', detail: 'Formato esperado YYYY-MM.' });
  }
  const type = typeof q.type === 'string' && q.type.trim() ? q.type.trim() : null;
  let page = Number.parseInt(q.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  let pageSize = Number.parseInt(q.page_size, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // --- Query ---
  try {
    let query = admin
      .from('ai_article_generations')
      .select(SELECT_COLS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('article_type', type);
    if (monthRange) {
      query = query.gte('created_at', monthRange.start).lt('created_at', monthRange.end);
    }

    const { data, count, error } = await query;
    if (error) {
      console.error('[ai-generator] generator-history query', error);
      return res.status(500).json({ error: 'history_query_failed', detail: error.message });
    }

    return res.status(200).json({
      generations: data || [],
      total: count || 0,
      page,
      page_size: pageSize
    });
  } catch (err) {
    console.error('[ai-generator] generator-history', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
