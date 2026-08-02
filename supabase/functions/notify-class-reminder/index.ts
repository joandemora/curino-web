// supabase/functions/notify-class-reminder/index.ts
//
// Edge Function invocada por pg_cron cada 10 min. Recorre inscripciones
// pagadas y manda:
//   - Recordatorio T-24h si la clase empieza en (24h - 15min, 24h + 15min]
//     y reminder_24h_sent_at es NULL.
//   - Recordatorio T-1h  si la clase empieza en (1h - 15min, 1h + 15min]
//     y reminder_1h_sent_at es NULL.
//
// Idempotencia: la marca del timestamp se hace en el UPDATE con guard
// `is null`, asi que el segundo cron doble no reenvia.
//
// Auth: header X-Cron-Secret vs env CRON_SECRET. verify_jwt=false.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import {
  sendClaseReminderEmail,
  ClaseInfo
} from '../_shared/clase-invoices.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

interface Pending {
  inscripcion_id: string;
  email: string;
  nombre: string;
  clase_id: string;
  fecha: string;
  duracion_min: number;
  meet_url: string | null;
  tipo: '24h' | '1h';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  try {
    const cronSecret = Deno.env.get('CRON_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!cronSecret) {
      console.error('notify-class-reminder: CRON_SECRET not configured');
      return jsonResponse({ error: 'server_misconfigured' }, 500);
    }

    const provided = req.headers.get('X-Cron-Secret') || req.headers.get('x-cron-secret');
    if (provided !== cronSecret) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Ventana +-15 min alrededor de T-24h y T-1h. El cron corre cada 10 min,
    // asi que con +-15 min de holgura nunca perdemos una inscripcion. La
    // marca del timestamp evita duplicados.
    const now = new Date();
    const in24hMin = new Date(now.getTime() + (24 * 60 - 15) * 60 * 1000).toISOString();
    const in24hMax = new Date(now.getTime() + (24 * 60 + 15) * 60 * 1000).toISOString();
    const in1hMin  = new Date(now.getTime() + (60 - 15) * 60 * 1000).toISOString();
    const in1hMax  = new Date(now.getTime() + (60 + 15) * 60 * 1000).toISOString();

    // Cargar inscripciones pendientes de recordatorio 24h
    const { data: rows24h, error: err24h } = await supabase
      .from('inscripciones')
      .select('id, email, nombre, clase_id, reminder_24h_sent_at, clases!inner(id, fecha, duracion_min, meet_url, estado)')
      .eq('estado', 'pagada')
      .is('reminder_24h_sent_at', null)
      .gte('clases.fecha', in24hMin)
      .lte('clases.fecha', in24hMax);

    if (err24h) {
      console.error('notify-class-reminder: query 24h failed', err24h);
      return jsonResponse({ error: 'query_failed', detail: err24h.message }, 500);
    }

    // Cargar inscripciones pendientes de recordatorio 1h
    const { data: rows1h, error: err1h } = await supabase
      .from('inscripciones')
      .select('id, email, nombre, clase_id, reminder_1h_sent_at, clases!inner(id, fecha, duracion_min, meet_url, estado)')
      .eq('estado', 'pagada')
      .is('reminder_1h_sent_at', null)
      .gte('clases.fecha', in1hMin)
      .lte('clases.fecha', in1hMax);

    if (err1h) {
      console.error('notify-class-reminder: query 1h failed', err1h);
      return jsonResponse({ error: 'query_failed', detail: err1h.message }, 500);
    }

    const pending: Pending[] = [];
    for (const r of rows24h || []) {
      const c = (r as any).clases;
      if (!c || c.estado === 'cerrada') continue;
      pending.push({
        inscripcion_id: r.id, email: r.email, nombre: r.nombre,
        clase_id: c.id, fecha: c.fecha, duracion_min: c.duracion_min,
        meet_url: c.meet_url, tipo: '24h'
      });
    }
    for (const r of rows1h || []) {
      const c = (r as any).clases;
      if (!c || c.estado === 'cerrada') continue;
      pending.push({
        inscripcion_id: r.id, email: r.email, nombre: r.nombre,
        clase_id: c.id, fecha: c.fecha, duracion_min: c.duracion_min,
        meet_url: c.meet_url, tipo: '1h'
      });
    }

    let sent = 0, failed = 0;
    for (const p of pending) {
      const clase: ClaseInfo = {
        id: p.clase_id,
        fecha: p.fecha,
        duracion_min: p.duracion_min,
        meet_url: p.meet_url
      };

      // Marcamos ANTES de enviar con guard `is null`. Si el update no
      // afecta filas, es que otro cron llego primero → skip.
      const column = p.tipo === '24h' ? 'reminder_24h_sent_at' : 'reminder_1h_sent_at';
      const { data: claimed, error: claimError } = await supabase
        .from('inscripciones')
        .update({ [column]: new Date().toISOString() })
        .eq('id', p.inscripcion_id)
        .is(column, null)
        .select('id')
        .maybeSingle();

      if (claimError || !claimed) {
        console.log(`notify-class-reminder: skip ${p.inscripcion_id} (${p.tipo}) — already claimed`);
        continue;
      }

      try {
        await sendClaseReminderEmail(p.email, p.nombre, clase, p.tipo);
        sent++;
        console.log(`notify-class-reminder: sent ${p.tipo} to ${p.email} (${p.inscripcion_id})`);
      } catch (mailErr) {
        // Si el email falla, deshacemos el claim para reintentar en el
        // proximo cron. Riesgo minimo de duplicado si la primera vez si
        // llego pero fallo la lectura; aceptable frente al riesgo de
        // no enviar el recordatorio.
        failed++;
        console.error(`notify-class-reminder: send failed ${p.inscripcion_id} (${p.tipo})`, mailErr);
        await supabase
          .from('inscripciones')
          .update({ [column]: null })
          .eq('id', p.inscripcion_id);
      }
    }

    return jsonResponse({ checked: pending.length, sent, failed }, 200);

  } catch (err: any) {
    console.error('notify-class-reminder error:', err);
    return jsonResponse({ error: 'internal_error', detail: err?.message }, 500);
  }
});
