// supabase/functions/partners-seguimiento/index.ts
//
// Seguimiento automatico de quien completa la solicitud de /partners y no
// compra. Invocada por pg_cron cada 15 min (X-Cron-Secret = CRON_SECRET).
//
// Por solicitud completa (completada_at) sin compra del Intensivo:
//   +30 min  aviso a Juan (info@casacurino.com) "Sin comprar: …"   aviso_sin_compra_at
//   +1 h     email 1: enlace por si se cerro                     seguimiento_1_at
//   +24 h    email 2: caso Maria Alcalde + 3 dudas               seguimiento_2_at
//   +48 h    email 3: oferta Sesion 1:1 (60 € durante 3 h)       seguimiento_3_at + oferta_sesion_enviada_at
//   +72 h    email 4: plazas reales del Intensivo (ultimo)        seguimiento_4_at
// Reglas:
//   - Compra del Intensivo (pagado_at) → se cancela todo.
//   - Compra de la Sesion (sesion_comprada_at) → se salta el email 3.
//   - Baja (baja_at) → no mas emails al lead (el aviso a Juan si sale).
//   - Intensivo agotado o sin edicion → el email 4 no se envia.
//   - Como mucho un email al lead por ejecucion; si hay varios vencidos
//     (p. ej. el cron estuvo parado) solo se envia el mas reciente y los
//     anteriores se marcan como procesados sin enviar.
//   - Las marcas *_at evitan repetir (tambien cuando un paso se salta).
//   - Solo leads con consentimiento_comercial (casilla v2). El aviso a Juan
//     sale para todas las solicitudes completas.
//   - Email 3 (oferta sesion) solo si PARTNERS_SEGUIMIENTO_SESION_ACTIVO='true'.
//
// Interruptor: no envia nada mientras PARTNERS_SEGUIMIENTO_ACTIVO !== 'true'.
// Modo prueba: { modo: 'prueba', solicitud_id, segundos_por_hora } procesa
// solo esa solicitud (nombre debe empezar por "PRUEBA") con los plazos
// acelerados (1 h → segundos_por_hora segundos), aunque el interruptor este
// apagado.
//
// Remitente: "Juan de Mora <info@casacurino.com>", reply_to info@.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { signLeadToken } from '../_shared/lead-token.ts'
import { SESION } from '../_shared/sesion-config.ts'

const SITE = 'https://www.casacurino.com';
const WA = '34611965612';
const IG_MARIA = 'https://www.instagram.com/p/DZNH1qfMFY0/';
const FROM_JUAN = 'Juan de Mora <info@casacurino.com>';
const AVISO_TO = 'info@casacurino.com';

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
  noviembre: 'Ya, en el intensivo de noviembre', proximos_meses: 'En los próximos meses', informandome: 'Solo estoy informándome'
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function resend(payload: Record<string, unknown>): Promise<boolean> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) console.error('seguimiento: Resend', r.status, await r.text());
  return r.ok;
}

// ── Plantilla "email personal": texto sencillo, un boton discreto ────────
function personal(parrafos: string[], boton: { url: string; label: string } | null, bajaUrl: string): string {
  const ps = parrafos.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join('');
  const btn = boton
    ? `<p style="margin:18px 0"><a href="${esc(boton.url)}" style="display:inline-block;background:#12B76A;color:#161616;font-weight:bold;padding:11px 20px;text-decoration:none;border-radius:4px">${esc(boton.label)}</a></p>`
    : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:560px;margin:0 auto;padding:16px">
${ps}${btn}
<p style="margin:0 0 14px">Juan de Mora · Curino</p>
<p style="font-size:11px;color:#999;margin-top:28px;border-top:1px solid #eee;padding-top:10px">Recibes este email porque solicitaste información sobre Curino Partners en casacurino.com. Si no quieres recibir más, <a href="${esc(bajaUrl)}" style="color:#999">date de baja aquí</a>. SISTEMA &amp; CURINO SLU · Carrer de Balmes 252, 5-2, 08006 Barcelona.</p>
</body></html>`;
}

// deno-lint-ignore no-explicit-any
type Lead = any;

// deno-lint-ignore no-explicit-any
async function intensivo(supabase: any) {
  const { data } = await supabase.from('clases')
    .select('plazas_totales, plazas_ocupadas, estado')
    .eq('tipo', 'directo').eq('oculta', false).in('estado', ['abierta', 'agotada'])
    .gt('fecha', new Date().toISOString()).order('fecha', { ascending: true }).limit(1).maybeSingle();
  if (!data) return null;
  return { libres: Math.max(0, data.plazas_totales - data.plazas_ocupadas), total: data.plazas_totales, abierta: data.estado === 'abierta' };
}

// ── Contenido de cada email ──────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function construir(n: 1 | 2 | 3 | 4, lead: Lead, supabase: any): Promise<{ subject: string; html: string } | null> {
  const nombre = String(lead.nombre || '').split(' ')[0] || 'hola';
  const token = await signLeadToken(lead.id);
  const checkoutUrl = `${SITE}/partners/formaciones/?t=${encodeURIComponent(token)}&ir=intensivo`;
  const formacionesUrl = `${SITE}/partners/formaciones/?t=${encodeURIComponent(token)}`;
  const bajaUrl = `${SITE}/partners/baja/?t=${encodeURIComponent(token)}`;
  const waUrl = `https://wa.me/${WA}?text=${encodeURIComponent(`Hola Juan, soy ${nombre}. Tengo una duda sobre el intensivo Curino Partners.`)}`;

  if (n === 1) {
    return {
      subject: `${nombre}, te dejo el enlace por si se te cerró`,
      html: personal([
        `Hola ${esc(nombre)},`,
        'Te escribo por si se te cerró la página después de rellenar la solicitud del Intensivo Curino Partners.',
        'Te recuerdo lo que incluye:<br>· 4 semanas y 8 clases en directo por Zoom conmigo.<br>· El negocio, producto y producción, diseño y presupuesto, y cómo vender y entregar.<br>· Plantilla de presupuesto, contrato de venta, catálogo y acceso al CAD de Curino.<br>· El grupo de WhatsApp de tu promoción.',
        'Aquí tienes el enlace para reservar tu plaza:'
      ], { url: checkoutUrl, label: 'Reservar mi plaza' }, bajaUrl).replace('<p style="margin:0 0 14px">Juan de Mora · Curino</p>',
        `<p style="margin:0 0 14px">Si tienes cualquier duda, respóndeme a este email o <a href="${esc(waUrl)}">escríbeme por WhatsApp</a>.</p><p style="margin:0 0 14px">Juan de Mora · Curino</p>`)
    };
  }
  if (n === 2) {
    return {
      subject: 'El tipo de proyecto que vas a aprender a vender',
      html: personal([
        `Hola ${esc(nombre)},`,
        `Te enseño un proyecto real: el armario a medida que hicimos para Maria Alcalde. Ella misma lo enseñó en su Instagram: <a href="${esc(IG_MARIA)}">${esc(IG_MARIA)}</a>`,
        'Este es el tipo de proyecto que se vende en este sector, y lo que aprenderás a vender en el intensivo: diseño, presupuesto y entrega, sin taller propio.',
        'Las tres dudas que más me preguntan:',
        '<strong>«No sé nada de carpintería.»</strong> No vas a fabricar nada: tu trabajo es diseñar, presupuestar y vender. Lo que necesitas saber de materiales, acabados y herrajes lo vemos en la semana 2.',
        '<strong>«No tengo mucho tiempo.»</strong> Son 8 clases en directo en 4 semanas, dos por semana. Yo llevo Curino solo, unas 2 horas al día; para empezar te basta con reservar 1-2 horas diarias.',
        '<strong>«¿Cómo son las clases?»</strong> En directo por Zoom, con tiempo para tus preguntas en cada una, y con el grupo de WhatsApp de la promoción entre clase y clase.',
        'Si lo tienes claro, aquí tienes tu plaza:'
      ], { url: checkoutUrl, label: 'Reservar mi plaza' }, bajaUrl)
    };
  }
  if (n === 3) {
    const oferta = (SESION.precioOfertaCents / 100).toLocaleString('es-ES');
    const normal = (SESION.precioNormalCents / 100).toLocaleString('es-ES');
    return {
      subject: 'Si aún no es tu momento para el intensivo',
      html: personal([
        `Hola ${esc(nombre)},`,
        `Si aún no es tu momento para el intensivo, empieza con una sesión 1:1 conmigo de 30 min y llévate los recursos iniciales para arrancar en el sector.`,
        'En 30 minutos vemos tu situación y tu plan para empezar, y te llevas los recursos iniciales: la plantilla de presupuesto, la lista de proveedores con los que empezar y los primeros pasos para conseguir tu primer cliente.',
        `Solo para ti: <strong>${oferta} € durante las próximas ${SESION.ofertaHoras} horas</strong> (después, ${normal} €).`
      ], { url: formacionesUrl, label: `Quiero mi sesión por ${oferta} €` }, bajaUrl)
    };
  }
  // n === 4
  const int = await intensivo(supabase);
  if (!int || !int.abierta || int.libres <= 0) return null; // agotado o sin edicion → no se envia
  return {
    subject: `Quedan ${int.libres} de ${int.total} plazas`,
    html: personal([
      `Hola ${esc(nombre)},`,
      `Último email sobre esto: en la primera edición del Intensivo Curino Partners quedan <strong>${int.libres} de ${int.total} plazas</strong>.`,
      'Es el mismo modelo con el que hemos hecho proyectos como el de Maria Alcalde.',
      'Aquí tienes todas las formaciones, por si quieres empezar por el intensivo o con una sesión conmigo:',
    ], { url: formacionesUrl, label: 'Ver las formaciones' }, bajaUrl).replace('<p style="margin:0 0 14px">Juan de Mora · Curino</p>',
      '<p style="margin:0 0 14px">Si no es tu momento, no pasa nada. Cuando quieras, respóndeme a este email.</p><p style="margin:0 0 14px">Juan de Mora · Curino</p>')
  };
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

// ── Procesar una solicitud ─────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function procesar(supabase: any, lead: Lead, segPorHora: number, ahora: number): Promise<string[]> {
  const log: string[] = [];
  if (lead.pagado_at) return log; // compro el intensivo → nada
  const base = new Date(lead.completada_at).getTime();
  const vencido = (horas: number) => ahora >= base + horas * segPorHora * 1000;
  const marca = async (cols: Record<string, string>) => {
    await supabase.from('partners_solicitudes').update(cols).eq('id', lead.id);
    Object.assign(lead, cols);
  };
  const now = () => new Date().toISOString();

  // Aviso a Juan (+30 min). Tambien si el lead se dio de baja.
  if (!lead.aviso_sin_compra_at && vencido(0.5)) {
    const ok = await resend({
      from: 'Curino Partners — Solicitudes <noreply@casacurino.com>', to: [AVISO_TO], reply_to: lead.email,
      subject: `Sin comprar: ${lead.nombre} (${lead.cualificado ? 'cualificado' : 'no cualificado'})`,
      html: avisoJuanHtml(lead)
    });
    if (ok) { await marca({ aviso_sin_compra_at: now() }); log.push('aviso_juan'); }
  }

  // Emails al lead: solo con la casilla v2 (consentimiento_comercial) y sin baja.
  if (lead.baja_at || !lead.consentimiento_comercial) return log;

  // Pasos vencidos y pendientes
  const pasos: { n: 1 | 2 | 3 | 4; horas: number; col: string }[] = [
    { n: 1, horas: 1, col: 'seguimiento_1_at' },
    { n: 2, horas: 24, col: 'seguimiento_2_at' },
    { n: 3, horas: 48, col: 'seguimiento_3_at' },
    { n: 4, horas: 72, col: 'seguimiento_4_at' }
  ];
  const pendientes = pasos.filter((p) => !lead[p.col] && vencido(p.horas));
  if (!pendientes.length) return log;
  const ultimo = pendientes[pendientes.length - 1];
  for (const p of pendientes.slice(0, -1)) { await marca({ [p.col]: now() }); log.push(`email_${p.n}:saltado_por_retraso`); }

  if (ultimo.n === 3 && lead.sesion_comprada_at) {
    await marca({ seguimiento_3_at: now() }); log.push('email_3:saltado_sesion_comprada'); return log;
  }
  // Activacion por partes: sin PARTNERS_SEGUIMIENTO_SESION_ACTIVO la oferta
  // de la sesion (email 3) no se envia.
  if (ultimo.n === 3 && Deno.env.get('PARTNERS_SEGUIMIENTO_SESION_ACTIVO') !== 'true') {
    await marca({ seguimiento_3_at: now() }); log.push('email_3:saltado_sesion_inactiva'); return log;
  }
  const email = await construir(ultimo.n, lead, supabase);
  if (!email) { await marca({ [ultimo.col]: now() }); log.push(`email_${ultimo.n}:no_enviado_agotado`); return log; }

  const ok = await resend({ from: FROM_JUAN, to: [lead.email], reply_to: 'info@casacurino.com', subject: email.subject, html: email.html });
  if (ok) {
    const cols: Record<string, string> = { [ultimo.col]: now() };
    if (ultimo.n === 3) cols.oferta_sesion_enviada_at = now();
    await marca(cols);
    log.push(`email_${ultimo.n}:enviado`);
  }
  return log;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'unauthorized' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const ahora = Date.now();
  const sel = '*';

  // Modo prueba: una sola solicitud "PRUEBA", plazos acelerados.
  if (body?.modo === 'prueba') {
    const segPorHora = Math.max(1, Math.min(3600, Number(body?.segundos_por_hora) || 10));
    const { data: lead } = await supabase.from('partners_solicitudes').select(sel).eq('id', String(body?.solicitud_id || '')).maybeSingle();
    if (!lead || !/^PRUEBA/i.test(String(lead.nombre || '')) || !lead.completada_at) return json({ error: 'solo_solicitudes_prueba_completas' }, 400);
    return json({ ok: true, modo: 'prueba', log: await procesar(supabase, lead, segPorHora, ahora) });
  }

  if (Deno.env.get('PARTNERS_SEGUIMIENTO_ACTIVO') !== 'true') return json({ ok: true, activo: false });

  const { data: leads, error } = await supabase.from('partners_solicitudes').select(sel)
    .not('completada_at', 'is', null).is('pagado_at', null)
    .gt('completada_at', new Date(ahora - 4 * 24 * 3600_000).toISOString())   // ventana de la secuencia
    .order('completada_at', { ascending: true }).limit(200);
  if (error) { console.error('seguimiento: select', error); return json({ error: 'select' }, 500); }
  const resumen: Record<string, string[]> = {};
  for (const lead of leads || []) {
    try {
      const l = await procesar(supabase, lead, 3600, ahora);
      if (l.length) resumen[lead.id] = l;
    } catch (e) { console.error('seguimiento: lead', lead.id, e); }
  }
  return json({ ok: true, activo: true, procesados: (leads || []).length, resumen });
});
