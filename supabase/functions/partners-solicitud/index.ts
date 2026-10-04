// supabase/functions/partners-solicitud/index.ts
//
// Edge Function: guarda paso a paso el formulario multipaso de la landing
// /partners/ (tabla partners_solicitudes) y avisa a Juan por email.
// Invocada server-to-server desde /api/partners-solicitud.js (anon key),
// que añade pais, IP y user-agent del visitante.
//
// Acciones (body.action):
//   'start' — paso 0: { nombre, email, telefono_prefijo, telefono,
//             privacidad:true, website (honeypot), utm_*, fbclid, fbc, fbp,
//             landing_url, referrer, event_id, ad_consent }
//             Upsert por email. Devuelve { id, token }. El token se rota en
//             cada 'start' y autentica los pasos siguientes.
//             Efectos: email "nuevo lead" a Juan + Lead por CAPI.
//   'step'  — pasos 1-4: { id, token, paso, ...respuesta del paso }
//             Al completar el paso 4 calcula cualificado/segmento y manda
//             el email "solicitud completa" con todas las respuestas.
//             Acepta dos formatos (transicion v1 → v2, 2026-10):
//               v2 (vigente): situacion_actual, experiencia, dedicacion,
//                  inicio. cualificado = inicio <> 'informandome'.
//               v1 (landing anterior): p1_dedicacion, p2_situacion +
//                  p2_instagram_web, p3_inicio, p4_inversion.
//             Se distingue por el nombre del campo, no por `paso`.
//   'evento'— metricas: { id, token, evento: 'precio_visto'|'checkout_iniciado' }
//   'cta'   — pantalla final: { id, token,
//             cta: 'checkout'|'whatsapp'|'whatsapp_one_to_one' }
//
// Hardening: honeypot, rate limit por hash IP (max 5 'start'/hora),
// validacion estricta de valores de opcion (CHECK en la tabla tambien).
//
// Secrets: RESEND_API_KEY, PARTNERS_NOTIFY_EMAIL (por defecto
// juan@casacurino.com), META_CAPI_TOKEN (opcional, ver _shared/meta-capi.ts).
//
// verify_jwt=false. Registrado en supabase/config.toml.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { sendMetaEvent, adConsentAllowed } from '../_shared/meta-capi.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIJO_RE = /^\+\d{1,4}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// Etiquetas legibles (emails). Las claves coinciden con los CHECK de la tabla.
const P1: Record<string, string> = {
  carpinteria_reformas: 'Carpintería o reformas',
  interiorismo_arquitectura: 'Interiorismo o arquitectura',
  comercial_ventas: 'Comercial o ventas',
  cuenta_ajena: 'Trabajo por cuenta ajena en otro sector',
  otro_negocio: 'Tengo otro negocio'
};
const P3: Record<string, string> = {
  noviembre: 'Ya, en el intensivo de noviembre',
  tres_meses: 'En los próximos 3 meses',
  informandome: 'Solo estoy informándome'
};
const P4: Record<string, string> = {
  si_1000_4000: 'Sí, tengo entre 1.000 € y 4.000 € para invertir',
  semanas: 'Necesito unas semanas para organizarme',
  no: 'Ahora mismo no'
};
// v2
const SITUACION: Record<string, string> = {
  cuenta_ajena: 'Trabajo por cuenta ajena',
  autonomo_negocio: 'Soy autónomo o tengo un negocio',
  cambio_profesional: 'Busco un cambio profesional',
  estudiando: 'Estoy estudiando'
};
const EXPERIENCIA: Record<string, string> = {
  reformas_carpinteria: 'Reformas o carpintería',
  interiorismo_arquitectura: 'Interiorismo o arquitectura',
  ventas_atencion: 'Ventas o atención al cliente',
  desde_cero: 'No, empiezo desde cero'
};
const DEDICACION: Record<string, string> = {
  '1_2_horas': '1-2 horas al día',
  media_jornada: 'Media jornada',
  tiempo_completo: 'Quiero dedicarme a tiempo completo'
};
const INICIO: Record<string, string> = {
  noviembre: 'Ya, en el intensivo de noviembre',
  proximos_meses: 'En los próximos meses',
  informandome: 'Solo estoy informándome'
};
const V2_FIELDS: Record<string, Record<string, string>> = {
  situacion_actual: SITUACION,
  experiencia: EXPERIENCIA,
  dedicacion: DEDICACION,
  inicio: INICIO
};

const SEGMENTO_LABEL: Record<string, string> = {
  cualificado: 'CUALIFICADO',
  necesita_semanas: 'Necesita unas semanas (seguimiento)',
  informandose: 'Solo informándose',
  sin_presupuesto: 'Sin presupuesto ahora'
};
const CTA_LABEL: Record<string, string> = {
  checkout: 'Acceder ahora (checkout)',
  whatsapp: 'WhatsApp (dudas)',
  whatsapp_one_to_one: 'WhatsApp (one-to-one)'
};

function str(v: unknown, max = 480): string {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

function escapeHtml(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function segmentoV2(inicio: string): { cualificado: boolean; segmento: string } {
  return inicio === 'informandome'
    ? { cualificado: false, segmento: 'informandose' }
    : { cualificado: true, segmento: 'cualificado' };
}

function segmentoDe(p3: string | null, p4: string | null): { cualificado: boolean; segmento: string } {
  if (p4 === 'semanas') return { cualificado: false, segmento: 'necesita_semanas' };
  if (p4 === 'no') return { cualificado: false, segmento: 'sin_presupuesto' };
  if (p3 === 'informandome') return { cualificado: false, segmento: 'informandose' };
  return { cualificado: true, segmento: 'cualificado' };
}

// ── Emails a Juan ─────────────────────────────────────────────
async function notify(subject: string, html: string, replyTo: string): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('partners-solicitud: RESEND_API_KEY missing');
    return false;
  }
  const to = Deno.env.get('PARTNERS_NOTIFY_EMAIL') || 'juan@casacurino.com';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Curino Partners — Solicitudes <noreply@casacurino.com>',
      to: to.split(',').map(s => s.trim()).filter(Boolean),
      reply_to: replyTo,
      subject,
      html
    })
  });
  if (!r.ok) {
    console.error('partners-solicitud: Resend error', r.status, await r.text());
    return false;
  }
  return true;
}

function row(label: string, value: string | null | undefined): string {
  const v = value ? escapeHtml(value).replace(/\n/g, '<br>') : '<span style="color:#888">—</span>';
  return `<tr><td style="padding:6px 12px 6px 0;color:#888;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0">${v}</td></tr>`;
}

function waLink(prefijo: string, telefono: string): string {
  return `https://wa.me/${(prefijo + telefono).replace(/\D/g, '')}`;
}

function esV1(s: any): boolean {
  return !!(s.p1_dedicacion || s.p2_situacion || s.p3_inicio || s.p4_inversion);
}

function solicitudHtml(s: any, titulo: string): string {
  const tel = `${s.telefono_prefijo} ${s.telefono}`;
  const origen = [s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term]
    .filter(Boolean).join(' / ');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1a1a1a">
  <h2 style="margin:0 0 16px">${escapeHtml(titulo)}</h2>
  <table style="border-collapse:collapse;font-size:14px;width:100%">
    ${row('Nombre', s.nombre)}
    ${row('Email', s.email)}
    ${row('Teléfono', tel)}
    ${s.segmento ? row('Resultado', SEGMENTO_LABEL[s.segmento] || s.segmento) : ''}
    ${s.perfil_one_to_one ? row('Perfil', '⭐ Perfil one-to-one (quiere dedicarse a tiempo completo)') : ''}
    ${esV1(s) ? `
    ${row('1. A qué se dedica', P1[s.p1_dedicacion] || null)}
    ${row('2. Situación', s.p2_situacion)}
    ${row('2. Instagram / web', s.p2_instagram_web)}
    ${row('3. Cuándo empezar', P3[s.p3_inicio] || null)}
    ${row('4. Inversión', P4[s.p4_inversion] || null)}` : `
    ${row('1. Situación actual', SITUACION[s.situacion_actual] || null)}
    ${row('2. Experiencia', EXPERIENCIA[s.experiencia] || null)}
    ${row('3. Tiempo que puede dedicar', DEDICACION[s.dedicacion] || null)}
    ${row('4. Cuándo empezar', INICIO[s.inicio] || null)}`}
    ${s.cta_final ? row('Eligió', CTA_LABEL[s.cta_final] || s.cta_final) : ''}
    ${row('Paso alcanzado', `${s.paso_alcanzado} de 4`)}
    ${row('Origen (UTM)', origen || null)}
    ${row('fbclid', s.fbclid ? 'sí' : null)}
  </table>
  <p style="margin-top:20px">
    <a href="${waLink(s.telefono_prefijo, s.telefono)}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:10px 18px;text-decoration:none">Escribir por WhatsApp</a>
    &nbsp; <a href="mailto:${escapeHtml(s.email)}" style="color:#0a0a0a">Responder por email</a>
  </p>
  <p style="font-size:12px;color:#888;margin-top:24px">casacurino.com/partners · ID ${escapeHtml(s.id)}</p>
</body></html>`;
}

// ── Handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('partners-solicitud: missing env');
      return jsonResponse({ error: 'server_misconfigured' }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => ({}));
    const action = str(body?.action, 10);

    // ── start (paso 0) ─────────────────────────────────────
    if (action === 'start') {
      if (str(body?.website).length > 0) {
        // Honeypot: ok silencioso con ids falsos para no dar pistas.
        return jsonResponse({ id: crypto.randomUUID(), token: generateToken() }, 200);
      }
      const nombre = str(body?.nombre, 120);
      const email = str(body?.email, 200).toLowerCase();
      const prefijo = str(body?.telefono_prefijo, 5) || '+34';
      const telefono = str(body?.telefono, 30).replace(/[^\d]/g, '');
      if (nombre.length < 2) return jsonResponse({ error: 'invalid_nombre' }, 400);
      if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);
      if (!PREFIJO_RE.test(prefijo)) return jsonResponse({ error: 'invalid_prefijo' }, 400);
      if (telefono.length < 6 || telefono.length > 15) return jsonResponse({ error: 'invalid_telefono' }, 400);
      if (body?.privacidad !== true) return jsonResponse({ error: 'privacidad_required' }, 400);

      const clientIp = str(body?.client_ip, 64);
      const ipHash = clientIp ? await sha256(clientIp) : null;
      if (ipHash) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from('partners_solicitudes')
          .select('id', { count: 'exact', head: true })
          .eq('ip_hash', ipHash)
          .gte('created_at', oneHourAgo);
        if ((count ?? 0) >= 5) return jsonResponse({ error: 'rate_limited' }, 429);
      }

      const eventId = UUID_RE.test(str(body?.event_id, 64)) ? str(body?.event_id, 64) : null;
      const token = generateToken();
      const now = new Date().toISOString();

      // Campos de contacto/atribucion. Los de atribucion solo se pisan
      // si vienen informados (no borrar el origen de la primera visita).
      const record: Record<string, unknown> = {
        nombre, email,
        telefono_prefijo: prefijo, telefono,
        // Casilla unica obligatoria (2026-10): privacidad + contacto por email
        // y WhatsApp sobre la solicitud + informacion y ofertas de formaciones
        // → consentimiento_solicitud y consentimiento_comercial a la vez.
        consentimiento_privacidad: true, consentimiento_at: now,
        consentimiento_solicitud: true, consentimiento_solicitud_at: now, consentimiento_solicitud_origen: 'formulario',
        consentimiento_comercial: true, consentimiento_comercial_at: now, consentimiento_comercial_origen: 'formulario',
        edit_token: token,
        user_agent: str(body?.client_ua, 500) || null,
        ip_hash: ipHash
      };
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid']) {
        const v = str(body?.[k], 240);
        if (v) record[k] = v;
      }
      const landing = str(body?.landing_url, 1000);
      if (landing) record.landing_url = landing;
      const referrer = str(body?.referrer, 1000);
      if (referrer) record.referrer = referrer;
      if (eventId) record.event_id_lead = eventId;

      // ¿Ya habia una solicitud con este email? (upsert por email: la fila se
      // reutiliza y conserva su created_at original).
      const { data: previo } = await supabase
        .from('partners_solicitudes')
        .select('id, created_at, notificado_lead_at')
        .eq('email', email)
        .maybeSingle();

      const { data: saved, error } = await supabase
        .from('partners_solicitudes')
        .upsert(record, { onConflict: 'email' })
        .select('*')
        .single();
      if (error || !saved) {
        console.error('partners-solicitud: upsert failed', error);
        return jsonResponse({ error: 'internal_error' }, 500);
      }

      // Best-effort: aviso a Juan + Lead por CAPI.
      // Aviso: la primera vez y tambien en cada REENVIO del mismo email
      // (antes solo se avisaba la primera vez y los reenvios pasaban
      // desapercibidos). No se repite si ya se aviso hace < 30 min (p. ej. el
      // lead vuelve con "Atras" al paso 0 y reenvia).
      try {
        const REAVISO_MS = 30 * 60 * 1000;
        const ultimoAviso = saved.notificado_lead_at ? new Date(saved.notificado_lead_at).getTime() : 0;
        const esReenvio = !!previo;
        if (!ultimoAviso || (esReenvio && Date.now() - ultimoAviso > REAVISO_MS)) {
          const primera = previo ? new Date(previo.created_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) : '';
          const ok = await notify(
            esReenvio ? `Nueva solicitud Partners (repetida): ${nombre}` : `Nueva solicitud Partners: ${nombre}`,
            solicitudHtml(saved, esReenvio
              ? `Solicitud repetida — Curino Partners (contacto). Primera solicitud: ${primera}`
              : 'Nueva solicitud — Curino Partners (contacto)'),
            email
          );
          if (ok) {
            // En un reenvio se rearma tambien el aviso de "solicitud completa".
            await supabase.from('partners_solicitudes')
              .update({ notificado_lead_at: new Date().toISOString(), ...(esReenvio ? { notificado_completa_at: null } : {}) })
              .eq('id', saved.id);
          }
        }
      } catch (e) {
        console.error('partners-solicitud: notify lead failed', e);
      }

      try {
        const adConsent = typeof body?.ad_consent === 'boolean' ? body.ad_consent : null;
        const country = str(body?.country, 2) || null;
        if (eventId && adConsentAllowed(adConsent, country)) {
          await sendMetaEvent({
            eventName: 'Lead',
            eventId,
            eventSourceUrl: landing || 'https://casacurino.com/partners/',
            email, phone: prefijo + telefono, firstName: nombre, country,
            fbc: str(body?.fbc, 400) || null,
            fbp: str(body?.fbp, 200) || null,
            clientIp: clientIp || null,
            clientUa: str(body?.client_ua, 500) || null,
            customData: { content_category: 'partners_solicitud' }
          });
        }
      } catch (e) {
        console.error('partners-solicitud: CAPI Lead failed', e);
      }

      return jsonResponse({ id: saved.id, token }, 200);
    }

    // ── step / cta: requieren id + token ───────────────────
    const id = str(body?.id, 64);
    const token = str(body?.token, 64);
    if (!UUID_RE.test(id) || !TOKEN_RE.test(token)) return jsonResponse({ error: 'invalid_session' }, 400);

    const { data: current, error: loadErr } = await supabase
      .from('partners_solicitudes')
      .select('*')
      .eq('id', id)
      .eq('edit_token', token)
      .maybeSingle();
    if (loadErr) {
      console.error('partners-solicitud: load failed', loadErr);
      return jsonResponse({ error: 'internal_error' }, 500);
    }
    if (!current) return jsonResponse({ error: 'invalid_session' }, 403);

    if (action === 'step') {
      const paso = Number(body?.paso);
      if (!Number.isInteger(paso) || paso < 1 || paso > 4) return jsonResponse({ error: 'invalid_paso' }, 400);
      const update: Record<string, unknown> = {};
      const v2Field = Object.keys(V2_FIELDS).find(k => body?.[k] != null);
      if (v2Field) {
        const v = str(body?.[v2Field], 40);
        if (!V2_FIELDS[v2Field][v]) return jsonResponse({ error: `invalid_${v2Field}` }, 400);
        update[v2Field] = v;
        if (v2Field === 'dedicacion') update.perfil_one_to_one = v === 'tiempo_completo';
      } else if (paso === 1) {
        const v = str(body?.p1_dedicacion, 40);
        if (!P1[v]) return jsonResponse({ error: 'invalid_p1' }, 400);
        update.p1_dedicacion = v;
      } else if (paso === 2) {
        const situacion = str(body?.p2_situacion, 3000);
        if (situacion.length < 3) return jsonResponse({ error: 'invalid_p2' }, 400);
        update.p2_situacion = situacion;
        update.p2_instagram_web = str(body?.p2_instagram_web, 300) || null;
      } else if (paso === 3) {
        const v = str(body?.p3_inicio, 40);
        if (!P3[v]) return jsonResponse({ error: 'invalid_p3' }, 400);
        update.p3_inicio = v;
      } else if (paso === 4) {
        const v = str(body?.p4_inversion, 40);
        if (!P4[v]) return jsonResponse({ error: 'invalid_p4' }, 400);
        update.p4_inversion = v;
      } else {
        return jsonResponse({ error: 'invalid_paso' }, 400);
      }
      // El paso alcanzado nunca retrocede (si vuelve "Atras" y reenvia).
      update.paso_alcanzado = Math.max(current.paso_alcanzado || 0, paso);
      // Solicitud completa: arranca la secuencia de seguimiento (partners-seguimiento).
      if (paso === 4 && !current.completada_at) update.completada_at = new Date().toISOString();

      const merged = { ...current, ...update };
      let result: { cualificado: boolean; segmento: string } | null = null;
      if (v2Field && merged.inicio) {
        result = segmentoV2(merged.inicio);
        update.cualificado = result.cualificado;
        update.segmento = result.segmento;
      } else if (!v2Field && merged.p3_inicio && merged.p4_inversion) {
        result = segmentoDe(merged.p3_inicio, merged.p4_inversion);
        update.cualificado = result.cualificado;
        update.segmento = result.segmento;
      }

      const { data: saved, error } = await supabase
        .from('partners_solicitudes')
        .update(update)
        .eq('id', id)
        .select('*')
        .single();
      if (error || !saved) {
        console.error('partners-solicitud: step update failed', error);
        return jsonResponse({ error: 'internal_error' }, 500);
      }

      if (paso === 4 && !saved.notificado_completa_at) {
        try {
          const tag = (result?.cualificado ? '✅ CUALIFICADO' : (SEGMENTO_LABEL[saved.segmento] || ''))
            + (saved.perfil_one_to_one ? ' · ⭐ one-to-one' : '')
            + (!saved.consentimiento_comercial ? ' · sin consentimiento comercial' : '');
          // Reenvio del mismo email: la fila es antigua pero el aviso de
          // contacto es de este ciclo.
          const repetida = saved.notificado_lead_at && saved.created_at
            && new Date(saved.notificado_lead_at).getTime() - new Date(saved.created_at).getTime() > 60_000;
          const ok = await notify(
            `Solicitud completa Partners${repetida ? ' (repetida)' : ''}: ${saved.nombre} — ${tag}`,
            solicitudHtml(saved, 'Solicitud completa — Curino Partners'),
            saved.email
          );
          if (ok) {
            await supabase.from('partners_solicitudes')
              .update({ notificado_completa_at: new Date().toISOString() })
              .eq('id', id);
          }
        } catch (e) {
          console.error('partners-solicitud: notify completa failed', e);
        }
      }

      return jsonResponse({
        ok: true,
        cualificado: saved.cualificado,
        segmento: saved.segmento
      }, 200);
    }

    if (action === 'cta') {
      const cta = str(body?.cta, 20);
      if (!CTA_LABEL[cta]) return jsonResponse({ error: 'invalid_cta' }, 400);
      const { error } = await supabase
        .from('partners_solicitudes')
        .update({ cta_final: cta, cta_final_at: new Date().toISOString() })
        .eq('id', id);
      if (error) {
        console.error('partners-solicitud: cta update failed', error);
        return jsonResponse({ error: 'internal_error' }, 500);
      }
      return jsonResponse({ ok: true }, 200);
    }

    // Metricas de embudo: primera vez que ve el precio / inicia un checkout.
    if (action === 'evento') {
      const col = ({ precio_visto: 'precio_visto_at', checkout_iniciado: 'checkout_iniciado_at' } as Record<string, string>)[str(body?.evento, 30)];
      if (!col) return jsonResponse({ error: 'invalid_evento' }, 400);
      await supabase.from('partners_solicitudes').update({ [col]: new Date().toISOString() }).eq('id', id).is(col, null);
      return jsonResponse({ ok: true }, 200);
    }

    return jsonResponse({ error: 'invalid_action' }, 400);

  } catch (err: any) {
    console.error('partners-solicitud error:', err);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
