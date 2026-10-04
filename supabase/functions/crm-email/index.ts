// supabase/functions/crm-email/index.ts
//
// Emails personalizados del CRM de Partners (/admin/partners/emails.html).
// Solo admin: JWT del usuario (verify_jwt) + user_roles.role = 'admin'.
//
// Acciones (body.action):
//   'destinatarios' { segmento, tipo } → incluidos (con variables resueltas)
//                   + excluidos con motivo.
//   'preview'       { segmento, tipo, asunto, cuerpo, indice? } → asunto y
//                   HTML renderizados con un destinatario real.
//   'prueba'        idem → se envia a joandemora@gmail.com ("[PRUEBA] …").
//   'enviar'        { segmento, tipo, asunto, cuerpo, plantilla_id?,
//                   confirmacion: N } → envio por lotes. Bloqueado si alguna
//                   variable usada sale vacia para algun destinatario
//                   (preview y prueba si se permiten, marcando el hueco).
//
// segmento: { tipo: 'contactos', ids: [...] } | { tipo: 'edicion', clase_id }
//         | { tipo: 'sesion' } | { tipo: 'leads', filtros: {...} }
// tipo de envio:
//   'servicio'  → solo alumnos con pago activo; se envia aunque tengan baja
//                 comercial, salvo baja por rebote o queja.
//   'comercial' → solo con consentimiento_comercial y sin baja. Pie de baja
//                 + cabeceras List-Unsubscribe (one-click).
// Variables: {nombre} {email} {curso} {fecha_inicio} {hora} {zoom}
//            {enlace_reserva} {plazas_restantes}
// Formato del cuerpo: **negrita**, [texto](url), URLs sueltas y saltos de
// linea. {zoom} o {enlace_reserva} solos en una linea → boton verde con el
// enlace en texto debajo. Firma «Juan de Mora · Curino» automatica.
// Envio: Resend /emails/batch (100 por llamada, pausa entre lotes), desde
// «Juan de Mora <info@casacurino.com>», reply_to info@. Cada email queda en
// partners_emails (el webhook de Resend actualiza su estado).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { signLeadToken } from '../_shared/lead-token.ts'
import { SITE, construirVars, edicionAbierta, layout, renderCuerpo, sustituir, variablesUsadas } from '../_shared/crm-render.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const FROM = 'Juan de Mora <info@casacurino.com>';
const PRUEBA_TO = 'joandemora@gmail.com';
const FN_BASE = `${Deno.env.get('SUPABASE_URL')}/functions/v1`;
const MAX_DEST = 1000;

// deno-lint-ignore no-explicit-any
type Any = any;
interface Dest {
  email: string; nombre: string;
  solicitud_id: string | null; inscripcion_id: string | null; sesion_id: string | null;
  vars: Record<string, string>;
}

// ── Resolucion de destinatarios ──────────────────────────────────
async function resolver(supa: Any, segmento: Any, tipo: string) {
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
async function construir(d: Dest, tipo: string, asunto: string, cuerpo: string, marcar = false) {
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

async function resendBatch(msgs: Any[]): Promise<{ ids: (string | null)[]; error?: string }> {
  const r = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(msgs)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ids: msgs.map(() => null), error: `${r.status} ${JSON.stringify(d).slice(0, 200)}` };
  return { ids: (d.data || []).map((x: Any) => x?.id || null) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Solo admin
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await supa.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'unauthorized' }, 401);
  const { data: rol } = await supa.from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
  if (!rol) return json({ error: 'forbidden' }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    // Pasos de secuencia (pantalla Secuencias): vista previa y prueba con un
    // contacto real. Nunca envia al contacto: la prueba va a PRUEBA_TO.
    if (action === 'paso_preview' || action === 'paso_prueba') {
      const asuntoP = String(body?.asunto || '').trim().slice(0, 300);
      const cuerpoP = String(body?.cuerpo || '').slice(0, 20000);
      if (!asuntoP || !cuerpoP.trim()) return json({ error: 'asunto y cuerpo obligatorios' }, 400);
      const { data: sol } = await supa.from('partners_solicitudes').select('id, nombre, email').eq('id', String(body?.solicitud_id || '')).maybeSingle();
      if (!sol) return json({ error: 'contacto no encontrado' }, 404);
      const abierta = await edicionAbierta(supa);
      const vars = await construirVars({ nombre: sol.nombre, email: sol.email, solicitud_id: sol.id }, abierta, abierta?.titulo || 'Intensivo Curino Partners', abierta);
      const vacias = variablesUsadas(asuntoP, cuerpoP).filter((v) => !vars[v]);
      const token = await signLeadToken(sol.id);
      const msg: Any = {
        from: FROM, to: [PRUEBA_TO], reply_to: 'info@casacurino.com',
        subject: sustituir(asuntoP, vars, false, true),
        html: layout(renderCuerpo(cuerpoP, vars, true), 'secuencia', `${SITE}/partners/baja/?t=${encodeURIComponent(token)}`)
      };
      if (action === 'paso_preview') return json({ para: sol.email, asunto: msg.subject, html: msg.html, variables_vacias: vacias });
      msg.subject = `[PRUEBA] ${msg.subject}`;
      const r = await resendBatch([msg]);
      await supa.from('partners_emails').insert({
        tipo: 'prueba', asunto: msg.subject, email: PRUEBA_TO, nombre: sol.nombre, paso_id: body?.paso_id || null,
        resend_id: r.ids[0], estado: r.ids[0] ? 'enviado' : 'error', error: r.error || null, enviado_por: u.user.id
      });
      return r.ids[0] ? json({ ok: true, enviado_a: PRUEBA_TO, con_datos_de: sol.email }) : json({ error: r.error }, 502);
    }

    const tipo = body?.tipo === 'comercial' ? 'comercial' : 'servicio';
    const { incluidos, excluidos } = await resolver(supa, body?.segmento, tipo);
    if (incluidos.length > MAX_DEST) return json({ error: `demasiados destinatarios (max ${MAX_DEST})` }, 400);

    const asunto = String(body?.asunto || '').trim().slice(0, 300);
    const cuerpo = String(body?.cuerpo || '').slice(0, 20000);
    const usadas = variablesUsadas(asunto, cuerpo);
    const vaciasDetalle = usadas
      .map((v) => ({ variable: v, destinatarios: incluidos.filter((d) => !d.vars[v]).length }))
      .filter((x) => x.destinatarios > 0);
    const vacias = vaciasDetalle.map((x) => x.variable);

    if (action === 'destinatarios') {
      return json({
        incluidos: incluidos.map((d) => ({ email: d.email, nombre: d.nombre, vars: d.vars })),
        excluidos, variables_vacias: vacias, variables_vacias_detalle: vaciasDetalle
      });
    }

    if (!asunto || !cuerpo.trim()) return json({ error: 'asunto y cuerpo obligatorios' }, 400);

    if (action === 'preview' || action === 'prueba') {
      const d = incluidos[Math.max(0, Math.min(incluidos.length - 1, Number(body?.indice) || 0))];
      if (!d) return json({ error: 'sin destinatarios' }, 400);
      const msg = await construir(d, tipo, asunto, cuerpo, true);
      if (action === 'preview') return json({ para: d.email, asunto: msg.subject, html: msg.html, variables_vacias: vacias, variables_vacias_detalle: vaciasDetalle });
      msg.to = [PRUEBA_TO];
      msg.subject = `[PRUEBA] ${msg.subject}`;
      const r = await resendBatch([msg]);
      await supa.from('partners_emails').insert({
        tipo: 'prueba', plantilla_id: body?.plantilla_id || null, asunto: msg.subject, email: PRUEBA_TO,
        nombre: d.nombre, resend_id: r.ids[0], estado: r.ids[0] ? 'enviado' : 'error', error: r.error || null, enviado_por: u.user.id
      });
      return r.ids[0] ? json({ ok: true, enviado_a: PRUEBA_TO, con_datos_de: d.email }) : json({ error: r.error }, 502);
    }

    if (action === 'enviar') {
      if (Number(body?.confirmacion) !== incluidos.length) {
        return json({ error: 'confirmacion_no_coincide', destinatarios: incluidos.length }, 409);
      }
      // Sin excepciones: con una variable vacia no se envia a nadie.
      if (vacias.length) return json({ error: 'variables_vacias', variables_vacias: vacias, variables_vacias_detalle: vaciasDetalle }, 409);
      const envioId = crypto.randomUUID();
      let enviados = 0, errores = 0;
      for (let i = 0; i < incluidos.length; i += 100) {
        const lote = incluidos.slice(i, i + 100);
        const msgs = await Promise.all(lote.map((d) => construir(d, tipo, asunto, cuerpo)));
        const r = await resendBatch(msgs);
        const filas = lote.map((d, k) => ({
          envio_id: envioId, tipo, plantilla_id: body?.plantilla_id || null, asunto: msgs[k].subject,
          email: d.email, nombre: d.nombre, solicitud_id: d.solicitud_id, inscripcion_id: d.inscripcion_id, sesion_id: d.sesion_id,
          resend_id: r.ids[k] || null, estado: r.ids[k] ? 'enviado' : 'error', error: r.ids[k] ? null : (r.error || 'sin id'),
          enviado_por: u.user.id
        }));
        await supa.from('partners_emails').insert(filas);
        enviados += filas.filter((f) => f.estado === 'enviado').length;
        errores += filas.filter((f) => f.estado === 'error').length;
        if (i + 100 < incluidos.length) await new Promise((res) => setTimeout(res, 700)); // limite de Resend
      }
      return json({ ok: true, envio_id: envioId, enviados, errores, excluidos: excluidos.length });
    }

    return json({ error: 'invalid_action' }, 400);
  } catch (e) {
    console.error('crm-email error', e);
    return json({ error: 'internal_error' }, 500);
  }
});
