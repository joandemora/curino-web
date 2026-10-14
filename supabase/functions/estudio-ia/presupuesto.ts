// supabase/functions/estudio-ia/presupuesto.ts
//
// Estudio Curino · acciones de tarifa, plantilla y presupuesto (F3).
//
//   'tarifa'              { de?: 'curino' | 'mia' } → conceptos + valores (null = PENDIENTE).
//   'tarifa_guardar'      { de, valores, descuento_pct, iva_pct } → admin: la de
//                         Curino; cualquiera: la suya («mia»).
//   'plantilla'           → la del usuario (o la inicial: admin = SISTEMA &
//                         CURINO; alumno = vacía) + URLs firmadas de logo/firma.
//   'plantilla_guardar'   { datos } → un alumno nunca con datos de Curino.
//   'plantilla_subida'    { campo: 'logo' | 'firma', tipo, bytes } → URL firmada (PNG/JPG).
// Varios presupuestos por proyecto (2026-10): cada uno con su id; sin
// presupuesto_id se usa el principal del proyecto (aceptado o el último).
//   'presupuestos'         { proyecto_id } → lista + siguiente n.º Z + versiones y documentos para la base.
//   'presupuesto_nuevo'    { proyecto_id, numero?, base: { tipo: 'versiones', versiones: [{ numero, armarios }] }
//                          | { tipo: 'documentos', documentos: [{ tabla: 'doc'|'fichero', id }] } | { tipo: 'blanco' } }
//   'presupuesto_duplicar' { presupuesto_id } → copia con Z…-B, -C…
//   'presupuesto'          { presupuesto_id } → el presupuesto (o null si es del histórico).
//   'presupuesto_generar'  { presupuesto_id } → recalcula con la tarifa desde cada versión.
//   'presupuesto_guardar'  { presupuesto_id, datos } → cabecera, comisión y partidas (también libres).
//   'presupuesto_textos'   { presupuesto_id } → Claude redacta subtítulo e intro.
//   'presupuesto_pdf'      { presupuesto_id } → PDF (dos si hay comisión: _cliente / _interiorista).
//   'presupuesto_dibujos'  { presupuesto_id } → SVG de cada partida de diseño (para el Excel).

import { PDFDocument, rgb, degrees } from 'https://esm.sh/pdf-lib@1.17.1'
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1'
import { laminasProyecto, dibujoLamina } from '../_shared/estudio/alzado.ts'
import { medirConFuentes } from '../_shared/estudio/pdf.ts'
import { dibujoSvg } from '../_shared/estudio/svg.ts'
import { LOGO_ALTO, LOGO_ANCHO, LOGO_PATH } from '../_shared/estudio/logo.ts'
import { CONCEPTOS, TARIFA_PENDIENTE, type Tarifa } from '../_shared/estudio/tarifa.ts'
import {
  generarPresupuesto, totales, validarPlantilla, faltanPlantilla, PLANTILLA_ADMIN, PLANTILLA_ALUMNO,
  claveDe, docVariante, importesNegocio, partidaLibre, type DocPresupuesto, type Partida, type Plantilla
} from '../_shared/estudio/presupuesto.ts'
import { pintarPresupuesto } from '../_shared/estudio/presupuesto-pdf.ts'
import { costeUsd, redactarTextos, proponerPartidas, type Adjunto } from '../_shared/estudio/ia.ts'
import { descontarSaldo, emisorCurinoDe, sinCredito, type EstadoAlumno } from './acceso.ts'
import { guardarDocumento } from './proyecto.ts'
import { interRegular, interBold, interCss } from '../_shared/estudio/fuentes/inter.ts'
import { openSansRegular, openSansBold } from '../_shared/estudio/fuentes/opensans.ts'
import type { Proyecto } from '../_shared/estudio/esquema.ts'

// deno-lint-ignore no-explicit-any
type Any = any;
export interface Ctx {
  supa: Any; userId: string; esAdmin: boolean; cfg: Any; clave: string; modelo: string; body: Any;
  json: (b: unknown, s?: number) => Response; base64: (b: Uint8Array) => string;
  alumno?: EstadoAlumno | null;
}

const ACCIONES = new Set(['tarifa', 'tarifa_guardar', 'plantilla', 'plantilla_guardar', 'plantilla_subida',
  'presupuestos', 'presupuesto_nuevo', 'presupuesto_duplicar', 'presupuesto', 'presupuesto_generar', 'presupuesto_guardar', 'presupuesto_textos', 'presupuesto_pdf', 'presupuesto_dibujos']);
export const esAccionPresupuesto = (a: string) => ACCIONES.has(a);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const numOrNull = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
};

async function cargarTarifa(supa: Any, userId: string | null): Promise<Tarifa & { id?: string; propia: boolean }> {
  const curino = (await supa.from('estudio_tarifas').select('*').is('user_id', null).maybeSingle()).data;
  const propia = userId ? (await supa.from('estudio_tarifas').select('*').eq('user_id', userId).maybeSingle()).data : null;
  const fila = propia ?? curino;
  return {
    id: fila?.id, propia: !!propia,
    valores: { ...TARIFA_PENDIENTE.valores, ...(fila?.valores ?? {}) },
    descuento_pct: fila?.descuento_pct === null || fila?.descuento_pct === undefined ? TARIFA_PENDIENTE.descuento_pct : Number(fila.descuento_pct),
    iva_pct: fila?.iva_pct === null || fila?.iva_pct === undefined ? TARIFA_PENDIENTE.iva_pct : Number(fila.iva_pct)
  };
}

async function cargarPlantilla(supa: Any, userId: string, esAdmin: boolean): Promise<Plantilla> {
  const { data } = await supa.from('estudio_plantillas').select('datos').eq('user_id', userId).maybeSingle();
  const base = esAdmin ? PLANTILLA_ADMIN : PLANTILLA_ALUMNO;
  return { ...base, ...(data?.datos ?? {}) };
}

async function ibanesCurino(supa: Any): Promise<string[]> {
  const { data: admins } = await supa.from('user_roles').select('user_id').eq('role', 'admin');
  const ids = (admins ?? []).map((a: Any) => a.user_id);
  if (!ids.length) return [];
  const { data } = await supa.from('estudio_plantillas').select('datos').in('user_id', ids);
  return (data ?? []).map((d: Any) => String(d.datos?.iban || '')).filter(Boolean);
}

function limpiarPlantilla(d: Any, base: Plantilla): Plantilla {
  const fp = Array.isArray(d?.forma_pago) ? d.forma_pago.slice(0, 6).map((x: Any) => ({ concepto: txt(x?.concepto, 40), pct: numOrNull(x?.pct, 0, 100) ?? 0 })).filter((x: Any) => x.concepto) : base.forma_pago;
  return {
    tipo: d?.tipo === 'propia' ? 'propia' : 'curino',
    empresa: txt(d?.empresa, 80), nif: txt(d?.nif, 20), direccion_1: txt(d?.direccion_1, 80), direccion_2: txt(d?.direccion_2, 80),
    email: txt(d?.email, 80), telefono: txt(d?.telefono, 30), lema: txt(d?.lema, 50), iban: txt(d?.iban, 40),
    forma_pago: fp, condiciones: txt(d?.condiciones, 6000), ciudad_firma: txt(d?.ciudad_firma, 40),
    firmante: txt(d?.firmante, 80), cargo: txt(d?.cargo, 60),
    firma_path: typeof d?.firma_path === 'string' ? d.firma_path : null,
    logo_path: typeof d?.logo_path === 'string' ? d.logo_path : null,
    color: /^#[0-9a-f]{6}$/i.test(String(d?.color)) ? String(d.color) : '#1d1d1b',
    materiales: txt(d?.materiales, 1500), mostrar_iva: d?.mostrar_iva === true
  };
}

async function usar(ctx: Ctx, proyectoId: string, llamadas: { uso: Any; ok: boolean }[], accion: string) {
  const c = ctx.cfg ?? {};
  const precios = { entrada: Number(c.precio_entrada ?? 2), salida: Number(c.precio_salida ?? 10), cache_escritura: Number(c.precio_cache_escritura ?? 2.5), cache_lectura: Number(c.precio_cache_lectura ?? 0.1) };
  let total = 0;
  for (const l of llamadas) {
    const coste = costeUsd(l.uso, precios); total += coste;
    await ctx.supa.from('estudio_uso').insert({
      user_id: ctx.userId, proyecto_id: proyectoId, accion, modelo: ctx.modelo,
      input_tokens: l.uso.input_tokens, output_tokens: l.uso.output_tokens,
      cache_escritura_tokens: l.uso.cache_creation_input_tokens, cache_lectura_tokens: l.uso.cache_read_input_tokens,
      coste_usd: coste, ok: l.ok
    });
  }
  if (!ctx.esAdmin) await descontarSaldo(ctx.supa, ctx.alumno ?? null, ctx.userId, total);
  return Math.round(total * 10000) / 10000;
}

export async function accionPresupuesto(action: string, ctx: Ctx): Promise<Response> {
  const { supa, userId, esAdmin, body, json } = ctx;
  // Emite como SISTEMA & CURINO: admin o acceso especial (cuenta propia de Juan)
  const emisor = esAdmin || !!ctx.alumno?.emisor_curino;

  // ── Tarifa ──
  if (action === 'tarifa') {
    const deCurino = body?.de === 'curino' || (esAdmin && body?.de !== 'mia');
    const t = await cargarTarifa(supa, deCurino ? null : userId);
    return json({ de: deCurino ? 'curino' : 'mia', propia: t.propia, conceptos: CONCEPTOS, tarifa: { valores: t.valores, descuento_pct: t.descuento_pct, iva_pct: t.iva_pct } });
  }
  if (action === 'tarifa_guardar') {
    const deCurino = body?.de === 'curino';
    if (deCurino && !esAdmin) return json({ error: 'Solo admin edita la tarifa Curino.' }, 403);
    const valores: Record<string, number | null> = {};
    for (const c of CONCEPTOS) valores[c.clave] = numOrNull(body?.valores?.[c.clave], 0, c.unidad === '%' ? 500 : 1_000_000);
    const fila = { valores, descuento_pct: numOrNull(body?.descuento_pct, 0, 100) ?? 0, iva_pct: numOrNull(body?.iva_pct, 0, 100) ?? 21, updated_at: new Date().toISOString() };
    let r;
    if (deCurino) r = await supa.from('estudio_tarifas').update(fila).is('user_id', null);
    else {
      const { data: ya } = await supa.from('estudio_tarifas').select('id').eq('user_id', userId).maybeSingle();
      r = ya ? await supa.from('estudio_tarifas').update(fila).eq('id', ya.id) : await supa.from('estudio_tarifas').insert({ user_id: userId, ...fila });
    }
    if (r.error) throw r.error;
    return json({ ok: true, pendientes: Object.values(valores).filter((v) => v === null).length });
  }

  // ── Plantilla ──
  if (action === 'plantilla') {
    const p = await cargarPlantilla(supa, userId, emisor);
    const firmar = async (path: string | null) => path ? (await supa.storage.from('estudio').createSignedUrl(path, 3600)).data?.signedUrl ?? null : null;
    return json({ plantilla: p, emisor_curino: emisor, logo_url: await firmar(p.logo_path), firma_url: await firmar(p.firma_path) });
  }
  if (action === 'plantilla_guardar') {
    const base = emisor ? PLANTILLA_ADMIN : PLANTILLA_ALUMNO;
    const p = limpiarPlantilla(body?.datos ?? {}, base);
    const propio = `${userId}/plantilla/`;
    if (p.logo_path && !p.logo_path.startsWith(propio)) p.logo_path = null;
    if (p.firma_path && !p.firma_path.startsWith(propio)) p.firma_path = null;
    const error = validarPlantilla(p, emisor);
    if (error) return json({ error }, 400);
    if (!emisor) {
      for (const ib of await ibanesCurino(supa)) {
        const e = validarPlantilla(p, false, ib);
        if (e) return json({ error: e }, 400);
      }
    }
    const r = await supa.from('estudio_plantillas').upsert({ user_id: userId, datos: p, updated_at: new Date().toISOString() });
    if (r.error) throw r.error;
    return json({ ok: true, plantilla: p });
  }
  if (action === 'plantilla_subida') {
    const campo = body?.campo === 'firma' ? 'firma' : 'logo';
    const tipo = String(body?.tipo || '');
    const ext = tipo === 'image/png' ? 'png' : tipo === 'image/jpeg' ? 'jpg' : '';
    if (!ext) return json({ error: 'Sube una imagen PNG o JPG.' }, 400);
    if (!(Number(body?.bytes) > 0) || Number(body.bytes) > 2 * 1024 * 1024) return json({ error: 'La imagen supera 2 MB.' }, 400);
    const path = `${userId}/plantilla/${campo}-${crypto.randomUUID()}.${ext}`;
    const { data, error } = await supa.storage.from('estudio').createSignedUploadUrl(path);
    if (error) throw error;
    return json({ path, token: data.token });
  }

  // ── Presupuestos (varios por proyecto; sobre un proyecto propio o, si admin, cualquiera) ──
  const presId = String(body?.presupuesto_id || '');
  let fila: Any = null;
  if (UUID.test(presId)) {
    fila = (await supa.from('estudio_presupuestos').select('*').eq('id', presId).maybeSingle()).data;
    if (!fila) return json({ error: 'Presupuesto no encontrado' }, 404);
  }
  const proyectoId = fila?.proyecto_id ?? String(body?.proyecto_id || '');
  if (!UUID.test(proyectoId)) return json({ error: 'proyecto_id no válido' }, 400);
  const { data: proyecto } = await supa.from('estudio_proyectos').select('*').eq('id', proyectoId).maybeSingle();
  if (!proyecto || (proyecto.user_id !== userId && !esAdmin)) return json({ error: 'Proyecto no encontrado' }, 404);
  // Sin id: el principal del proyecto (el aceptado o el último modificado)
  if (!fila && action !== 'presupuestos' && action !== 'presupuesto_nuevo') {
    fila = (await supa.from('estudio_presupuesto_principal').select('*').eq('proyecto_id', proyectoId).maybeSingle()).data;
  }
  const duenoAdmin = await emisorCurinoDe(supa, proyecto.user_id);
  // Importado del histórico (solo número e importe): no hay documento editable
  const doc: DocPresupuesto | null = fila?.datos?.importado ? null : fila?.datos ?? null;
  const tarifa = await cargarTarifa(supa, proyecto.user_id);
  // El IVA es del proyecto (21 % por defecto, 10 % reformas), no de la tarifa
  if (proyecto.iva_pct !== null && proyecto.iva_pct !== undefined) tarifa.iva_pct = Number(proyecto.iva_pct);
  const plantilla = await cargarPlantilla(supa, proyecto.user_id, duenoAdmin);
  const iva = tarifa.iva_pct ?? 21;
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const camposImporte = (d: DocPresupuesto) => {
    // Importes cacheados (sin IVA) para métricas; null si hay partidas sin precio
    const im = importesNegocio(d, iva);
    return { importe: im.importe, pvp: im.pvp, comision_importe: im.comision, numero: d.numero || null };
  };
  const guardar = async (d: DocPresupuesto) => {
    const r = await supa.from('estudio_presupuestos').update({ datos: d, updated_at: new Date().toISOString(), ...camposImporte(d) }).eq('id', fila.id).select('*').single();
    if (r.error) throw r.error;
    fila = r.data;
  };
  const crear = async (d: DocPresupuesto) => {
    const r = await supa.from('estudio_presupuestos').insert({ proyecto_id: proyectoId, datos: d, estado: 'borrador', estado_at: new Date().toISOString(), ...camposImporte(d) }).select('*').single();
    if (r.error) throw r.error;
    fila = r.data;
  };
  const versionDatos = async (n: number) => (await supa.from('estudio_versiones').select('numero, datos').eq('proyecto_id', proyectoId).eq('numero', n).maybeSingle()).data as { numero: number; datos: Proyecto } | null;
  const respuesta = (d: DocPresupuesto | null) => ({
    id: fila?.id ?? null, numero: fila?.numero ?? d?.numero ?? null,
    presupuesto: d, importado: d || !fila ? null : { numero: fila.datos?.numero ?? fila.numero ?? null, importe: fila.importe ?? null },
    totales: d ? totales(d, iva) : null, importes: d ? importesNegocio(d, iva) : null,
    iva_pct: tarifa.iva_pct, tarifa_propia: tarifa.propia, version_actual: proyecto.version_actual,
    estado: fila?.estado ?? 'borrador', estado_nota: fila?.estado_nota ?? null, estado_at: fila?.estado_at ?? null,
    enviado_at: fila?.enviado_at ?? null, aceptado_at: fila?.aceptado_at ?? null, rechazado_at: fila?.rechazado_at ?? null
  });
  const cabecera = (numero: string): Omit<DocPresupuesto, 'version' | 'partidas'> => ({
    numero, fecha: hoy, atencion: String(proyecto.nombre || '').replace(/^\d{1,4}\s*-\s*/, ''),
    proyecto: 'MOBILIARIO A MEDIDA', proyecto_2: '', validez: '30 DÍAS', seccion: 'MOBILIARIO A MEDIDA'
  });
  /** Siguiente n.º Z del usuario (el mayor + 1); vacío si no usa ese formato. */
  const siguienteZ = async () => {
    const { data: ps } = await supa.from('estudio_proyectos').select('id').eq('user_id', proyecto.user_id);
    const ids = (ps ?? []).map((x: Any) => x.id);
    const { data: ns } = ids.length ? await supa.from('estudio_presupuestos').select('numero, datos').in('proyecto_id', ids) : { data: [] };
    let max = 0, ancho = 0;
    for (const x of ns ?? []) {
      const m = String(x.numero || x.datos?.numero || '').match(/^z(\d{3,})/i);
      if (m && Number(m[1]) > max) { max = Number(m[1]); ancho = m[1].length; }
    }
    return max ? 'Z' + String(max + 1).padStart(ancho, '0') : '';
  };

  if (action === 'presupuestos') {
    const { data: lista } = await supa.from('estudio_presupuestos').select('id, numero, datos, estado, estado_nota, importe, pvp, comision_importe, created_at, updated_at').eq('proyecto_id', proyectoId).order('created_at');
    const { data: vers } = await supa.from('estudio_versiones').select('numero, datos').eq('proyecto_id', proyectoId).order('numero');
    const { data: dis } = await supa.from('estudio_disenos').select('id, nombre, guardado, version_actual, miniatura').eq('proyecto_id', proyectoId).gt('version_actual', 0).order('updated_at', { ascending: false });
    const [docs, fichs] = await Promise.all([
      supa.from('estudio_documentos').select('id, tipo, nombre, numero, version').eq('proyecto_id', proyectoId).in('tipo', ['alzados_pdf', 'presupuesto_pdf']).order('created_at', { ascending: false }),
      supa.from('estudio_ficheros').select('id, tipo, nombre, mime').eq('proyecto_id', proyectoId).eq('subido', true).order('created_at', { ascending: false })
    ]);
    return json({
      presupuestos: (lista ?? []).map((x: Any) => ({
        id: x.id, numero: x.numero || x.datos?.numero || '', fecha: x.datos?.fecha || String(x.created_at).slice(0, 10),
        importe: x.importe, pvp: x.pvp, estado: x.estado, estado_nota: x.estado_nota, importado: !!x.datos?.importado,
        comision: x.datos?.comision?.activa ? x.datos.comision : null, partidas: x.datos?.partidas?.length ?? 0, actualizado: x.updated_at
      })),
      siguiente: await siguienteZ(),
      versiones: (vers ?? []).map((v: Any) => ({ numero: v.numero, armarios: (v.datos?.armarios ?? []).map((a: Any) => ({ codigo: a.codigo, titulo: a.titulo })) })),
      // Diseños (los documentos de tipo «Diseño»): partidas con su dibujo desde su versión actual
      disenos: (dis ?? []).map((d: Any) => {
        const v = (vers ?? []).find((x: Any) => x.numero === d.version_actual);
        return { id: d.id, nombre: d.nombre, guardado: d.guardado, version: d.version_actual, miniatura: d.miniatura, armarios: (v?.datos?.armarios ?? []).map((a: Any) => ({ codigo: a.codigo, titulo: a.titulo })) };
      }),
      documentos: [
        ...(docs.data ?? []).map((x: Any) => ({ tabla: 'doc', id: x.id, nombre: x.nombre, tipo: x.tipo })),
        ...(fichs.data ?? []).filter((x: Any) => /^(application\/pdf|image\/(jpeg|png|webp))$/.test(x.mime)).map((x: Any) => ({ tabla: 'fichero', id: x.id, nombre: x.nombre, tipo: x.tipo }))
      ]
    });
  }

  if (action === 'presupuesto_nuevo') {
    const b = body?.base ?? {};
    const numero = txt(body?.numero, 40) || await siguienteZ();
    let d: DocPresupuesto;
    if (b.tipo === 'versiones') {
      const elegidas = (Array.isArray(b.versiones) ? b.versiones : []).slice(0, 10);
      if (!elegidas.length) return json({ error: 'Elige al menos una versión del diseño.' }, 400);
      const partidas: Partida[] = []; const usadas: number[] = [];
      for (const e of elegidas) {
        const v = await versionDatos(Number(e?.numero));
        if (!v) return json({ error: `No existe la versión v${e?.numero}.` }, 400);
        const armarios = Array.isArray(e?.armarios) ? e.armarios.map(String) : [];
        const g = generarPresupuesto({ proyecto: v.datos, version: v.numero, tarifa, plantilla, nombre: proyecto.nombre, referencia: numero, hoy, armarios });
        partidas.push(...g.partidas); usadas.push(v.numero);
      }
      if (!partidas.length) return json({ error: 'Elige al menos un armario.' }, 400);
      d = { ...cabecera(numero), version: usadas[0], versiones: usadas, partidas };
    } else if (b.tipo === 'documentos') {
      const todos = Array.isArray(b.documentos) ? b.documentos : [];
      if (!todos.length) return json({ error: 'Elige al menos un documento.' }, 400);
      // Diseños → partidas con dibujo (sin IA)
      const partidas: Partida[] = []; const usadas: number[] = [];
      for (const r of todos.filter((x: Any) => x?.tabla === 'diseno').slice(0, 10)) {
        const { data: dd } = await supa.from('estudio_disenos').select('id, version_actual').eq('id', String(r?.id || '')).eq('proyecto_id', proyectoId).maybeSingle();
        const v = dd?.version_actual ? await versionDatos(dd.version_actual) : null;
        if (!v) continue;
        const armarios = Array.isArray(r?.armarios) ? r.armarios.map(String) : [];
        const g = generarPresupuesto({ proyecto: v.datos, version: v.numero, tarifa, plantilla, nombre: proyecto.nombre, referencia: numero, hoy, armarios });
        partidas.push(...g.partidas); usadas.push(v.numero);
      }
      const refs = todos.filter((x: Any) => x?.tabla !== 'diseno').slice(0, 4);
      if (!refs.length) {
        if (!partidas.length) return json({ error: 'Elige al menos un armario del diseño.' }, 400);
        d = { ...cabecera(numero), version: usadas[0], versiones: usadas, partidas };
        await crear(d);
        return json(respuesta(d));
      }
      if (!ctx.clave) return json({ error: 'La IA no está configurada.' }, 500);
      if (!esAdmin) { const sin = sinCredito(ctx.alumno ?? null); if (sin) return json({ error: sin, sin_credito: true }, 402); }
      const adjuntos: Adjunto[] = []; let total = 0;
      for (const r of refs) {
        const tabla = r?.tabla === 'doc' ? 'estudio_documentos' : 'estudio_ficheros';
        const { data: x } = await supa.from(tabla).select('*').eq('id', String(r?.id || '')).eq('proyecto_id', proyectoId).maybeSingle();
        if (!x) continue;
        const mime = tabla === 'estudio_documentos' ? (x.tipo === 'presupuesto_xlsx' ? '' : 'application/pdf') : x.mime;
        if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(mime)) continue;
        const { data: blob } = await supa.storage.from('estudio').download(x.path);
        if (!blob) continue;
        const u8 = new Uint8Array(await blob.arrayBuffer()); total += u8.length;
        if (total > 18 * 1024 * 1024) return json({ error: 'Los documentos elegidos superan 18 MB entre todos: elige menos.' }, 400);
        adjuntos.push({ tipo: mime as Adjunto['tipo'], base64: ctx.base64(u8), nombre: x.nombre });
      }
      if (!adjuntos.length) return json({ error: 'Ninguno de los documentos se puede leer (PDF o foto).' }, 400);
      const r = await proponerPartidas({ clave: ctx.clave, modelo: ctx.modelo, adjuntos });
      await usar(ctx, proyectoId, r.llamadas, 'partidas');
      if (!r.partidas?.length && !partidas.length) return json({ error: 'Claude no ha podido proponer partidas con esos documentos. Prueba con otros o empieza en blanco.' }, 502);
      r.partidas = r.partidas ?? [];
      const libres = r.partidas.map((x, i) => partidaLibre({ n: i + 1, titulo: x.titulo, descripcion: x.descripcion, cantidad: x.cantidad, precio: x.precio_unitario, dto: tarifa.descuento_pct ?? 0 }));
      d = { ...cabecera(numero), version: usadas[0] ?? (proyecto.version_actual || 0), versiones: usadas.length ? usadas : undefined, partidas: [...partidas, ...libres] };
    } else {
      d = { ...cabecera(numero), version: proyecto.version_actual || 0, partidas: [partidaLibre({ n: 1, dto: tarifa.descuento_pct ?? 0 })] };
    }
    await crear(d);
    return json(respuesta(d));
  }

  if (!fila) return json(respuesta(null));
  if (action === 'presupuesto') return json(respuesta(doc));

  if (action === 'presupuesto_duplicar') {
    if (!doc) return json({ error: 'Los presupuestos importados no se pueden duplicar: crea uno nuevo.' }, 400);
    const base = String(fila.numero || doc.numero || 'PRESUPUESTO').replace(/-[A-Z]$/i, '');
    const { data: ns } = await supa.from('estudio_presupuestos').select('numero').eq('proyecto_id', proyectoId);
    const usados = new Set((ns ?? []).map((x: Any) => String(x.numero || '').toUpperCase()));
    let numero = base;
    for (const l of 'BCDEFGHIJKLMNOPQRSTUVWXYZ') { if (!usados.has(`${base}-${l}`.toUpperCase())) { numero = `${base}-${l}`; break; } }
    const copia: DocPresupuesto = JSON.parse(JSON.stringify(doc));
    copia.numero = numero; copia.fecha = hoy;
    await crear(copia);
    return json(respuesta(copia));
  }

  if (!doc) return json({ error: 'Este presupuesto es del histórico (solo n.º e importe): crea uno nuevo para editarlo.' }, 400);

  /** Recalcula desde su versión las partidas de diseño (las libres se quedan igual). */
  const recalcularDesdeVersiones = async (d: DocPresupuesto, soloSinPrecio = false) => {
    const porVersion = new Map<number, string[]>();
    for (const p of d.partidas) if (!p.libre) { const n = p.version ?? d.version; porVersion.set(n, [...(porVersion.get(n) ?? []), p.codigo]); }
    const frescas = new Map<string, Partida>();
    for (const [n, cods] of porVersion) {
      const v = await versionDatos(n);
      if (!v) continue;
      const g = generarPresupuesto({ proyecto: v.datos, version: n, tarifa, plantilla, nombre: proyecto.nombre, hoy: d.fecha, previo: d, armarios: cods });
      for (const p of g.partidas) frescas.set(claveDe(p), p);
    }
    d.partidas = d.partidas.map((p) => {
      if (p.libre) return p;
      const f = frescas.get(claveDe(p)) ?? frescas.get(`v${p.version ?? d.version}:${p.codigo}`);
      if (!f) return p;
      return soloSinPrecio ? (p.precio_manual ? p : { ...p, precio: f.precio, desglose: f.desglose, pendientes: f.pendientes }) : f;
    });
  };

  if (action === 'presupuesto_generar') {
    // «Recalcular con la tarifa»: textos técnicos y precios de tarifa desde cada versión
    const d: DocPresupuesto = JSON.parse(JSON.stringify(doc));
    await recalcularDesdeVersiones(d);
    await guardar(d);
    return json(respuesta(d));
  }

  if (action === 'presupuesto_guardar') {
    const e = body?.datos ?? {};
    const d: DocPresupuesto = { ...doc };
    for (const [k, max] of [['numero', 40], ['atencion', 80], ['proyecto', 80], ['proyecto_2', 80], ['validez', 30], ['seccion', 60]] as const) {
      if (e[k] !== undefined) (d as Any)[k] = txt(e[k], max);
    }
    if (typeof e.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha)) d.fecha = e.fecha;
    if (e.comision && typeof e.comision === 'object') {
      d.comision = { activa: e.comision.activa === true, pct: numOrNull(e.comision.pct, 0, 100) ?? 0, paga: e.comision.paga === 'interiorista' ? 'interiorista' : 'cliente' };
    }
    if (Array.isArray(e.partidas)) {
      const prev = new Map(doc.partidas.map((p) => [claveDe(p), p]));
      d.partidas = e.partidas.slice(0, 40).map((x: Any, i: number): Partida => {
        const p = prev.get(String(x?.clave || x?.codigo || ''));
        const cantidad = Math.max(1, Math.min(99, Math.round(Number(x?.cantidad) || 1)));
        const comunes = {
          cantidad,
          subtitulo: x?.subtitulo !== undefined ? txt(x.subtitulo, 160) : p?.subtitulo ?? '',
          intro: x?.intro !== undefined ? txt(x.intro, 800) : p?.intro ?? '',
          tecnico: x?.tecnico !== undefined ? txt(x.tecnico, 3000) : p?.tecnico ?? '',
          materiales: x?.materiales !== undefined ? txt(x.materiales, 1500) : p?.materiales ?? '',
          dto_pct: numOrNull(x?.dto_pct, 0, 100) ?? p?.dto_pct ?? 0
        };
        if (p && !p.libre) {
          const precioManual = x?.precio_manual === true;
          return { ...p, ...comunes, precio_manual: precioManual, precio: precioManual ? numOrNull(x?.precio, 0, 10_000_000) : p.precio_manual ? null : p.precio };
        }
        // Partida libre (nueva o existente): todo a mano
        return {
          ...(p ?? partidaLibre({ n: i + 1 })), ...comunes,
          codigo: txt(x?.codigo, 10) || p?.codigo || `P.${String(i + 1).padStart(2, '0')}`,
          titulo: (txt(x?.titulo, 120) || p?.titulo || 'PARTIDA').toUpperCase(),
          precio: numOrNull(x?.precio, 0, 10_000_000), precio_manual: true, libre: true
        };
      });
      // Al quitar el precio manual vuelve el de la tarifa
      if (d.partidas.some((p) => !p.libre && !p.precio_manual && p.precio === null)) await recalcularDesdeVersiones(d, true);
    }
    await guardar(d);
    return json(respuesta(d));
  }

  if (action === 'presupuesto_textos') {
    if (!ctx.clave) return json({ error: 'La IA no está configurada.' }, 500);
    const d: DocPresupuesto = JSON.parse(JSON.stringify(doc));
    const porVersion = new Map<number, Partida[]>();
    for (const p of d.partidas) if (!p.libre) { const n = p.version ?? d.version; porVersion.set(n, [...(porVersion.get(n) ?? []), p]); }
    if (!porVersion.size) return json({ error: 'La IA redacta los textos de las partidas que salen del diseño; las partidas libres se escriben a mano.' }, 400);
    let coste = 0;
    for (const [n, ps] of porVersion) {
      const v = await versionDatos(n);
      if (!v) continue;
      const r = await redactarTextos({ clave: ctx.clave, modelo: ctx.modelo, proyecto: v.datos, partidas: ps });
      coste += await usar(ctx, proyectoId, r.llamadas, 'textos');
      if (!r.textos) return json({ error: 'La IA no ha podido redactar los textos. Inténtalo de nuevo.', detalle: esAdmin ? r.error : undefined }, 502);
      for (const p of ps) { const t = r.textos.find((x) => x.codigo === p.codigo); if (t) { p.subtitulo = t.subtitulo || p.subtitulo; p.intro = t.intro; } }
    }
    await guardar(d);
    return json({ ...respuesta(d), coste_usd: Math.round(coste * 10000) / 10000 });
  }

  // Un alumno no descarga (PDF ni Excel) sin sus datos de emisor completos.
  if (!duenoAdmin) {
    const faltan = faltanPlantilla(plantilla);
    if (faltan.length) return json({ error: `Antes de descargar el presupuesto completa «Mis datos y plantilla»: falta ${faltan.join(', ')}.`, faltan }, 400);
  }

  /** Dibujos de las partidas de diseño, con la clave de cada partida («v2:A.01»). */
  const dibujosDe = async <T>(medir: Any, mapa: (l: Any, clave: string) => T): Promise<T[]> => {
    const out: T[] = [];
    const porVersion = new Map<number, Partida[]>();
    for (const p of doc.partidas) if (!p.libre) { const n = p.version ?? doc.version; porVersion.set(n, [...(porVersion.get(n) ?? []), p]); }
    for (const [n, ps] of porVersion) {
      const v = await versionDatos(n);
      if (!v) continue;
      for (const l of laminasProyecto(v.datos, medir)) {
        const p = ps.find((x) => x.codigo === l.codigo);
        if (p) out.push(mapa(l, claveDe(p)));
      }
    }
    return out;
  };

  if (action === 'presupuesto_dibujos') {
    const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
    const inter = { regular: await pdf.embedFont(interRegular(), { subset: true }), bold: await pdf.embedFont(interBold(), { subset: true }) };
    const medir = medirConFuentes(inter);
    const css = interCss();
    const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_ANCHO} ${LOGO_ALTO}" width="${LOGO_ANCHO}" height="${LOGO_ALTO}"><path d="${LOGO_PATH}" fill="#000000"/></svg>`;
    const firmar = async (path: string | null) => path ? (await supa.storage.from('estudio').createSignedUrl(path, 600)).data?.signedUrl ?? null : null;
    return json({
      logo, plantilla, iva_pct: tarifa.iva_pct, presupuesto_id: fila.id,
      firma_url: await firmar(plantilla.firma_path), logo_url: plantilla.tipo === 'propia' ? await firmar(plantilla.logo_path) : null,
      dibujos: await dibujosDe(medir, (l, clave) => { const d = dibujoLamina(l, medir); return { codigo: clave, svg: dibujoSvg(d.prims, d.caja, css), ancho: d.caja.w, alto: d.caja.h }; })
    });
  }

  if (action === 'presupuesto_pdf') {
    // Defensa: un alumno nunca emite con datos de Curino aunque se cuele en la BD.
    if (!duenoAdmin) {
      const err = validarPlantilla(plantilla, false);
      if (err) return json({ error: err }, 400);
    }
    // Con comisión del interiorista: dos PDF (cliente PVP / interiorista con DTO)
    const variantes: ('cliente' | 'interiorista' | null)[] = doc.comision?.activa ? ['cliente', 'interiorista'] : [null];
    const archivos: { nombre: string; base64: string; variante: string | null }[] = [];
    for (const variante of variantes) {
      const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
      const os = { regular: await pdf.embedFont(openSansRegular(), { subset: true }), bold: await pdf.embedFont(openSansBold(), { subset: true }) };
      const inter = { regular: await pdf.embedFont(interRegular(), { subset: true }), bold: await pdf.embedFont(interBold(), { subset: true }) };
      const medir = medirConFuentes(inter);
      const dibujos = await dibujosDe(medir, (l, clave) => ({ ...dibujoLamina(l, medir), codigo: clave }));
      const imagen = async (path: string | null) => {
        if (!path) return undefined;
        const { data } = await supa.storage.from('estudio').download(path);
        if (!data) return undefined;
        const b = new Uint8Array(await data.arrayBuffer());
        return b[0] === 0x89 ? await pdf.embedPng(b) : await pdf.embedJpg(b);
      };
      pintarPresupuesto(pdf, { presupuesto: docVariante(doc, variante), plantilla, dibujos, ivaPct: iva }, { os, inter }, { rgb, degrees },
        { logo: plantilla.tipo === 'propia' ? await imagen(plantilla.logo_path) : undefined, firma: await imagen(plantilla.firma_path) });
      pdf.setTitle(`Presupuesto ${doc.numero || proyecto.nombre}${variante ? ` (${variante})` : ''}`);
      pdf.setCreator('Estudio Curino');
      const nombre = `Presupuesto_${(doc.numero || proyecto.nombre).replace(/[^\w-]+/g, '_')}${variante ? '_' + variante : ''}.pdf`;
      const bytes = await pdf.save();
      await guardarDocumento(supa, { proyecto_id: proyectoId, user_id: proyecto.user_id, tipo: 'presupuesto_pdf', version: doc.version || null, numero: doc.numero || null, nombre, bytes, presupuesto_id: fila.id, variante });
      archivos.push({ nombre, base64: ctx.base64(bytes), variante });
    }
    return json({ archivos, nombre: archivos[0].nombre, base64: archivos[0].base64 });
  }

  return json({ error: 'accion_desconocida' }, 400);
}
