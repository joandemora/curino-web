// supabase/functions/estudio-ia/acceso.ts
//
// Estudio Curino · acceso de alumnos, créditos y admin (F4).
//
// Sin sesión:
//   'acceso_enlace' { email } → si es alumno activo, enlace mágico por email
//                   (Resend, desde Curino). Respuesta siempre igual (no revela
//                   quién es alumno). Máx. 3 enlaces / 15 min por email.
// Con sesión:
//   'yo'            → estado del alumno: acceso, crédito y gasto del mes,
//                     plantilla completa o qué falta.
// Solo admin:
//   'admin_alumnos'        → alumnos (compras + accesos) con estado, crédito y gasto; config; coste del mes.
//   'admin_acceso'         { email, acceso_hasta?, cortado?, concedido?, credito_mensual_usd?, nota?, ilimitado?, almacenamiento_mb?, max_fichero_mb?, emisor_curino? }
//   'admin_credito'        { email, usd, nota? } → ampliación de crédito del mes.
//   'admin_config'         { modelo, precio_*, credito_mensual_usd, meses_tras_fin, max_*, abierto_alumnos }
//   'acceso_enlace_prueba' { email } → devuelve el enlace (solo emails «prueba», no lo envía).

import { escapeHtml, resendSend } from '../_shared/clase-invoices.ts'
import { faltanPlantilla, PLANTILLA_ALUMNO, type Plantilla } from '../_shared/estudio/presupuesto.ts'

// deno-lint-ignore no-explicit-any
type Any = any;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const URL_ESTUDIO = 'https://www.casacurino.com/partners/estudio/';

export interface EstadoAlumno {
  email: string; nombre: string | null; productos: string | null; acceso_hasta: string | null;
  activo: boolean; cortado: boolean; concedido: boolean; credito_usd: number; gastado_usd: number; proyectos: number;
  saldo_usd: number; suscripcion: string | null; suscripcion_hasta: string | null; puede_suscribirse: boolean;
  // Accesos especiales (estudio_accesos): sin tope de créditos, cuota propia, emite como Curino
  ilimitado: boolean; almacenamiento_mb: number | null; max_fichero_mb: number | null; emisor_curino: boolean;
}

export async function estadoAlumno(supa: Any, email: string): Promise<EstadoAlumno | null> {
  const { data } = await supa.rpc('estudio_alumnos', { p_email: email.toLowerCase() });
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  const { data: a } = await supa.from('estudio_accesos').select('ilimitado, almacenamiento_mb, max_fichero_mb, emisor_curino').eq('email', email.toLowerCase()).maybeSingle();
  return {
    ...r, ilimitado: !!a?.ilimitado, almacenamiento_mb: a?.almacenamiento_mb ?? null, max_fichero_mb: a?.max_fichero_mb ?? null, emisor_curino: !!a?.emisor_curino,
    credito_usd: Number(r.credito_usd ?? 0), gastado_usd: Number(r.gastado_usd ?? 0), saldo_usd: Number(r.saldo_usd ?? 0)
  };
}

/** ¿Emite como SISTEMA & CURINO? Admin o acceso con emisor_curino (por user_id del dueño). */
export async function emisorCurinoDe(supa: Any, userId: string): Promise<boolean> {
  const { data: rol } = await supa.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
  if (rol) return true;
  const { data: u } = await supa.auth.admin.getUserById(userId);
  const email = String(u?.user?.email || '').toLowerCase();
  if (!email) return false;
  const { data: a } = await supa.from('estudio_accesos').select('emisor_curino').eq('email', email).maybeSingle();
  return !!a?.emisor_curino;
}

/** Puede entrar si es alumno activo y el Estudio está abierto (o tiene acceso concedido para pruebas). */
export function puedeEntrar(e: EstadoAlumno | null, cfg: Any): { ok: boolean; motivo?: string } {
  if (!e || !e.activo) return { ok: false, motivo: e?.cortado ? 'Tu acceso al Estudio está desactivado.' : 'Tu acceso al Estudio no está activo (es para alumnos del Intensivo y del One-to-one durante el curso y 6 meses después).' };
  if (!cfg?.abierto_alumnos && !e.concedido) return { ok: false, motivo: 'El Estudio aún no está abierto a alumnos.' };
  return { ok: true };
}

/** 1 crédito = 0,01 $ de coste real de IA (la contabilidad interna va en $). */
export const creditos = (usd: number) => Math.round((Number(usd) || 0) * 100);

export function sinCredito(e: EstadoAlumno | null): string | null {
  if (!e || e.ilimitado) return null;
  if (e.gastado_usd >= e.credito_usd && e.saldo_usd <= 0) {
    return `Has gastado los ${creditos(e.credito_usd)} créditos de este mes. Se renuevan el día 1; si los necesitas antes, compra un pack en «Créditos y plan».`;
  }
  return null;
}

/**
 * Tras gastar «coste» $, la parte que excede el crédito mensual que quedaba al
 * empezar la petición se descuenta del saldo de packs (movimiento «consumo»).
 */
export async function descontarSaldo(supa: Any, e: EstadoAlumno | null, userId: string, coste: number): Promise<void> {
  if (!e || e.ilimitado || !(coste > 0)) return;
  const quedaba = Math.max(0, e.credito_usd - e.gastado_usd);
  const exceso = Math.round((coste - quedaba) * 1e6) / 1e6;
  if (exceso > 0 && e.saldo_usd > 0) {
    await supa.from('estudio_saldo').insert({ user_id: userId, email: e.email, usd: -Math.min(exceso, e.saldo_usd), motivo: 'consumo' });
  }
}

async function enlaceMagico(supa: Any, email: string): Promise<string | null> {
  const opciones = { redirectTo: URL_ESTUDIO };
  let r = await supa.auth.admin.generateLink({ type: 'magiclink', email, options: opciones });
  if (r.error) {
    // No existe el usuario: se crea (email confirmado) y se vuelve a pedir el enlace.
    const c = await supa.auth.admin.createUser({ email, email_confirm: true });
    if (c.error && !/already/i.test(c.error.message)) { console.error('estudio acceso: createUser', c.error.message); return null; }
    r = await supa.auth.admin.generateLink({ type: 'magiclink', email, options: opciones });
  }
  if (r.error) { console.error('estudio acceso: generateLink', r.error.message); return null; }
  return r.data?.properties?.action_link ?? null;
}

const ACCIONES_ADMIN = new Set(['admin_alumnos', 'admin_acceso', 'admin_credito', 'admin_config', 'acceso_enlace_prueba']);
export const esAccionAdminAcceso = (a: string) => ACCIONES_ADMIN.has(a);

export async function accionEnlace(supa: Any, cfg: Any, body: Any, json: (b: unknown, s?: number) => Response): Promise<Response> {
  const email = String(body?.email || '').trim().toLowerCase().slice(0, 200);
  const generico = { ok: true, mensaje: 'Si tu email es el de un alumno con acceso al Estudio, te hemos enviado un enlace para entrar. Revisa también el spam.' };
  if (!EMAIL.test(email)) return json({ error: 'Escribe un email válido.' }, 400);
  const desde = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await supa.from('estudio_enlaces').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', desde);
  if ((count ?? 0) >= 3) return json(generico);
  const e = await estadoAlumno(supa, email);
  const ok = puedeEntrar(e, cfg).ok;
  let enviado = false;
  if (ok) {
    const link = await enlaceMagico(supa, email);
    if (link) {
      const nombre = (e?.nombre || '').split(' ')[0];
      await resendSend({
        from: 'Curino <noreply@casacurino.com>', to: [email], reply_to: 'info@casacurino.com',
        subject: 'Tu enlace para entrar al Estudio Curino',
        html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a1a1a">
<h2 style="margin:0 0 12px">Estudio Curino</h2>
<p>Hola${nombre ? ' ' + escapeHtml(nombre) : ''},</p>
<p>Pulsa el botón para entrar al Estudio. El enlace caduca en una hora y solo sirve una vez.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#161616;color:#ffffff;font-weight:bold;padding:12px 22px;text-decoration:none;border-radius:8px">Entrar al Estudio</a></p>
<p style="font-size:13px;color:#666">Si no lo has pedido tú, ignora este email.</p>
<p style="font-size:12px;color:#888;margin-top:30px">SISTEMA &amp; CURINO SLU · <a href="https://www.casacurino.com/aviso-legal/" style="color:#888">Aviso legal</a></p>
</body></html>`
      });
      enviado = true;
    }
  }
  await supa.from('estudio_enlaces').insert({ email, enviado });
  return json(generico);
}

export async function accionYo(supa: Any, email: string, userId: string, esAdmin: boolean, cfg: Any, json: (b: unknown, s?: number) => Response): Promise<Response> {
  const e = esAdmin ? null : await estadoAlumno(supa, email);
  const { data: pl } = await supa.from('estudio_plantillas').select('datos').eq('user_id', userId).maybeSingle();
  const plantilla: Plantilla = { ...PLANTILLA_ALUMNO, ...(pl?.datos ?? {}) };
  return json({
    email, admin: esAdmin, acceso: esAdmin ? { ok: true } : puedeEntrar(e, cfg),
    // Antiguo alumno sin acceso: puede entrar a «Créditos y plan» para suscribirse
    puede_suscribirse: !!e?.puede_suscribirse && (!!cfg?.abierto_alumnos || !!e?.concedido),
    alumno: e ? { nombre: e.nombre, productos: e.productos, acceso_hasta: e.acceso_hasta, suscripcion: e.suscripcion } : null,
    // En créditos (1 crédito = 0,01 $ de coste real)
    credito: e ? { ilimitado: e.ilimitado, mes: creditos(e.credito_usd), gastados: creditos(e.gastado_usd), restantes: Math.max(0, creditos(e.credito_usd) - creditos(e.gastado_usd)), saldo: creditos(e.saldo_usd) } : null,
    emisor_curino: esAdmin || !!e?.emisor_curino,
    faltan: esAdmin || e?.emisor_curino ? [] : faltanPlantilla(plantilla)
  });
}

export async function accionAdminAcceso(action: string, supa: Any, userId: string, body: Any, json: (b: unknown, s?: number) => Response): Promise<Response> {
  const num = (v: unknown, min: number, max: number) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10000) / 10000 : null;
  };
  if (action === 'admin_alumnos') {
    const [{ data: alumnos, error }, { data: cfg }] = await Promise.all([
      supa.rpc('estudio_alumnos', { p_email: null }),
      supa.from('estudio_config').select('*').eq('id', 1).maybeSingle()
    ]);
    if (error) throw error;
    const inicio = (await supa.rpc('estudio_inicio_mes')).data;
    const { data: usos } = await supa.from('estudio_uso').select('user_id, coste_usd, input_tokens, output_tokens, cache_escritura_tokens, cache_lectura_tokens').gte('created_at', inicio);
    const mes = (usos ?? []).reduce((s: Any, u: Any) => ({
      coste: s.coste + Number(u.coste_usd), llamadas: s.llamadas + 1,
      tokens: s.tokens + u.input_tokens + u.output_tokens + u.cache_escritura_tokens + u.cache_lectura_tokens
    }), { coste: 0, llamadas: 0, tokens: 0 });
    return json({ alumnos: alumnos ?? [], config: cfg, mes: { ...mes, coste: Math.round(mes.coste * 10000) / 10000, desde: inicio } });
  }
  if (action === 'admin_acceso') {
    const email = String(body?.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return json({ error: 'Email no válido' }, 400);
    const { data: ya } = await supa.from('estudio_accesos').select('*').eq('email', email).maybeSingle();
    const fila: Any = { email, updated_at: new Date().toISOString() };
    if ('acceso_hasta' in (body ?? {})) fila.acceso_hasta = body.acceso_hasta ? new Date(body.acceso_hasta + 'T23:59:59+01:00').toISOString() : null;
    if ('cortado' in (body ?? {})) fila.cortado = body.cortado === true;
    if ('concedido' in (body ?? {})) fila.concedido = body.concedido === true;
    if ('credito_mensual_usd' in (body ?? {})) fila.credito_mensual_usd = num(body.credito_mensual_usd, 0, 1000);
    if ('ilimitado' in (body ?? {})) fila.ilimitado = body.ilimitado === true;
    if ('emisor_curino' in (body ?? {})) fila.emisor_curino = body.emisor_curino === true;
    if ('almacenamiento_mb' in (body ?? {})) { const mb = num(body.almacenamiento_mb, 10, 1048576); fila.almacenamiento_mb = mb === null ? null : Math.round(mb); }
    if ('max_fichero_mb' in (body ?? {})) { const mb = num(body.max_fichero_mb, 1, 250); fila.max_fichero_mb = mb === null ? null : Math.round(mb); }
    if ('nota' in (body ?? {})) fila.nota = String(body.nota || '').slice(0, 300) || null;
    const r = ya ? await supa.from('estudio_accesos').update(fila).eq('email', email) : await supa.from('estudio_accesos').insert(fila);
    if (r.error) throw r.error;
    return json({ ok: true });
  }
  if (action === 'admin_credito') {
    const email = String(body?.email || '').trim().toLowerCase();
    const usd = num(body?.usd, 0.01, 1000);
    if (!EMAIL.test(email) || usd === null) return json({ error: 'Email o importe no válido' }, 400);
    const mes = (await supa.rpc('estudio_mes_actual')).data;
    const r = await supa.from('estudio_creditos').insert({ email, mes, usd, nota: String(body?.nota || '').slice(0, 200) || null, creado_por: userId });
    if (r.error) throw r.error;
    return json({ ok: true });
  }
  if (action === 'admin_config') {
    const c = body ?? {};
    const fila: Any = { updated_at: new Date().toISOString() };
    if (typeof c.modelo === 'string' && /^claude-[a-z0-9-]+$/.test(c.modelo.trim())) fila.modelo = c.modelo.trim();
    for (const [k, max] of [['precio_entrada', 1000], ['precio_salida', 1000], ['precio_cache_escritura', 1000], ['precio_cache_lectura', 1000], ['credito_mensual_usd', 1000]] as const) {
      const v = num(c[k], 0, max); if (v !== null) fila[k] = v;
    }
    for (const [k, min, max] of [['meses_tras_fin', 0, 60], ['max_llamadas_hora', 1, 500], ['max_mb', 1, 50], ['max_paginas', 1, 50], ['almacenamiento_mb', 10, 102400]] as const) {
      const v = num(c[k], min, max); if (v !== null) fila[k] = Math.round(v);
    }
    if (typeof c.abierto_alumnos === 'boolean') fila.abierto_alumnos = c.abierto_alumnos;
    for (const [k, max] of [['plan_eur', 1000], ['plan_usd', 1000]] as const) { const v = num(c[k], 0, max); if (v !== null) fila[k] = v; }
    const mult = num(c.multiplicador, 1, 100); if (mult !== null) fila.multiplicador = mult;
    const cambio = num(c.eur_usd, 0.5, 2); if (cambio !== null) fila.eur_usd = cambio;
    if (Array.isArray(c.packs)) {
      const packs = c.packs.slice(0, 6).map((p: Any, i: number) => ({ id: String(p?.id || `p${i + 1}`).replace(/[^\w-]/g, '').slice(0, 20) || `p${i + 1}`, eur: num(p?.eur, 1, 1000), usd: num(p?.usd, 0.01, 1000) }))
        .filter((p: Any) => p.eur !== null && p.usd !== null);
      fila.packs = packs;
    }
    const r = await supa.from('estudio_config').update(fila).eq('id', 1);
    if (r.error) throw r.error;
    return json({ ok: true });
  }
  if (action === 'acceso_enlace_prueba') {
    // Solo para probar el flujo del alumno sin depender del correo.
    const email = String(body?.email || '').trim().toLowerCase();
    if (!EMAIL.test(email) || !/prueba/.test(email)) return json({ error: 'Solo para emails de prueba («prueba» en el email).' }, 400);
    return json({ enlace: await enlaceMagico(supa, email) });
  }
  return json({ error: 'accion_desconocida' }, 400);
}
