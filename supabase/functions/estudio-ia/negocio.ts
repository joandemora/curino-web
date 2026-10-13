// supabase/functions/estudio-ia/negocio.ts
//
// Estudio Curino · «Mi negocio» (F5).
//   'presupuesto_estado' { proyecto_id, estado } → borrador / enviado / aceptado / rechazado
//                         (con su fecha; volver a borrador las borra).
//   'negocio'       { periodo: 'mes'|'trimestre'|'anio'|'todo' } → métricas del usuario.
//   'admin_negocio' { periodo } (admin) → las mismas, agregadas, + una fila por alumno.
// Métricas: proyectos creados, presupuestos enviados e importe presupuestado
// (por fecha de envío), ventas = aceptados (por fecha de aceptación), tasa
// de cierre = aceptados / enviados del periodo, ticket medio, pendientes de
// respuesta (enviados sin respuesta, con días desde el envío), evolución de
// los últimos 12 meses y últimos presupuestos. Importes sin IVA.

import { totales, type DocPresupuesto } from '../_shared/estudio/presupuesto.ts'
import { madridAUtc } from '../_shared/crm-envio.ts'
import { metricasProyecto } from '../_shared/estudio/metricas.ts'

// deno-lint-ignore no-explicit-any
type Any = any;
const ESTADOS = ['borrador', 'enviado', 'aceptado', 'rechazado'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACCIONES = new Set(['presupuesto_estado', 'negocio', 'admin_negocio']);
export const esAccionNegocio = (a: string) => ACCIONES.has(a);

/** Inicio del periodo en hora de Madrid (null = todo). */
function inicioPeriodo(p: string): Date | null {
  const [y, m] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).split('-').map(Number);
  if (p === 'todo') return null;
  if (p === 'anio') {   // «Año» = últimos 12 meses (incluido el actual)
    const d = new Date(Date.UTC(y, m - 1 - 11, 1));
    return madridAUtc(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01T00:00`);
  }
  const mes = p === 'mes' ? m : m - ((m - 1) % 3);
  return madridAUtc(`${y}-${String(mes).padStart(2, '0')}-01T00:00`);
}
const mesClave = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7);

function importeDe(p: Any, iva: number): number | null {
  if (p.importe !== null && p.importe !== undefined) return Number(p.importe);
  if (!p.datos?.partidas) return null;   // importado sin importe
  const t = totales(p.datos as DocPresupuesto, iva);
  return t.pendientes ? null : t.importe;
}

export function metricas(proyectos: Any[], presupuestos: Any[], periodo: string, iva = 21, diasCaducidad = 90) {
  const desde = inicioPeriodo(periodo);
  const en = (iso: string | null) => !!iso && (!desde || new Date(iso) >= desde);
  const nombre = new Map(proyectos.map((p) => [p.id, p.nombre]));
  const enviados = presupuestos.filter((p) => en(p.enviado_at));
  const aceptados = presupuestos.filter((p) => p.estado === 'aceptado' && en(p.aceptado_at));
  const suma = (l: Any[]) => Math.round(l.reduce((s, p) => s + (importeDe(p, iva) ?? 0), 0) * 100) / 100;
  const ventas = suma(aceptados);
  const hoy = Date.now();
  // Últimos 12 meses (incluido el actual)
  const meses: string[] = [];
  const [ya, ma] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).split('-').map(Number);
  for (let i = 11; i >= 0; i--) meses.push(new Date(Date.UTC(ya, ma - 1 - i, 15)).toISOString().slice(0, 7));
  const serie = meses.map((m) => ({
    mes: m,
    presupuestado: suma(presupuestos.filter((p) => p.enviado_at && mesClave(p.enviado_at) === m)),
    aceptado: suma(presupuestos.filter((p) => p.estado === 'aceptado' && p.aceptado_at && mesClave(p.aceptado_at) === m))
  }));
  const fila = (p: Any) => ({
    proyecto_id: p.proyecto_id, cliente: nombre.get(p.proyecto_id) ?? '', numero: p.datos?.numero || '',
    estado: p.estado, estado_nota: p.estado_nota ?? null, importe: importeDe(p, iva), fecha: p.estado_at || p.updated_at || p.created_at, enviado_at: p.enviado_at
  });
  return {
    periodo,
    proyectos: proyectos.filter((p) => en(p.created_at)).length,
    enviados: enviados.length,
    presupuestado: suma(enviados),
    aceptados: aceptados.length,
    ventas,
    tasa_cierre: enviados.length ? Math.round((1000 * aceptados.length) / enviados.length) / 10 : null,
    ticket_medio: aceptados.length ? Math.round((100 * ventas) / aceptados.length) / 100 : null,
    // Enviados que pasarán a «rechazado» en los próximos 15 días (seguimiento)
    caducan: presupuestos.filter((p) => p.estado === 'enviado').map((p) => {
      const ref = new Date(p.estado_at || p.enviado_at).getTime();
      return { ...fila(p), quedan: diasCaducidad - Math.floor((hoy - ref) / 86_400_000) };
    }).filter((x) => x.quedan >= 0 && x.quedan <= 15).sort((a, b) => a.quedan - b.quedan),
    dias_caducidad: diasCaducidad,
    pendientes: presupuestos.filter((p) => p.estado === 'enviado').map((p) => ({ ...fila(p), dias: Math.floor((hoy - new Date(p.enviado_at).getTime()) / 86_400_000) }))
      .sort((a, b) => b.dias - a.dias),
    serie,
    ultimos: [...presupuestos].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 8).map(fila)
  };
}

/**
 * Facturación, coste y margen REALES de los proyectos del periodo (aceptados
 * en el periodo o con facturas a cliente fechadas en él) + ranking por margen.
 */
async function reales(supa: Any, proyectos: Any[], presupuestos: Any[], periodo: string) {
  const ids = proyectos.map((p) => p.id);
  if (!ids.length) return { facturacion: 0, costes: 0, margen: null, margen_pct: null, ranking: [] };
  const [f, c] = await Promise.all([
    supa.from('estudio_ficheros').select('proyecto_id, tipo, base, total, fecha, proveedor').in('proyecto_id', ids).eq('subido', true),
    supa.from('estudio_costes').select('proyecto_id, categoria, importe, fecha').in('proyecto_id', ids)
  ]);
  const desde = inicioPeriodo(periodo);
  const en = (iso: string | null) => !!iso && (!desde || new Date(iso) >= desde);
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  let fact = 0, cost = 0, conCostes = false;
  const ranking: Any[] = [];
  for (const p of proyectos) {
    const pr = presupuestos.find((x) => x.proyecto_id === p.id) ?? null;
    const fich = (f.data ?? []).filter((x: Any) => x.proyecto_id === p.id);
    const cos = (c.data ?? []).filter((x: Any) => x.proyecto_id === p.id);
    const facturasEnPeriodo = fich.some((x: Any) => x.tipo === 'factura_cliente' && en(x.fecha));
    if (!(pr?.estado === 'aceptado' && en(pr.aceptado_at)) && !facturasEnPeriodo) continue;
    const m = metricasProyecto({ presupuesto: pr, ficheros: fich, costes: cos, cobros: [], hoy });
    if (!m.facturacion) continue;
    fact += m.facturacion; cost += m.costes;
    if (m.margen !== null) conCostes = true;
    ranking.push({ proyecto_id: p.id, cliente: p.nombre, facturacion: m.facturacion, costes: m.costes, margen: m.margen, margen_pct: m.margen_pct });
  }
  ranking.sort((a, b) => (b.margen_pct ?? -1e9) - (a.margen_pct ?? -1e9));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    facturacion: r2(fact), costes: r2(cost), margen: conCostes ? r2(fact - cost) : null,
    margen_pct: conCostes && fact > 0 ? Math.round((1000 * (fact - cost)) / fact) / 10 : null, ranking
  };
}

/**
 * Margen por mes (proyectos aceptados ese mes con costes: facturación − costes)
 * y calendario de montajes (aceptados con su fecha prevista, montado y cobro).
 */
async function extras(supa: Any, proyectos: Any[], presupuestos: Any[], serie: Any[]) {
  const ids = proyectos.map((p) => p.id);
  if (!ids.length) return { serie, calendario: [] };
  const [f, c, cb] = await Promise.all([
    supa.from('estudio_ficheros').select('proyecto_id, tipo, base, total, fecha').in('proyecto_id', ids).eq('subido', true),
    supa.from('estudio_costes').select('proyecto_id, categoria, importe, fecha').in('proyecto_id', ids),
    supa.from('estudio_cobros').select('proyecto_id, concepto, pct, importe, fecha_prevista, cobrado, fecha_cobro').in('proyecto_id', ids)
  ]);
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const porMes = new Map<string, { f: number; c: number }>();
  const calendario: Any[] = [];
  for (const p of proyectos) {
    const pr = presupuestos.find((x) => x.proyecto_id === p.id);
    if (pr?.estado !== 'aceptado') continue;
    const m = metricasProyecto({
      presupuesto: pr, hoy,
      ficheros: (f.data ?? []).filter((x: Any) => x.proyecto_id === p.id),
      costes: (c.data ?? []).filter((x: Any) => x.proyecto_id === p.id),
      cobros: (cb.data ?? []).filter((x: Any) => x.proyecto_id === p.id)
    });
    // Margen fiable: con facturación y todos los costes con importe (sin «pendiente de revisar»)
    const costeSinImporte = (f.data ?? []).some((x: Any) => x.proyecto_id === p.id && x.tipo === 'factura_proveedor' && (x.base === null || x.base === undefined));
    if (m.margen !== null && m.facturacion > 0 && !costeSinImporte && pr.aceptado_at) {
      const k = mesClave(pr.aceptado_at), a = porMes.get(k) ?? { f: 0, c: 0 };
      a.f += m.facturacion; a.c += m.costes; porMes.set(k, a);
    }
    calendario.push({
      id: p.id, numero: p.numero ?? null, nombre: p.nombre, importe: m.facturacion,
      montaje_previsto: p.montaje_previsto ?? null, montado: !!p.montado, montado_at: p.montado_at ?? null, montaje_nota: p.montaje_nota ?? null,
      cobro: m.cobros.total > 0 && m.cobros.pendiente <= 0.5 ? 'cobrado' : 'pendiente', pendiente: m.cobros.pendiente
    });
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    serie: serie.map((x) => { const a = porMes.get(x.mes); return { ...x, margen: a ? r2(a.f - a.c) : 0, margen_pct: a && a.f > 0 ? Math.round((1000 * (a.f - a.c)) / a.f) / 10 : null }; }),
    calendario
  };
}

export async function accionNegocio(action: string, o: {
  supa: Any; userId: string; esAdmin: boolean; body: Any; json: (b: unknown, s?: number) => Response;
}): Promise<Response> {
  const { supa, userId, esAdmin, body, json } = o;
  const periodo = ['mes', 'trimestre', 'anio', 'todo'].includes(body?.periodo) ? body.periodo : 'mes';
  const campos = 'proyecto_id, estado, estado_nota, estado_at, enviado_at, aceptado_at, rechazado_at, importe, pvp, created_at, updated_at, datos';
  const { data: cfgC } = await supa.from('estudio_config').select('dias_caducidad').eq('id', 1).maybeSingle();
  const dias = Number(cfgC?.dias_caducidad ?? 90);

  if (action === 'presupuesto_estado') {
    const pid = String(body?.proyecto_id || '');
    const estado = String(body?.estado || '');
    if (!UUID.test(pid) || !ESTADOS.includes(estado as typeof ESTADOS[number])) return json({ error: 'Estado no válido' }, 400);
    const { data: pr } = await supa.from('estudio_proyectos').select('user_id, montaje_previsto, montado').eq('id', pid).maybeSingle();
    if (!pr || (pr.user_id !== userId && !esAdmin)) return json({ error: 'Proyecto no encontrado' }, 404);
    // Al aceptar, la fecha prevista de montaje es obligatoria (si el proyecto no la tiene ya)
    if (estado === 'aceptado' && !pr.montaje_previsto && !pr.montado) {
      const fm = String(body?.montaje_previsto || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fm) || isNaN(Date.parse(fm))) return json({ error: 'Indica la fecha prevista de montaje para aceptar el presupuesto.', falta_montaje: true }, 400);
      const u = await supa.from('estudio_proyectos').update({ montaje_previsto: fm }).eq('id', pid);
      if (u.error) throw u.error;
    }
    const { data: p } = await supa.from('estudio_presupuestos').select('enviado_at').eq('proyecto_id', pid).maybeSingle();
    if (!p) return json({ error: 'Genera primero el presupuesto.' }, 400);
    const ahora = new Date().toISOString();
    // Cambio manual: se borra la nota automática; si vuelve a «enviado», los días cuentan desde ahora
    const fila: Any = { estado, estado_at: ahora, estado_nota: null };
    if (estado === 'borrador') Object.assign(fila, { enviado_at: null, aceptado_at: null, rechazado_at: null });
    else {
      fila.enviado_at = p.enviado_at || ahora;
      fila.aceptado_at = estado === 'aceptado' ? ahora : null;
      fila.rechazado_at = estado === 'rechazado' ? ahora : null;
    }
    const r = await supa.from('estudio_presupuestos').update(fila).eq('proyecto_id', pid);
    if (r.error) throw r.error;
    return json({ ok: true, ...fila });
  }

  if (action === 'negocio') {
    const { data: proyectos } = await supa.from('estudio_proyectos').select('id, numero, nombre, created_at, user_id, montaje_previsto, montado, montado_at, montaje_nota').eq('user_id', userId);
    const ids = (proyectos ?? []).map((p: Any) => p.id);
    const { data: pres } = ids.length ? await supa.from('estudio_presupuestos').select(campos).in('proyecto_id', ids) : { data: [] };
    const base = metricas(proyectos ?? [], pres ?? [], periodo, 21, dias);
    const ex = await extras(supa, proyectos ?? [], pres ?? [], base.serie);
    return json({ ...base, serie: ex.serie, calendario: ex.calendario, real: await reales(supa, proyectos ?? [], pres ?? [], periodo) });
  }

  if (action === 'admin_negocio') {
    if (!esAdmin) return json({ error: 'forbidden' }, 403);
    const { data: admins } = await supa.from('user_roles').select('user_id').eq('role', 'admin');
    const fuera = new Set((admins ?? []).map((a: Any) => a.user_id));
    // Tampoco las cuentas que emiten como Curino (cuenta propia de Juan)
    const { data: propias } = await supa.from('estudio_accesos').select('email').eq('emisor_curino', true);
    for (const a of propias ?? []) { const { data: u } = await supa.rpc('estudio_alumnos', { p_email: a.email }); if (u?.[0]?.user_id) fuera.add(u[0].user_id); }
    const { data: todos } = await supa.from('estudio_proyectos').select('id, user_id, nombre, created_at');
    const proyectos = (todos ?? []).filter((p: Any) => !fuera.has(p.user_id));   // sin los proyectos de admin
    const ids = proyectos.map((p: Any) => p.id);
    const { data: pres } = ids.length ? await supa.from('estudio_presupuestos').select(campos).in('proyecto_id', ids) : { data: [] };
    const { data: alumnos } = await supa.rpc('estudio_alumnos', { p_email: null });
    const email = new Map((alumnos ?? []).filter((a: Any) => a.user_id).map((a: Any) => [a.user_id, a.email]));
    const porUsuario = new Map<string, Any[]>();
    for (const p of proyectos) porUsuario.set(p.user_id, [...(porUsuario.get(p.user_id) ?? []), p]);
    const filas = [...porUsuario.entries()].map(([uid, ps]) => {
      const pids = new Set(ps.map((p: Any) => p.id));
      const m = metricas(ps, (pres ?? []).filter((x: Any) => pids.has(x.proyecto_id)), periodo);
      return { email: email.get(uid) ?? uid, proyectos: m.proyectos, enviados: m.enviados, presupuestado: m.presupuestado, aceptados: m.aceptados, ventas: m.ventas, tasa_cierre: m.tasa_cierre, pendientes: m.pendientes.length };
    }).sort((a, b) => b.ventas - a.ventas || b.presupuestado - a.presupuestado);
    const total = metricas(proyectos, pres ?? [], periodo, 21, dias);
    const real = await reales(supa, proyectos, pres ?? [], periodo);
    real.ranking = real.ranking.map((r: Any) => ({ ...r, alumno: email.get(proyectos.find((p: Any) => p.id === r.proyecto_id)?.user_id) ?? '' }));
    return json({ ...total, real, alumnos: filas, alumnos_con_actividad: filas.length });
  }
  return json({ error: 'accion_desconocida' }, 400);
}
