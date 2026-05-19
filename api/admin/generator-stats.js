// /api/admin/generator-stats.js
//
// GET → estadísticas del generador de artículos por IA:
//   {
//     this_month: { generations_count, cost_eur_used, cost_eur_cap, percentage_used },
//     last_10_generations: [...],
//     failed_count_last_30_days
//   }
//
// Sólo accesible al admin de Curino (check user_roles).

const { createClient } = require('@supabase/supabase-js');

module.exports.config = { maxDuration: 30 };

const EUR_USD_RATE = 1.08;

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
    console.error('[ai-generator] generator-stats: missing supabase env');
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
    console.error('[ai-generator] generator-stats auth', err);
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
    console.error('[ai-generator] generator-stats role', err);
    return res.status(500).json({ error: 'auth_check_failed' });
  }

  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      { data: cfg },
      { data: monthRows, error: monthErr },
      { count: monthCount, error: monthCountErr },
      { data: lastTen, error: lastErr },
      { count: failed30, error: failErr }
    ] = await Promise.all([
      admin.from('ai_generator_config').select('monthly_cap_eur').eq('id', 1).maybeSingle(),
      admin
        .from('ai_article_generations')
        .select('cost_estimate_usd')
        .gte('created_at', monthStart.toISOString())
        .eq('status', 'success'),
      admin
        .from('ai_article_generations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart.toISOString()),
      admin
        .from('ai_article_generations')
        .select('id, created_at, admin_uuid, brief_topic, model_used, input_tokens, output_tokens, cost_estimate_usd, status, error_message, article_id, urls_failed')
        .order('created_at', { ascending: false })
        .limit(10),
      admin
        .from('ai_article_generations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', thirtyDaysAgo.toISOString())
    ]);

    if (monthErr || monthCountErr || lastErr || failErr) {
      console.error('[ai-generator] generator-stats query', { monthErr, monthCountErr, lastErr, failErr });
      return res.status(500).json({ error: 'stats_query_failed' });
    }

    const monthUsd = (monthRows || []).reduce((acc, r) => acc + Number(r.cost_estimate_usd || 0), 0);
    const monthEur = monthUsd / EUR_USD_RATE;
    const cap = cfg ? Number(cfg.monthly_cap_eur) : 0;
    const percentage = cap > 0 ? Math.round((monthEur / cap) * 1000) / 10 : 0;

    return res.status(200).json({
      this_month: {
        generations_count: monthCount || 0,
        cost_eur_used: Math.round(monthEur * 100) / 100,
        cost_eur_cap: cap,
        percentage_used: percentage
      },
      last_10_generations: lastTen || [],
      failed_count_last_30_days: failed30 || 0
    });
  } catch (err) {
    console.error('[ai-generator] generator-stats', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
