// supabase/functions/_shared/estudio/alzado.ts
//
// Estudio Curino · renderizador de alzados (F1, 2026-10).
//
// Convierte cada armario del proyecto (esquema.ts) en una lámina: una lista
// de primitivas en puntos (y hacia abajo) que luego pintan svg.ts (vista
// previa) y pdf.ts (PDF vectorial con pdf-lib). Estilo Curino calibrado con
// los alzados de referencia (Z2606941 v6): por cada cuerpo, alzado interior +
// frente cerrado; cotas en cm; colgadores; cajoneras; puertas molduradas con
// tirador de latón; «2 cm a suelo»; cabecera &CURINO y numeración A.0N.
//
// Todas las cotas salen del JSON. Las proporciones de dibujo que no son
// medidas del mueble (moldura, colgadores, holguras) están en ESTILO.

import { LOGO_ALTO, LOGO_ANCHO } from './logo.ts';
import {
  type Armario, type Cuerpo, type Frente, type PiezaFrente, type Proyecto, type Zona, type Formato,
  repartoZonas, ZOCALO_DEF, GROSOR_DEF, SEPARACION_SUELO_DEF, materialPieza, agarrePuerta, fmtMm, huecoMano, tapetasCajonera
} from './esquema.ts';
import { laminasCocina, laminasCocinaPresupuesto } from './cocina-alzado.ts';

// ── Primitivas ──────────────────────────────────────────────────────
export type Prim =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; opacity?: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number }
  | { k: 'poly'; pts: [number, number][]; fill?: string; stroke?: string; sw?: number; opacity?: number }
  | { k: 'text'; x: number; y: number; t: string; size: number; bold?: boolean; color: string; anchor: 'start' | 'middle' | 'end'; vertical?: boolean }
  | { k: 'logo'; x: number; y: number; h: number; color: string };

export interface Lamina {
  codigo: string;
  formato: Formato;
  ancho: number;   // pt
  alto: number;    // pt
  prims: Prim[];
  inicioDibujo: number;  // prims[0..inicioDibujo) = cabecera y pie; el resto, el dibujo
  pagina?: number;       // 2 = página extra del armario (sección / planta que no caben en la primera)
  grupo?: string;        // presupuesto: filas del mismo armario / cocina (van todas a la misma escala)
}

/** Caja (pt) que ocupa una lista de primitivas. */
export function cajaPrims(prims: Prim[], medir: Medir = medirAprox): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pt = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of prims) {
    if (p.k === 'rect') { pt(p.x, p.y); pt(p.x + p.w, p.y + p.h); }
    else if (p.k === 'line') { pt(p.x1, p.y1); pt(p.x2, p.y2); }
    else if (p.k === 'poly') p.pts.forEach(([x, y]) => pt(x, y));
    else if (p.k === 'text') {
      const w = medir(p.t, p.size, !!p.bold);
      const off = p.anchor === 'middle' ? w / 2 : p.anchor === 'end' ? w : 0;
      if (p.vertical) { pt(p.x - p.size, p.y - off); pt(p.x + 2, p.y - off + w); }
      else { pt(p.x - off, p.y - p.size); pt(p.x - off + w, p.y + p.size * 0.25); }
    } else if (p.k === 'logo') { pt(p.x, p.y); pt(p.x + p.h * 3.76, p.y + p.h); }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Solo el dibujo de la lámina (sin cabecera ni pie) y su caja. */
export function dibujoLamina(l: Lamina, medir: Medir = medirAprox) {
  const prims = l.prims.slice(l.inicioDibujo);
  return { prims, caja: cajaPrims(prims, medir) };
}

/** Ancho en pt de un texto (Inter). pdf.ts usa las métricas reales de la fuente. */
export type Medir = (texto: string, size: number, bold: boolean) => number;
export const medirAprox: Medir = (t, size, bold) => t.length * size * (bold ? 0.6 : 0.56);

// ── Estilo (colores, grosores en pt; medidas de dibujo en cm) ───────
export const ESTILO = {
  tinta: '#1d1d1b',
  cota: '#555555',
  etiqueta: '#333333',
  suave: '#777777',
  subtitulo: '#444444',
  fondoInterior: '#fbfaf7',
  tablero: '#ece6dc',
  zocalo: '#d9d3c8',
  cajon: '#e3ddd2',
  cajonInterior: '#efeae1',
  cajon_frente_bajo: 0.35,   // × alto del cajón (cajón abierto, frente bajo)
  cajon_escote: 0.45,        // profundidad del escote × alto del cajón
  cajon_escote_ancho: 0.4,   // ancho del escote × ancho del cajón
  puerta: '#f6f4ef',
  barra: '#444444',
  gancho: '#666666',
  prenda: '#9a9a9a',
  prendaBorde: '#7a7a7a',
  laton: '#b8864b',
  latonBorde: '#8a6234',
  acero: '#c3c7cc',
  aceroBorde: '#7d8288',
  textil: '#ece6da',
  tramaTextil: '#cdbfa6',
  ratan: '#f3e9d4',
  rejilla: '#b89a66',
  chapa: '#f1e6d3',
  uneroDm: '#b9b1a3',
  uneroMadera: '#b98d58',
  // separaciones entre vistas (cm)
  hueco_vistas: 45,
  hueco_cuerpos: 80,
  margen_izq_cm: 48.4,   // cotas verticales a la izquierda
  margen_der_cm: 15.6,   // suelo a la derecha
  // cotas (cm desde el mueble)
  cota_arriba: 12.5,
  cota_abajo: 16,
  cota_alto: 20,
  cota_altillo: 9,
  pie_vista: 43,
  suelo_extra: 15,
  // perchas
  barra_bajo_balda: 7,
  barra_margen: 1.5,
  percha_paso: 7.5,
  percha_primera: 5,
  gancho_arriba: 2.5,
  gancho_abajo: 2,
  prenda_arriba: 2.5,
  prenda_ancho_arriba: 2.8,
  prenda_ancho_abajo: 5.2,
  prenda_corta_max: 97,
  prenda_larga_max: 162.5,
  prenda_etiqueta: 0.48,  // etiqueta a esta fracción del largo de la prenda
  // cajones
  cajon_holgura: 0.4,
  cajon_separacion: 0.8,
  cajon_tirador: 16,
  cajon_tirador_baja: 3.1,
  // puertas
  puerta_holgura: 0.15,
  moldura: 0.12,          // × ancho de la puerta
  moldura_interior: 0.028,
  travesano_altura: 0.36, // centro del travesaño, × alto de la puerta desde abajo
  travesano: 8,
  tirador_borde: 4,
  tirador_alto: 9,
  tirador_ancho: 1.4,
  cruz_ancho: 3.6,
  cruz_alto: 1.2,
  zocalo_frente_margen: 1.8,
  suelo_texto_dx: 4,
  suelo_texto_dy: 6,
  // sección y planta (cm de dibujo)
  trasera: 1,
  zocalo_retranqueo: 4,
  corredera_holgura: 0.5,   // entre los dos planos de puertas correderas
  planta_cota: 12.5,        // cotas de la planta, separadas del mueble
  planta_simbolo: 8,        // flechas de coplanar / corredera delante de la puerta
  vistas_minimo: 0.85       // sección / planta en la misma página si la escala no baja de esto
} as const;

export const PAGINA: Record<Formato, {
  w: number; h: number; ml: number; mr: number;
  logo: [number, number]; titulo: number; subtitulo: number; der1: number; der2: number; pie: number;
}> = {
  A3: { w: 1190.88, h: 841.68, ml: 59.5, mr: 1143.3, logo: [59.8, 41.8], titulo: 88.3, subtitulo: 109.4, der1: 66.7, der2: 76.4, pie: 799.6 },
  A4: { w: 841.68, h: 595.44, ml: 42.1, mr: 808.0, logo: [41.8, 23.0], titulo: 62.5, subtitulo: 77.4, der1: 49.5, der2: 59.1, pie: 565.7 }
};
/**
 * «Página» de los dibujos del presupuesto: cada fila (interior + cerrado; sección +
 * planta) se dibuja en un ancho útil tal que, reducida al ancho de la fila del PDF
 * (FILA_DIBUJO.ancho), las cotas de 7,5 pt queden en COTA_MIN_PT (5 pt). El alto
 * útil limita las filas altas a FILA_DIBUJO.alto.
 */
export const FILA_DIBUJO = { x0: 42.8, ancho: 508.7, alto: 380, separacion: 8 };
export const COTA_MIN_PT = 5;
const K_MIN = COTA_MIN_PT / 7.5;
const ANCHO_PRES = (FILA_DIBUJO.ancho / K_MIN) * 0.92;   // holgura para cotas y etiquetas que sobresalen del dibujo
export const PAGINA_PRESUPUESTO = {
  w: ANCHO_PRES + 80, h: (FILA_DIBUJO.alto / K_MIN / 0.531) * 0.85 /* ALTO_UTIL; holgura para cotas */, ml: 40, mr: ANCHO_PRES + 40,
  logo: [40, 20] as [number, number], titulo: 50, subtitulo: 60, der1: 30, der2: 40, pie: 0
};
type Hoja = Formato | 'PRES';
export const paginaDe = (f: Hoja) => (f === 'PRES' ? PAGINA_PRESUPUESTO : PAGINA[f]);
export const LOGO_ANCHO_PT = 77.7;  // caja del logo en los alzados de referencia
export const LOGO_CAJA_ALTO = 21.6;
export const ALTO_UTIL = 0.531;     // × alto de página para el cuerpo más alto
export const CENTRO_VERTICAL = 0.511;
const A3_DESDE_CM = 480;     // ancho de vistas a partir del cual se usa A3

// ── Utilidades ──────────────────────────────────────────────────────
/** 47,5 · 95 · 0,3 — coma decimal española. */
/** 47,5 · 95 · 54,75 — coma decimal, hasta dos decimales (los parciales de una cota suman el total). */
export function fmtCm(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function anchoVistas(a: Armario): number {
  let w = 0;
  a.cuerpos.forEach((c, i) => { w += (i ? ESTILO.hueco_cuerpos : 0) + c.ancho * 2 + ESTILO.hueco_vistas; });
  return w;
}

export function formatoArmario(a: Armario): Formato {
  return a.formato ?? (anchoVistas(a) > A3_DESDE_CM ? 'A3' : 'A4');
}

export function subtituloAuto(a: Armario): string {
  const medidas = (c: Cuerpo) => `${fmtCm(c.ancho)} × ${fmtCm(c.alto)} × ${fmtCm(c.fondo)} cm`;
  if (a.cuerpos.length > 1) {
    return a.cuerpos.map((c, i) => `${c.nombre ? c.nombre.toLowerCase().replace(/^./, (x) => x.toUpperCase()) : `Cuerpo ${i + 1}`} ${medidas(c)}`).join(' + ');
  }
  const c = a.cuerpos[0];
  const grupos: { ancho: number; n: number }[] = [];
  for (const m of c.modulos) {
    const g = grupos.find((x) => x.ancho === m.ancho);
    if (g) g.n++; else grupos.push({ ancho: m.ancho, n: 1 });
  }
  const mods = grupos.map((g) => `${plural(g.n, 'módulo', 'módulos')} de ${fmtCm(g.ancho)} cm`).join(' + ');
  const puertas = c.frente.piezas.filter((p) => p.tipo === 'puerta');
  const iguales = puertas.length > 0 && puertas.every((p) => p.ancho === puertas[0].ancho);
  return [mods, medidas(c), iguales ? `${plural(puertas.length, 'puerta', 'puertas')} de ${fmtCm(puertas[0].ancho)} cm` : '']
    .filter(Boolean).join(' · ');
}

/** Modelos de puerta presentes en el frente (el de cada puerta o el del frente). */
export function modelosPuertas(f: Frente): ('moldurada' | 'lisa')[] {
  const m = new Set<'moldurada' | 'lisa'>();
  for (const p of f.piezas) if (p.tipo === 'puerta') m.add(p.modelo ?? f.modelo);
  return [...m];
}

/** «Puertas abatibles lisas · Blanco Soft III»: el acabado tal cual viene en el esquema (sin plurales ni mayúsculas cambiadas). */
export function descripcionFrente(f: Frente): string {
  const modelos = modelosPuertas(f);
  const modelo = modelos.length > 1 ? 'molduradas y lisas' : (modelos[0] ?? f.modelo) === 'moldurada' ? 'molduradas' : 'lisas';
  return [
    'Puertas',
    ({ abatible: 'abatibles', corredera: 'correderas', coplanar: 'coplanares', escamoteable: 'escamoteables' } as Record<string, string>)[f.apertura] ?? 'abatibles',
    modelo
  ].join(' ') + (f.acabado && f.acabado.trim() ? ` · ${f.acabado.trim()}` : '');
}

/** Lado del tirador de cada pieza: por parejas desde la izquierda; la última puerta suelta, hacia su vecina. */
export function ladosTirador(piezas: PiezaFrente[]): (('izq' | 'der') | null)[] {
  const out: (('izq' | 'der') | null)[] = piezas.map(() => null);
  let grupo: number[] = [];
  const cerrar = () => {
    for (let i = 0; i + 1 < grupo.length; i += 2) { out[grupo[i]] = 'der'; out[grupo[i + 1]] = 'izq'; }
    if (grupo.length % 2 === 1) out[grupo[grupo.length - 1]] = grupo.length > 1 ? 'izq' : 'der';
    grupo = [];
  };
  piezas.forEach((p, i) => { if (p.tipo === 'puerta') grupo.push(i); else cerrar(); });
  cerrar();
  piezas.forEach((p, i) => { if (p.tipo === 'puerta' && p.tirador) out[i] = p.tirador; });
  return out;
}

// ── Sección y planta: geometría ─────────────────────────────────────
/** Fondo del cuerpo sin puertas (D) y grosor de puerta (gp). Correderas: dos planos de puertas. */
export function fondosCuerpo(c: Cuerpo): { D: number; gp: number } {
  const gp = c.grosor ?? GROSOR_DEF;
  const D = c.frente.apertura === 'corredera' ? c.fondo - 2 * gp - ESTILO.corredera_holgura : c.fondo - gp;
  return { D, gp };
}

/** Módulos con el mismo interior comparten sección: [[0, 2], [1]]. */
export function gruposSeccion(c: Cuerpo): number[][] {
  const grupos = new Map<string, number[]>();
  c.modulos.forEach((m, i) => {
    const k = JSON.stringify(m.interior);
    grupos.set(k, [...(grupos.get(k) ?? []), i]);
  });
  return [...grupos.values()];
}

type V2 = [number, number];
export interface CuerpoPlanta { c: Cuerpo; o: V2; u: V2; v: V2; D: number; gp: number; lado: 'izq' | 'der' }
/**
 * Colocación en planta (cm; y hacia la habitación). El primer cuerpo va con la
 * trasera en y = 0; «linea» sigue al anterior alineado por detrás; las esquinas
 * se apoyan en los extremos de la fila principal (cuerpo 0 + los que van en
 * línea tras él): giradas 90°, arrancando en su frente y enrasadas por fuera.
 * `lado`: dónde va la cota de fondo (el extremo libre del cuerpo).
 */
export function geometriaPlanta(a: Armario): { cuerpos: CuerpoPlanta[]; caja: { x0: number; y0: number; x1: number; y1: number } } {
  const out: CuerpoPlanta[] = [];
  const mas = (p: V2, k: number, d: V2): V2 => [p[0] + k * d[0], p[1] + k * d[1]];
  const neg = (d: V2): V2 => [-d[0] || 0, -d[1] || 0];
  let finFila = 0;
  a.cuerpos.forEach((c, i) => {
    const col = i === 0 ? 'linea' : c.colocacion ?? 'linea';
    const { D, gp } = fondosCuerpo(c);
    if (i === 0) { out.push({ c, o: [0, 0], u: [1, 0], v: [0, 1], D, gp, lado: 'izq' }); return; }
    if (col === 'linea') {
      const prev = out[i - 1];
      if (finFila === i - 1) finFila = i;
      out.push({ c, o: mas(prev.o, prev.c.ancho, prev.u), u: prev.u, v: prev.v, D, gp, lado: 'der' });
    } else if (col === 'esquina_der') {
      const ref = out[finFila];
      out.push({ c, o: mas(mas(ref.o, ref.c.ancho, ref.u), ref.c.fondo, ref.v), u: ref.v, v: neg(ref.u), D, gp, lado: 'der' });
    } else {
      const ref = out[0];
      out.push({ c, o: mas(ref.o, ref.c.fondo + c.ancho, ref.v), u: neg(ref.v), v: ref.u, D, gp, lado: 'izq' });
    }
  });
  // Caja: cuerpos, barrido de puertas y cotas
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pt = (q: CuerpoPlanta, uu: number, vv: number) => {
    const p = mas(mas(q.o, uu, q.u), vv, q.v);
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  };
  const E = ESTILO;
  for (const q of out) {
    const { c } = q;
    pt(q, 0, -E.planta_cota - 6); pt(q, c.ancho, -E.planta_cota - 6);
    pt(q, q.lado === 'izq' ? -E.planta_cota - 6 : c.ancho + E.planta_cota + 6, 0);
    const giro = c.frente.apertura === 'abatible' || c.frente.apertura === 'escamoteable';
    const maxPuerta = Math.max(0, ...c.frente.piezas.filter((p) => p.tipo === 'puerta').map((p) => p.ancho));
    pt(q, 0, c.fondo + (giro ? maxPuerta : E.planta_simbolo + 2)); pt(q, c.ancho, c.fondo + (giro ? maxPuerta : E.planta_simbolo + 2));
  }
  return { cuerpos: out, caja: { x0, y0, x1, y1 } };
}

/** Qué entra en una página: interior + cerrado, secciones y/o planta. */
interface Composicion { principal: boolean; lateral: boolean; planta: boolean }
const SOLO_PRINCIPAL: Composicion = { principal: true, lateral: false, planta: false };

function anchoFila(a: Armario, o: Composicion): number {
  let w = 0, primero = true;
  const gap = (g: number) => { if (!primero) w += g; primero = false; };
  for (const c of a.cuerpos) {
    if (o.principal) { gap(ESTILO.hueco_cuerpos); w += c.ancho * 2 + ESTILO.hueco_vistas; }
    if (o.lateral) gruposSeccion(c).forEach((_, j) => { gap(j === 0 ? ESTILO.hueco_cuerpos : ESTILO.hueco_vistas); w += c.fondo; });
  }
  if (o.planta) { const k = geometriaPlanta(a).caja; gap(ESTILO.hueco_cuerpos); w += k.x1 - k.x0; }
  return w;
}

function escala(a: Armario, o: Composicion, formato: Hoja): number {
  const pg = paginaDe(formato), E = ESTILO;
  const altoMax = Math.max(...a.cuerpos.map((c) => c.alto));
  const k = o.planta ? geometriaPlanta(a).caja : null;
  const alto = Math.max(o.principal || o.lateral ? altoMax : 0, k ? k.y1 - k.y0 : 0);
  return Math.min((pg.mr - pg.ml) / (anchoFila(a, o) + E.margen_izq_cm + E.margen_der_cm), (pg.h * ALTO_UTIL) / alto);
}

// ── Lámina ──────────────────────────────────────────────────────────
export function laminasProyecto(p: Proyecto, medir: Medir = medirAprox): Lamina[] {
  return [...p.armarios.flatMap((a) => laminasArmario(a, p, medir)), ...(p.cocinas ?? []).flatMap((c) => laminasCocina(c, p, medir))];
}


/** Láminas para el presupuesto: las de cada armario y, en cocinas, una por tramo (código de su partida). */
/**
 * Láminas para el presupuesto, una por fila de dibujos a todo el ancho: interior +
 * cerrado juntos y, si hay vistas, sección + planta en una segunda fila. En cocinas,
 * una fila por tramo (código de su partida) y sección + planta bajo la última.
 */
export function laminasPresupuesto(p: Proyecto, medir: Medir = medirAprox): Lamina[] {
  const armarios = p.armarios.flatMap((a) => {
    const lateral = !!a.vistas?.includes('lateral'), planta = !!a.vistas?.includes('planta');
    const extra: Composicion = { principal: false, lateral, planta };
    // Todas las vistas del armario a la misma escala: la de la fila que más reduce
    const s = Math.min(escala(a, SOLO_PRINCIPAL, 'PRES'), lateral || planta ? escala(a, extra, 'PRES') : Infinity);
    const filas = [laminaArmario(a, p, medir, SOLO_PRINCIPAL, true, s)];
    if (lateral || planta) filas.push(laminaArmario(a, p, medir, extra, true, s));
    return filas.map((l) => ({ ...l, grupo: a.codigo }));
  });
  return [...armarios, ...(p.cocinas ?? []).flatMap((c) => laminasCocinaPresupuesto(c, p, medir, true))];
}
/** Tamaño de una fila de dibujo en el presupuesto: a todo el ancho, sin pasar del alto máximo, en proporción. */
export function escalaFila(caja: { w: number; h: number }): number {
  return Math.min(FILA_DIBUJO.ancho / caja.w, FILA_DIBUJO.alto / caja.h);
}
/**
 * Reducción de cada fila: la menor de su grupo (mismo armario / cocina), para que
 * todas las vistas salgan a la misma escala (la planta nunca más grande que el alzado).
 */
export function escalasPorGrupo<T extends { caja: { w: number; h: number }; grupo?: string; codigo: string }>(filas: T[]): Map<T, number> {
  const min = new Map<string, number>();
  for (const f of filas) { const g = grupoDibujo(f); min.set(g, Math.min(min.get(g) ?? Infinity, escalaFila(f.caja))); }
  return new Map(filas.map((f) => [f, min.get(grupoDibujo(f))!]));
}
/** Grupo de una fila por la clave de su partida: «v2:A.01» → «v2:A.01»; tramos de cocina «v1:C.01.2» → «v1:C.01». */
export function grupoDibujo(f: { grupo?: string; codigo: string }): string {
  return f.grupo ?? f.codigo.replace(/^((?:v\d+:)?[AC]\.\d+).*$/, '$1');
}

/** Láminas de un armario: una, o dos si la sección / planta no caben con el alzado. */
export function laminasArmario(a: Armario, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir = medirAprox): Lamina[] {
  const lateral = !!a.vistas?.includes('lateral'), planta = !!a.vistas?.includes('planta');
  if (!lateral && !planta) return [laminaArmario(a, p, medir)];
  const formato = formatoArmario(a);
  const todo: Composicion = { principal: true, lateral, planta };
  if (escala(a, todo, formato) >= ESTILO.vistas_minimo * escala(a, SOLO_PRINCIPAL, formato)) return [laminaArmario(a, p, medir, todo)];
  return [laminaArmario(a, p, medir), laminaArmario(a, p, medir, { principal: false, lateral, planta })];
}

export function laminaArmario(a: Armario, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir = medirAprox, comp: Composicion = SOLO_PRINCIPAL, presupuesto = false, escalaFija?: number): Lamina {
  const formato: Hoja = presupuesto ? 'PRES' : formatoArmario(a);
  const pg = paginaDe(formato);
  const prims: Prim[] = [];
  const E = ESTILO;

  // Escala: el conjunto cabe en el ancho útil y el cuerpo más alto en ALTO_UTIL
  // (la página extra no amplía más que la principal).
  const anchoCm = anchoFila(a, comp);
  const altoMax = Math.max(...a.cuerpos.map((c) => c.alto));
  const s = escalaFija ?? (comp.principal ? escala(a, comp, formato) : Math.min(escala(a, comp, formato), escala(a, SOLO_PRINCIPAL, formato)));
  const cm = (v: number) => v * s;
  const centro = (pg.ml + pg.mr) / 2;
  let x = centro - cm(anchoCm) / 2 + cm(E.margen_izq_cm - E.margen_der_cm) / 2;
  const suelo = pg.h * CENTRO_VERTICAL + cm(altoMax) / 2;
  let primero = true;
  const separar = (g: number) => { if (!primero) x += cm(g); primero = false; };

  // ── helpers de dibujo ──
  const rect = (x0: number, y0: number, w: number, h: number, o: Partial<Extract<Prim, { k: 'rect' }>> = {}) =>
    prims.push({ k: 'rect', x: x0, y: y0, w, h, ...o });
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number) =>
    prims.push({ k: 'line', x1, y1, x2, y2, stroke, sw });
  const text = (x0: number, y0: number, t: string, size: number, color: string, anchor: 'start' | 'middle' | 'end' = 'start', bold = false, vertical = false) =>
    prims.push({ k: 'text', x: x0, y: y0, t, size, color, anchor, bold, vertical });
  const tablero = (x0: number, y0: number, w: number, h: number) =>
    rect(x0, y0, w, h, { fill: E.tablero, stroke: E.tinta, sw: 0.8 });

  function etiqueta(cx: number, cy: number, t: string, size = 7.5, caja = true, color: string = E.etiqueta) {
    const lineas = t.split('\n');
    const lh = size * 1.21;
    const w = Math.max(...lineas.map((l) => medir(l, size, false)));
    const h = size * 1.53 + (lineas.length - 1) * lh;
    if (caja) rect(cx - w / 2 - 1.2, cy - h / 2, w + 2.4, h, { fill: '#ffffff', opacity: 0.85 });
    lineas.forEach((l, i) => text(cx, cy - ((lineas.length - 1) * lh) / 2 + i * lh + 0.3635 * size, l, size, color, 'middle'));
  }

  function cotaH(xa: number, xb: number, y: number, t: string) {
    const c = E.cota;
    line(xa, y - 4.6, xa, y + 4.6, c, 0.7);
    line(xb, y - 4.6, xb, y + 4.6, c, 0.7);
    const a = xa + 0.8, b = xb - 0.8;
    line(a, y, b, y, c, 0.7);
    line(a, y, a + 4, y - 2, c, 0.7); line(a, y, a + 4, y + 2, c, 0.7);
    line(b, y, b - 4, y - 2, c, 0.7); line(b, y, b - 4, y + 2, c, 0.7);
    text((xa + xb) / 2, y - 6.9, t, 7.5, c, 'middle');
  }
  function cotaV(x0: number, ya: number, yb: number, t: string) {
    const c = E.cota;
    line(x0 - 4.6, ya, x0 + 4.6, ya, c, 0.7);
    line(x0 - 4.6, yb, x0 + 4.6, yb, c, 0.7);
    const a = ya + 0.8, b = yb - 0.8;
    line(x0, a, x0, b, c, 0.7);
    line(x0, a, x0 - 2, a + 4, c, 0.7); line(x0, a, x0 + 2, a + 4, c, 0.7);
    line(x0, b, x0 - 2, b - 4, c, 0.7); line(x0, b, x0 + 2, b - 4, c, 0.7);
    text(x0 - 6.9, (ya + yb) / 2, t, 7.5, c, 'middle', false, true);
  }
  /** Cota pequeña (hueco de mano, tapeta): marcas oblicuas sin flechas y el texto al lado. */
  function cotaMini(xa: number, ya: number, xb: number, yb: number, t: string, lado: 'izq' | 'der' | 'arriba' = 'der') {
    const c = E.cota, vertical = Math.abs(xa - xb) < 0.01;
    line(xa, ya, xb, yb, c, 0.5);
    for (const [px, py] of [[xa, ya], [xb, yb]]) {
      line(px - 1.4, py + 1.4, px + 1.4, py - 1.4, c, 0.6);
      if (vertical) line(px - 2.5, py, px + 2.5, py, c, 0.4); else line(px, py - 2.5, px, py + 2.5, c, 0.4);
    }
    const mx = (xa + xb) / 2, my = (ya + yb) / 2, w = medir(t, 6, false);
    const tx = lado === 'arriba' ? mx : lado === 'der' ? Math.max(xa, xb) + 2.5 + w / 2 : Math.min(xa, xb) - 2.5 - w / 2;
    const ty = lado === 'arriba' ? Math.min(ya, yb) - 4.5 : my;
    etiqueta(tx, ty, t, 6, true, c);
  }

  // ── Cabecera y pie ──
  const logoAlto = (LOGO_ANCHO_PT * LOGO_ALTO) / LOGO_ANCHO;
  prims.push({ k: 'logo', x: pg.logo[0], y: pg.logo[1] + LOGO_CAJA_ALTO - logoAlto, h: logoAlto, color: E.tinta });
  text(pg.ml, pg.titulo, `${a.codigo}  ${a.titulo}`, 11, E.tinta, 'start', true);
  text(pg.ml, pg.subtitulo, a.subtitulo ?? subtituloAuto(a), 9, E.subtitulo);
  const cabecera = [comp.principal ? 'ALZADO INTERIOR + FRENTE CERRADO' : '', comp.lateral ? 'SECCIÓN LATERAL' : '', comp.planta ? 'PLANTA' : ''].filter(Boolean).join(' + ');
  text(pg.mr, pg.der1, cabecera, 8, E.cota, 'end');
  text(pg.mr, pg.der2, `${descripcionFrente(a.cuerpos[0].frente)} · cotas en cm`, 8, E.cota, 'end');
  const pie = [p.referencia ? `Presupuesto ${p.referencia}` : '', p.cliente ?? ''].filter(Boolean).join(' · ');
  if (pie) text(pg.mr, pg.pie, pie, 7.5, E.suave, 'end');
  if (a.notas) text(pg.ml, pg.pie, a.notas, 7.5, E.suave);
  const inicioDibujo = prims.length;

  // ── Vistas ──
  a.cuerpos.forEach((c) => {
    const prefijo = c.nombre ? `${c.nombre} · ` : '';
    if (comp.principal) vistasPrincipales(c, prefijo);
    if (comp.lateral) gruposSeccion(c).forEach((mods, j) => {
      separar(j === 0 ? E.hueco_cuerpos : E.hueco_vistas);
      seccion(c, mods, j === 0, prefijo);
    });
  });
  if (comp.planta) { separar(E.hueco_cuerpos); vistaPlanta(); }

  function vistasPrincipales(c: Cuerpo, prefijo: string) {
    separar(E.hueco_cuerpos);
    const z = c.zocalo ?? ZOCALO_DEF;
    const g = c.grosor ?? GROSOR_DEF;
    const W = cm(c.ancho);
    const arriba = suelo - cm(c.alto);
    const baseCuerpo = suelo - cm(z);

    // ── Interior ──
    const x0 = x;
    let mx = x0;
    const capas: { fondo: (() => void)[]; tableros: (() => void)[]; dentro: (() => void)[] } = { fondo: [], tableros: [], dentro: [] };
    c.modulos.forEach((m) => {
      const mw = cm(m.ancho);
      const mx0 = mx;
      capas.fondo.push(() => {
        rect(mx0, arriba, mw, baseCuerpo - arriba, { fill: E.fondoInterior });
        if (z > 0) rect(mx0 + cm(g), baseCuerpo, mw - 2 * cm(g), cm(z), { fill: E.zocalo, stroke: E.tinta, sw: 0.6 });
      });
      const ix0 = mx0 + cm(g), ix1 = mx0 + mw - cm(g), iw = ix1 - ix0;
      const reparto = repartoZonas(m.interior, { alto: c.alto, zocalo: z, grosor: g });
      capas.tableros.push(() => {
        tablero(mx0, arriba, cm(g), baseCuerpo - arriba);
        tablero(mx0 + mw - cm(g), arriba, cm(g), baseCuerpo - arriba);
        tablero(ix0, arriba, iw, cm(g));
        tablero(ix0, baseCuerpo - cm(g), iw, cm(g));
        reparto.zonas.forEach((zm) => {
          if (zm.balda_encima) tablero(ix0, arriba + cm(zm.arriba - zm.balda_encima), iw, cm(zm.balda_encima));
        });
      });
      const percheros = m.interior.filter((zz) => zz.tipo === 'perchero').length;
      let nPerchero = 0;
      reparto.zonas.forEach((zm) => {
        const zt = arriba + cm(zm.arriba);
        const zb = zt + cm(zm.libre);
        const cx = (ix0 + ix1) / 2;
        const zona: Zona = zm.zona;
        switch (zona.tipo) {
          case 'altillo':
            capas.dentro.push(() => etiqueta(cx, (zt + zb) / 2, zona.etiqueta ?? 'ALTILLO'));
            break;
          case 'perchero':
          case 'perchero_extraible': {
            const largas = zona.tipo === 'perchero_extraible' || zona.prendas === 'largas';
            let t = zona.etiqueta;
            if (!t) {
              if (zona.tipo === 'perchero_extraible') t = 'Perchero extraíble\nprendas largas';
              else {
                nPerchero++;
                t = percheros === 1 ? 'Barra de colgar'
                  : percheros === 2 ? (nPerchero === 1 ? 'Perchero superior' : 'Perchero inferior')
                  : `Perchero ${nPerchero}`;
              }
            }
            const etiquetaFinal = t;
            capas.dentro.push(() => {
              const by = zt + cm(E.barra_bajo_balda);
              const py = by + cm(E.prenda_arriba);
              const largo = Math.min(0.95 * (zb - py), cm(largas ? E.prenda_larga_max : E.prenda_corta_max));
              const n = Math.max(1, Math.floor((m.ancho - 2 * g - 2 * E.percha_primera) / E.percha_paso) + 1);
              for (let i = 0; i < n; i++) {
                const px = ix0 + cm(E.percha_primera + i * E.percha_paso);
                if (px > ix1 - cm(1)) break;
                line(px, by - cm(E.gancho_arriba), px, by + cm(E.gancho_abajo), E.gancho, 0.6);
                const ta = cm(E.prenda_ancho_arriba) / 2, tb = cm(E.prenda_ancho_abajo) / 2;
                prims.push({ k: 'poly', pts: [[px - ta, py], [px + ta, py], [px + tb, py + largo], [px - tb, py + largo]], fill: E.prenda, stroke: E.prendaBorde, sw: 0.4, opacity: 0.35 });
              }
              line(ix0 + cm(E.barra_margen), by, ix1 - cm(E.barra_margen), by, E.barra, 2.2);
              etiqueta(cx, py + largo * E.prenda_etiqueta, etiquetaFinal);
            });
            break;
          }
          case 'cajonera': {
            const n = zona.cajones;
            const tap = tapetasCajonera(zona, c.frente.apertura), hm = huecoMano(zona);
            // Tapetas laterales (para las bisagras de las puertas abatibles): de la balda de arriba a la de abajo
            if (tap > 0) capas.tableros.push(() => {
              tablero(ix0, zt, cm(tap), zb - zt);
              tablero(ix1 - cm(tap), zt, cm(tap), zb - zt);
            });
            capas.dentro.push(() => {
              const h = (zm.libre - E.cajon_holgura * 2 - (n - 1) * E.cajon_separacion) / n;
              const abierto = zona.frente === 'abierto', escote = abierto && zona.abierto === 'escote';
              const ag = hm ? 'ninguno' : zona.agarre ?? 'tirador';
              const cx0 = ix0 + cm(tap), cw = iw - 2 * cm(tap);
              for (let i = 0; i < n; i++) {
                const dy = zt + cm(E.cajon_holgura + i * (h + E.cajon_separacion));
                const x0c = cx0 + cm(E.cajon_holgura) / 1.5, wc = cw - (2 * cm(E.cajon_holgura)) / 1.5, hc = cm(h);
                let topFrente = dy;
                if (hm) {
                  // Hueco de mano: frente completo con el hueco libre encima
                  topFrente = dy + cm(Math.min(hm, h - 1));
                  rect(x0c, dy, wc, topFrente - dy, { fill: E.fondoInterior, stroke: E.suave, sw: 0.3 });
                  rect(x0c, topFrente, wc, dy + hc - topFrente, { fill: E.cajon, stroke: E.tinta, sw: 0.8 });
                  if (i === 0) cotaMini(x0c + wc - cm(4), dy, x0c + wc - cm(4), topFrente, fmtCm(hm), 'izq');
                } else if (!abierto) rect(x0c, dy, wc, hc, { fill: E.cajon, stroke: E.tinta, sw: 0.8 });
                else {
                  // Cajón interior: se ve el hueco y la caja del cajón por encima del frente
                  rect(x0c, dy, wc, hc, { fill: E.fondoInterior, stroke: E.tinta, sw: 0.4 });
                  rect(x0c + cm(1.5), dy + hc * 0.12, wc - cm(3), hc * 0.88, { fill: E.cajonInterior, stroke: E.suave, sw: 0.4 });
                  if (escote) {
                    const ew = wc * E.cajon_escote_ancho, ex = x0c + (wc - ew) / 2, ed = hc * E.cajon_escote;
                    prims.push({ k: 'poly', pts: [[x0c, dy], [ex, dy], [ex, dy + ed], [ex + ew, dy + ed], [ex + ew, dy], [x0c + wc, dy], [x0c + wc, dy + hc], [x0c, dy + hc]], fill: E.cajon, stroke: E.tinta, sw: 0.8 });
                    topFrente = dy + ed;
                  } else {
                    topFrente = dy + hc * (1 - E.cajon_frente_bajo);
                    rect(x0c, topFrente, wc, dy + hc - topFrente, { fill: E.cajon, stroke: E.tinta, sw: 0.8 });
                  }
                }
                // Agarre propio de los cajones (con escote, el escote ya es el agarre si no se pide otro)
                if (ag === 'tirador' && !escote) {
                  const tl = Math.min(cm(E.cajon_tirador), cw * 0.4);
                  const ty = Math.min(topFrente + cm(E.cajon_tirador_baja), dy + hc - 2);
                  line(cx - tl / 2, ty, cx + tl / 2, ty, E.tinta, 1.2);
                } else if (ag === 'unero') {
                  rect(x0c + 0.4, topFrente + 0.4, wc - 0.8, Math.min(2.2, hc * 0.2), { fill: E.uneroDm, stroke: E.tinta, sw: 0.3 });
                }
              }
              if (tap > 0) cotaMini(ix0, zb - cm(4), ix0 + cm(tap), zb - cm(4), fmtCm(tap), 'der');
              const t = zona.etiqueta ?? `Cajonera ${plural(n, 'cajón', 'cajones')}${hm ? ' con hueco de mano' : abierto ? (escote ? ' abiertos con escote' : ' (zapatero abierto)') : ''}${hm ? '' : ag === 'ninguno' ? ' sin tirador' : ag === 'unero' ? ' con uñero' : ''}`;
              const cy = zm.balda_encima ? zt - cm(zm.balda_encima) - (7 * 1.53) / 2 : zt + 7;
              etiqueta(cx, cy, t, 7);
            });
            break;
          }
          case 'estantes': {
            const n = zona.estantes, ge = zm.grosor_estantes ?? g, hueco = zm.hueco_estantes ?? (zm.libre - n * g) / (n + 1);
            capas.tableros.push(() => {
              for (let i = 1; i <= n; i++) tablero(ix0, zt + cm(i * hueco + (i - 1) * ge), iw, cm(ge));
            });
            const medio = Math.floor(n / 2);
            const cy = zt + cm(medio * (hueco + ge) + hueco / 2);
            capas.dentro.push(() => etiqueta(cx, cy, zona.etiqueta ?? etiquetaEstantes(ge, g)));
            break;
          }
          case 'balda_inferior':
            capas.dentro.push(() => etiqueta(cx, (zt + zb) / 2, zona.etiqueta ?? 'Balda inferior'));
            break;
          case 'hueco':
            if (zona.etiqueta) { const t = zona.etiqueta; capas.dentro.push(() => etiqueta(cx, (zt + zb) / 2, t)); }
            break;
        }
      });
      mx += mw;
    });
    capas.fondo.forEach((f) => f());
    line(x0 - cm(E.suelo_extra), suelo, x0 + W + cm(E.suelo_extra), suelo, E.tinta, 1.2);
    capas.tableros.forEach((f) => f());
    capas.dentro.forEach((f) => f());

    // Cotas del interior
    cotaH(x0, x0 + W, arriba - cm(E.cota_arriba), `${fmtCm(c.ancho)} cm`);
    let cx0 = x0;
    c.modulos.forEach((m) => { cotaH(cx0, cx0 + cm(m.ancho), suelo + cm(E.cota_abajo), fmtCm(m.ancho)); cx0 += cm(m.ancho); });
    cotaV(x0 - cm(E.cota_alto), arriba, suelo, `${fmtCm(c.alto)} cm`);
    const conAltillo = c.modulos.find((m) => m.interior[0]?.tipo === 'altillo');
    const altillo = conAltillo?.interior[0];
    if (altillo && altillo.tipo === 'altillo') {
      cotaV(x0 - cm(E.cota_altillo), arriba, arriba + cm(altillo.alto), `altillo ${fmtCm(altillo.alto)}`);
    }
    text(x0 + W / 2, suelo + cm(E.pie_vista), `${prefijo}INTERIOR`, 8.5, E.tinta, 'middle', true);

    // ── Frente cerrado ──
    x += W + cm(E.hueco_vistas);
    const f0 = x;
    const f = c.frente;
    const sep = f.separacion_suelo ?? SEPARACION_SUELO_DEF;
    const bajo = suelo - cm(sep);
    if (sep > 0) rect(f0 + cm(E.zocalo_frente_margen), bajo, W - 2 * cm(E.zocalo_frente_margen), cm(sep), { fill: E.zocalo });
    line(f0 - cm(E.suelo_extra), suelo, f0 + W + cm(E.suelo_extra), suelo, E.tinta, 1.2);
    const lados = ladosTirador(f.piezas);
    let px = f0;
    // Líneas diagonales recortadas a un rectángulo (rejilla de ratán)
    const diagonales = (x0: number, y0: number, w: number, h: number, paso: number, color: string, sw: number) => {
      for (const dir of [1, -1]) {
        const c0 = dir === 1 ? x0 - (y0 + h) : x0 + y0, c1 = dir === 1 ? x0 + w - y0 : x0 + w + y0 + h;
        for (let c = c0 + paso / 2; c < c1; c += paso) {
          const pts: [number, number][] = [];
          const yIzq = dir === 1 ? x0 - c : c - x0, yDer = dir === 1 ? x0 + w - c : c - x0 - w;
          const xArr = dir === 1 ? y0 + c : c - y0, xAbj = dir === 1 ? y0 + h + c : c - y0 - h;
          if (yIzq >= y0 && yIzq <= y0 + h) pts.push([x0, yIzq]);
          if (yDer >= y0 && yDer <= y0 + h) pts.push([x0 + w, yDer]);
          if (xArr > x0 && xArr < x0 + w) pts.push([xArr, y0]);
          if (xAbj > x0 && xAbj < x0 + w) pts.push([xAbj, y0 + h]);
          if (pts.length >= 2) line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], color, sw);
        }
      }
    };
    f.piezas.forEach((pz, i) => {
      const pw = cm(pz.ancho);
      const d0 = px + cm(E.puerta_holgura), d1 = px + pw - cm(E.puerta_holgura);
      const mat = materialPieza(f, pz);
      const fondo = mat === 'textil' ? E.textil : mat === 'ratan' ? E.ratan : mat === 'chapa_madera' ? E.chapa : E.puerta;
      rect(d0, arriba, d1 - d0, bajo - arriba, { fill: fondo, stroke: E.tinta, sw: 0.9 });
      if (mat === 'textil') {
        // Trama de tela (bastidor tapizado)
        const ins = cm(2.5), paso = cm(2.2);
        for (let yy = arriba + ins; yy < bajo - ins; yy += paso) line(d0 + ins, yy, d1 - ins, yy, E.tramaTextil, 0.3);
        for (let xx = d0 + ins; xx < d1 - ins; xx += paso) line(xx, arriba + ins, xx, bajo - ins, E.tramaTextil, 0.3);
        rect(d0 + ins, arriba + ins, d1 - d0 - 2 * ins, bajo - arriba - 2 * ins, { stroke: E.tinta, sw: 0.5 });
      } else if (mat === 'ratan') {
        // Bastidor de madera + rejilla
        const ins = cm(5);
        rect(d0 + ins, arriba + ins, d1 - d0 - 2 * ins, bajo - arriba - 2 * ins, { stroke: E.tinta, sw: 0.8 });
        diagonales(d0 + ins, arriba + ins, d1 - d0 - 2 * ins, bajo - arriba - 2 * ins, cm(3.2), E.rejilla, 0.35);
      }
      const altoPuerta = c.alto - sep;
      const travesano = bajo - cm(altoPuerta * E.travesano_altura);
      if (pz.tipo === 'fijo') {
        // Etiqueta del frente fijo: dentro si cabe (en horizontal o en vertical); si no, fuera con línea de referencia
        const t = pz.etiqueta ?? 'FRENTE FIJO\nLISO';
        const lineas = t.split('\n'), wTxt = Math.max(...lineas.map((l) => medir(l, 6.5, false)));
        const cxp = (d0 + d1) / 2, cyp = (arriba + bajo) / 2, una = lineas.join(' ');
        if (wTxt + 4 <= d1 - d0) etiqueta(cxp, cyp, t, 6.5, false, E.suave);
        else if (d1 - d0 >= 9 && medir(una, 6.5, false) + 8 <= bajo - arriba) text(cxp + 2.3, cyp, una, 6.5, E.suave, 'middle', false, true);
        else if (i === 0) { line(d0, cyp, d0 - 12, cyp, E.cota, 0.5); text(d0 - 14, cyp + 2.3, una, 6.5, E.suave, 'end'); }
        else if (i === f.piezas.length - 1) { line(d1, cyp, d1 + 12, cyp, E.cota, 0.5); text(d1 + 14, cyp + 2.3, una, 6.5, E.suave, 'start'); }
        else { line(cxp, arriba, cxp, arriba - 7, E.cota, 0.5); text(cxp, arriba - 9, una, 6, E.suave, 'middle'); }
      } else {
        if (mat === 'moldurada_lacada' || (!pz.material && !f.material && (pz.modelo ?? f.modelo) === 'moldurada')) {
          const mg = cm(pz.ancho * E.moldura), mi = cm(pz.ancho * E.moldura_interior);
          const tr = cm(E.travesano) / 2;
          const paneles: [number, number][] = [[arriba + mg, travesano - tr], [travesano + tr, bajo - mg]];
          for (const [ya, yb] of paneles) {
            if (yb - ya < cm(5)) continue;
            rect(d0 + mg, ya, d1 - d0 - 2 * mg, yb - ya, { stroke: E.tinta, sw: 0.9 });
            rect(d0 + mg + mi, ya + mi, d1 - d0 - 2 * mg - 2 * mi, yb - ya - 2 * mi, { stroke: E.tinta, sw: 0.5 });
          }
        }
        const lado = lados[i];
        const ag = agarrePuerta(f, pz);
        if (lado && (ag === 'unero_dm' || ag === 'unero_madera')) {
          // Uñero: ranura en el canto de apertura, sin tirador
          // (dibujado a 3 cm para que se lea a escala; la ranura es la línea interior)
          const uw = cm(3), ux = lado === 'der' ? d1 - uw : d0;
          rect(ux, arriba, uw, bajo - arriba, { fill: ag === 'unero_madera' ? E.uneroMadera : E.uneroDm, stroke: E.tinta, sw: 0.5 });
          const rx = lado === 'der' ? ux + uw * 0.35 : ux + uw * 0.65;
          line(rx, arriba + cm(2), rx, bajo - cm(2), E.tinta, 0.6);
        } else if (lado && (ag === 'tirador' || ag === 'tirador_premium')) {
          const tx = lado === 'der' ? px + pw - cm(E.tirador_borde) : px + cm(E.tirador_borde);
          const [fc, bc] = ag === 'tirador_premium' ? [E.laton, E.latonBorde] : [E.acero, E.aceroBorde];
          rect(tx - cm(E.tirador_ancho) / 2, travesano - cm(E.tirador_alto) / 2, cm(E.tirador_ancho), cm(E.tirador_alto), { fill: fc, stroke: bc, sw: 0.5 });
          if (ag === 'tirador_premium') rect(tx - cm(E.cruz_ancho) / 2, travesano - cm(E.cruz_alto) / 2, cm(E.cruz_ancho), cm(E.cruz_alto), { fill: fc, stroke: bc, sw: 0.5 });
        }
      }
      px += pw;
    });
    if (sep > 0) text(f0 + W + cm(E.suelo_extra) + cm(E.suelo_texto_dx), suelo - cm(E.suelo_texto_dy), `${fmtCm(sep)} cm a suelo`, 6.5, E.cota);
    cotaH(f0, f0 + W, arriba - cm(E.cota_arriba), `${fmtCm(c.ancho)} cm`);
    let fx = f0;
    f.piezas.forEach((pz) => { cotaH(fx, fx + cm(pz.ancho), suelo + cm(E.cota_abajo), fmtCm(pz.ancho)); fx += cm(pz.ancho); });
    const nPuertas = f.piezas.filter((pz) => pz.tipo === 'puerta').length;
    const nFijos = f.piezas.length - nPuertas;
    const AP: Record<string, [string, string]> = { corredera: ['corredera', 'correderas'], coplanar: ['coplanar', 'coplanares'], escamoteable: ['escamoteable', 'escamoteables'] };
    const ap = AP[f.apertura] ? ' ' + AP[f.apertura][nPuertas === 1 ? 0 : 1] : '';
    const pieCerrado = `${prefijo}CERRADO · ${plural(nPuertas, 'puerta', 'puertas')}${ap}${nFijos ? ` + ${plural(nFijos, 'frente fijo', 'frentes fijos')}` : ''}`;
    text(f0 + W / 2, suelo + cm(E.pie_vista), pieCerrado, 8.5, E.tinta, 'middle', true);
    x += W;
  }

  // ── Sección lateral de un grupo de módulos (trasera a la izquierda, puertas a la derecha) ──
  function seccion(c: Cuerpo, mods: number[], conCotaAlto: boolean, prefijo: string) {
    const z = c.zocalo ?? ZOCALO_DEF, g = c.grosor ?? GROSOR_DEF;
    const { D, gp } = fondosCuerpo(c);
    const f = c.frente, sep = f.separacion_suelo ?? SEPARACION_SUELO_DEF;
    const m = c.modulos[mods[0]];
    const xb = x, xD = x + cm(D), xF = x + cm(c.fondo);
    const arriba = suelo - cm(c.alto), baseCuerpo = suelo - cm(z), bajo = suelo - cm(sep);
    // Costado (fondo), zócalo retranqueado, suelo
    rect(xb, arriba, xD - xb, baseCuerpo - arriba, { fill: E.fondoInterior, stroke: E.tinta, sw: 0.8 });
    if (z > 0) {
      rect(xb + cm(E.trasera), baseCuerpo, xD - cm(E.zocalo_retranqueo) - xb - cm(E.trasera), cm(z), { fill: E.zocalo, stroke: E.tinta, sw: 0.6 });
      if (cm(z) > 8) text((xb + xD - cm(E.zocalo_retranqueo)) / 2, baseCuerpo + cm(z) / 2 + 2.2, `zócalo ${fmtCm(z)}`, 6, E.cota, 'middle');
    }
    line(xb - cm(E.suelo_extra), suelo, xF + cm(E.suelo_extra), suelo, E.tinta, 1.2);
    // Trasera, techo y base
    tablero(xb, arriba, cm(E.trasera), baseCuerpo - arriba);
    tablero(xb, arriba, xD - xb, cm(g));
    tablero(xb, baseCuerpo - cm(g), xD - xb, cm(g));
    const ix0 = xb + cm(E.trasera), ix1 = xD, iw = ix1 - ix0, cx = (ix0 + ix1) / 2;
    const reparto = repartoZonas(m.interior, { alto: c.alto, zocalo: z, grosor: g });
    const dentro: (() => void)[] = [];
    reparto.zonas.forEach((zm) => {
      const zt = arriba + cm(zm.arriba), zb = zt + cm(zm.libre);
      if (zm.balda_encima) tablero(ix0, zt - cm(zm.balda_encima), iw, cm(zm.balda_encima));
      const zona = zm.zona;
      switch (zona.tipo) {
        case 'altillo': dentro.push(() => etiqueta(cx, (zt + zb) / 2, 'ALTILLO', 6.5)); break;
        case 'perchero':
        case 'perchero_extraible': {
          const largas = zona.tipo === 'perchero_extraible' || zona.prendas === 'largas';
          const by = zt + cm(E.barra_bajo_balda), py = by + cm(E.prenda_arriba);
          const largo = Math.min(0.95 * (zb - py), cm(largas ? E.prenda_larga_max : E.prenda_corta_max));
          // Prenda de perfil (los hombros van en el sentido del fondo)
          const ta = iw * 0.36, tb = iw * 0.42;
          prims.push({ k: 'poly', pts: [[cx - ta, py], [cx + ta, py], [cx + tb, py + largo], [cx - tb, py + largo]], fill: E.prenda, stroke: E.prendaBorde, sw: 0.4, opacity: 0.35 });
          line(cx, by - cm(E.gancho_arriba), cx, py, E.gancho, 0.6);
          if (zona.tipo === 'perchero_extraible') {
            line(ix0 + cm(3), by, ix1 - cm(3), by, E.barra, 2.2);
            dentro.push(() => etiqueta(cx, py + largo * E.prenda_etiqueta, 'Perchero\nextraíble', 6.5));
          } else {
            circulo(cx, by, Math.max(1.6, cm(1.5)), E.barra);
          }
          break;
        }
        case 'cajonera': {
          const n = zona.cajones;
          const h = (zm.libre - E.cajon_holgura * 2 - (n - 1) * E.cajon_separacion) / n;
          const abierto = zona.frente === 'abierto', escote = abierto && zona.abierto === 'escote', hm = huecoMano(zona);
          for (let i = 0; i < n; i++) {
            const dy = zt + cm(E.cajon_holgura + i * (h + E.cajon_separacion));
            rect(ix0 + cm(2), dy + cm(Math.max(h * 0.3, hm + 1)), ix1 - cm(g) - ix0 - cm(2), dy + cm(h) - (dy + cm(Math.max(h * 0.3, hm + 1))), { fill: E.cajon, stroke: E.tinta, sw: 0.6 });
            // Frente de canto: entero; zapatero abierto, solo la parte baja; con escote, entero en los lados y el escote en línea fina; con hueco de mano, bajo el hueco
            const fy = hm ? dy + cm(Math.min(hm, h - 1)) : abierto && !escote ? dy + cm(h * (1 - E.cajon_frente_bajo)) : dy;
            rect(ix1 - cm(g), fy, cm(g), dy + cm(h) - fy, { fill: E.cajon, stroke: E.tinta, sw: 0.8 });
            if (hm && i === 0) cotaMini(ix1 - cm(g) - 3, dy, ix1 - cm(g) - 3, fy, fmtCm(hm), 'izq');
            if (escote) line(ix1 - cm(g), dy + cm(h * E.cajon_escote), ix1, dy + cm(h * E.cajon_escote), E.suave, 0.5);
          }
          break;
        }
        case 'estantes': {
          const n = zona.estantes, ge = zm.grosor_estantes ?? g, hueco = zm.hueco_estantes ?? 0;
          for (let i = 1; i <= n; i++) tablero(ix0, zt + cm(i * hueco + (i - 1) * ge), iw, cm(ge));
          if (Math.abs(ge - g) > 0.05) dentro.push(() => etiqueta(cx, zt + cm(hueco / 2), `${fmtMm(ge)} mm`, 6.5));
          break;
        }
        default: break;
      }
    });
    dentro.forEach((d) => d());
    // Puertas (de canto)
    const fondoPuerta = materialPieza(f, f.piezas[0]) === 'ratan' ? E.ratan : materialPieza(f, f.piezas[0]) === 'textil' ? E.textil : E.puerta;
    rect(xD, arriba, cm(gp), bajo - arriba, { fill: fondoPuerta, stroke: E.tinta, sw: 0.8 });
    if (f.apertura === 'corredera') {
      const x2 = xD + cm(gp + E.corredera_holgura);
      rect(x2, arriba, cm(gp), bajo - arriba, { fill: fondoPuerta, stroke: E.tinta, sw: 0.8 });
      rect(xD, arriba - 2.2, xF - xD, 2.2, { fill: E.acero, stroke: E.aceroBorde, sw: 0.5 });
    }
    text(xF + 8, (arriba + bajo) / 2, `puerta ${fmtMm(gp)} mm · ${fmtCm(sep)} cm a suelo`, 6, E.cota, 'middle', false, true);
    // Cotas
    cotaH(xb, xF, arriba - cm(E.cota_arriba), `${fmtCm(c.fondo)} cm`);
    cotaH(xb, xD, suelo + cm(E.cota_abajo), fmtCm(D));
    if (conCotaAlto) {
      cotaV(xb - cm(E.cota_alto), arriba, suelo, `${fmtCm(c.alto)} cm`);
      const alt = m.interior[0];
      if (alt?.tipo === 'altillo') cotaV(xb - cm(E.cota_altillo), arriba, arriba + cm(alt.alto), `altillo ${fmtCm(alt.alto)}`);
    }
    const nombres = mods.map((i) => i + 1);
    const cual = c.modulos.length === 1 ? '' : nombres.length === 1 ? `módulo ${nombres[0]}` : `módulos ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
    text((xb + xF) / 2, suelo + cm(E.pie_vista), `${prefijo}SECCIÓN`, 8.5, E.tinta, 'middle', true);
    if (cual) text((xb + xF) / 2, suelo + cm(E.pie_vista) + 10, cual, 7.5, E.cota, 'middle');
    x = xF;
  }

  // ── Planta (desde arriba; trasera arriba, puertas abajo) ──
  function vistaPlanta() {
    const geo = geometriaPlanta(a);
    const k = geo.caja;
    const hPlanta = cm(k.y1 - k.y0);
    const top = pg.h * CENTRO_VERTICAL - hPlanta / 2;
    const X = (px: number) => x + cm(px - k.x0), Y = (py: number) => top + cm(py - k.y0);
    for (const q of geo.cuerpos) {
      const { c, D, gp } = q;
      const f = c.frente, g = c.grosor ?? GROSOR_DEF;
      const P = (uu: number, vv: number): V2 => [X(q.o[0] + uu * q.u[0] + vv * q.v[0]), Y(q.o[1] + uu * q.u[1] + vv * q.v[1])];
      const rectL = (u0: number, v0: number, u1: number, v1: number, o: Partial<Extract<Prim, { k: 'rect' }>>) => {
        const [ax, ay] = P(u0, v0), [bx, by] = P(u1, v1);
        rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), o);
      };
      const lineL = (u0: number, v0: number, u1: number, v1: number, color: string, sw: number) => { const [ax, ay] = P(u0, v0), [bx, by] = P(u1, v1); line(ax, ay, bx, by, color, sw); };
      const flechaL = (u0: number, v0: number, u1: number, v1: number) => { const a0 = P(u0, v0), a1 = P(u1, v1); flecha(a0[0], a0[1], a1[0], a1[1]); };
      // Cuerpo y costados de cada módulo
      rectL(0, 0, c.ancho, D, { fill: E.fondoInterior, stroke: E.tinta, sw: 0.8 });
      rectL(0, 0, c.ancho, E.trasera, { fill: E.tablero, stroke: E.tinta, sw: 0.5 });
      let mu = 0;
      for (const m of c.modulos) {
        rectL(mu, 0, mu + g, D, { fill: E.tablero, stroke: E.tinta, sw: 0.6 });
        rectL(mu + m.ancho - g, 0, mu + m.ancho, D, { fill: E.tablero, stroke: E.tinta, sw: 0.6 });
        // Tapetas laterales de la cajonera (la más gruesa del módulo), con su cota
        const tap = Math.max(0, ...m.interior.map((z) => (z.tipo === 'cajonera' ? tapetasCajonera(z, f.apertura) : 0)));
        if (tap > 0) {
          rectL(mu + g, E.trasera, mu + g + tap, D, { fill: E.tablero, stroke: E.tinta, sw: 0.5 });
          rectL(mu + m.ancho - g - tap, E.trasera, mu + m.ancho - g, D, { fill: E.tablero, stroke: E.tinta, sw: 0.5 });
          const [ax, ay] = P(mu + g, D * 0.45), [bx, by] = P(mu + g + tap, D * 0.45);
          cotaMini(ax, ay, bx, by, fmtCm(tap), 'der');
        }
        mu += m.ancho;
      }
      // Puertas y apertura
      const lados = ladosTirador(f.piezas);
      let pu = 0, nPuerta = 0;
      f.piezas.forEach((pz, i) => {
        const w = pz.ancho, mat = materialPieza(f, pz);
        const fondo = mat === 'textil' ? E.textil : mat === 'ratan' ? E.ratan : mat === 'chapa_madera' ? E.chapa : E.puerta;
        let v0 = D;
        if (f.apertura === 'corredera' && pz.tipo === 'puerta' && nPuerta++ % 2 === 1) v0 = D + gp + E.corredera_holgura;
        rectL(pu, v0, pu + w, v0 + gp, { fill: fondo, stroke: E.tinta, sw: 0.8 });
        const lado = lados[i];
        if (pz.tipo === 'puerta' && lado) {
          const bis = lado === 'der' ? pu : pu + w;          // bisagra en el lado contrario al agarre
          const dir = lado === 'der' ? 1 : -1;                // hacia el canto de apertura
          const vF = D + gp;
          if (f.apertura === 'abatible' || f.apertura === 'escamoteable') {
            lineL(bis, vF, bis, vF + w, E.tinta, 0.9);
            const pasos = 14;
            for (let t = 0; t < pasos; t++) {
              const a0 = (t / pasos) * Math.PI / 2, a1 = ((t + 1) / pasos) * Math.PI / 2;
              lineL(bis + dir * w * Math.cos(a0), vF + w * Math.sin(a0), bis + dir * w * Math.cos(a1), vF + w * Math.sin(a1), E.cota, 0.45);
            }
            if (f.apertura === 'escamoteable') {
              // La puerta abierta se esconde en el costado: bolsillo y flecha hacia dentro
              const fondoBolsillo = Math.min(w, D - 3);
              rectL(bis + dir * 0.4, D - fondoBolsillo, bis + dir * (gp + 1.2), D, { stroke: E.suave, sw: 0.5 });
              flechaL(bis + dir * (gp + 3.5), vF + w * 0.55, bis + dir * (gp + 3.5), D - fondoBolsillo * 0.55);
            }
          } else if (f.apertura === 'coplanar') {
            // Sale hacia fuera y desliza hacia su pareja
            const uc = pu + w / 2, sv = vF + E.planta_simbolo * 0.6;
            lineL(uc, vF + 1, uc, sv, E.tinta, 0.6);
            flechaL(uc, sv, uc + dir * w * 0.35, sv);
          } else {
            const sv = vF + E.planta_simbolo * 0.6;
            flechaL(pu + w / 2, sv, pu + w * 0.2, sv);
            flechaL(pu + w / 2, sv, pu + w * 0.8, sv);
          }
        }
        pu += w;
      });
      // Cotas: ancho por detrás, fondo en el extremo libre
      const cota = (u0: number, v0: number, u1: number, v1: number, t: string) => {
        const [ax, ay] = P(u0, v0), [bx, by] = P(u1, v1);
        if (Math.abs(ay - by) < 0.01) cotaH(Math.min(ax, bx), Math.max(ax, bx), ay, t);
        else cotaV(ax, Math.min(ay, by), Math.max(ay, by), t);
      };
      cota(0, -E.planta_cota, c.ancho, -E.planta_cota, `${fmtCm(c.ancho)} cm`);
      const uf = q.lado === 'izq' ? -E.planta_cota : c.ancho + E.planta_cota;
      cota(uf, 0, uf, c.fondo, `fondo ${fmtCm(c.fondo)}`);
      if (a.cuerpos.length > 1 && c.nombre) { const [cxp, cyp] = P(c.ancho / 2, D / 2); etiqueta(cxp, cyp, c.nombre, 6.5); }
    }
    // Con otras vistas en la hoja, el título se alinea con el suelo; la planta sola, justo debajo
    const pie = (comp.principal || comp.lateral ? Math.max(suelo, top + hPlanta) : top + hPlanta) + cm(E.pie_vista);
    const ap = new Set(geo.cuerpos.map((q) => q.c.frente.apertura));
    const AP: Record<string, string> = { abatible: 'abatibles', corredera: 'correderas', coplanar: 'coplanares', escamoteable: 'escamoteables' };
    text(x + cm(k.x1 - k.x0) / 2, pie, 'PLANTA', 8.5, E.tinta, 'middle', true);
    text(x + cm(k.x1 - k.x0) / 2, pie + 10, `puertas ${[...ap].map((t) => AP[t] ?? t).join(' y ')}`, 7.5, E.cota, 'middle');
    x += cm(k.x1 - k.x0);
  }

  function circulo(cx: number, cy: number, r: number, color: string) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 12; i++) pts.push([cx + r * Math.cos((i / 12) * 2 * Math.PI), cy + r * Math.sin((i / 12) * 2 * Math.PI)]);
    prims.push({ k: 'poly', pts, fill: color, stroke: color, sw: 0.3 });
  }
  function flecha(x1: number, y1: number, x2: number, y2: number) {
    line(x1, y1, x2, y2, E.tinta, 0.6);
    const ang = Math.atan2(y2 - y1, x2 - x1), l = 3.6;
    for (const d of [0.45, -0.45]) line(x2, y2, x2 - l * Math.cos(ang + d), y2 - l * Math.sin(ang + d), E.tinta, 0.6);
  }

  return { codigo: a.codigo, formato: formato === 'PRES' ? 'A4' : formato, ancho: pg.w, alto: pg.h, prims, inicioDibujo, pagina: comp.principal ? 1 : 2 };
}

/** «Estantes» o «Estantes 30 mm» si no son del grosor del tablero. */
function etiquetaEstantes(ge: number, g: number): string {
  return Math.abs(ge - g) > 0.05 ? `Estantes ${fmtMm(ge)} mm` : 'Estantes';
}
