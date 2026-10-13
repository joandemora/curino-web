// supabase/functions/estudio-ia/proyecto.ts
//
// Estudio Curino · ficha del proyecto (2026-10).
//   'proyectos_lista'  → tarjetas: miniatura, estado e importe del presupuesto,
//                        facturación, coste, margen y última modificación.
//   'documentos'       { proyecto_id } → lo generado (alzados/presupuestos PDF, Excel) con URL firmada.
//   'doc_subida'       { proyecto_id, tipo, version?, numero?, nombre, bytes } → URL firmada para
//                        guardar un Excel generado en el navegador.
//   'doc_borrar'       { id }
//   'ficheros'         { proyecto_id } → archivos propios con URL firmada + uso de almacenamiento.
//   'fichero_subida'   { proyecto_id, nombre, mime, bytes } → URL firmada (máx. 20 MB y cuota).
//   'fichero_guardar'  { id, tipo, proveedor, fecha, base, iva, total, notas }
//   'fichero_borrar'   { id }
//   'fichero_leer_ia'  { id } → Claude lee proveedor, fecha e importes (gasta créditos).
//   'coste_guardar'    { proyecto_id, id?, categoria, concepto, fecha, importe } · 'coste_borrar' { id }
//   'cobro_guardar'    { id, concepto?, importe?, fecha_prevista?, cobrado?, fecha_cobro? }
//   'cobros_regenerar' { proyecto_id } → plazos por defecto (forma de pago de la plantilla)
//   'metricas_proyecto'{ proyecto_id } → facturación, cobros, costes, margen, línea temporal y avisos.
// guardarDocumento() lo usan las acciones 'pdf' (alzados) y 'presupuesto_pdf'.

import { laminasProyecto, dibujoLamina, medirAprox } from '../_shared/estudio/alzado.ts'
import { dibujoSvg } from '../_shared/estudio/svg.ts'
import { cobrosPorDefecto, metricasProyecto } from '../_shared/estudio/metricas.ts'
import { costeUsd, leerFactura } from '../_shared/estudio/ia.ts'
import { PLANTILLA_ADMIN, PLANTILLA_ALUMNO, type Plantilla } from '../_shared/estudio/presupuesto.ts'
import type { Proyecto } from '../_shared/estudio/esquema.ts'
import { descontarSaldo, sinCredito, type EstadoAlumno } from './acceso.ts'

// deno-lint-ignore no-explicit-any
type Any = any;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls'
};
const TIPOS_F = ['factura_proveedor', 'presupuesto_proveedor', 'factura_cliente', 'foto_obra', 'plano', 'otro'];
const CATS = ['materiales', 'mano_obra', 'transporte', 'montaje', 'otros'];
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

const ACCIONES = new Set(['proyecto_montaje', 'proyecto_iva', 'leer_paginas', 'proyectos_lista', 'documentos', 'doc_subida', 'doc_borrar', 'ficheros', 'fichero_subida', 'fichero_guardar',
  'fichero_borrar', 'fichero_leer_ia', 'coste_guardar', 'coste_borrar', 'cobro_guardar', 'cobros_regenerar', 'metricas_proyecto']);
export const esAccionProyecto = (a: string) => ACCIONES.has(a);

const num = (v: unknown, max = 1e9): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && Math.abs(n) <= max ? Math.round(n * 100) / 100 : null;
};
const fecha = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** SVG del primer armario de una versión (tarjeta del proyecto). */
export function miniaturaSvg(datos: Proyecto): string | null {
  try {
    const l = laminasProyecto(datos, medirAprox)[0];
    if (!l) return null;
    const d = dibujoLamina(l, medirAprox);
    return dibujoSvg(d.prims, d.caja);
  } catch { return null; }
}

/** Guarda en Documentos un PDF generado en el servidor. */
export async function guardarDocumento(supa: Any, o: { proyecto_id: string; user_id: string; tipo: string; version?: number | null; numero?: string | null; nombre: string; bytes: Uint8Array }) {
  try {
    const path = `${o.user_id}/${o.proyecto_id}/documentos/${crypto.randomUUID()}.pdf`;
    const up = await supa.storage.from('estudio').upload(path, o.bytes, { contentType: 'application/pdf' });
    if (up.error) throw up.error;
    await supa.from('estudio_documentos').insert({ proyecto_id: o.proyecto_id, user_id: o.user_id, tipo: o.tipo, version: o.version ?? null, numero: o.numero ?? null, nombre: o.nombre, path, bytes: o.bytes.length });
  } catch (e) { console.error('estudio: guardar documento', e); }
}

async function usoAlmacenamiento(supa: Any, userId: string): Promise<number> {
  const [a, b, c] = await Promise.all([
    supa.from('estudio_ficheros').select('bytes').eq('user_id', userId),
    supa.from('estudio_documentos').select('bytes').eq('user_id', userId),
    supa.from('estudio_archivos').select('bytes').eq('user_id', userId)
  ]);
  return [a, b, c].reduce((s: number, r: Any) => s + (r.data ?? []).reduce((t: number, x: Any) => t + Number(x.bytes || 0), 0), 0);
}

async function datosProyecto(supa: Any, pid: string) {
  const [pres, fich, cost, cob] = await Promise.all([
    supa.from('estudio_presupuestos').select('estado, importe, aceptado_at, datos').eq('proyecto_id', pid).maybeSingle(),
    supa.from('estudio_ficheros').select('id, tipo, base, iva, total, fecha, proveedor').eq('proyecto_id', pid),
    supa.from('estudio_costes').select('id, categoria, concepto, fecha, importe, created_at').eq('proyecto_id', pid).order('fecha', { nullsFirst: false }),
    supa.from('estudio_cobros').select('*').eq('proyecto_id', pid).order('orden')
  ]);
  return { pres: pres.data, ficheros: fich.data ?? [], costes: cost.data ?? [], cobros: cob.data ?? [] };
}

async function plantillaDe(supa: Any, userId: string): Promise<Plantilla> {
  const { data: rol } = await supa.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
  const { data } = await supa.from('estudio_plantillas').select('datos').eq('user_id', userId).maybeSingle();
  return { ...(rol ? PLANTILLA_ADMIN : PLANTILLA_ALUMNO), ...(data?.datos ?? {}) };
}

/** Crea los plazos por defecto si el presupuesto está aceptado y aún no hay ninguno. */
async function asegurarCobros(supa: Any, proyecto: Any, pres: Any, existentes: Any[], forzar = false) {
  if ((!forzar && existentes.length) || pres?.estado !== 'aceptado' || !(Number(pres.importe) > 0)) return existentes;
  // IVA del proyecto (21 % por defecto, 10 % reformas de vivienda)
  const iva = Number(proyecto.iva_pct ?? 21);
  const pl = await plantillaDe(supa, proyecto.user_id);
  const aceptado = new Date(pres.aceptado_at || Date.now()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const plazos = cobrosPorDefecto(pl.forma_pago || [], Math.round(Number(pres.importe) * (1 + iva / 100) * 100) / 100, aceptado);
  if (forzar) await supa.from('estudio_cobros').delete().eq('proyecto_id', proyecto.id);
  const filas = plazos.map((p, i) => ({ ...p, orden: i + 1, proyecto_id: proyecto.id, user_id: proyecto.user_id }));
  const { data } = await supa.from('estudio_cobros').insert(filas).select('*');
  return data ?? [];
}

export async function accionProyecto(action: string, ctx: {
  supa: Any; userId: string; esAdmin: boolean; cfg: Any; clave: string; modelo: string; body: Any; alumno: EstadoAlumno | null;
  json: (b: unknown, s?: number) => Response;
}): Promise<Response> {
  const { supa, userId, esAdmin, cfg, body, json } = ctx;
  const firmar = async (path: string) => (await supa.storage.from('estudio').createSignedUrl(path, 3600)).data?.signedUrl ?? null;

  if (action === 'proyectos_lista') {
    const { data: proyectos } = await supa.from('estudio_proyectos').select('id, numero, nombre, referencia, version_actual, updated_at, created_at, miniatura').eq('user_id', userId).order('updated_at', { ascending: false });
    const lista = proyectos ?? [];
    const ids = lista.map((p: Any) => p.id);
    const vacio = { data: [] };
    const [pres, fich, cost] = ids.length ? await Promise.all([
      supa.from('estudio_presupuestos').select('proyecto_id, estado, importe, aceptado_at, updated_at, datos').in('proyecto_id', ids),
      supa.from('estudio_ficheros').select('proyecto_id, tipo, base, total, fecha').in('proyecto_id', ids),
      supa.from('estudio_costes').select('proyecto_id, categoria, importe, fecha').in('proyecto_id', ids)
    ]) : [vacio, vacio, vacio];
    const hoy = hoyMadrid();
    const out = [];
    for (const p of lista) {
      // Miniatura perezosa: si falta y hay versión, se genera y se guarda
      if (!p.miniatura && p.version_actual) {
        const { data: v } = await supa.from('estudio_versiones').select('datos').eq('proyecto_id', p.id).eq('numero', p.version_actual).maybeSingle();
        const svg = v ? miniaturaSvg(v.datos) : null;
        if (svg) { p.miniatura = svg; await supa.from('estudio_proyectos').update({ miniatura: svg }).eq('id', p.id); }
      }
      const pr = (pres.data ?? []).find((x: Any) => x.proyecto_id === p.id) ?? null;
      const m = metricasProyecto({
        presupuesto: pr, hoy, cobros: [],
        ficheros: (fich.data ?? []).filter((x: Any) => x.proyecto_id === p.id), costes: (cost.data ?? []).filter((x: Any) => x.proyecto_id === p.id)
      });
      const ultima = [p.updated_at, pr?.updated_at].filter(Boolean).sort().pop();
      out.push({
        id: p.id, num: p.numero ?? null, nombre: p.nombre, referencia: p.referencia, version: p.version_actual, miniatura: p.miniatura || null,
        estado: pr?.estado ?? null, numero: pr?.datos?.numero || null, importe: pr?.importe ?? null,
        facturacion: m.facturacion, costes: m.costes, margen: m.margen, margen_pct: m.margen_pct, actualizado: ultima
      });
    }
    return json({ proyectos: out });
  }

  // Acciones sobre un documento / fichero / coste / cobro concreto: comprobar dueño
  const dueno = async (tabla: string, id: string) => {
    if (!UUID.test(id)) return null;
    const { data } = await supa.from(tabla).select('*').eq('id', id).maybeSingle();
    return data && (data.user_id === userId || esAdmin) ? data : null;
  };

  if (action === 'doc_borrar' || action === 'fichero_borrar') {
    const tabla = action === 'doc_borrar' ? 'estudio_documentos' : 'estudio_ficheros';
    const fila = await dueno(tabla, String(body?.id || ''));
    if (!fila) return json({ error: 'No encontrado' }, 404);
    await supa.storage.from('estudio').remove([fila.path]);
    await supa.from(tabla).delete().eq('id', fila.id);
    return json({ ok: true });
  }
  if (action === 'fichero_guardar') {
    const f = await dueno('estudio_ficheros', String(body?.id || ''));
    if (!f) return json({ error: 'No encontrado' }, 404);
    const fila: Any = {};
    if (body?.tipo !== undefined) fila.tipo = TIPOS_F.includes(body.tipo) ? body.tipo : 'otro';
    if (body?.proveedor !== undefined) fila.proveedor = String(body.proveedor || '').slice(0, 120) || null;
    if (body?.fecha !== undefined) fila.fecha = fecha(body.fecha);
    for (const k of ['base', 'iva', 'total']) if (body?.[k] !== undefined) fila[k] = num(body[k]);
    if (body?.notas !== undefined) fila.notas = String(body.notas || '').slice(0, 500) || null;
    if (body?.subido === true) fila.subido = true;
    const r = await supa.from('estudio_ficheros').update(fila).eq('id', f.id).select('*').single();
    if (r.error) throw r.error;
    return json({ fichero: r.data });
  }
  if (action === 'leer_paginas') {
    // Solo admin: lee con IA las páginas (imágenes) de un documento SIN guardar nada en él; registra el uso.
    if (!esAdmin) return json({ error: 'forbidden' }, 403);
    let imgs = Array.isArray(body?.imagenes) ? body.imagenes.slice(0, 12).filter((x: Any) => /^image\/(jpeg|png|webp)$/.test(x?.tipo) && typeof x?.base64 === 'string') : [];
    // O rutas temporales del bucket (_tmp/leer/…): se descargan aquí
    if (!imgs.length && Array.isArray(body?.paths)) {
      for (const pth of body.paths.slice(0, 12).filter((x: Any) => typeof x === 'string' && x.startsWith('_tmp/leer/') && !x.includes('..'))) {
        const { data: b } = await supa.storage.from('estudio').download(pth);
        if (!b) continue;
        const u8 = new Uint8Array(await b.arrayBuffer());
        let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        imgs.push({ tipo: 'image/jpeg', base64: btoa(bin) });
      }
    }
    if (!imgs.length) return json({ error: 'Sin imágenes' }, 400);
    const nombre = String(body?.nombre || 'documento').slice(0, 120);
    const r = await leerFactura({ clave: ctx.clave, modelo: ctx.modelo, adjunto: { tipo: imgs[0].tipo, base64: imgs[0].base64, nombre }, paginas: imgs.map((x: Any) => ({ tipo: x.tipo, base64: x.base64, nombre })) });
    const precios = { entrada: Number(cfg?.precio_entrada ?? 2), salida: Number(cfg?.precio_salida ?? 10), cache_escritura: Number(cfg?.precio_cache_escritura ?? 2.5), cache_lectura: Number(cfg?.precio_cache_lectura ?? 0.1) };
    let coste = 0;
    for (const l of r.llamadas) {
      const c = costeUsd(l.uso, precios); coste += c;
      await supa.from('estudio_uso').insert({ user_id: userId, proyecto_id: null, accion: 'leer_paginas', modelo: ctx.modelo, input_tokens: l.uso.input_tokens, output_tokens: l.uso.output_tokens, cache_escritura_tokens: l.uso.cache_creation_input_tokens, cache_lectura_tokens: l.uso.cache_read_input_tokens, coste_usd: c, ok: l.ok });
    }
    return json({ datos: r.datos, error: r.error ?? null, creditos: Math.max(1, Math.round(coste * 100)) });
  }
  if (action === 'fichero_leer_ia') {
    const f = await dueno('estudio_ficheros', String(body?.id || ''));
    if (!f) return json({ error: 'No encontrado' }, 404);
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(f.mime)) return json({ error: 'La IA solo lee PDF o fotos (JPG, PNG, WEBP).' }, 400);
    if (!esAdmin) { const sin = sinCredito(ctx.alumno); if (sin) return json({ error: sin, sin_credito: true }, 402); }
    const { data: blob } = await supa.storage.from('estudio').download(f.path);
    if (!blob) return json({ error: 'No encuentro el archivo.' }, 404);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const r = await leerFactura({ clave: ctx.clave, modelo: ctx.modelo, adjunto: { tipo: f.mime, base64: btoa(s), nombre: f.nombre } });
    // Uso y créditos
    const precios = { entrada: Number(cfg?.precio_entrada ?? 2), salida: Number(cfg?.precio_salida ?? 10), cache_escritura: Number(cfg?.precio_cache_escritura ?? 2.5), cache_lectura: Number(cfg?.precio_cache_lectura ?? 0.1) };
    let coste = 0;
    for (const l of r.llamadas) {
      const c = costeUsd(l.uso, precios); coste += c;
      await supa.from('estudio_uso').insert({ user_id: userId, proyecto_id: f.proyecto_id, accion: 'leer_factura', modelo: ctx.modelo, input_tokens: l.uso.input_tokens, output_tokens: l.uso.output_tokens, cache_escritura_tokens: l.uso.cache_creation_input_tokens, cache_lectura_tokens: l.uso.cache_read_input_tokens, coste_usd: c, ok: l.ok });
    }
    if (!esAdmin) await descontarSaldo(supa, ctx.alumno, userId, coste);
    if (!r.datos) return json({ error: 'No he podido leer el documento. Rellena los datos a mano.', creditos: Math.round(coste * 100) }, 502);
    const d = r.datos;
    const fila: Any = { leido_ia: true };
    if (TIPOS_F.includes(String(d.tipo)) && f.tipo === 'otro') fila.tipo = d.tipo;
    if (d.proveedor) fila.proveedor = String(d.proveedor).slice(0, 120);
    if (fecha(d.fecha)) fila.fecha = d.fecha;
    for (const k of ['base', 'iva', 'total']) { const v = Number(d[k]); if (Number.isFinite(v)) fila[k] = Math.round(v * 100) / 100; }
    const up = await supa.from('estudio_ficheros').update(fila).eq('id', f.id).select('*').single();
    return json({ fichero: up.data, creditos: Math.max(1, Math.round(coste * 100)) });
  }
  if (action === 'coste_borrar') {
    const c = await dueno('estudio_costes', String(body?.id || ''));
    if (!c) return json({ error: 'No encontrado' }, 404);
    await supa.from('estudio_costes').delete().eq('id', c.id);
    return json({ ok: true });
  }
  if (action === 'cobro_guardar') {
    const c = await dueno('estudio_cobros', String(body?.id || ''));
    if (!c) return json({ error: 'No encontrado' }, 404);
    const fila: Any = {};
    if (body?.concepto !== undefined) fila.concepto = String(body.concepto || '').slice(0, 80) || c.concepto;
    if (body?.importe !== undefined) { const v = num(body.importe); if (v !== null && v >= 0) fila.importe = v; }
    if (body?.fecha_prevista !== undefined) fila.fecha_prevista = fecha(body.fecha_prevista);
    if (body?.cobrado !== undefined) { fila.cobrado = body.cobrado === true; fila.fecha_cobro = fila.cobrado ? (fecha(body.fecha_cobro) || hoyMadrid()) : null; }
    else if (body?.fecha_cobro !== undefined) fila.fecha_cobro = fecha(body.fecha_cobro);
    const r = await supa.from('estudio_cobros').update(fila).eq('id', c.id).select('*').single();
    if (r.error) throw r.error;
    return json({ cobro: r.data });
  }

  // El resto, sobre un proyecto
  const pid = String(body?.proyecto_id || '');
  if (!UUID.test(pid)) return json({ error: 'proyecto_id no válido' }, 400);
  const { data: proyecto } = await supa.from('estudio_proyectos').select('*').eq('id', pid).maybeSingle();
  if (!proyecto || (proyecto.user_id !== userId && !esAdmin)) return json({ error: 'Proyecto no encontrado' }, 404);
  // Cuota: la propia del acceso (estudio_accesos.almacenamiento_mb) o la general
  const cuotaMb = Number(ctx.alumno?.almacenamiento_mb ?? cfg?.almacenamiento_mb ?? 1024);
  const maxFichero = (ctx.alumno?.max_fichero_mb ?? 20) * 1024 * 1024;

  if (action === 'documentos') {
    const { data } = await supa.from('estudio_documentos').select('*').eq('proyecto_id', pid).order('created_at', { ascending: false });
    const docs = [];
    for (const d of data ?? []) docs.push({ ...d, url: await firmar(d.path) });
    return json({ documentos: docs });
  }
  if (action === 'doc_subida') {
    const tipo = String(body?.tipo || '');
    if (tipo !== 'presupuesto_xlsx') return json({ error: 'Tipo no válido' }, 400);
    const bytes = Number(body?.bytes || 0);
    if (!(bytes > 0) || bytes > maxFichero) return json({ error: 'Archivo demasiado grande' }, 400);
    const path = `${proyecto.user_id}/${pid}/documentos/${crypto.randomUUID()}.xlsx`;
    const { data: s, error } = await supa.storage.from('estudio').createSignedUploadUrl(path);
    if (error) throw error;
    await supa.from('estudio_documentos').insert({ proyecto_id: pid, user_id: proyecto.user_id, tipo, version: Number(body?.version) || null, numero: String(body?.numero || '').slice(0, 40) || null, nombre: String(body?.nombre || 'Presupuesto.xlsx').slice(0, 120), path, bytes });
    return json({ path, token: s.token });
  }
  if (action === 'ficheros') {
    const { data } = await supa.from('estudio_ficheros').select('*').eq('proyecto_id', pid).eq('subido', true).order('created_at', { ascending: false });
    const lista = [];
    for (const f of data ?? []) lista.push({ ...f, url: await firmar(f.path) });
    const usado = await usoAlmacenamiento(supa, proyecto.user_id);
    return json({ ficheros: lista, almacenamiento: { usado, limite: cuotaMb * 1024 * 1024 } });
  }
  if (action === 'fichero_subida') {
    const mime = String(body?.mime || '');
    const bytes = Number(body?.bytes || 0);
    if (!MIME[mime]) return json({ error: 'Formato no admitido: PDF, imagen (JPG, PNG, WEBP) o Excel.' }, 400);
    if (!(bytes > 0) || bytes > maxFichero) return json({ error: `El archivo supera ${maxFichero / 1048576} MB.` }, 400);
    const limite = cuotaMb * 1024 * 1024;
    if ((await usoAlmacenamiento(supa, proyecto.user_id)) + bytes > limite) return json({ error: `Has llegado al límite de almacenamiento (${cuotaMb} MB). Borra archivos que no necesites.` }, 400);
    const path = `${proyecto.user_id}/${pid}/archivos/${crypto.randomUUID()}.${MIME[mime]}`;
    const { data: s, error } = await supa.storage.from('estudio').createSignedUploadUrl(path);
    if (error) throw error;
    const tipo = TIPOS_F.includes(body?.tipo) ? body.tipo : (mime.startsWith('image/') ? 'foto_obra' : 'otro');
    const { data: f, error: e2 } = await supa.from('estudio_ficheros').insert({ proyecto_id: pid, user_id: proyecto.user_id, path, nombre: String(body?.nombre || 'archivo').slice(0, 120), mime, bytes, tipo }).select('id').single();
    if (e2) throw e2;
    return json({ id: f.id, path, token: s.token });
  }
  if (action === 'coste_guardar') {
    const fila: Any = {
      proyecto_id: pid, user_id: proyecto.user_id, categoria: CATS.includes(body?.categoria) ? body.categoria : 'otros',
      concepto: String(body?.concepto || '').slice(0, 120) || null, fecha: fecha(body?.fecha), importe: num(body?.importe)
    };
    if (fila.importe === null || fila.importe < 0) return json({ error: 'Pon un importe (sin IVA).' }, 400);
    const r = body?.id && UUID.test(body.id)
      ? await supa.from('estudio_costes').update(fila).eq('id', body.id).eq('proyecto_id', pid).select('*').single()
      : await supa.from('estudio_costes').insert(fila).select('*').single();
    if (r.error) throw r.error;
    return json({ coste: r.data });
  }
  if (action === 'cobros_regenerar') {
    const { pres, cobros } = await datosProyecto(supa, pid);
    if (pres?.estado !== 'aceptado') return json({ error: 'Los cobros se calculan cuando el presupuesto está aceptado.' }, 400);
    return json({ cobros: await asegurarCobros(supa, proyecto, pres, cobros, true) });
  }
  if (action === 'proyecto_montaje') {
    // Fecha prevista de montaje y montado (sí/no + fecha real)
    const fila: Any = {};
    if (body?.montaje_previsto !== undefined) fila.montaje_previsto = fecha(body.montaje_previsto);
    if (body?.montado !== undefined) {
      fila.montado = body.montado === true;
      fila.montado_at = fila.montado ? (fecha(body.montado_at) || null) : null;
      fila.montaje_nota = fila.montado ? (proyecto.montaje_nota && !body.montado_at ? proyecto.montaje_nota : null) : null;
    } else if (body?.montado_at !== undefined) { fila.montado_at = fecha(body.montado_at); if (fila.montado_at) fila.montaje_nota = null; }
    const r = await supa.from('estudio_proyectos').update(fila).eq('id', pid).select('montaje_previsto, montado, montado_at, montaje_nota').single();
    if (r.error) throw r.error;
    return json({ ok: true, ...r.data });
  }
  if (action === 'proyecto_iva') {
    // Cambia el tipo de IVA; los plazos se reescalan al nuevo total con IVA (se conservan fechas y cobrados)
    const nuevo = Number(body?.iva_pct);
    if (![0, 4, 10, 21].includes(nuevo)) return json({ error: 'Tipo de IVA no válido (21, 10, 4 o 0 %).' }, 400);
    const viejo = Number(proyecto.iva_pct ?? 21);
    const r = await supa.from('estudio_proyectos').update({ iva_pct: nuevo }).eq('id', pid);
    if (r.error) throw r.error;
    if (nuevo !== viejo) {
      const { data: cob } = await supa.from('estudio_cobros').select('id, importe').eq('proyecto_id', pid);
      for (const c of cob ?? []) await supa.from('estudio_cobros').update({ importe: Math.round(Number(c.importe) * (1 + nuevo / 100) / (1 + viejo / 100) * 100) / 100 }).eq('id', c.id);
    }
    return json({ ok: true, iva_pct: nuevo });
  }
  if (action === 'metricas_proyecto') {
    const d = await datosProyecto(supa, pid);
    const cobros = await asegurarCobros(supa, proyecto, d.pres, d.cobros);
    const m = metricasProyecto({ presupuesto: d.pres, ficheros: d.ficheros, costes: d.costes, cobros, hoy: hoyMadrid() });
    return json({ ...m, iva_pct: Number(proyecto.iva_pct ?? 21), presupuesto: d.pres ? { estado: d.pres.estado, importe: d.pres.importe, numero: d.pres.datos?.numero || null } : null, costes_lista: d.costes, cobros_lista: cobros });
  }
  return json({ error: 'accion_desconocida' }, 400);
}
