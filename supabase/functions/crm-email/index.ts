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
import { type Any, FROM, MAX_DEST, PRUEBA_TO, construir, enviarLotes, madridAUtc, resendBatch, resolver, vaciasDetalle } from '../_shared/crm-envio.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

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

    // Diagnostico (solo lectura): ultimo evento que Resend tiene de un email
    // del CRM. Solo para resend_id registrados en partners_emails.
    if (action === 'resend_estado') {
      const rid = String(body?.resend_id || '');
      const { data: fila } = await supa.from('partners_emails').select('id').eq('resend_id', rid).maybeSingle();
      if (!fila) return json({ error: 'no_encontrado' }, 404);
      const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(rid)}`, { headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}` } });
      const d = await r.json().catch(() => ({}));
      return json({ status: r.status, last_event: d?.last_event ?? null, created_at: d?.created_at ?? null });
    }

    // Envios programados: cancelar (solo si sigue pendiente)
    if (action === 'programado_cancelar') {
      const { data } = await supa.from('partners_envios_programados').update({ estado: 'cancelado', updated_at: new Date().toISOString() })
        .eq('id', String(body?.id || '')).eq('estado', 'pendiente').select('id');
      return (data || []).length ? json({ ok: true }) : json({ error: 'no_pendiente' }, 409);
    }

    const tipo = body?.tipo === 'comercial' ? 'comercial' : 'servicio';
    const { incluidos, excluidos } = await resolver(supa, body?.segmento, tipo);
    if (incluidos.length > MAX_DEST) return json({ error: `demasiados destinatarios (max ${MAX_DEST})` }, 400);

    const asunto = String(body?.asunto || '').trim().slice(0, 300);
    const cuerpo = String(body?.cuerpo || '').slice(0, 20000);
    const vDetalle = vaciasDetalle(incluidos, asunto, cuerpo);
    const vacias = vDetalle.map((x) => x.variable);

    if (action === 'destinatarios') {
      return json({
        incluidos: incluidos.map((d) => ({ email: d.email, nombre: d.nombre, vars: d.vars })),
        excluidos, variables_vacias: vacias, variables_vacias_detalle: vDetalle
      });
    }

    if (!asunto || !cuerpo.trim()) return json({ error: 'asunto y cuerpo obligatorios' }, 400);

    // Programar (o editar uno pendiente). Los destinatarios y las variables se
    // recalculan al llegar la hora; aqui solo se avisa de como estan ahora.
    if (action === 'programar') {
      const cuando = madridAUtc(String(body?.cuando || ''));
      if (!cuando) return json({ error: 'fecha_invalida' }, 400);
      if (cuando.getTime() < Date.now() + 2 * 60_000) return json({ error: 'la hora debe ser al menos 2 minutos en el futuro' }, 400);
      if (cuando.getTime() > Date.now() + 366 * 24 * 3600_000) return json({ error: 'como mucho a un año vista' }, 400);
      const fila = {
        programado_para: cuando.toISOString(), tipo, segmento: body?.segmento || null,
        segmento_desc: String(body?.segmento_desc || '').slice(0, 300), asunto, cuerpo,
        plantilla_id: body?.plantilla_id || null, updated_at: new Date().toISOString()
      };
      const q = body?.id
        ? supa.from('partners_envios_programados').update(fila).eq('id', String(body.id)).eq('estado', 'pendiente').select('id, programado_para')
        : supa.from('partners_envios_programados').insert({ ...fila, estado: 'pendiente', creado_por: u.user.id, creado_por_email: u.user.email || null }).select('id, programado_para');
      const { data, error } = await q;
      if (error || !(data || []).length) return json({ error: body?.id ? 'no_pendiente' : 'no_guardado' }, 409);
      return json({ ok: true, id: data[0].id, programado_para: data[0].programado_para, destinatarios_ahora: incluidos.length, variables_vacias_detalle: vDetalle });
    }

    if (action === 'preview' || action === 'prueba') {
      const d = incluidos[Math.max(0, Math.min(incluidos.length - 1, Number(body?.indice) || 0))];
      if (!d) return json({ error: 'sin destinatarios' }, 400);
      const msg = await construir(d, tipo, asunto, cuerpo, true);
      if (action === 'preview') return json({ para: d.email, asunto: msg.subject, html: msg.html, variables_vacias: vacias, variables_vacias_detalle: vDetalle });
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
      if (vacias.length) return json({ error: 'variables_vacias', variables_vacias: vacias, variables_vacias_detalle: vDetalle }, 409);
      const r = await enviarLotes(supa, { incluidos, tipo, asunto, cuerpo, plantilla_id: body?.plantilla_id || null, enviado_por: u.user.id });
      return json({ ok: true, ...r, excluidos: excluidos.length });
    }

    return json({ error: 'invalid_action' }, 400);
  } catch (e) {
    console.error('crm-email error', e);
    return json({ error: 'internal_error' }, 500);
  }
});
