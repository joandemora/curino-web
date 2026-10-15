// supabase/functions/estudio-ia/negocio.ts
//
// Estudio Curino · «Mi negocio» (F5).
//   'presupuesto_estado' { proyecto_id, presupuesto_id?, estado, montaje_previsto? } → borrador /
//                         enviado / aceptado / rechazado (con su fecha; volver a borrador las borra).
//                         Varios aceptados por proyecto: aceptar uno no rechaza los demás; cada
//                         aceptado pide su fecha prevista de montaje.
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
import { relevantes, agregadosPorProyecto } from '../_shared/estudio/aceptados.ts'

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
  const vacio = { facturacion: 0, costes: 0, margen: null, margen_pct: null, ranking: [], incompletos: [], n_fiables: 0, n_aceptados: 0, n_incompletos: 0 };
  const ids = proyectos.map((p) => p.id);
  if (!ids.length) return vacio;
  const [f, c] = await Promise.all([
    supa.from('estudio_ficheros').select('proyecto_id, tipo, base, total, fecha, proveedor, tipo_coste, sustituido_por').in('proyecto_id', ids).eq('subido', true),
    supa.from('estudio_costes').select('proyecto_id, categoria, importe, fecha').in('proyecto_id', ids)
  ]);
  const desde = inicioPeriodo(periodo);
  const en = (iso: string | null) => !!iso && (!desde || new Date(iso) >= desde);
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  let fact = 0, cost = 0, nAceptados = 0;
  const ranking: Any[] = [], incompletos: Any[] = [];
  // Varios aceptados por proyecto: se suman (agregado); un aceptado entra si alguno es del periodo
  const agg = agregadosPorProyecto(presupuestos);
  const aceptadoEnPeriodo = (pid: string) => presupuestos.some((x) => x.proyecto_id === pid && x.estado === 'aceptado' && en(x.aceptado_at));
  for (const p of proyectos) {
    const pr = agg.get(p.id) ?? null;
    const fich = (f.data ?? []).filter((x: Any) => x.proyecto_id === p.id);
    const cos = (c.data ?? []).filter((x: Any) => x.proyecto_id === p.id);
    const facturasEnPeriodo = fich.some((x: Any) => x.tipo === 'factura_cliente' && en(x.fecha));
    if (!(pr?.estado === 'aceptado' && aceptadoEnPeriodo(p.id)) && !facturasEnPeriodo) continue;
    nAceptados++;
    // Margen fiable: con facturación, algún coste y ningún coste sin importe (metricasProyecto, según las reglas del proyecto)
    const m = metricasProyecto({ presupuesto: pr, ficheros: fich, costes: cos, cobros: [], hoy, v2: !!p.costes_v2 });
    const fila = { proyecto_id: p.id, cliente: p.nombre, facturacion: m.facturacion, costes: m.costes, margen: m.margen, margen_pct: m.margen_pct };
    const motivo = m.motivo;
    if (motivo) { incompletos.push({ ...fila, motivo }); continue; }
    fact += m.facturacion; cost += m.costes;
    ranking.push(fila);
  }
  ranking.sort((a, b) => (b.margen_pct ?? -1e9) - (a.margen_pct ?? -1e9));
  incompletos.sort((a, b) => (b.facturacion || 0) - (a.facturacion || 0));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    facturacion: r2(fact), costes: r2(cost), margen: ranking.length ? r2(fact - cost) : null,
    margen_pct: ranking.length && fact > 0 ? Math.round((1000 * (fact - cost)) / fact) / 10 : null,
    ranking, incompletos, n_fiables: ranking.length, n_aceptados: nAceptados, n_incompletos: incompletos.length
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
    supa.from('estudio_ficheros').select('proyecto_id, tipo, base, total, fecha, tipo_coste, sustituido_por').in('proyecto_id', ids).eq('subido', true),
    supa.from('estudio_costes').select('proyecto_id, categoria, importe, fecha').in('proyecto_id', ids),
    supa.from('estudio_cobros').select('proyecto_id, concepto, pct, importe, fecha_prevista, cobrado, fecha_cobro').in('proyecto_id', ids)
  ]);
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const porMes = new Map<string, { f: number; c: number }>();
  const calendario: Any[] = [];
  const agg = agregadosPorProyecto(presupuestos);
  for (const p of proyectos) {
    const pr = agg.get(p.id);
    if (pr?.estado !== 'aceptado') {
      // Sin aceptado pero con montaje en el proyecto (datos de antes): sigue en el calendario
      if (p.montaje_previsto || p.montado) calendario.push({ id: p.id, presupuesto_id: null, numero: p.numero ?? null, presupuesto: null, nombre: p.nombre, importe: null,
        montaje_previsto: p.montaje_previsto ?? null, montado: !!p.montado, montado_at: p.montado_at ?? null, montaje_nota: p.montaje_nota ?? null, cobro: 'pendiente', pendiente: null });
      continue;
    }
    const m = metricasProyecto({
      presupuesto: pr, hoy, v2: !!p.costes_v2,
      ficheros: (f.data ?? []).filter((x: Any) => x.proyecto_id === p.id),
      costes: (c.data ?? []).filter((x: Any) => x.proyecto_id === p.id),
      cobros: (cb.data ?? []).filter((x: Any) => x.proyecto_id === p.id)
    });
    // Margen fiable: con facturación y todos los costes con importe (sin «pendiente de revisar»)
    const costeSinImporte = m.costes_sin_importe > 0;
    if (m.margen !== null && m.facturacion > 0 && !costeSinImporte && pr.aceptado_at) {
      const k = mesClave(pr.aceptado_at), a = porMes.get(k) ?? { f: 0, c: 0 };
      a.f += m.facturacion; a.c += m.costes; porMes.set(k, a);
    }
    // Una entrada por presupuesto aceptado, con su montaje
    // Cobrado si lo cobrado (facturas a cliente con IVA, o los cobros antiguos marcados) llega al total con IVA
    const esperado = Math.round(m.facturacion * (1 + Number(p.iva_pct ?? 21) / 100) * 100) / 100;
    const cobro = esperado > 0 && m.cobros.cobrado >= esperado - 0.5 ? 'cobrado' : 'pendiente';
    const pendienteCobro = Math.max(0, Math.round((esperado - m.cobros.cobrado) * 100) / 100);
    for (const x of presupuestos.filter((q) => q.proyecto_id === p.id && q.estado === 'aceptado')) {
      calendario.push({
        id: p.id, presupuesto_id: x.id, numero: p.numero ?? null, presupuesto: x.numero || x.datos?.numero || null, nombre: p.nombre, importe: x.importe ?? null,
        montaje_previsto: x.montaje_previsto ?? null, montado: !!x.montado, montado_at: x.montado_at ?? null, montaje_nota: x.montaje_nota ?? null,
        cobro, pendiente: pendienteCobro
      });
    }
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
  const campos = 'id, numero, proyecto_id, estado, estado_nota, estado_at, enviado_at, aceptado_at, rechazado_at, importe, pvp, comision_importe, created_at, updated_at, datos, montaje_previsto, montado, montado_at, montaje_nota';
  const { data: cfgC } = await supa.from('estudio_config').select('dias_caducidad').eq('id', 1).maybeSingle();
  const dias = Number(cfgC?.dias_caducidad ?? 90);

  if (action === 'presupuesto_estado') {
    const pid = String(body?.proyecto_id || '');
    const estado = String(body?.estado || '');
    if (!UUID.test(pid) || !ESTADOS.includes(estado as typeof ESTADOS[number])) return json({ error: 'Estado no válido' }, 400);
    const { data: pr } = await supa.from('estudio_proyectos').select('user_id').eq('id', pid).maybeSingle();
    if (!pr || (pr.user_id !== userId && !esAdmin)) return json({ error: 'Proyecto no encontrado' }, 404);
    // Varios presupuestos por proyecto: el indicado o, si no, el principal
    const prid = String(body?.presupuesto_id || '');
    const sel = 'id, proyecto_id, enviado_at, numero, estado, montaje_previsto, montado';
    const { data: p } = UUID.test(prid)
      ? await supa.from('estudio_presupuestos').select(sel).eq('id', prid).eq('proyecto_id', pid).maybeSingle()
      : await supa.from('estudio_presupuesto_principal').select(sel).eq('proyecto_id', pid).maybeSingle();
    if (!p) return json({ error: 'Genera primero el presupuesto.' }, 400);
    const ahora = new Date().toISOString();
    // Cambio manual: se borra la nota automática; si vuelve a «enviado», los días cuentan desde ahora
    const fila: Any = { estado, estado_at: ahora, estado_nota: null };
    // Cada aceptado lleva su fecha prevista de montaje (obligatoria si no la tiene). Aceptar uno no rechaza los demás.
    if (estado === 'aceptado' && !p.montaje_previsto && !p.montado) {
      const fm = String(body?.montaje_previsto || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fm) || isNaN(Date.parse(fm))) return json({ error: `Indica la fecha prevista de montaje de ${p.numero || 'este presupuesto'} para aceptarlo.`, falta_montaje: true }, 400);
      fila.montaje_previsto = fm;
    }
    if (estado === 'borrador') Object.assign(fila, { enviado_at: null, aceptado_at: null, rechazado_at: null });
    else {
      fila.enviado_at = p.enviado_at || ahora;
      fila.aceptado_at = estado === 'aceptado' ? ahora : null;
      fila.rechazado_at = estado === 'rechazado' ? ahora : null;
    }
    const r = await supa.from('estudio_presupuestos').update(fila).eq('id', p.id);
    if (r.error) throw r.error;
    return json({ ok: true, presupuesto_id: p.id, ...fila });
  }

  if (action === 'negocio') {
    const { data: proyectos } = await supa.from('estudio_proyectos').select('id, numero, nombre, created_at, user_id, montaje_previsto, montado, montado_at, montaje_nota, costes_v2, iva_pct').eq('user_id', userId);
    const ids = (proyectos ?? []).map((p: Any) => p.id);
    // Todos los presupuestos: métricas de envío con los «relevantes» (aceptados o, si no hay, el último), margen y calendario con todos los aceptados
    const { data: pres } = ids.length ? await supa.from('estudio_presupuestos').select(campos).in('proyecto_id', ids) : { data: [] };
    const base = metricas(proyectos ?? [], relevantes(pres ?? []), periodo, 21, dias);
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
    const { data: todos } = await supa.from('estudio_proyectos').select('id, user_id, nombre, created_at, costes_v2');
    const proyectos = (todos ?? []).filter((p: Any) => !fuera.has(p.user_id));   // sin los proyectos de admin
    const ids = proyectos.map((p: Any) => p.id);
    const { data: pres0 } = ids.length ? await supa.from('estudio_presupuestos').select(campos).in('proyecto_id', ids) : { data: [] };
    const pres = relevantes(pres0 ?? []);
    const { data: alumnos } = await supa.rpc('estudio_alumnos', { p_email: null });
    const email = new Map((alumnos ?? []).filter((a: Any) => a.user_id).map((a: Any) => [a.user_id, a.email]));
    const porUsuario = new Map<string, Any[]>();
    for (const p of proyectos) porUsuario.set(p.user_id, [...(porUsuario.get(p.user_id) ?? []), p]);
    const filas = [...porUsuario.entries()].map(([uid, ps]) => {
      const pids = new Set(ps.map((p: Any) => p.id));
      const m = metricas(ps, (pres ?? []).filter((x: Any) => pids.has(x.proyecto_id)), periodo);
      return { email: email.get(uid) ?? uid, proyectos: m.proyectos, enviados: m.enviados, presupuestado: m.presupuestado, aceptados: m.aceptados, ventas: m.ventas, tasa_cierre: m.tasa_cierre, pendientes: m.pendientes.length };
    }).sort((a, b) => b.ventas - a.ventas || b.presupuestado - a.presupuestado);
    const total = metricas(proyectos, pres, periodo, 21, dias);
    const real = await reales(supa, proyectos, pres, periodo);
    real.ranking = real.ranking.map((r: Any) => ({ ...r, alumno: email.get(proyectos.find((p: Any) => p.id === r.proyecto_id)?.user_id) ?? '' }));
    real.incompletos = real.incompletos.map((r: Any) => ({ ...r, alumno: email.get(proyectos.find((p: Any) => p.id === r.proyecto_id)?.user_id) ?? '' }));
    return json({ ...total, real, alumnos: filas, alumnos_con_actividad: filas.length });
  }
  return json({ error: 'accion_desconocida' }, 400);
}
