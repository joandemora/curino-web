// supabase/functions/_shared/estudio/cocina-alzado.ts
//
// Estudio Curino · dibujo de COCINAS (fase 3), estilo Curino como los alzados
// de armarios (mismas primitivas, cabecera, cotas en cm con coma).
//
//   - Alzado de cada tramo (pared): zócalo, bajos y columnas con sus frentes
//     (puertas, cajones, Aventos, horno / micro), encimera, altos colgados a
//     SEPARACION_ALTOS sobre la encimera y alineados por arriba, y los
//     electrodomésticos simbolizados (placa, fregadero, campana, nevera,
//     lavavajillas). Cotas de cada módulo, total y alturas.
//   - Planta (vista «planta»): tramos colocados como los cuerpos de armario
//     (línea, esquina izq./der. arrancando en el frente de la pared principal,
//     isla delante a PASILLO_ISLA), fondos de bajos 58 + puerta, encimera 65 y
//     altos 33 (en línea fina), apertura de las puertas y columnas con aspa.
//   - Sección lateral tipo (vista «lateral»): bajo + encimera + alto con sus
//     alturas y fondos.
// Misma regla que armarios para pasar a una hoja 2.

import {
  type Lamina, type Prim, type Medir, medirAprox, fmtCm, ESTILO, PAGINA, PAGINA_PRESUPUESTO, LOGO_ANCHO_PT, LOGO_CAJA_ALTO, ALTO_UTIL, CENTRO_VERTICAL, ladosTirador
} from './alzado.ts';
import { LOGO_ALTO, LOGO_ANCHO } from './logo.ts';
import type { Proyecto } from './esquema.ts';
import {
  type Cocina, type ModuloCocina, type TramoCocina, completarCocina, alturasCajones, anchoPuerta, esUnero, fondoModulo,
  COCINA_DEF, ACABADO_TXT, TIPO_TXT
} from './cocina.ts';

export const COCINA_DIBUJO = {
  separacion_altos: 60,   // cm entre encimera y altos (solo dibujo)
  pasillo_isla: 100,      // cm entre la pared principal y la isla (solo dibujo)
  puerta: 2,              // grueso de frente (cm, dibujo)
  nevera_alto: 200,
  encimera: '#6f6a63',
  frente: '#f6f4ef',
  rincon: '#e9e5dd',
  electro: '#d9dcdf',
  electroBorde: '#7d8288',
  cristal: '#c9d6df',
  ventana: '#eef3f6'
};
// ESTILO se lee dentro de las funciones (alzado.ts importa este módulo: dependencia circular)
const D = COCINA_DIBUJO;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const sumaAncho = (mods: ModuloCocina[] = []) => mods.reduce((s, m) => s + m.ancho, 0);
const altoBajos = (t: TramoCocina) => Math.max(COCINA_DEF.alto_bajo, ...t.bajos.filter((m) => !['columna', 'columna_hm', 'hueco'].includes(m.tipo)).map((m) => m.alto ?? COCINA_DEF.alto_bajo));
const altoAltos = (t: TramoCocina) => Math.max(0, ...(t.altos ?? []).filter((m) => m.tipo === 'alto' || m.tipo === 'esquinero_alto').map((m) => m.alto ?? COCINA_DEF.alto_alto));

interface Composicion { principal: boolean; lateral: boolean; planta: boolean }

// ── Planta: geometría ───────────────────────────────────────────────
type V2 = [number, number];
export interface TramoPlanta { t: TramoCocina; o: V2; u: V2; v: V2; ancho: number; lado: 'izq' | 'der' }
const FONDO_TOTAL = COCINA_DEF.fondo_bajo + D.puerta;   // 60: cuerpo + puerta

export function geometriaCocina(c: Cocina): { tramos: TramoPlanta[]; caja: { x0: number; y0: number; x1: number; y1: number } } {
  const E = ESTILO;
  const out: TramoPlanta[] = [];
  const mas = (p: V2, k: number, d: V2): V2 => [p[0] + k * d[0], p[1] + k * d[1]];
  const neg = (d: V2): V2 => [-d[0] || 0, -d[1] || 0];
  let finFila = 0;
  c.tramos.forEach((t, i) => {
    const ancho = Math.max(sumaAncho(t.bajos), sumaAncho(t.altos));
    const col = i === 0 ? 'linea' : t.colocacion ?? 'linea';
    if (i === 0) { out.push({ t, o: [0, 0], u: [1, 0], v: [0, 1], ancho, lado: 'izq' }); return; }
    if (col === 'linea') {
      const prev = out[i - 1];
      if (finFila === i - 1) finFila = i;
      out.push({ t, o: mas(prev.o, prev.ancho, prev.u), u: prev.u, v: prev.v, ancho, lado: 'der' });
    } else if (col === 'esquina_der') {
      const ref = out[finFila];
      out.push({ t, o: mas(mas(ref.o, ref.ancho, ref.u), FONDO_TOTAL, ref.v), u: ref.v, v: neg(ref.u), ancho, lado: 'der' });
    } else if (col === 'esquina_izq') {
      const ref = out[0];
      out.push({ t, o: mas(ref.o, FONDO_TOTAL + ancho, ref.v), u: neg(ref.v), v: ref.u, ancho, lado: 'izq' });
    } else {
      // Isla: delante de la fila principal, centrada, mirando a la pared
      const filaAncho = out.slice(0, finFila + 1).reduce((s, q) => s + q.ancho, 0);
      const fondoIsla = COCINA_DEF.fondo_encimera;
      out.push({ t, o: [filaAncho / 2 + ancho / 2, FONDO_TOTAL + D.pasillo_isla + fondoIsla], u: [-1, 0], v: [0, -1], ancho, lado: 'der' });
    }
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of out) {
    const pt = (uu: number, vv: number) => { const p = mas(mas(q.o, uu, q.u), vv, q.v); x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
    const maxPuerta = Math.max(30, ...q.t.bajos.filter((m) => m.frente?.tipo === 'puertas').map((m) => anchoPuerta(m, m.frente!.puertas ?? 1)));
    pt(0, -E.planta_cota - 6); pt(q.ancho, -E.planta_cota - 6);
    pt(q.lado === 'izq' ? -3 * E.planta_cota - 6 : q.ancho + 3 * E.planta_cota + 6, 0);
    pt(0, FONDO_TOTAL + maxPuerta); pt(q.ancho, FONDO_TOTAL + maxPuerta);
  }
  return { tramos: out, caja: { x0, y0, x1, y1 } };
}

// ── Medidas de cada vista (cm) ───────────────────────────────────────
const ANCHO_SECCION = COCINA_DEF.fondo_encimera + 10;
function alturas(c: Cocina) {
  const t0 = c.tramos[0];
  const z = c.zocalo ?? COCINA_DEF.zocalo;
  const hb = Math.max(...c.tramos.map(altoBajos));
  const ha = Math.max(COCINA_DEF.alto_alto, ...c.tramos.map(altoAltos));
  const encimera = z + hb + COCINA_DEF.encimera_grueso;
  const techoAltos = encimera + D.separacion_altos + ha;
  const columnas = Math.max(0, ...c.tramos.flatMap((t) => t.bajos.filter((m) => m.tipo === 'columna' || m.tipo === 'columna_hm').map((m) => z + (m.alto ?? COCINA_DEF.alto_columna))));
  const neveras = c.tramos.some((t) => t.bajos.some((m) => m.tipo === 'hueco' && m.electro?.includes('nevera'))) ? D.nevera_alto : 0;
  return { z, hb, ha, encimera, techoAltos, techo: Math.max(techoAltos, columnas, neveras), t0 };
}
function anchoFila(c: Cocina, o: Composicion): number {
  let w = 0, primero = true;
  const gap = () => { if (!primero) w += ESTILO.hueco_cuerpos; primero = false; };
  if (o.principal) for (const t of c.tramos) { gap(); w += Math.max(sumaAncho(t.bajos), sumaAncho(t.altos)); }
  if (o.lateral) { gap(); w += ANCHO_SECCION; }
  if (o.planta) { const k = geometriaCocina(c).caja; gap(); w += k.x1 - k.x0; }
  return w;
}
function escala(c: Cocina, o: Composicion, pres = false): number {
  const E = ESTILO;
  const pg = pres ? PAGINA_PRESUPUESTO : PAGINA.A4;
  const k = o.planta ? geometriaCocina(c).caja : null;
  const alto = Math.max(o.principal || o.lateral ? alturas(c).techo : 0, k ? k.y1 - k.y0 : 0);
  return Math.min((pg.mr - pg.ml) / (anchoFila(c, o) + E.margen_izq_cm + E.margen_der_cm), (pg.h * ALTO_UTIL) / alto);
}
const SOLO: Composicion = { principal: true, lateral: false, planta: false };

/** Láminas de una cocina: alzados de los tramos y, si caben, sección y planta (si no, hoja 2). */
export function laminasCocina(entrada: Cocina, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir = medirAprox): Lamina[] {
  const E = ESTILO;
  const c = completarCocina(entrada);
  const lateral = !!c.vistas?.includes('lateral'), planta = !!c.vistas?.includes('planta');
  if (!lateral && !planta) return [lamina(c, p, medir, SOLO)];
  const todo = { principal: true, lateral, planta };
  if (escala(c, todo) >= E.vistas_minimo * escala(c, SOLO)) return [lamina(c, p, medir, todo)];
  return [lamina(c, p, medir, SOLO), lamina(c, p, medir, { principal: false, lateral, planta })];
}

/**
 * Láminas para el presupuesto (una partida por tramo): el alzado de cada pared
 * con el código de su partida («C.01.1», «C.01.2»…) y, si la cocina tiene
 * vistas, la sección y la planta con el código de la última partida.
 */
export function laminasCocinaPresupuesto(entrada: Cocina, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir = medirAprox, pres = false): Lamina[] {
  const c = completarCocina(entrada);
  const lateral = !!c.vistas?.includes('lateral'), planta = !!c.vistas?.includes('planta');
  const extra: Composicion = { principal: false, lateral, planta };
  // Presupuesto: todos los tramos, la sección y la planta a la misma escala (la que más reduce)
  const s = pres ? Math.min(...c.tramos.map((t) => escala({ ...c, tramos: [t] }, SOLO, true)), lateral || planta ? escala(c, extra, true) : Infinity) : undefined;
  const out = c.tramos.map((t, i) => ({ ...lamina({ ...c, tramos: [t] }, p, medir, SOLO, pres, s), codigo: `${c.codigo}.${i + 1}`, grupo: pres ? c.codigo : undefined }));
  if (lateral || planta) out.push({ ...lamina(c, p, medir, extra, pres, s), codigo: `${c.codigo}.${c.tramos.length}`, grupo: pres ? c.codigo : undefined });
  return out;
}

function lamina(c: Cocina, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir, comp: Composicion, pres = false, escalaFija?: number): Lamina {
  const E = ESTILO;
  const pg = pres ? PAGINA_PRESUPUESTO : PAGINA.A4, prims: Prim[] = [];
  const H = alturas(c);
  const s = escalaFija ?? (comp.principal ? escala(c, comp, pres) : Math.min(escala(c, comp, pres), escala(c, SOLO, pres)));
  const cm = (v: number) => v * s;
  let x = (pg.ml + pg.mr) / 2 - cm(anchoFila(c, comp)) / 2 + cm(E.margen_izq_cm - E.margen_der_cm) / 2;
  const suelo = pg.h * CENTRO_VERTICAL + cm(H.techo) / 2;
  let primero = true;
  const separar = () => { if (!primero) x += cm(ESTILO.hueco_cuerpos); primero = false; };

  // ── primitivas ──
  const rect = (x0: number, y0: number, w: number, h: number, o: Partial<Extract<Prim, { k: 'rect' }>> = {}) => prims.push({ k: 'rect', x: x0, y: y0, w, h, ...o });
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string = E.tinta, sw = 0.8) => prims.push({ k: 'line', x1, y1, x2, y2, stroke, sw });
  const text = (x0: number, y0: number, t: string, size: number, color: string, anchor: 'start' | 'middle' | 'end' = 'start', bold = false, vertical = false) =>
    prims.push({ k: 'text', x: x0, y: y0, t, size, color, anchor, bold, vertical });
  const etiqueta = (cx: number, cy: number, t: string, size = 6.5, caja = true) => {
    const w = medir(t, size, false), h = size * 1.5;
    if (caja) rect(cx - w / 2 - 1.2, cy - h / 2, w + 2.4, h, { fill: '#ffffff', opacity: 0.85 });
    text(cx, cy + 0.36 * size, t, size, E.etiqueta, 'middle');
  };
  const cotaH = (xa: number, xb: number, y: number, t: string) => {
    const k = E.cota;
    line(xa, y - 4.6, xa, y + 4.6, k, 0.7); line(xb, y - 4.6, xb, y + 4.6, k, 0.7);
    line(xa + 0.8, y, xb - 0.8, y, k, 0.7);
    line(xa + 0.8, y, xa + 4.8, y - 2, k, 0.7); line(xa + 0.8, y, xa + 4.8, y + 2, k, 0.7);
    line(xb - 0.8, y, xb - 4.8, y - 2, k, 0.7); line(xb - 0.8, y, xb - 4.8, y + 2, k, 0.7);
    text((xa + xb) / 2, y - 6.9, t, 7, k, 'middle');
  };
  const cotaV = (x0: number, ya: number, yb: number, t: string, lado: 'izq' | 'der' = 'izq') => {
    const k = E.cota;
    line(x0 - 4.6, ya, x0 + 4.6, ya, k, 0.7); line(x0 - 4.6, yb, x0 + 4.6, yb, k, 0.7);
    line(x0, ya + 0.8, x0, yb - 0.8, k, 0.7);
    line(x0, ya + 0.8, x0 - 2, ya + 4.8, k, 0.7); line(x0, ya + 0.8, x0 + 2, ya + 4.8, k, 0.7);
    line(x0, yb - 0.8, x0 - 2, yb - 4.8, k, 0.7); line(x0, yb - 0.8, x0 + 2, yb - 4.8, k, 0.7);
    if (yb - ya > medir(t, 6.5, false) + 4) text(x0 + (lado === 'izq' ? -5.5 : 9.5), (ya + yb) / 2, t, 6.5, k, 'middle', false, true);
    else text(x0 + (lado === 'izq' ? -4 : 4), (ya + yb) / 2 + 2.3, t, 6, k, lado === 'izq' ? 'end' : 'start');
  };
  const flecha = (x1: number, y1: number, x2: number, y2: number, color: string = E.tinta) => {
    line(x1, y1, x2, y2, color, 0.6);
    const a = Math.atan2(y2 - y1, x2 - x1);
    for (const d of [0.45, -0.45]) line(x2, y2, x2 - 3.4 * Math.cos(a + d), y2 - 3.4 * Math.sin(a + d), color, 0.6);
  };
  const circulo = (cx: number, cy: number, r: number, o: { fill?: string; stroke?: string; sw?: number }) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 16; i++) pts.push([cx + r * Math.cos((i / 16) * 2 * Math.PI), cy + r * Math.sin((i / 16) * 2 * Math.PI)]);
    prims.push({ k: 'poly', pts, ...o });
  };

  // ── Cabecera y pie ──
  const logoAlto = (LOGO_ANCHO_PT * LOGO_ALTO) / LOGO_ANCHO;
  prims.push({ k: 'logo', x: pg.logo[0], y: pg.logo[1] + LOGO_CAJA_ALTO - logoAlto, h: logoAlto, color: E.tinta });
  text(pg.ml, pg.titulo, `${c.codigo}  ${c.titulo}`, 11, E.tinta, 'start', true);
  text(pg.ml, pg.subtitulo, c.tramos.map((t, i) => `${capital(t.nombre ?? `Tramo ${i + 1}`)} ${fmtCm(Math.max(sumaAncho(t.bajos), sumaAncho(t.altos)))} cm`).join(' + ') + ` · bajos ${fmtCm(H.hb)} · altos ${fmtCm(H.ha)}`, 9, E.subtitulo);
  const cab = [comp.principal ? 'ALZADO DE COCINA' : '', comp.lateral ? 'SECCIÓN' : '', comp.planta ? 'PLANTA' : ''].filter(Boolean).join(' + ');
  text(pg.mr, pg.der1, cab, 8, E.cota, 'end');
  text(pg.mr, pg.der2, `Cuerpo ${ACABADO_TXT[c.acabado!]} · puertas grupo ${c.grupo}${c.agarre === 'unero' ? ' · uñero' : ''} · cotas en cm`, 8, E.cota, 'end');
  const pie = [p.referencia ? `Presupuesto ${p.referencia}` : '', p.cliente ?? ''].filter(Boolean).join(' · ');
  if (pie) text(pg.mr, pg.pie, pie, 7.5, E.suave, 'end');
  if (c.supuestos?.length) {
    let t = `Supuestos: ${c.supuestos.join(' · ')}`;
    while (medir(t, 6.5, false) > (pg.mr - pg.ml) * 0.62 && t.length > 20) t = t.slice(0, t.lastIndexOf(' · ')) + ' …';
    text(pg.ml, pg.pie, t, 6.5, E.suave);
  }
  const inicioDibujo = prims.length;

  if (comp.principal) c.tramos.forEach((t) => { separar(); alzadoTramo(t); });
  if (comp.lateral) { separar(); seccion(); }
  if (comp.planta) { separar(); vistaPlanta(); }

  // ── Alzado de un tramo ──
  function alzadoTramo(t: TramoCocina) {
    const x0 = x, W = Math.max(sumaAncho(t.bajos), sumaAncho(t.altos));
    const z = H.z, yZ = suelo - cm(z);
    const yEnc = suelo - cm(H.encimera);
    const yTechoAltos = suelo - cm(H.techoAltos);
    line(x0 - cm(E.suelo_extra), suelo, x0 + cm(W) + cm(E.suelo_extra), suelo, E.tinta, 1.2);
    // Bajos y columnas
    let mx = x0;
    const tramosEncimera: [number, number][] = [];
    const lados = ladosTirador(t.bajos.map((m) => (m.tipo === 'regleta' || m.tipo === 'hueco' ? { tipo: 'fijo' as const, ancho: m.ancho } : { tipo: 'puerta' as const, ancho: m.ancho })));
    t.bajos.forEach((m, i) => {
      const w = cm(m.ancho), alto = m.alto ?? (m.tipo === 'columna' || m.tipo === 'columna_hm' ? COCINA_DEF.alto_columna : COCINA_DEF.alto_bajo);
      const conEncimera = !(m.tipo === 'columna' || m.tipo === 'columna_hm' || (m.tipo === 'hueco' && m.electro?.includes('nevera')));
      if (conEncimera && t.encimera !== false) {
        const ult = tramosEncimera[tramosEncimera.length - 1];
        if (ult && Math.abs(ult[1] - mx) < 0.01) ult[1] = mx + w; else tramosEncimera.push([mx, mx + w]);
      }
      if (m.tipo === 'regleta') {
        // Regleta de ajuste: tira de frente, con su zócalo, bajo la encimera
        if (z > 0) rect(mx, yZ, w, cm(z), { fill: E.zocalo, stroke: E.tinta, sw: 0.5 });
        rect(mx, yZ - cm(H.hb), w, cm(H.hb), { fill: E.tablero, stroke: E.tinta, sw: 0.7 });
        mx += w; return;
      }
      if (m.tipo === 'hueco') {
        const ev = m.electro ?? [];
        if (ev.includes('nevera')) {
          const h = cm(D.nevera_alto);
          rect(mx + 0.6, suelo - h, w - 1.2, h, { fill: D.electro, stroke: D.electroBorde, sw: 0.8 });
          line(mx + 0.6, suelo - h * 0.62, mx + w - 0.6, suelo - h * 0.62, D.electroBorde, 0.6);
          line(mx + w - 4, suelo - h * 0.62 - 14, mx + w - 4, suelo - h * 0.62 - 4, D.electroBorde, 1.4);
          etiqueta(mx + w / 2, suelo - h * 0.4, 'NEVERA');
        } else if (ev.includes('lavavajillas') || ev.includes('lavadora')) {
          const h = cm(alto);
          rect(mx + 0.4, yZ - h, w - 0.8, h, { fill: D.frente, stroke: E.tinta, sw: 0.8 });
          rect(mx + 0.4, yZ, w - 0.8, cm(z), { fill: E.zocalo });
          etiqueta(mx + w / 2, yZ - h / 2, ev.includes('lavadora') ? 'LAVADORA' : 'LAVAVAJILLAS', 6);
        } else if (m.etiqueta) etiqueta(mx + w / 2, yZ - cm(alto) / 2, m.etiqueta.toUpperCase(), 6);
        mx += w; return;
      }
      // Zócalo
      if (z > 0) rect(mx, yZ, w, cm(z), { fill: E.zocalo, stroke: E.tinta, sw: 0.5 });
      const top = yZ - cm(alto);
      rect(mx, top, w, cm(alto), { fill: D.frente, stroke: E.tinta, sw: 0.9 });
      frentes(m, mx, top, w, cm(alto), 'bajos', lados[i] ?? null, i === 0 ? 'izq' : i === t.bajos.length - 1 ? 'der' : null);
      // Electrodomésticos sobre la encimera
      const ev = m.electro ?? [];
      if (ev.includes('placa')) { rect(mx + w * 0.12, yEnc - 2.4, w * 0.76, 1.6, { fill: '#2b2b2b' }); text(mx + w / 2, yEnc - 6, 'PLACA', 5.5, E.suave, 'middle'); }
      if (ev.includes('fregadero') || m.tipo === 'fregadero') {
        const cx = mx + w / 2;
        line(cx, yEnc, cx, yEnc - cm(22), E.aceroBorde, 1.6);
        line(cx, yEnc - cm(22), cx + cm(14), yEnc - cm(22), E.aceroBorde, 1.6);
        line(cx + cm(14), yEnc - cm(22), cx + cm(14), yEnc - cm(18), E.aceroBorde, 1.6);
        rect(mx + w * 0.15, yEnc - 1.2, w * 0.7, 1.2, { fill: E.acero });
      }
      mx += w;
    });
    // Encimera
    for (const [a, b] of tramosEncimera) rect(a - 0.5, yEnc, b - a + 1, cm(COCINA_DEF.encimera_grueso) + 0.6, { fill: D.encimera, stroke: E.tinta, sw: 0.5 });
    // Altos (alineados por arriba)
    let ax = x0;
    const ladosA = ladosTirador((t.altos ?? []).map((m) => (m.tipo === 'regleta' || m.tipo === 'hueco' ? { tipo: 'fijo' as const, ancho: m.ancho } : { tipo: 'puerta' as const, ancho: m.ancho })));
    (t.altos ?? []).forEach((m, i) => {
      const w = cm(m.ancho);
      if (m.tipo === 'regleta') { rect(ax, yTechoAltos, w, cm(H.ha), { fill: E.tablero, stroke: E.tinta, sw: 0.7 }); ax += w; return; }
      if (m.tipo === 'hueco') {
        const ev = m.electro ?? [];
        if (ev.includes('campana')) {
          const cx = ax + w / 2, yb = yEnc - cm(D.separacion_altos - 5), hc = cm(14);
          prims.push({ k: 'poly', pts: [[ax + w * 0.1, yb], [ax + w * 0.9, yb], [cx + w * 0.16, yb - hc], [cx - w * 0.16, yb - hc]], fill: E.acero, stroke: E.aceroBorde, sw: 0.7 });
          rect(cx - w * 0.16, yTechoAltos, w * 0.32, yb - hc - yTechoAltos, { fill: E.acero, stroke: E.aceroBorde, sw: 0.7 });
          text(cx, yb + 8, 'CAMPANA', 5.5, E.suave, 'middle');
        } else if ((m.etiqueta ?? '').toUpperCase().includes('VENTANA')) {
          const y1 = yEnc - cm(D.separacion_altos - 15), y0 = yTechoAltos + cm(5);
          rect(ax + w * 0.08, y0, w * 0.84, y1 - y0, { fill: D.ventana, stroke: E.tinta, sw: 0.8 });
          line(ax + w / 2, y0, ax + w / 2, y1, E.tinta, 0.5);
          text(ax + w / 2, y1 + 8, 'VENTANA', 5.5, E.suave, 'middle');
        } else if (m.etiqueta) etiqueta(ax + w / 2, yTechoAltos + cm(H.ha) / 2, m.etiqueta.toUpperCase(), 6);
        ax += w; return;
      }
      const alto = m.alto ?? COCINA_DEF.alto_alto;
      rect(ax, yTechoAltos, w, cm(alto), { fill: D.frente, stroke: E.tinta, sw: 0.9 });
      frentes(m, ax, yTechoAltos, w, cm(alto), 'altos', ladosA[i] ?? null, i === 0 ? 'izq' : i === (t.altos ?? []).length - 1 ? 'der' : null);
      ax += w;
    });
    // Cotas: módulos (abajo), total (arriba), alturas (izquierda)
    let cx0 = x0;
    t.bajos.forEach((m) => {
      if (m.tipo === 'regleta') text(cx0 + cm(m.ancho) / 2, suelo + cm(E.cota_abajo) + 12, `regleta ${fmtCm(m.ancho)}`, 5.5, E.cota, 'middle');
      else cotaH(cx0, cx0 + cm(m.ancho), suelo + cm(E.cota_abajo), fmtCm(m.ancho));
      cx0 += cm(m.ancho);
    });
    if ((t.altos ?? []).length) {
      let ax0 = x0; const ya = suelo - cm(H.techo) - cm(E.cota_arriba);
      (t.altos ?? []).forEach((m) => { if (m.tipo !== 'hueco' || m.ancho >= 30) cotaH(ax0, ax0 + cm(m.ancho), ya, fmtCm(m.ancho)); ax0 += cm(m.ancho); });
    }
    cotaH(x0, x0 + cm(W), suelo - cm(H.techo) - cm(E.cota_arriba) - ((t.altos ?? []).length ? 16 : 0), `${fmtCm(W)} cm`);
    const xc = x0 - cm(10);
    cotaV(xc, yZ, suelo, fmtCm(z));
    cotaV(xc, yEnc, yZ, fmtCm(H.hb));
    if ((t.altos ?? []).length) {
      cotaV(xc, yTechoAltos + cm(H.ha), yEnc, fmtCm(D.separacion_altos));
      cotaV(xc, yTechoAltos, yTechoAltos + cm(H.ha), fmtCm(H.ha));
    }
    cotaV(x0 - cm(E.cota_alto), yEnc, suelo, `encimera ${fmtCm(H.encimera)}`);
    text(x0 + cm(W) / 2, suelo + cm(E.pie_vista), `${(t.nombre ?? 'TRAMO').toUpperCase()} · ALZADO`, 8.5, E.tinta, 'middle', true);
    const mueble = (m: ModuloCocina) => m.tipo !== 'hueco' && m.tipo !== 'regleta';
    const nReg = [...t.bajos, ...(t.altos ?? [])].filter((m) => m.tipo === 'regleta').length;
    const desc = [plural(t.bajos.filter(mueble).length, 'bajo', 'bajos'), (t.altos ?? []).some(mueble) ? plural((t.altos ?? []).filter(mueble).length, 'alto', 'altos') : '', nReg ? plural(nReg, 'regleta', 'regletas') : '', t.largo ? `pared ${fmtCm(t.largo)}` : ''].filter(Boolean).join(' + ').replace(/ \+ pared/, ' · pared');
    text(x0 + cm(W) / 2, suelo + cm(E.pie_vista) + 10, desc, 7.5, E.cota, 'middle');
    x += cm(W);
  }

  /** Frentes de un módulo (puertas, cajones, Aventos, horno / micro) y su agarre. */
  function frentes(m: ModuloCocina, x0: number, top: number, w: number, h: number, fila: 'bajos' | 'altos', lado: 'izq' | 'der' | null, extremo: 'izq' | 'der' | null) {
    const f = m.frente!, g = m.grupo ?? c.grupo!, ag = m.agarre ?? c.agarre;
    const unero = esUnero(g, ag), premium = ag === 'tirador_premium';
    const gap = 0.6;
    const panel = (px: number, py: number, pw: number, ph: number, ladoT: 'izq' | 'der' | 'centro') => {
      rect(px + gap, py + gap, pw - 2 * gap, ph - 2 * gap, { fill: D.frente, stroke: E.tinta, sw: 0.7 });
      if (unero) {
        // Uñero: ranura en el canto de arriba (bajos) o de abajo (altos)
        const uy = fila === 'altos' ? py + ph - gap - 2.2 : py + gap;
        rect(px + gap, uy, pw - 2 * gap, 2.2, { fill: E.uneroDm, stroke: E.tinta, sw: 0.3 });
      } else {
        const [fc, bc] = premium ? [E.laton, E.latonBorde] : [E.acero, E.aceroBorde];
        if (ladoT === 'centro') rect(px + pw / 2 - Math.min(pw * 0.2, 12), fila === 'altos' ? py + ph - 7 : py + 5, Math.min(pw * 0.4, 24), 1.8, { fill: fc, stroke: bc, sw: 0.4 });
        else {
          const tx = ladoT === 'der' ? px + pw - 5 : px + 3.4;
          const ty = fila === 'altos' ? py + ph - 5 - Math.min(16, ph * 0.3) : py + 5;
          rect(tx, ty, 1.8, Math.min(16, ph * 0.3), { fill: fc, stroke: bc, sw: 0.4 });
        }
      }
    };
    if (m.tipo === 'esquinero' || m.tipo === 'esquinero_alto') {
      // Solo se ve la puerta (ancho − fondo); el resto queda tapado por la otra pared
      const vista = cm(anchoPuerta(m, 2)), dPuertaIzq = extremo !== 'izq';
      const pxP = dPuertaIzq ? x0 : x0 + w - vista;
      rect(dPuertaIzq ? x0 + vista : x0, top, w - vista, h, { fill: D.rincon, stroke: E.tinta, sw: 0.5 });
      text(dPuertaIzq ? x0 + (vista + w) / 2 : x0 + (w - vista) / 2, top + h / 2, 'RINCÓN', 5.5, E.suave, 'middle');
      panel(pxP, top, vista, h, dPuertaIzq ? 'der' : 'izq');
      return;
    }
    if (m.tipo === 'columna_hm' || m.tipo === 'columna') {
      const alts = f.alturas?.length ? f.alturas : [m.alto ?? COCINA_DEF.alto_columna];
      if (m.tipo === 'columna_hm' && alts.length >= 2) {
        let y = top;
        const ph0 = cm(alts[0]);
        panel(x0, y, w, ph0, 'centro'); y += ph0;
        electro(x0, y, w, cm(COCINA_DEF.micro_hueco), 'MICRO'); y += cm(COCINA_DEF.micro_hueco);
        electro(x0, y, w, cm(COCINA_DEF.horno_hueco), 'HORNO'); y += cm(COCINA_DEF.horno_hueco);
        panel(x0, y, w, top + h - y, 'centro');
      } else {
        let y = top;
        const n = Math.max(1, f.puertas ?? 1);
        for (const a of alts) { for (let k = 0; k < n; k++) panel(x0 + (w / n) * k, y, w / n, cm(a), n === 1 ? (lado ?? 'der') : k === 0 ? 'der' : 'izq'); y += cm(a); }
      }
      return;
    }
    if (m.tipo === 'horno') {
      const hh = cm(COCINA_DEF.horno_hueco);
      electro(x0, top, w, hh, 'HORNO');
      if (h - hh > 2) panel(x0, top + hh, w, h - hh, 'centro');
      return;
    }
    if (f.tipo === 'cajones') {
      let y = top;
      const alts = alturasCajones(m), k = h / alts.reduce((s, a) => s + cm(a), 0);
      for (const a of alts) { panel(x0, y, w, cm(a) * k, 'centro'); y += cm(a) * k; }
      return;
    }
    if (f.tipo === 'aventos_hf' || f.tipo === 'aventos_hk') {
      if (f.tipo === 'aventos_hf') { panel(x0, top, w, h / 2, 'centro'); panel(x0, top + h / 2, w, h / 2, 'centro'); }
      else panel(x0, top, w, h, 'centro');
      text(x0 + w / 2, top + (f.tipo === 'aventos_hf' ? h / 4 : h / 2) + 2, f.tipo === 'aventos_hf' ? 'Aventos HF' : 'Aventos HK', 5.5, E.suave, 'middle');
      return;
    }
    if (f.tipo === 'abierto') { rect(x0 + 1.5, top + 1.5, w - 3, h - 3, { fill: E.fondoInterior, stroke: E.tinta, sw: 0.5 }); return; }
    const n = Math.max(1, f.puertas ?? 1);
    for (let k = 0; k < n; k++) panel(x0 + (w / n) * k, top, w / n, h, n === 1 ? (lado ?? 'der') : k % 2 === 0 ? 'der' : 'izq');
  }
  function electro(x0: number, y0: number, w: number, h: number, nombre: string) {
    rect(x0 + 1, y0 + 1, w - 2, h - 2, { fill: D.electro, stroke: D.electroBorde, sw: 0.8 });
    rect(x0 + w * 0.12, y0 + h * 0.3, w * 0.76, h * 0.55, { fill: D.cristal, stroke: D.electroBorde, sw: 0.5 });
    line(x0 + w * 0.2, y0 + h * 0.17, x0 + w * 0.8, y0 + h * 0.17, D.electroBorde, 1.2);
    text(x0 + w / 2, y0 + h * 0.6, nombre, 5.5, E.etiqueta, 'middle');
  }

  // ── Sección lateral tipo: bajo + encimera + alto ──
  function seccion() {
    const x0 = x + cm(5);            // pared
    const z = H.z, fb = COCINA_DEF.fondo_bajo, fa = COCINA_DEF.fondo_alto, fe = COCINA_DEF.fondo_encimera;
    const yZ = suelo - cm(z), yEnc = suelo - cm(H.encimera), yTecho = suelo - cm(H.techoAltos);
    line(x0, suelo, x0, yTecho - cm(10), E.tinta, 2);                              // pared
    line(x0 - cm(5), suelo, x0 + cm(fe) + cm(E.suelo_extra), suelo, E.tinta, 1.2);
    if (z > 0) rect(x0 + cm(2), yZ, cm(fb - 6), cm(z), { fill: E.zocalo, stroke: E.tinta, sw: 0.5 });
    rect(x0, yZ - cm(H.hb), cm(fb), cm(H.hb), { fill: E.fondoInterior, stroke: E.tinta, sw: 0.9 });
    rect(x0 + 0.6, yZ - cm(H.hb), cm(1), cm(H.hb), { fill: E.tablero, stroke: E.tinta, sw: 0.4 });  // trasera
    rect(x0 + cm(fb), yZ - cm(H.hb), cm(D.puerta), cm(H.hb), { fill: D.frente, stroke: E.tinta, sw: 0.8 });
    rect(x0, yEnc, cm(fe), cm(COCINA_DEF.encimera_grueso) + 0.6, { fill: D.encimera, stroke: E.tinta, sw: 0.5 });
    // Alto
    rect(x0, yTecho, cm(fa), cm(H.ha), { fill: E.fondoInterior, stroke: E.tinta, sw: 0.9 });
    rect(x0 + cm(fa), yTecho, cm(D.puerta), cm(H.ha), { fill: D.frente, stroke: E.tinta, sw: 0.8 });
    tablero(x0, yTecho + cm(H.ha) / 2, cm(fa), cm(1.6));
    // Cotas
    const xc = x0 + cm(fe) + cm(12);
    cotaV(xc, yZ, suelo, fmtCm(z), 'der');
    cotaV(xc, yEnc, yZ, fmtCm(H.hb), 'der');
    cotaV(xc, yTecho + cm(H.ha), yEnc, fmtCm(D.separacion_altos), 'der');
    cotaV(xc, yTecho, yTecho + cm(H.ha), fmtCm(H.ha), 'der');
    cotaV(xc + cm(14), yEnc, suelo, fmtCm(H.encimera), 'der');
    cotaV(xc + cm(14), yTecho, suelo, fmtCm(H.techoAltos), 'der');
    cotaH(x0, x0 + cm(fe), yEnc - 9, `encimera ${fmtCm(fe)}`);
    cotaH(x0, x0 + cm(fb + D.puerta), suelo + cm(E.cota_abajo), fmtCm(fb + D.puerta));
    cotaH(x0, x0 + cm(fa + D.puerta), yTecho - cm(E.cota_arriba) + 4, fmtCm(fa + D.puerta));
    text(x0 + cm(fe) / 2, suelo + cm(E.pie_vista), 'SECCIÓN TIPO', 8.5, E.tinta, 'middle', true);
    text(x0 + cm(fe) / 2, suelo + cm(E.pie_vista) + 10, 'bajo + encimera + alto', 7.5, E.cota, 'middle');
    x += cm(ANCHO_SECCION);
  }
  function tablero(x0: number, y0: number, w: number, h: number) { rect(x0, y0 - h / 2, w, h, { fill: E.tablero, stroke: E.tinta, sw: 0.5 }); }

  // ── Planta ──
  function vistaPlanta() {
    const geo = geometriaCocina(c), k = geo.caja;
    const hPl = cm(k.y1 - k.y0), top = pg.h * CENTRO_VERTICAL - hPl / 2;
    const X = (px: number) => x + cm(px - k.x0), Y = (py: number) => top + cm(py - k.y0);
    for (const q of geo.tramos) {
      const P = (uu: number, vv: number): V2 => [X(q.o[0] + uu * q.u[0] + vv * q.v[0]), Y(q.o[1] + uu * q.u[1] + vv * q.v[1])];
      const rectL = (u0: number, v0: number, u1: number, v1: number, o: Partial<Extract<Prim, { k: 'rect' }>>) => {
        const [ax, ay] = P(u0, v0), [bx, by] = P(u1, v1);
        rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), o);
      };
      const lineL = (u0: number, v0: number, u1: number, v1: number, col: string = E.tinta, sw = 0.8) => { const a = P(u0, v0), b = P(u1, v1); line(a[0], a[1], b[0], b[1], col, sw); };
      const t = q.t, fb = COCINA_DEF.fondo_bajo;
      // Bajos
      let mu = 0;
      const lados = ladosTirador(t.bajos.map((m) => (m.tipo === 'regleta' || m.tipo === 'hueco' ? { tipo: 'fijo' as const, ancho: m.ancho } : { tipo: 'puerta' as const, ancho: m.ancho })));
      const encimera: [number, number][] = [];
      t.bajos.forEach((m, i) => {
        const w = m.ancho, ev = m.electro ?? [];
        const col = m.tipo === 'columna' || m.tipo === 'columna_hm', nev = m.tipo === 'hueco' && ev.includes('nevera');
        if (!col && !nev && t.encimera !== false) { const u = encimera[encimera.length - 1]; if (u && Math.abs(u[1] - mu) < 0.01) u[1] = mu + w; else encimera.push([mu, mu + w]); }
        if (m.tipo === 'regleta') { rectL(mu, fb - 2, mu + w, fb + D.puerta, { fill: E.tablero, stroke: E.tinta, sw: 0.6 }); mu += w; return; }
        if (m.tipo === 'hueco') {
          if (nev) { rectL(mu + 1, 1, mu + w - 1, fb + D.puerta, { fill: D.electro, stroke: D.electroBorde, sw: 0.7 }); const [cx, cy] = P(mu + w / 2, fb / 2); text(cx, cy + 2, 'NEV.', 5.5, E.etiqueta, 'middle'); }
          else if (ev.length) { const [cx, cy] = P(mu + w / 2, fb / 2); text(cx, cy + 2, ev[0] === 'lavavajillas' ? 'LV' : ev[0] === 'lavadora' ? 'LAV.' : '', 5.5, E.suave, 'middle'); }
          mu += w; return;
        }
        rectL(mu, 0, mu + w, fb, { fill: E.fondoInterior, stroke: E.tinta, sw: 0.7 });
        rectL(mu, fb, mu + w, fb + D.puerta, { fill: D.frente, stroke: E.tinta, sw: 0.6 });
        if (col) { lineL(mu, 0, mu + w, fb, E.suave, 0.5); lineL(mu + w, 0, mu, fb, E.suave, 0.5); }
        // Apertura de puertas (las columnas y bajos con puertas)
        const f = m.frente!;
        if (f.tipo === 'puertas' && m.tipo !== 'esquinero') {
          const n = Math.max(1, f.puertas ?? 1), wp = w / n, vF = fb + D.puerta;
          for (let kk = 0; kk < n; kk++) {
            const pu = mu + wp * kk, ladoT = n === 1 ? (lados[i] ?? 'der') : kk % 2 === 0 ? 'der' : 'izq';
            const bis = ladoT === 'der' ? pu : pu + wp, dir = ladoT === 'der' ? 1 : -1;
            lineL(bis, vF, bis, vF + wp, E.tinta, 0.6);
            for (let s2 = 0; s2 < 10; s2++) {
              const a0 = (s2 / 10) * Math.PI / 2, a1 = ((s2 + 1) / 10) * Math.PI / 2;
              lineL(bis + dir * wp * Math.cos(a0), vF + wp * Math.sin(a0), bis + dir * wp * Math.cos(a1), vF + wp * Math.sin(a1), E.cota, 0.4);
            }
          }
        } else if (f.tipo === 'cajones') {
          const a = P(mu + w / 2, fb + D.puerta + 1), b = P(mu + w / 2, fb + D.puerta + 9);
          flecha(a[0], a[1], b[0], b[1], E.cota);
        } else if (m.tipo === 'esquinero') {
          const wp = anchoPuerta(m, 2), lado = i === t.bajos.length - 1 ? 'izq' : 'der';
          const pu = lado === 'izq' ? mu : mu + w - wp;
          rectL(pu, fb, pu + wp, fb + D.puerta, { fill: D.frente, stroke: E.tinta, sw: 0.8 });
          const [cx, cy] = P(lado === 'izq' ? mu + wp + (w - wp) / 2 : mu + (w - wp) / 2, fb / 2); text(cx, cy + 2, 'rincón', 5, E.suave, 'middle');
        }
        if (ev.includes('placa')) for (const [du, dv] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.68], [0.7, 0.68]]) { const [cx, cy] = P(mu + w * du, fb * dv); circulo(cx, cy, Math.max(2.4, cm(w * 0.11)), { stroke: E.tinta, sw: 0.6 }); }
        if (ev.includes('fregadero') || m.tipo === 'fregadero') {
          rectL(mu + w * 0.18, fb * 0.25, mu + w * 0.82, fb * 0.82, { fill: E.acero, stroke: E.aceroBorde, sw: 0.7 });
          const [cx, cy] = P(mu + w / 2, fb * 0.14); circulo(cx, cy, 1.6, { fill: E.aceroBorde });
        }
        mu += w;
      });
      // Encimera (contorno) y altos (línea fina)
      for (const [a, b] of encimera) rectL(a, 0, b, COCINA_DEF.fondo_encimera, { stroke: D.encimera, sw: 1.1 });
      let au = 0;
      for (const m of t.altos ?? []) { if (m.tipo !== 'hueco') rectL(au, 0, au + m.ancho, fondoModulo(m.tipo) + D.puerta, { stroke: E.suave, sw: 0.5 }); au += m.ancho; }
      // Cotas: largo por detrás y fondos en el extremo libre
      const cota = (u0: number, v0: number, u1: number, v1: number, txt: string) => {
        const [ax, ay] = P(u0, v0), [bx, by] = P(u1, v1);
        if (Math.abs(ay - by) < 0.01) cotaH(Math.min(ax, bx), Math.max(ax, bx), ay, txt);
        else cotaV(ax, Math.min(ay, by), Math.max(ay, by), txt);
      };
      cota(0, -E.planta_cota, q.ancho, -E.planta_cota, `${fmtCm(q.ancho)} cm`);
      const s1 = q.lado === 'izq' ? -1 : 1, u1 = q.lado === 'izq' ? 0 : q.ancho;
      cota(u1 + s1 * E.planta_cota, 0, u1 + s1 * E.planta_cota, FONDO_TOTAL, fmtCm(FONDO_TOTAL));
      cota(u1 + s1 * 2 * E.planta_cota, 0, u1 + s1 * 2 * E.planta_cota, COCINA_DEF.fondo_encimera, `enc. ${fmtCm(COCINA_DEF.fondo_encimera)}`);
      if ((t.altos ?? []).some((m) => m.tipo !== 'hueco')) cota(u1 + s1 * 3 * E.planta_cota, 0, u1 + s1 * 3 * E.planta_cota, COCINA_DEF.fondo_alto, `altos ${fmtCm(COCINA_DEF.fondo_alto)}`);
      if (c.tramos.length > 1 && t.nombre) {
        // Nombre del tramo detrás de su cota de largo (en los tramos girados, al lado, sin pisar la cota)
        if (Math.abs(q.u[0]) > 0.5) { const [cx, cy] = P(q.ancho / 2, -E.planta_cota - 14); text(cx, cy, t.nombre.toUpperCase(), 6.5, E.etiqueta, 'middle', true); }
        else { const [cx, cy] = P(q.ancho / 2, -E.planta_cota - 8); const fuera = -q.v[0] > 0; text(cx + (fuera ? 10 : -10), cy + 2, t.nombre.toUpperCase(), 6.5, E.etiqueta, fuera ? 'start' : 'end', true); }
      }
    }
    const forma = c.tramos.some((t) => t.colocacion === 'isla') ? 'con isla' : c.tramos.filter((t) => t.colocacion === 'esquina_izq' || t.colocacion === 'esquina_der').length === 2 ? 'en U' : c.tramos.some((t) => t.colocacion === 'esquina_izq' || t.colocacion === 'esquina_der') ? 'en L' : 'lineal';
    const pieY = (comp.principal || comp.lateral ? Math.max(suelo, top + hPl) : top + hPl) + cm(E.pie_vista);
    text(x + cm(k.x1 - k.x0) / 2, pieY, 'PLANTA', 8.5, E.tinta, 'middle', true);
    text(x + cm(k.x1 - k.x0) / 2, pieY + 10, `cocina ${forma}`, 7.5, E.cota, 'middle');
    x += cm(k.x1 - k.x0);
  }

  return { codigo: c.codigo, formato: 'A4', ancho: pg.w, alto: pg.h, prims, inicioDibujo, pagina: comp.principal ? 1 : 2 };
}

function capital(t: string): string { return t.toLowerCase().replace(/^./, (x) => x.toUpperCase()); }
export { TIPO_TXT };
