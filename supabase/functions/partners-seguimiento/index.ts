// supabase/functions/partners-seguimiento/index.ts
//
// Motor de las secuencias de Partners (editables en /admin/partners/
// secuencias.html). Invocada por pg_cron cada 5 min (X-Cron-Secret).
//
// Por cada secuencia activa (partners_secuencias) y cada solicitud que cumple
// su disparador («solicitud completa sin compra»: completada_at, sin
// pagado_at si sale_compra_intensivo, consentimiento_solicitud, sin baja):
//   - Los plazos de cada paso (retraso_minutos) cuentan desde
//     secuencia_inicio_at si existe, si no desde completada_at.
//   - Solo envia dentro de la franja de la secuencia (hora de Madrid); fuera
//     de ella espera a la siguiente.
//   - Como mucho un email por solicitud y secuencia en cada ejecucion: si hay
//     varios pasos vencidos, sale el mas reciente y los anteriores se marcan
//     como saltados («retraso»).
//   - Condiciones del paso (si no se cumplen se salta para ese contacto):
//     req_comercial, req_sesion_activa (PARTNERS_SEGUIMIENTO_SESION_ACTIVO),
//     req_plazas, no_si_sesion_comprada. Una variable vacia tambien lo salta.
//   - activa_oferta_sesion marca oferta_sesion_enviada_at (precio 60 € 3 h).
//   - Salidas: compra del intensivo / de la sesion / llamada de admision
//     reservada (sale_llamada) segun la secuencia; baja y borrado siempre;
//     lista de supresion (partners_supresion).
//   - req_cualificado: el paso solo sale a solicitudes cualificadas.
//   - partners_secuencia_estado (unico por solicitud y paso) evita repetir:
//     se reserva antes de enviar y se libera si Resend falla.
// Aparte, aviso a Juan (info@) +30 min de cada solicitud completa sin compra
// (solo en los 4 dias siguientes a completada_at).
// Y los envios programados de la pantalla Emails (partners_envios_programados)
// que ya han llegado a su hora: recalcula destinatarios con las reglas de
// consentimiento y bajas; con alguna variable vacia no envia ('bloqueado') y
// avisa por email a quien lo programo. Sin franja: salen a la hora elegida.
//
// Modo prueba: { modo: 'prueba', solicitud_id, secuencia_id?,
// segundos_por_hora } procesa solo esa solicitud (nombre «PRUEBA…») con los
// plazos acelerados (1 h → segundos_por_hora s), sin franja y aunque la
// secuencia este pausada.
//
// Leads «Sin agendar» (formulario completado y cualificado, con
// consentimiento, +1 h, sin llamada vigente en Cal.com): aviso por email a
// joandemora@gmail.com (uno por contacto) y otro por cada cancelación o
// no presentado (los encola cal-webhook). Solo de 9:00 a 21:30 Madrid; antes
// de enviar se comprueba que sigue sin llamada (si no, 'descartado').
// Modo prueba: { modo: 'prueba_agenda', solicitud_id, segundos_por_hora }
// solo para «PRUEBA», sin franja.
//
// Remitente: «Juan de Mora <info@casacurino.com>», reply_to info@.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { signLeadToken } from '../_shared/lead-token.ts'
import { MAX_DEST, enviarLotes, resolver, vaciasDetalle } from '../_shared/crm-envio.ts'
import { SITE, construirVars, edicionAbierta, esc, layout, plazasLibres, renderCuerpo, sustituir, variablesUsadas } from '../_shared/crm-render.ts'

const FROM_JUAN = 'Juan de Mora <info@casacurino.com>';
const AVISO_TO = 'info@casacurino.com';
const SECUENCIA_DEFECTO = '5e9a0001-0000-4000-8000-000000000001';
// Embudo con llamada de admisión abierto desde aquí: antes nadie vio el calendario.
const EMBUDO_LLAMADA_DESDE = '2026-10-05T09:11:19Z';
const AVISO_AGENDA_TO = 'joandemora@gmail.com';

const P1: Record<string, string> = {
  cuenta_ajena: 'Trabajo por cuenta ajena', autonomo_negocio: 'Soy autónomo o tengo un negocio',
  cambio_profesional: 'Busco un cambio profesional', estudiando: 'Estoy estudiando'
};
const P2: Record<string, string> = {
  reformas_carpinteria: 'Reformas o carpintería', interiorismo_arquitectura: 'Interiorismo o arquitectura',
  ventas_atencion: 'Ventas o atención al cliente', desde_cero: 'No, empiezo desde cero'
};
const P3: Record<string, string> = {
  '1_2_horas': '1-2 horas al día', media_jornada: 'Media jornada', tiempo_completo: 'Quiero dedicarme a tiempo completo'
};
const P4: Record<string, string> = {
  ya: 'Ya, en la próxima edición del intensivo', octubre: 'Ya, en el intensivo de octubre', noviembre: 'Ya, en el intensivo de noviembre', proximos_meses: 'En los próximos meses', informandome: 'Solo estoy informándome'
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

// deno-lint-ignore no-explicit-any
type Lead = any;
// deno-lint-ignore no-explicit-any
type Any = any;

async function resendId(payload: Record<string, unknown>): Promise<string | null> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) { console.error('seguimiento: Resend', r.status, await r.text()); return null; }
  const d = await r.json().catch(() => ({}));
  return d?.id || 'sin-id';
}

function avisoJuanHtml(lead: Lead): string {
  const nombre = String(lead.nombre || '');
  const tel = `${lead.telefono_prefijo || ''}${lead.telefono || ''}`.replace(/\D/g, '');
  const texto = `Hola ${nombre.split(' ')[0]}, soy Juan de Mora, de Curino 👋 He visto tu solicitud para el intensivo Curino Partners. ¿Te surgió alguna duda al ver la información? Encantado de resolvértela.`;
  const row = (k: string, v: unknown) => `<tr><td style="padding:5px 12px 5px 0;color:#888">${esc(k)}</td><td>${v ? esc(v) : '—'}</td></tr>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:16px;color:#1a1a1a">
<h2 style="margin:0 0 12px">Sin comprar: ${esc(nombre)} (${lead.cualificado ? 'cualificado' : 'no cualificado'})</h2>
<table style="border-collapse:collapse;font-size:14px">
${row('Email', lead.email)}${row('Teléfono', `${lead.telefono_prefijo || ''} ${lead.telefono || ''}`)}
${row('1. Situación', P1[lead.situacion_actual])}${row('2. Experiencia', P2[lead.experiencia])}
${row('3. Dedicación', P3[lead.dedicacion])}${row('4. Inicio', P4[lead.inicio])}
${row('Perfil one-to-one', lead.perfil_one_to_one ? 'Sí' : 'No')}${row('Eligió', lead.cta_final)}
${row('Vio el precio', lead.precio_visto_at ? 'Sí' : 'No')}${row('Inició checkout', lead.checkout_iniciado_at ? 'Sí' : 'No')}
${row('utm_source / campaign', [lead.utm_source, lead.utm_campaign].filter(Boolean).join(' / '))}${row('utm_content', lead.utm_content)}
</table>
<p style="margin-top:18px"><a href="https://wa.me/${tel}?text=${encodeURIComponent(texto)}" style="display:inline-block;background:#12B76A;color:#161616;font-weight:bold;padding:10px 18px;text-decoration:none;border-radius:4px">Escribirle por WhatsApp</a></p>
<p style="font-size:12px;color:#888">Solicitud completada: ${esc(lead.completada_at)} · ID ${esc(lead.id)}</p>
</body></html>`;
}

// Minutos del dia en Madrid
function minutosMadrid(ahora: number): number {
  const p = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }).formatToParts(new Date(ahora));
  return Number(p.find((x) => x.type === 'hour')?.value) * 60 + Number(p.find((x) => x.type === 'minute')?.value);
}
const aMin = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
function enFranja(sec: Any, ahora: number): boolean {
  const m = minutosMadrid(ahora), ini = aMin(sec.franja_inicio), fin = aMin(sec.franja_fin);
  return ini <= fin ? m >= ini && m < fin : m >= ini || m < fin;   // franja que cruza medianoche
}

async function emailHash(email: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(email || '').trim().toLowerCase()));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Aviso a Juan (+30 min) ────────────────────────────────────────
async function avisoJuan(supabase: Any, lead: Lead, segPorHora: number, ahora: number): Promise<boolean> {
  if (lead.aviso_sin_compra_at || lead.pagado_at) return false;
  const completada = new Date(lead.completada_at).getTime();
  if (ahora < completada + 0.5 * segPorHora * 1000 || ahora >= completada + 96 * segPorHora * 1000) return false;
  const id = await resendId({
    from: 'Curino Partners — Solicitudes <noreply@casacurino.com>', to: [AVISO_TO], reply_to: lead.email,
    subject: `Sin comprar: ${lead.nombre} (${lead.cualificado ? 'cualificado' : 'no cualificado'})`,
    html: avisoJuanHtml(lead)
  });
  if (!id) return false;
  await supabase.from('partners_solicitudes').update({ aviso_sin_compra_at: new Date().toISOString() }).eq('id', lead.id);
  return true;
}

// ── Una solicitud en una secuencia ────────────────────────────────
async function procesar(supabase: Any, sec: Any, pasos: Any[], lead: Lead, hechos: Set<string>,
  abierta: Any, segPorHora: number, ahora: number): Promise<string[]> {
  const log: string[] = [];
  if (lead.baja_at || !lead.consentimiento_solicitud) return log;
  if (sec.sale_compra_intensivo && lead.pagado_at) return log;
  if (sec.sale_compra_sesion && lead.sesion_comprada_at) return log;
  if (sec.sale_llamada && lead.llamada_estado === 'reservada') return log;
  const base = new Date(lead.secuencia_inicio_at || lead.completada_at).getTime();
  const pendientes = pasos.filter((p) => !hechos.has(p.id) && ahora >= base + p.retraso_minutos * 60 * segPorHora / 3600 * 1000);
  if (!pendientes.length) return log;

  const marcar = async (paso: Any, estado: string, motivo: string | null, emailId: string | null = null) => {
    const { error } = await supabase.from('partners_secuencia_estado')
      .insert({ solicitud_id: lead.id, secuencia_id: sec.id, paso_id: paso.id, estado, motivo, email_id: emailId });
    return !error;   // error = ya existia (otra ejecucion)
  };
  const ultimo = pendientes[pendientes.length - 1];
  for (const p of pendientes.slice(0, -1)) { if (await marcar(p, 'saltado', 'retraso')) log.push(`${p.orden}:saltado_retraso`); }

  // Condiciones del paso
  const libres = plazasLibres(abierta);
  const motivo =
    ultimo.req_cualificado && !lead.cualificado ? 'no cualificado'
    : ultimo.req_comercial && !lead.consentimiento_comercial ? 'sin consentimiento comercial'
    : ultimo.no_si_sesion_comprada && lead.sesion_comprada_at ? 'sesión comprada'
    : ultimo.req_sesion_activa && Deno.env.get('PARTNERS_SEGUIMIENTO_SESION_ACTIVO') !== 'true' ? 'sesión inactiva'
    : ultimo.req_plazas && !(abierta && abierta.estado === 'abierta' && (libres || 0) > 0) ? 'sin plazas'
    : null;
  if (motivo) { if (await marcar(ultimo, 'saltado', motivo)) log.push(`${ultimo.orden}:saltado (${motivo})`); return log; }

  const vars = await construirVars({ nombre: lead.nombre, email: lead.email, solicitud_id: lead.id },
    abierta, abierta?.titulo || 'Intensivo Curino Partners', abierta);
  const vacias = variablesUsadas(ultimo.asunto, ultimo.cuerpo).filter((v) => !vars[v]);
  if (vacias.length) {
    const m = `variable vacía: ${vacias.map((v) => `{${v}}`).join(', ')}`;
    if (await marcar(ultimo, 'saltado', m)) log.push(`${ultimo.orden}:saltado (${m})`);
    return log;
  }

  // Reserva el paso antes de enviar (evita duplicados entre ejecuciones)
  if (!(await marcar(ultimo, 'enviado', null))) return log;
  const token = await signLeadToken(lead.id);
  const subject = sustituir(ultimo.asunto, vars, false);
  const id = await resendId({
    from: FROM_JUAN, to: [lead.email], reply_to: 'info@casacurino.com', subject,
    html: layout(renderCuerpo(ultimo.cuerpo, vars), 'secuencia', `${SITE}/partners/baja/?t=${encodeURIComponent(token)}`),
    headers: {
      'List-Unsubscribe': `<${Deno.env.get('SUPABASE_URL')}/functions/v1/partners-formaciones?accion=baja&t=${encodeURIComponent(token)}>, <mailto:info@casacurino.com?subject=baja>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
  if (!id) {
    // Resend fallo: se libera la reserva y se reintenta en la siguiente ejecucion
    await supabase.from('partners_secuencia_estado').delete().eq('solicitud_id', lead.id).eq('paso_id', ultimo.id);
    log.push(`${ultimo.orden}:error_resend`);
    return log;
  }
  const { data: em } = await supabase.from('partners_emails').insert({
    tipo: 'secuencia', secuencia_id: sec.id, paso_id: ultimo.id, asunto: subject, email: lead.email, nombre: lead.nombre,
    solicitud_id: lead.id, resend_id: id === 'sin-id' ? null : id, estado: 'enviado'
  }).select('id').single();
  await supabase.from('partners_secuencia_estado').update({ email_id: em?.id || null }).eq('solicitud_id', lead.id).eq('paso_id', ultimo.id);
  if (ultimo.activa_oferta_sesion) {
    await supabase.from('partners_solicitudes').update({ oferta_sesion_enviada_at: new Date().toISOString() }).eq('id', lead.id);
  }
  log.push(`${ultimo.orden}:enviado`);
  return log;
}

// ── Envios programados ─────────────────────────────────────────────
async function avisoProgramado(p: Any, titulo: string, detalle: string) {
  await resendId({
    from: 'Curino Partners — CRM <noreply@casacurino.com>', to: [p.creado_por_email || AVISO_TO], reply_to: 'info@casacurino.com',
    subject: `${titulo}: ${p.asunto}`,
    html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#1a1a1a">
<h2 style="margin:0 0 12px">${esc(titulo)}</h2>
<p><b>Asunto:</b> ${esc(p.asunto)}<br><b>Destinatarios:</b> ${esc(p.segmento_desc || '')}<br><b>Programado para:</b> ${esc(new Date(p.programado_para).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}</p>
<p>${detalle}</p>
<p><a href="${SITE}/admin/partners/emails.html">Abrir Emails en el panel</a></p></body></html>`
  });
}
async function ejecutarProgramados(supabase: Any, ahora: number): Promise<string[]> {
  const log: string[] = [];
  const { data: due } = await supabase.from('partners_envios_programados').select('*').eq('estado', 'pendiente')
    .lte('programado_para', new Date(ahora).toISOString()).order('programado_para').limit(10);
  for (const p of due || []) {
    // Reserva (evita que dos ejecuciones lo envien)
    const { data: claim } = await supabase.from('partners_envios_programados').update({ estado: 'enviando', updated_at: new Date().toISOString() })
      .eq('id', p.id).eq('estado', 'pendiente').select('id');
    if (!(claim || []).length) continue;
    const fin = (estado: string, resultado: Record<string, unknown>) => supabase.from('partners_envios_programados')
      .update({ estado, resultado, procesado_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', p.id);
    try {
      const { incluidos, excluidos } = await resolver(supabase, p.segmento, p.tipo);
      if (incluidos.length > MAX_DEST) {
        await fin('error', { error: `demasiados destinatarios (max ${MAX_DEST})`, destinatarios: incluidos.length });
        await avisoProgramado(p, 'Envío programado no enviado', `Hay ${incluidos.length} destinatarios y el máximo es ${MAX_DEST}.`);
        log.push(`programado ${p.id}: error`); continue;
      }
      const det = vaciasDetalle(incluidos, p.asunto, p.cuerpo);
      if (det.length) {
        await fin('bloqueado', { variables_vacias_detalle: det, destinatarios: incluidos.length, excluidos: excluidos.length });
        await avisoProgramado(p, 'Envío programado bloqueado', 'No se ha enviado a nadie porque hay variables vacías:<br>'
          + det.map((x: Any) => `· La variable <b>{${esc(x.variable)}}</b> está vacía para ${x.destinatarios} destinatario${x.destinatarios === 1 ? '' : 's'}.`).join('<br>')
          + '<br><br>Complétalas (Formaciones: fecha confirmada, Zoom…) o quítalas del texto y vuelve a programarlo.');
        log.push(`programado ${p.id}: bloqueado`); continue;
      }
      const r = await enviarLotes(supabase, { incluidos, tipo: p.tipo, asunto: p.asunto, cuerpo: p.cuerpo,
        plantilla_id: p.plantilla_id, enviado_por: p.creado_por, programado_id: p.id });
      await fin('enviado', { ...r, excluidos: excluidos.length });
      log.push(`programado ${p.id}: enviados ${r.enviados}`);
    } catch (e) {
      console.error('seguimiento: programado', p.id, e);
      await fin('error', { error: String(e).slice(0, 300) });
      await avisoProgramado(p, 'Envío programado con error', 'Ha fallado al enviarse. Revísalo en el panel.');
      log.push(`programado ${p.id}: error`);
    }
  }
  return log;
}

// ── Leads «Sin agendar» y avisos ────────────────────────────────────
function esSinAgendar(l: Lead, ahora: number, segPorHora = 3600): boolean {
  return l.origen === 'formulario' && !!l.completada_at && l.cualificado === true && !!l.consentimiento_solicitud
    && new Date(l.completada_at).getTime() >= new Date(EMBUDO_LLAMADA_DESDE).getTime()
    && ahora - new Date(l.completada_at).getTime() >= segPorHora * 1000
    && !l.baja_at && !l.pagado_at && !l.sesion_comprada_at && !l.one_to_one_comprado_at
    && l.llamada_estado !== 'reservada';
}
function avisoAgendaHtml(l: Lead, tipo: string): string {
  const tel = `${l.telefono_prefijo || ''}${l.telefono || ''}`.replace(/\D/g, '');
  const motivo = tipo === 'cancelada' ? 'Canceló la llamada de admisión.' : tipo === 'no_presentado' ? 'No se presentó a la llamada de admisión.' : 'Rellenó la solicitud hace más de 1 hora y no ha reservado la llamada de admisión.';
  const row = (k: string, v: unknown) => `<tr><td style="padding:5px 12px 5px 0;color:#888">${esc(k)}</td><td>${v ? esc(v) : '—'}</td></tr>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:16px;color:#1a1a1a">
<h2 style="margin:0 0 6px">${esc(l.nombre)}</h2>
<p style="margin:0 0 14px;color:#555">${esc(motivo)}</p>
<table style="border-collapse:collapse;font-size:14px">
${row('Teléfono', `${l.telefono_prefijo || ''} ${l.telefono || ''}`)}${row('Email', l.email)}
${row('1. Situación', P1[l.situacion_actual])}${row('2. Experiencia', P2[l.experiencia])}
${row('3. Dedicación', P3[l.dedicacion])}${row('4. Inicio', P4[l.inicio])}
${row('Solicitud completada', new Date(l.completada_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}
${l.llamada_at ? row('Llamada', new Date(l.llamada_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) + ` (${l.llamada_estado})`) : ''}
</table>
<p style="margin-top:18px"><a href="${SITE}/admin/partners/contacto.html?id=${esc(l.id)}" style="display:inline-block;background:#12B76A;color:#161616;font-weight:bold;padding:10px 18px;text-decoration:none;border-radius:4px">Abrir la ficha</a>
${tel ? ` &nbsp; <a href="https://wa.me/${tel}">WhatsApp</a>` : ''}</p>
</body></html>`;
}
async function avisosAgenda(supabase: Any, ahora: number, o: { soloId?: string; segPorHora?: number; sinFranja?: boolean } = {}): Promise<string[]> {
  const log: string[] = [];
  const seg = o.segPorHora || 3600;
  // 1. Nuevos «Sin agendar» → aviso pendiente (uno por contacto)
  let q = supabase.from('partners_solicitudes').select('*').eq('origen', 'formulario').eq('cualificado', true)
    .eq('consentimiento_solicitud', true).not('completada_at', 'is', null).gte('completada_at', EMBUDO_LLAMADA_DESDE)
    .is('baja_at', null).is('pagado_at', null).limit(500);
  if (o.soloId) q = q.eq('id', o.soloId);
  const { data: leads } = await q;
  for (const l of leads || []) {
    if (!esSinAgendar(l, ahora, seg)) continue;
    const { error } = await supabase.from('partners_avisos_agenda').insert({ solicitud_id: l.id, tipo: 'sin_agendar' });
    if (!error) log.push(`sin_agendar:${l.id}`);
  }
  // 2. Envío de pendientes (franja 9:00–21:30 Madrid)
  if (!o.sinFranja && !enFranja({ franja_inicio: '09:00', franja_fin: '21:30' }, ahora)) return log;
  let pq = supabase.from('partners_avisos_agenda').select('*').eq('estado', 'pendiente').order('created_at').limit(50);
  if (o.soloId) pq = pq.eq('solicitud_id', o.soloId);
  const { data: pend } = await pq;
  for (const a of pend || []) {
    // Cancelación/no-show: 5 min de margen por si es un cambio de hora
    if (a.tipo !== 'sin_agendar' && ahora - new Date(a.evento_at).getTime() < 5 * 60 * seg / 3600 * 1000) continue;
    const { data: l } = await supabase.from('partners_solicitudes').select('*').eq('id', a.solicitud_id).maybeSingle();
    if (!l || !esSinAgendar(l, ahora, seg)) {
      await supabase.from('partners_avisos_agenda').update({ estado: 'descartado' }).eq('id', a.id);
      log.push(`aviso_descartado:${a.tipo}`); continue;
    }
    const asunto = a.tipo === 'cancelada' ? `Lead canceló: ${l.nombre}` : a.tipo === 'no_presentado' ? `Lead no se presentó: ${l.nombre}` : `Lead sin agendar: ${l.nombre}`;
    const id = await resendId({ from: 'Curino Partners — Leads <noreply@casacurino.com>', to: [AVISO_AGENDA_TO], reply_to: l.email, subject: asunto, html: avisoAgendaHtml(l, a.tipo) });
    if (!id) { log.push(`aviso_error:${a.tipo}`); continue; }
    await supabase.from('partners_avisos_agenda').update({ estado: 'enviado', enviado_at: new Date().toISOString() }).eq('id', a.id);
    log.push(`aviso_enviado:${a.tipo}`);
  }
  return log;
}

async function cargarPasos(supabase: Any, secId: string): Promise<Any[]> {
  const { data } = await supabase.from('partners_secuencia_pasos').select('*').eq('secuencia_id', secId).eq('activo', true)
    .order('retraso_minutos').order('orden');
  return data || [];
}
async function hechosDe(supabase: Any, secId: string, leadIds: string[]): Promise<Map<string, Set<string>>> {
  const m = new Map<string, Set<string>>();
  if (!leadIds.length) return m;
  const { data } = await supabase.from('partners_secuencia_estado').select('solicitud_id, paso_id').eq('secuencia_id', secId).in('solicitud_id', leadIds);
  for (const x of data || []) { if (!m.has(x.solicitud_id)) m.set(x.solicitud_id, new Set()); m.get(x.solicitud_id)!.add(x.paso_id); }
  return m;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'unauthorized' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const ahora = Date.now();
  const abierta = await edicionAbierta(supabase);

  // Modo prueba de los avisos «Sin agendar»: solo «PRUEBA», sin franja.
  if (body?.modo === 'prueba_agenda') {
    const segPorHora = Math.max(1, Math.min(3600, Number(body?.segundos_por_hora) || 10));
    const { data: lead } = await supabase.from('partners_solicitudes').select('id, nombre').eq('id', String(body?.solicitud_id || '')).maybeSingle();
    if (!lead || !/^PRUEBA/i.test(String(lead.nombre || ''))) return json({ error: 'solo_solicitudes_prueba' }, 400);
    return json({ ok: true, modo: 'prueba_agenda', log: await avisosAgenda(supabase, ahora, { soloId: lead.id, segPorHora, sinFranja: true }) });
  }

  // Modo prueba: una sola solicitud "PRUEBA", plazos acelerados, sin franja.
  if (body?.modo === 'prueba') {
    const segPorHora = Math.max(1, Math.min(3600, Number(body?.segundos_por_hora) || 10));
    const { data: lead } = await supabase.from('partners_solicitudes').select('*').eq('id', String(body?.solicitud_id || '')).maybeSingle();
    if (!lead || !/^PRUEBA/i.test(String(lead.nombre || '')) || !lead.completada_at) return json({ error: 'solo_solicitudes_prueba_completas' }, 400);
    const { data: sec } = await supabase.from('partners_secuencias').select('*').eq('id', String(body?.secuencia_id || SECUENCIA_DEFECTO)).maybeSingle();
    if (!sec) return json({ error: 'secuencia_no_encontrada' }, 404);
    const log: string[] = [];
    if (await avisoJuan(supabase, lead, segPorHora, ahora)) log.push('aviso_juan');
    const pasos = await cargarPasos(supabase, sec.id);
    const hechos = (await hechosDe(supabase, sec.id, [lead.id])).get(lead.id) || new Set<string>();
    log.push(...await procesar(supabase, sec, pasos, lead, hechos, abierta, segPorHora, ahora));
    return json({ ok: true, modo: 'prueba', log });
  }

  const resumen: Record<string, string[]> = {};
  const add = (id: string, l: string[]) => { if (l.length) resumen[id] = [...(resumen[id] || []), ...l]; };

  // Envios programados que ya han llegado a su hora
  try { add('programados', await ejecutarProgramados(supabase, ahora)); } catch (e) { console.error('seguimiento: programados', e); }
  // Leads «Sin agendar» y avisos de cancelación / no presentado
  try { add('agenda', await avisosAgenda(supabase, ahora)); } catch (e) { console.error('seguimiento: avisos agenda', e); }

  // Aviso a Juan (independiente de las secuencias)
  const desdeAviso = new Date(ahora - 4 * 24 * 3600_000).toISOString();
  const { data: paraAviso } = await supabase.from('partners_solicitudes').select('*')
    .not('completada_at', 'is', null).is('pagado_at', null).is('aviso_sin_compra_at', null).gt('completada_at', desdeAviso).limit(200);
  for (const lead of paraAviso || []) {
    try { if (await avisoJuan(supabase, lead, 3600, ahora)) add(lead.id, ['aviso_juan']); } catch (e) { console.error('seguimiento: aviso', lead.id, e); }
  }

  // Secuencias activas
  const { data: secs } = await supabase.from('partners_secuencias').select('*').eq('activa', true);
  for (const sec of secs || []) {
    if (!enFranja(sec, ahora)) { add(sec.id, ['fuera_de_franja']); continue; }
    const pasos = await cargarPasos(supabase, sec.id);
    if (!pasos.length) continue;
    // Ventana: hasta el ultimo paso + 2 dias de margen
    const maxMin = Math.max(...pasos.map((p) => p.retraso_minutos));
    const desde = new Date(ahora - (maxMin + 2 * 24 * 60) * 60_000).toISOString();
    let q = supabase.from('partners_solicitudes').select('*')
      .not('completada_at', 'is', null).eq('consentimiento_solicitud', true).is('baja_at', null)
      .or(`secuencia_inicio_at.gt.${desde},and(secuencia_inicio_at.is.null,completada_at.gt.${desde})`);
    if (sec.sale_compra_intensivo) q = q.is('pagado_at', null);
    const { data: leads, error } = await q.order('completada_at', { ascending: true }).limit(500);
    if (error) { console.error('seguimiento: select', error); continue; }

    // Supresion: email borrado desde el CRM y solicitud creada antes del borrado
    const hashes = await Promise.all((leads || []).map((l: Lead) => emailHash(l.email)));
    const { data: sup } = hashes.length
      ? await supabase.from('partners_supresion').select('email_hash, created_at').in('email_hash', hashes)
      : { data: [] };
    const supMap = new Map<string, string>((sup || []).map((x: Any) => [x.email_hash, x.created_at]));
    const hechos = await hechosDe(supabase, sec.id, (leads || []).map((l: Lead) => l.id));

    for (const [i, lead] of (leads || []).entries()) {
      const borrado = supMap.get(hashes[i]);
      if (borrado && new Date(lead.created_at) < new Date(borrado)) continue;
      try {
        add(lead.id, await procesar(supabase, sec, pasos, lead, hechos.get(lead.id) || new Set(), abierta, 3600, ahora));
      } catch (e) { console.error('seguimiento: lead', lead.id, e); }
    }
  }
  return json({ ok: true, resumen });
});
