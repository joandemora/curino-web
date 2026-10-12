// supabase/functions/estudio-ia/index.ts
//
// Estudio Curino · llamadas a la API de Anthropic (solo en servidor; la clave
// ANTHROPIC_API_KEY nunca sale de aquí). F1: solo la acción de prueba de la
// clave. F2 añadirá plano/descripción → JSON del proyecto (tool use con
// ESQUEMA_JSON de _shared/estudio/esquema.ts) y el chat de cambios.
//
// Acciones (body.action):
//   'ping' (solo admin) → llamada mínima (max_tokens 1) al modelo por defecto;
//          devuelve estado, modelo y tokens usados. Nunca la clave.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

export const MODELO_DEF = 'claude-sonnet-5-5';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await supa.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'unauthorized' }, 401);
  const { data: rol } = await supa.from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
  if (!rol) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  if (body?.action !== 'ping') return json({ error: 'accion_desconocida' }, 400);

  const clave = Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!clave) return json({ ok: false, error: 'ANTHROPIC_API_KEY sin configurar' });
  const modelo = MODELO_DEF;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
  });
  const d = await r.json().catch(() => ({}));
  return json({
    ok: r.ok,
    status: r.status,
    modelo: d?.model ?? modelo,
    // Solo datos públicos de la clave: tipo (prefijo) y si lleva espacios.
    prefijo: (clave.trim().match(/^sk-ant-[a-z]+\d*-/) || ['desconocido'])[0],
    espacios_alrededor: clave !== clave.trim(),
    usage: d?.usage ?? null,
    error: r.ok ? null : { tipo: d?.error?.type ?? null, mensaje: d?.error?.message ?? null }
  });
});
