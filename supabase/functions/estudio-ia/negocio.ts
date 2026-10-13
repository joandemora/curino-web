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

// deno-lint-ignore no-explicit-any
type Any = any;
const ESTADOS = ['borrador', 'enviado', 'aceptado', 'rechazado'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACCIONES = new Set(['presupuesto_estado', 'negocio', 'admin_negocio']);
export const esAccionNegocio = (a: string) => ACCIONES.has(a);

/** Inicio del periodo en hora de Madrid (null = todo). */
function inicioPeriodo(p: string): Date | null {
  const [y, m] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).split('-').map(Number);
  const mes = p === 'mes' ? m : p === 'trimestre' ? m - ((m - 1) % 3) : 1;
  if (p === 'todo') return null;
  return madridAUtc(`${y}-${String(mes).padStart(2, '0')}-01T00:00`);
}
const mesClave = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7);

function importeDe(p: Any, iva: number): number | null {
  if (p.importe !== null && p.importe !== undefined) return Number(p.importe);
  const t = totales(p.datos as DocPresupuesto, iva);
  return t.pendientes ? null : t.importe;
}

export function metricas(proyectos: Any[], presupuestos: Any[], periodo: string, iva = 21) {
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
    estado: p.estado, importe: importeDe(p, iva), fecha: p.estado_at || p.updated_at || p.created_at, enviado_at: p.enviado_at
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
    pendientes: presupuestos.filter((p) => p.estado === 'enviado').map((p) => ({ ...fila(p), dias: Math.floor((hoy - new Date(p.enviado_at).getTime()) / 86_400_000) }))
      .sort((a, b) => b.dias - a.dias),
    serie,
    ultimos: [...presupuestos].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 8).map(fila)
  };
}

export async function accionNegocio(action: string, o: {
  supa: Any; userId: string; esAdmin: boolean; body: Any; json: (b: unknown, s?: number) => Response;
}): Promise<Response> {
  const { supa, userId, esAdmin, body, json } = o;
  const periodo = ['mes', 'trimestre', 'anio', 'todo'].includes(body?.periodo) ? body.periodo : 'mes';
  const campos = 'proyecto_id, estado, estado_at, enviado_at, aceptado_at, rechazado_at, importe, pvp, created_at, updated_at, datos';

  if (action === 'presupuesto_estado') {
    const pid = String(body?.proyecto_id || '');
    const estado = String(body?.estado || '');
    if (!UUID.test(pid) || !ESTADOS.includes(estado as typeof ESTADOS[number])) return json({ error: 'Estado no válido' }, 400);
    const { data: pr } = await supa.from('estudio_proyectos').select('user_id').eq('id', pid).maybeSingle();
    if (!pr || (pr.user_id !== userId && !esAdmin)) return json({ error: 'Proyecto no encontrado' }, 404);
    const { data: p } = await supa.from('estudio_presupuestos').select('enviado_at').eq('proyecto_id', pid).maybeSingle();
    if (!p) return json({ error: 'Genera primero el presupuesto.' }, 400);
    const ahora = new Date().toISOString();
    const fila: Any = { estado, estado_at: ahora };
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
    const { data: proyectos } = await supa.from('estudio_proyectos').select('id, nombre, created_at').eq('user_id', userId);
    const ids = (proyectos ?? []).map((p: Any) => p.id);
    const { data: pres } = ids.length ? await supa.from('estudio_presupuestos').select(campos).in('proyecto_id', ids) : { data: [] };
    return json(metricas(proyectos ?? [], pres ?? [], periodo));
  }

  if (action === 'admin_negocio') {
    if (!esAdmin) return json({ error: 'forbidden' }, 403);
    const { data: admins } = await supa.from('user_roles').select('user_id').eq('role', 'admin');
    const fuera = new Set((admins ?? []).map((a: Any) => a.user_id));
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
    const total = metricas(proyectos, pres ?? [], periodo);
    return json({ ...total, alumnos: filas, alumnos_con_actividad: filas.length });
  }
  return json({ error: 'accion_desconocida' }, 400);
}
