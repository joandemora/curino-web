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
//   'presupuesto'         { proyecto_id } → presupuesto guardado (o null).
//   'presupuesto_generar' { proyecto_id, numero? } → desde la versión (por
//                         defecto la actual), conservando lo editado a mano.
//   'presupuesto_guardar' { proyecto_id, datos } → cabecera y partidas editables.
//   'presupuesto_textos'  { proyecto_id } → Claude redacta subtítulo e intro.
//   'presupuesto_pdf'     { proyecto_id } → PDF (base64).
//   'presupuesto_dibujos' { proyecto_id } → SVG recortado de cada armario con
//                         Inter embebida (el navegador lo pasa a PNG para el Excel).

import { PDFDocument, rgb, degrees } from 'https://esm.sh/pdf-lib@1.17.1'
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1'
import { laminasProyecto, dibujoLamina } from '../_shared/estudio/alzado.ts'
import { medirConFuentes } from '../_shared/estudio/pdf.ts'
import { dibujoSvg } from '../_shared/estudio/svg.ts'
import { LOGO_ALTO, LOGO_ANCHO, LOGO_PATH } from '../_shared/estudio/logo.ts'
import { CONCEPTOS, TARIFA_PENDIENTE, type Tarifa } from '../_shared/estudio/tarifa.ts'
import {
  generarPresupuesto, totales, validarPlantilla, faltanPlantilla, PLANTILLA_ADMIN, PLANTILLA_ALUMNO,
  type DocPresupuesto, type Plantilla
} from '../_shared/estudio/presupuesto.ts'
import { pintarPresupuesto } from '../_shared/estudio/presupuesto-pdf.ts'
import { costeUsd, redactarTextos } from '../_shared/estudio/ia.ts'
import { descontarSaldo, emisorCurinoDe, type EstadoAlumno } from './acceso.ts'
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
  'presupuesto', 'presupuesto_generar', 'presupuesto_guardar', 'presupuesto_textos', 'presupuesto_pdf', 'presupuesto_dibujos']);
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

  // ── Presupuesto (sobre un proyecto propio o, si admin, cualquiera) ──
  const proyectoId = String(body?.proyecto_id || '');
  if (!UUID.test(proyectoId)) return json({ error: 'proyecto_id no válido' }, 400);
  const { data: proyecto } = await supa.from('estudio_proyectos').select('*').eq('id', proyectoId).maybeSingle();
  if (!proyecto || (proyecto.user_id !== userId && !esAdmin)) return json({ error: 'Proyecto no encontrado' }, 404);
  const duenoAdmin = await emisorCurinoDe(supa, proyecto.user_id);
  const { data: guardado } = await supa.from('estudio_presupuestos').select('datos, estado, estado_nota, estado_at, enviado_at, aceptado_at, rechazado_at, importe').eq('proyecto_id', proyectoId).maybeSingle();
  // Importado del histórico (solo número e importe): no hay documento editable
  const doc: DocPresupuesto | null = guardado?.datos?.importado ? null : guardado?.datos ?? null;
  const tarifa = await cargarTarifa(supa, proyecto.user_id);
  // El IVA es del proyecto (21 % por defecto, 10 % reformas), no de la tarifa
  if (proyecto.iva_pct !== null && proyecto.iva_pct !== undefined) tarifa.iva_pct = Number(proyecto.iva_pct);
  const plantilla = await cargarPlantilla(supa, proyecto.user_id, duenoAdmin);
  const guardar = async (d: DocPresupuesto) => {
    // Importes cacheados (sin IVA) para «Mi negocio»; null si hay partidas sin precio.
    const t = totales(d, tarifa.iva_pct ?? 21);
    const r = await supa.from('estudio_presupuestos').upsert({
      proyecto_id: proyectoId, datos: d, updated_at: new Date().toISOString(),
      importe: t.pendientes ? null : t.importe, pvp: t.pendientes ? null : t.pvp
    });
    if (r.error) throw r.error;
  };
  const versionDatos = async (n: number) => (await supa.from('estudio_versiones').select('numero, datos').eq('proyecto_id', proyectoId).eq('numero', n).maybeSingle()).data as { numero: number; datos: Proyecto } | null;
  const estado = { estado: guardado?.estado ?? 'borrador', estado_nota: guardado?.estado_nota ?? null, estado_at: guardado?.estado_at ?? null, enviado_at: guardado?.enviado_at ?? null, aceptado_at: guardado?.aceptado_at ?? null, rechazado_at: guardado?.rechazado_at ?? null };
  const importado = guardado?.datos?.importado ? { numero: guardado.datos.numero ?? null, importe: guardado.importe ?? null } : null;
  const respuesta = (d: DocPresupuesto | null) => ({ presupuesto: d, importado: d ? null : importado, totales: d ? totales(d, tarifa.iva_pct ?? 21) : null, iva_pct: tarifa.iva_pct, tarifa_propia: tarifa.propia, version_actual: proyecto.version_actual, ...estado });

  if (action === 'presupuesto') return json(respuesta(doc));

  if (action === 'presupuesto_generar') {
    const n = Number.isInteger(body?.numero) && body.numero > 0 ? body.numero : proyecto.version_actual;
    const v = n ? await versionDatos(n) : null;
    if (!v) return json({ error: 'El proyecto aún no tiene alzados: crea una versión primero.' }, 400);
    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const d = generarPresupuesto({ proyecto: v.datos, version: v.numero, tarifa, plantilla, nombre: proyecto.nombre, referencia: proyecto.referencia, hoy, previo: doc });
    await guardar(d);
    return json(respuesta(d));
  }

  if (!doc) return json({ error: 'Genera primero el presupuesto.' }, 400);

  if (action === 'presupuesto_guardar') {
    const e = body?.datos ?? {};
    const d: DocPresupuesto = { ...doc };
    for (const [k, max] of [['numero', 40], ['atencion', 80], ['proyecto', 80], ['proyecto_2', 80], ['validez', 30], ['seccion', 60]] as const) {
      if (e[k] !== undefined) (d as Any)[k] = txt(e[k], max);
    }
    if (typeof e.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha)) d.fecha = e.fecha;
    if (Array.isArray(e.partidas)) {
      d.partidas = doc.partidas.map((p) => {
        const x = e.partidas.find((y: Any) => y?.codigo === p.codigo);
        if (!x) return p;
        const precioManual = x.precio_manual === true;
        return {
          ...p,
          cantidad: Math.max(1, Math.min(99, Math.round(Number(x.cantidad) || 1))),
          subtitulo: x.subtitulo !== undefined ? txt(x.subtitulo, 160) : p.subtitulo,
          intro: x.intro !== undefined ? txt(x.intro, 800) : p.intro,
          tecnico: x.tecnico !== undefined ? txt(x.tecnico, 3000) : p.tecnico,
          materiales: x.materiales !== undefined ? txt(x.materiales, 1500) : p.materiales,
          precio_manual: precioManual,
          precio: precioManual ? numOrNull(x.precio, 0, 10_000_000) : p.precio_manual ? null : p.precio,
          dto_pct: numOrNull(x.dto_pct, 0, 100) ?? p.dto_pct
        };
      });
      // Al quitar el precio manual vuelve el de la tarifa
      if (d.partidas.some((p) => !p.precio_manual && p.precio === null)) {
        const v = await versionDatos(d.version);
        if (v) {
          const fresco = generarPresupuesto({ proyecto: v.datos, version: v.numero, tarifa, plantilla, nombre: proyecto.nombre, hoy: d.fecha });
          d.partidas = d.partidas.map((p) => p.precio_manual ? p : { ...p, precio: fresco.partidas.find((f) => f.codigo === p.codigo)?.precio ?? null });
        }
      }
    }
    await guardar(d);
    return json(respuesta(d));
  }

  if (action === 'presupuesto_textos') {
    if (!ctx.clave) return json({ error: 'La IA no está configurada.' }, 500);
    const v = await versionDatos(doc.version);
    if (!v) return json({ error: 'No encuentro la versión del presupuesto.' }, 400);
    const r = await redactarTextos({ clave: ctx.clave, modelo: ctx.modelo, proyecto: v.datos, partidas: doc.partidas });
    const coste = await usar(ctx, proyectoId, r.llamadas, 'textos');
    if (!r.textos) return json({ error: 'La IA no ha podido redactar los textos. Inténtalo de nuevo.', detalle: esAdmin ? r.error : undefined }, 502);
    const d: DocPresupuesto = { ...doc, partidas: doc.partidas.map((p) => { const t = r.textos!.find((x) => x.codigo === p.codigo); return t ? { ...p, subtitulo: t.subtitulo || p.subtitulo, intro: t.intro } : p; }) };
    await guardar(d);
    return json({ ...respuesta(d), coste_usd: coste });
  }

  const v = await versionDatos(doc.version);
  if (!v) return json({ error: 'No encuentro la versión del presupuesto.' }, 400);

  // Un alumno no descarga (PDF ni Excel) sin sus datos de emisor completos.
  if (!duenoAdmin) {
    const faltan = faltanPlantilla(plantilla);
    if (faltan.length) return json({ error: `Antes de descargar el presupuesto completa «Mis datos y plantilla»: falta ${faltan.join(', ')}.`, faltan }, 400);
  }

  if (action === 'presupuesto_dibujos') {
    const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
    const inter = { regular: await pdf.embedFont(interRegular(), { subset: true }), bold: await pdf.embedFont(interBold(), { subset: true }) };
    const medir = medirConFuentes(inter);
    const css = interCss();
    const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_ANCHO} ${LOGO_ALTO}" width="${LOGO_ANCHO}" height="${LOGO_ALTO}"><path d="${LOGO_PATH}" fill="#000000"/></svg>`;
    const firmar = async (path: string | null) => path ? (await supa.storage.from('estudio').createSignedUrl(path, 600)).data?.signedUrl ?? null : null;
    return json({
      logo, plantilla, iva_pct: tarifa.iva_pct,
      firma_url: await firmar(plantilla.firma_path), logo_url: plantilla.tipo === 'propia' ? await firmar(plantilla.logo_path) : null,
      dibujos: laminasProyecto(v.datos, medir).map((l) => { const d = dibujoLamina(l, medir); return { codigo: l.codigo, svg: dibujoSvg(d.prims, d.caja, css), ancho: d.caja.w, alto: d.caja.h }; })
    });
  }

  if (action === 'presupuesto_pdf') {
    // Defensa: un alumno nunca emite con datos de Curino aunque se cuele en la BD.
    if (!duenoAdmin) {
      const err = validarPlantilla(plantilla, false);
      if (err) return json({ error: err }, 400);
    }
    const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
    const os = { regular: await pdf.embedFont(openSansRegular(), { subset: true }), bold: await pdf.embedFont(openSansBold(), { subset: true }) };
    const inter = { regular: await pdf.embedFont(interRegular(), { subset: true }), bold: await pdf.embedFont(interBold(), { subset: true }) };
    const medir = medirConFuentes(inter);
    const dibujos = laminasProyecto(v.datos, medir).map((l) => ({ codigo: l.codigo, ...dibujoLamina(l, medir) }));
    const imagen = async (path: string | null) => {
      if (!path) return undefined;
      const { data } = await supa.storage.from('estudio').download(path);
      if (!data) return undefined;
      const b = new Uint8Array(await data.arrayBuffer());
      return b[0] === 0x89 ? await pdf.embedPng(b) : await pdf.embedJpg(b);
    };
    pintarPresupuesto(pdf, { presupuesto: doc, plantilla, dibujos, ivaPct: tarifa.iva_pct ?? 21 }, { os, inter }, { rgb, degrees },
      { logo: plantilla.tipo === 'propia' ? await imagen(plantilla.logo_path) : undefined, firma: await imagen(plantilla.firma_path) });
    pdf.setTitle(`Presupuesto ${doc.numero || proyecto.nombre}`);
    pdf.setCreator('Estudio Curino');
    const nombre = `Presupuesto_${(doc.numero || proyecto.nombre).replace(/[^\w-]+/g, '_')}.pdf`;
    const bytes = await pdf.save();
    await guardarDocumento(supa, { proyecto_id: proyectoId, user_id: proyecto.user_id, tipo: 'presupuesto_pdf', version: doc.version, numero: doc.numero || null, nombre, bytes });
    return json({ nombre, base64: ctx.base64(bytes) });
  }

  return json({ error: 'accion_desconocida' }, 400);
}
