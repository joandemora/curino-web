// supabase/functions/_shared/crm-envio.ts
//
// Destinatarios y envio de los emails del CRM de Partners. Lo usan la
// pantalla Emails (crm-email: «Enviar») y el cron de envios programados
// (partners-seguimiento), con las mismas reglas de consentimiento y bajas:
//   'servicio'  → solo alumnos con pago activo; se envia aunque tengan baja
//                 comercial, salvo baja por rebote o queja.
//   'comercial' → solo con consentimiento_comercial y sin baja. Pie de baja
//                 + cabeceras List-Unsubscribe (one-click).
// segmento: { tipo: 'contactos', ids } | { tipo: 'edicion', clase_id }
//         | { tipo: 'sesion' } | { tipo: 'leads', filtros }
// Envio: Resend /emails/batch (100 por llamada, pausa entre lotes), desde
// «Juan de Mora <info@casacurino.com>», reply_to info@. Cada email queda en
// partners_emails.

import { signLeadToken } from './lead-token.ts'
import { SITE, construirVars, edicionAbierta, layout, renderCuerpo, sustituir, variablesUsadas } from './crm-render.ts'

export const FROM = 'Juan de Mora <info@casacurino.com>';
export const PRUEBA_TO = 'joandemora@gmail.com';
const FN_BASE = `${Deno.env.get('SUPABASE_URL')}/functions/v1`;
export const MAX_DEST = 1000;

// deno-lint-ignore no-explicit-any
export type Any = any;
export interface Dest {
  email: string; nombre: string;
  solicitud_id: string | null; inscripcion_id: string | null; sesion_id: string | null;
  vars: Record<string, string>;
}

// ── Resolucion de destinatarios ──────────────────────────────────
export async function resolver(supa: Any, segmento: Any, tipo: string) {
  const incluidos: Dest[] = [];
  const excluidos: { email: string; nombre: string; motivo: string }[] = [];

  const abierta = await edicionAbierta(supa);
  const solPorEmail = async (emails: string[]) => {
    if (!emails.length) return new Map<string, Any>();
    const { data } = await supa.from('partners_solicitudes').select('*').in('email', emails);
    return new Map<string, Any>((data || []).map((s: Any) => [s.email, s]));
  };
  // Exclusiones segun tipo de envio
  const motivoExclusion = (sol: Any, esAlumno: boolean): string | null => {
    if (tipo === 'servicio') {
      if (!esAlumno) return 'no es alumno con pago activo';
      if (sol?.baja_at && (sol.motivo_baja === 'rebote' || sol.motivo_baja === 'queja')) return `baja por ${sol.motivo_baja}`;
      return null;
    }
    if (!sol) return 'sin solicitud (sin consentimiento)';
    if (sol.baja_at) return `baja (${sol.motivo_baja || 'enlace'})`;
    if (!sol.consentimiento_comercial) return 'sin consentimiento comercial';
    return null;
  };

  if (segmento?.tipo === 'edicion' || segmento?.tipo === 'sesion') {
    let filas: Any[] = [];
    let clase: Any = null;
    if (segmento.tipo === 'edicion') {
      const { data: c } = await supa.from('clases').select('*').eq('id', String(segmento.clase_id || '')).maybeSingle();
      clase = c;
      const { data } = await supa.from('inscripciones').select('id, nombre, email').eq('clase_id', String(segmento.clase_id || '')).eq('estado', 'pagada');
      filas = data || [];
    } else {
      const { data } = await supa.from('sesiones_1a1').select('id, nombre, email, solicitud_id').eq('estado', 'pagada');
      filas = data || [];
    }
    const sols = await solPorEmail(filas.map((f) => String(f.email).toLowerCase()));
    for (const f of filas) {
      const email = String(f.email).toLowerCase();
      const sol = sols.get(email);
      const motivo = motivoExclusion(sol, true);
      if (motivo) { excluidos.push({ email, nombre: f.nombre, motivo }); continue; }
      const curso = segmento.tipo === 'edicion' ? (clase?.titulo || 'Intensivo Curino Partners') : 'Sesión 1:1 con Juan · 30 min';
      const solicitudId = sol?.id || f.solicitud_id || null;
      incluidos.push({
        email, nombre: f.nombre, solicitud_id: solicitudId,
        inscripcion_id: segmento.tipo === 'edicion' ? f.id : null, sesion_id: segmento.tipo === 'sesion' ? f.id : null,
        vars: await construirVars({ nombre: f.nombre, email, solicitud_id: solicitudId }, segmento.tipo === 'edicion' ? clase : abierta, curso, abierta)
      });
    }
  } else if (segmento?.tipo === 'contactos' || segmento?.tipo === 'leads') {
    let q = supa.from('partners_solicitudes').select('*');
    if (segmento.tipo === 'contactos') {
      const ids = (segmento.ids || []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
      if (!ids.length) return { incluidos, excluidos };
      q = q.in('id', ids);
    } else {
      const f = segmento.filtros || {};
      if (f.estado) q = q.eq('crm_estado', f.estado);
      if (f.cualificado === 'si') q = q.eq('cualificado', true);
      if (f.cualificado === 'no') q = q.or('cualificado.is.null,cualificado.eq.false');
      if (f.compro === 'si') q = q.or('pagado_at.not.is.null,sesion_comprada_at.not.is.null');
      if (f.compro === 'no') q = q.is('pagado_at', null).is('sesion_comprada_at', null);
      if (f.anuncio) q = q.eq('utm_content', f.anuncio);
      if (f.desde) q = q.gte('created_at', f.desde);
      if (f.hasta) q = q.lte('created_at', f.hasta + 'T23:59:59');
    }
    const { data: sols } = await q.order('created_at', { ascending: false }).limit(MAX_DEST + 1);
    const insIds = (sols || []).map((s: Any) => s.inscripcion_id).filter(Boolean);
    const { data: ins } = insIds.length
      ? await supa.from('inscripciones').select('id, clase_id, estado').in('id', insIds)
      : { data: [] };
    const insMap = new Map<string, Any>((ins || []).map((i: Any) => [i.id, i]));
    const claseIds = [...new Set((ins || []).map((i: Any) => i.clase_id))];
    const { data: clases } = claseIds.length ? await supa.from('clases').select('*').in('id', claseIds) : { data: [] };
    const claseMap = new Map<string, Any>((clases || []).map((c: Any) => [c.id, c]));
    const { data: sesPag } = await supa.from('sesiones_1a1').select('id, email, solicitud_id').eq('estado', 'pagada');
    for (const s of sols || []) {
      const insc = s.inscripcion_id ? insMap.get(s.inscripcion_id) : null;
      const inscPagada = insc && insc.estado === 'pagada' ? insc : null;
      const ses = (sesPag || []).find((x: Any) => x.solicitud_id === s.id || String(x.email).toLowerCase() === s.email);
      const esAlumno = !!(inscPagada || ses);
      const motivo = motivoExclusion(s, esAlumno);
      if (motivo) { excluidos.push({ email: s.email, nombre: s.nombre, motivo }); continue; }
      const clase = inscPagada ? claseMap.get(inscPagada.clase_id) : abierta;
      const curso = inscPagada ? (clase?.titulo || 'Intensivo Curino Partners') : (ses ? 'Sesión 1:1 con Juan · 30 min' : (abierta?.titulo || 'Intensivo Curino Partners'));
      incluidos.push({
        email: s.email, nombre: s.nombre, solicitud_id: s.id,
        inscripcion_id: inscPagada?.id || null, sesion_id: ses?.id || null,
        vars: await construirVars({ nombre: s.nombre, email: s.email, solicitud_id: s.id }, clase, curso, abierta)
      });
    }
  }
  // Sin duplicados por email
  const vistos = new Set<string>();
  const unicos = incluidos.filter((d) => (vistos.has(d.email) ? false : (vistos.add(d.email), true)));
  return { incluidos: unicos, excluidos };
}

// ── Construccion y envio ───────────────────────────────────────
export async function construir(d: Dest, tipo: string, asunto: string, cuerpo: string, marcar = false) {
  const token = d.solicitud_id ? await signLeadToken(d.solicitud_id) : null;
  const bajaUrl = token ? `${SITE}/partners/baja/?t=${encodeURIComponent(token)}` : null;
  const msg: Any = {
    from: FROM, to: [d.email], reply_to: 'info@casacurino.com',
    subject: sustituir(asunto, d.vars, false, marcar),
    html: layout(renderCuerpo(cuerpo, d.vars, marcar), tipo, bajaUrl)
  };
  if (tipo === 'comercial' && token) {
    msg.headers = {
      'List-Unsubscribe': `<${FN_BASE}/partners-formaciones?accion=baja&t=${encodeURIComponent(token)}>, <mailto:info@casacurino.com?subject=baja>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };
  }
  return msg;
}

export async function resendBatch(msgs: Any[]): Promise<{ ids: (string | null)[]; error?: string }> {
  const r = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(msgs)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ids: msgs.map(() => null), error: `${r.status} ${JSON.stringify(d).slice(0, 200)}` };
  return { ids: (d.data || []).map((x: Any) => x?.id || null) };
}

// Variables usadas que salen vacias, con cuantos destinatarios afectados.
export function vaciasDetalle(incluidos: Dest[], asunto: string, cuerpo: string) {
  return variablesUsadas(asunto, cuerpo)
    .map((v) => ({ variable: v, destinatarios: incluidos.filter((d) => !d.vars[v]).length }))
    .filter((x) => x.destinatarios > 0);
}

// Envio por lotes + registro en partners_emails.
export async function enviarLotes(supa: Any, o: {
  incluidos: Dest[]; tipo: string; asunto: string; cuerpo: string;
  plantilla_id?: string | null; enviado_por?: string | null; programado_id?: string | null;
}): Promise<{ envio_id: string; enviados: number; errores: number }> {
  const envioId = crypto.randomUUID();
  let enviados = 0, errores = 0;
  for (let i = 0; i < o.incluidos.length; i += 100) {
    const lote = o.incluidos.slice(i, i + 100);
    const msgs = await Promise.all(lote.map((d) => construir(d, o.tipo, o.asunto, o.cuerpo)));
    const r = await resendBatch(msgs);
    const filas = lote.map((d, k) => ({
      envio_id: envioId, tipo: o.tipo, plantilla_id: o.plantilla_id || null, programado_id: o.programado_id || null,
      asunto: msgs[k].subject, email: d.email, nombre: d.nombre,
      solicitud_id: d.solicitud_id, inscripcion_id: d.inscripcion_id, sesion_id: d.sesion_id,
      resend_id: r.ids[k] || null, estado: r.ids[k] ? 'enviado' : 'error', error: r.ids[k] ? null : (r.error || 'sin id'),
      enviado_por: o.enviado_por || null
    }));
    await supa.from('partners_emails').insert(filas);
    enviados += filas.filter((f) => f.estado === 'enviado').length;
    errores += filas.filter((f) => f.estado === 'error').length;
    if (i + 100 < o.incluidos.length) await new Promise((res) => setTimeout(res, 700)); // limite de Resend
  }
  return { envio_id: envioId, enviados, errores };
}

// «YYYY-MM-DDTHH:MM» en hora de Madrid → Date (UTC).
export function madridAUtc(local: string): Date | null {
  const m = String(local || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);   // ajuste en los cambios de hora
  return new Date(t);
}
