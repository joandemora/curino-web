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
  repartoZonas, ZOCALO_DEF, GROSOR_DEF, SEPARACION_SUELO_DEF, materialPieza, agarrePuerta
} from './esquema.ts';

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
  suelo_texto_dy: 6
} as const;

const PAGINA: Record<Formato, {
  w: number; h: number; ml: number; mr: number;
  logo: [number, number]; titulo: number; subtitulo: number; der1: number; der2: number; pie: number;
}> = {
  A3: { w: 1190.88, h: 841.68, ml: 59.5, mr: 1143.3, logo: [59.8, 41.8], titulo: 88.3, subtitulo: 109.4, der1: 66.7, der2: 76.4, pie: 799.6 },
  A4: { w: 841.68, h: 595.44, ml: 42.1, mr: 808.0, logo: [41.8, 23.0], titulo: 62.5, subtitulo: 77.4, der1: 49.5, der2: 59.1, pie: 565.7 }
};
const LOGO_ANCHO_PT = 77.7;  // caja del logo en los alzados de referencia
const LOGO_CAJA_ALTO = 21.6;
const ALTO_UTIL = 0.531;     // × alto de página para el cuerpo más alto
const CENTRO_VERTICAL = 0.511;
const A3_DESDE_CM = 480;     // ancho de vistas a partir del cual se usa A3

// ── Utilidades ──────────────────────────────────────────────────────
/** 47,5 · 95 · 0,3 — coma decimal española. */
export function fmtCm(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
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

export function descripcionFrente(f: Frente): string {
  const pl = (s: string) => s.split(' ').map((w, i) => (i === 0 && /[aeiou]$/i.test(w) ? w + 's' : w)).join(' ');
  const modelos = modelosPuertas(f);
  const modelo = modelos.length > 1 ? 'molduradas y lisas' : (modelos[0] ?? f.modelo) === 'moldurada' ? 'molduradas' : 'lisas';
  return [
    'Puertas',
    ({ abatible: 'abatibles', corredera: 'correderas', coplanar: 'coplanares', escamoteable: 'escamoteables' } as Record<string, string>)[f.apertura] ?? 'abatibles',
    modelo,
    f.acabado ? pl(f.acabado.trim()) : ''
  ].filter(Boolean).join(' ');
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

// ── Lámina ──────────────────────────────────────────────────────────
export function laminasProyecto(p: Proyecto, medir: Medir = medirAprox): Lamina[] {
  return p.armarios.map((a) => laminaArmario(a, p, medir));
}

export function laminaArmario(a: Armario, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir = medirAprox): Lamina {
  const formato = formatoArmario(a);
  const pg = PAGINA[formato];
  const prims: Prim[] = [];
  const E = ESTILO;

  // Escala: el conjunto cabe en el ancho útil y el cuerpo más alto en ALTO_UTIL.
  const anchoCm = anchoVistas(a);
  const altoMax = Math.max(...a.cuerpos.map((c) => c.alto));
  const s = Math.min((pg.mr - pg.ml) / (anchoCm + E.margen_izq_cm + E.margen_der_cm), (pg.h * ALTO_UTIL) / altoMax);
  const cm = (v: number) => v * s;
  const centro = (pg.ml + pg.mr) / 2;
  let x = centro - cm(anchoCm) / 2 + cm(E.margen_izq_cm - E.margen_der_cm) / 2;
  const suelo = pg.h * CENTRO_VERTICAL + cm(altoMax) / 2;

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

  // ── Cabecera y pie ──
  const logoAlto = (LOGO_ANCHO_PT * LOGO_ALTO) / LOGO_ANCHO;
  prims.push({ k: 'logo', x: pg.logo[0], y: pg.logo[1] + LOGO_CAJA_ALTO - logoAlto, h: logoAlto, color: E.tinta });
  text(pg.ml, pg.titulo, `${a.codigo}  ${a.titulo}`, 11, E.tinta, 'start', true);
  text(pg.ml, pg.subtitulo, a.subtitulo ?? subtituloAuto(a), 9, E.subtitulo);
  text(pg.mr, pg.der1, 'ALZADO INTERIOR + FRENTE CERRADO', 8, E.cota, 'end');
  text(pg.mr, pg.der2, `${descripcionFrente(a.cuerpos[0].frente)} · cotas en cm`, 8, E.cota, 'end');
  const pie = [p.referencia ? `Presupuesto ${p.referencia}` : '', p.cliente ?? ''].filter(Boolean).join(' · ');
  if (pie) text(pg.mr, pg.pie, pie, 7.5, E.suave, 'end');
  if (a.notas) text(pg.ml, pg.pie, a.notas, 7.5, E.suave);
  const inicioDibujo = prims.length;

  // ── Vistas ──
  a.cuerpos.forEach((c, ic) => {
    if (ic) x += cm(E.hueco_cuerpos);
    const z = c.zocalo ?? ZOCALO_DEF;
    const g = c.grosor ?? GROSOR_DEF;
    const W = cm(c.ancho);
    const arriba = suelo - cm(c.alto);
    const baseCuerpo = suelo - cm(z);
    const prefijo = c.nombre ? `${c.nombre} · ` : '';

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
        reparto.zonas.forEach((zm, i) => {
          if (i < reparto.zonas.length - 1) tablero(ix0, arriba + cm(zm.arriba + zm.libre), iw, cm(g));
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
            capas.dentro.push(() => {
              const h = (zm.libre - E.cajon_holgura * 2 - (n - 1) * E.cajon_separacion) / n;
              for (let i = 0; i < n; i++) {
                const dy = zt + cm(E.cajon_holgura + i * (h + E.cajon_separacion));
                rect(ix0 + cm(E.cajon_holgura) / 1.5, dy, iw - (2 * cm(E.cajon_holgura)) / 1.5, cm(h), { fill: E.cajon, stroke: E.tinta, sw: 0.8 });
                const tl = Math.min(cm(E.cajon_tirador), iw * 0.4);
                line(cx - tl / 2, dy + cm(E.cajon_tirador_baja), cx + tl / 2, dy + cm(E.cajon_tirador_baja), E.tinta, 1.2);
              }
              const t = zona.etiqueta ?? `Cajonera ${plural(n, 'cajón', 'cajones')}`;
              const tieneBaldaEncima = zm.arriba > g + 0.01;
              const cy = tieneBaldaEncima ? zt - cm(g) - (7 * 1.53) / 2 : zt + 7;
              etiqueta(cx, cy, t, 7);
            });
            break;
          }
          case 'estantes': {
            const n = zona.estantes;
            const hueco = (zm.libre - n * g) / (n + 1);
            capas.tableros.push(() => {
              for (let i = 1; i <= n; i++) tablero(ix0, zt + cm(i * hueco + (i - 1) * g), iw, cm(g));
            });
            const medio = Math.floor(n / 2);
            const cy = zt + cm(medio * (hueco + g) + hueco / 2);
            capas.dentro.push(() => etiqueta(cx, cy, zona.etiqueta ?? 'Estantes'));
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
        etiqueta((d0 + d1) / 2, (arriba + bajo) / 2, pz.etiqueta ?? 'FRENTE FIJO\nLISO', 6.5, false, E.suave);
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
  });

  return { codigo: a.codigo, formato, ancho: pg.w, alto: pg.h, prims, inicioDibujo };
}
