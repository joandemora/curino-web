// supabase/functions/_shared/estudio/mueble-alzado.ts
//
// Estudio Curino · dibujo de MUEBLES A MEDIDA, estilo Curino como los armarios
// (mismas primitivas, cabecera, cotas en cm con coma):
//   - Alzado INTERIOR (estantes, cajones interiores, cuberteros, baldas
//     extraíbles y LED rotulados) y EXTERIOR (puertas lisas, en arco y vitrina
//     con su trama de cristal, push señalado, tiradores, uñero, cajones y
//     huecos abiertos con fondo de espejo / madera / lacado).
//   - Sección lateral (vista «lateral») y planta (vista «planta»).
//   - Cotas en cadena que suman el total (montantes + cuerpos; zócalo + zonas +
//     tapa). Misma regla de hoja 2 que armarios y escala común en presupuestos.

import { type Lamina, type Prim, type Medir, medirAprox, fmtCm, ESTILO, PAGINA, PAGINA_PRESUPUESTO, LOGO_ANCHO_PT, LOGO_CAJA_ALTO, ALTO_UTIL, CENTRO_VERTICAL } from './alzado.ts';
import { LOGO_ALTO, LOGO_ANCHO } from './logo.ts';
import type { Proyecto } from './esquema.ts';
import { type Mueble, type ZonaMueble, anchoMueble, altoMueble, montanteDe } from './mueble-esquema.ts';

export const MUEBLE_DIBUJO = {
  frente: '#f3f0ea', cristal: '#dfe9ee', espejo: '#e3ebef', madera: '#e7dbc6', lacado: '#f1eee7', led: '#d9a400',
  cajon_interior: 18, cubertero: 8, balda: 2.2, balda_paso: 21, tirador: 12
};
interface Composicion { principal: boolean; lateral: boolean; planta: boolean }
const SOLO: Composicion = { principal: true, lateral: false, planta: false };
const A3_DESDE_CM = 480;

function formato(m: Mueble): 'A3' | 'A4' { return 2 * anchoMueble(m) + ESTILO.hueco_vistas > A3_DESDE_CM ? 'A3' : 'A4'; }
function anchoFila(m: Mueble, o: Composicion): number {
  const E = ESTILO, W = anchoMueble(m);
  let w = 0, primero = true;
  const gap = (g: number) => { if (!primero) w += g; primero = false; };
  if (o.principal) { gap(E.hueco_cuerpos); w += 2 * W + E.hueco_vistas; }
  if (o.lateral) { gap(E.hueco_cuerpos); w += m.fondo; }
  if (o.planta) { gap(E.hueco_cuerpos); w += W; }
  return w;
}
function escala(m: Mueble, o: Composicion, pres: boolean): number {
  const E = ESTILO, pg = pres ? PAGINA_PRESUPUESTO : PAGINA[formato(m)];
  const alto = o.principal || o.lateral ? altoMueble(m) : m.fondo;
  return Math.min((pg.mr - pg.ml) / (anchoFila(m, o) + E.margen_izq_cm + E.margen_der_cm), (pg.h * ALTO_UTIL) / alto);
}

/** Láminas de un mueble: interior + exterior y, si caben, sección y planta (si no, hoja 2). */
export function laminasMueble(m: Mueble, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir = medirAprox): Lamina[] {
  const lateral = !!m.vistas?.includes('lateral'), planta = !!m.vistas?.includes('planta');
  if (!lateral && !planta) return [lamina(m, p, medir, SOLO)];
  const todo = { principal: true, lateral, planta };
  if (escala(m, todo, false) >= ESTILO.vistas_minimo * escala(m, SOLO, false)) return [lamina(m, p, medir, todo)];
  return [lamina(m, p, medir, SOLO), lamina(m, p, medir, { principal: false, lateral, planta })];
}
/** Presupuesto: interior + exterior en una fila y sección + planta en otra, a la misma escala. */
export function laminasMueblePresupuesto(m: Mueble, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir = medirAprox): Lamina[] {
  const lateral = !!m.vistas?.includes('lateral'), planta = !!m.vistas?.includes('planta');
  const extra: Composicion = { principal: false, lateral, planta };
  const s = Math.min(escala(m, SOLO, true), lateral || planta ? escala(m, extra, true) : Infinity);
  const out = [lamina(m, p, medir, SOLO, true, s)];
  if (lateral || planta) out.push(lamina(m, p, medir, extra, true, s));
  return out.map((l) => ({ ...l, grupo: m.codigo }));
}

function lamina(m: Mueble, p: Pick<Proyecto, 'referencia' | 'cliente'>, medir: Medir, comp: Composicion, pres = false, escalaFija?: number): Lamina {
  const E = ESTILO, D = MUEBLE_DIBUJO;
  const fmt = formato(m), pg = pres ? PAGINA_PRESUPUESTO : PAGINA[fmt], prims: Prim[] = [];
  const s = escalaFija ?? (comp.principal ? escala(m, comp, pres) : Math.min(escala(m, comp, pres), escala(m, SOLO, pres)));
  const cm = (v: number) => v * s;
  const W = anchoMueble(m), H = altoMueble(m), mt = montanteDe(m), z = m.zocalo ?? 0, tapa = m.tapa?.grosor ?? 0;
  let x = (pg.ml + pg.mr) / 2 - cm(anchoFila(m, comp)) / 2 + cm(E.margen_izq_cm - E.margen_der_cm) / 2;
  const suelo = pg.h * CENTRO_VERTICAL + cm(H) / 2;
  let primero = true;
  const separar = (g: number) => { if (!primero) x += cm(g); primero = false; };

  // ── primitivas ──
  const rect = (x0: number, y0: number, w: number, h: number, o: Partial<Extract<Prim, { k: 'rect' }>> = {}) => prims.push({ k: 'rect', x: x0, y: y0, w, h, ...o });
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string = E.tinta, sw = 0.8) => prims.push({ k: 'line', x1, y1, x2, y2, stroke, sw });
  const poly = (pts: [number, number][], o: Partial<Extract<Prim, { k: 'poly' }>>) => prims.push({ k: 'poly', pts, ...o });
  const text = (x0: number, y0: number, t: string, size: number, color: string, anchor: 'start' | 'middle' | 'end' = 'start', bold = false, vertical = false) =>
    prims.push({ k: 'text', x: x0, y: y0, t, size, color, anchor, bold, vertical });
  const tablero = (x0: number, y0: number, w: number, h: number) => rect(x0, y0, w, h, { fill: E.tablero, stroke: E.tinta, sw: 0.6 });
  const etiqueta = (cx: number, cy: number, t: string, size = 6.5) => {
    const w = medir(t, size, false), h = size * 1.5;
    rect(cx - w / 2 - 1.2, cy - h / 2, w + 2.4, h, { fill: '#ffffff', opacity: 0.85 });
    text(cx, cy + 0.36 * size, t, size, E.etiqueta, 'middle');
  };
  const cotaH = (xa: number, xb: number, y: number, t: string, chica = false) => {
    const k = E.cota;
    line(xa, y - 4, xa, y + 4, k, 0.6); line(xb, y - 4, xb, y + 4, k, 0.6);
    line(xa, y, xb, y, k, 0.6);
    if (xb - xa > 9) { line(xa + 0.8, y, xa + 4.3, y - 1.8, k, 0.6); line(xa + 0.8, y, xa + 4.3, y + 1.8, k, 0.6); line(xb - 0.8, y, xb - 4.3, y - 1.8, k, 0.6); line(xb - 0.8, y, xb - 4.3, y + 1.8, k, 0.6); }
    else { line(xa - 1.4, y + 1.4, xa + 1.4, y - 1.4, k, 0.6); line(xb - 1.4, y + 1.4, xb + 1.4, y - 1.4, k, 0.6); }
    text((xa + xb) / 2, y - (chica ? 3 : 5.5), t, chica ? 5.5 : 7, k, 'middle');
  };
  const cotaV = (x0: number, ya: number, yb: number, t: string, lado: 'izq' | 'der' = 'der') => {
    const k = E.cota;
    line(x0 - 4, ya, x0 + 4, ya, k, 0.6); line(x0 - 4, yb, x0 + 4, yb, k, 0.6); line(x0, ya, x0, yb, k, 0.6);
    if (yb - ya > 9) { line(x0, ya + 0.8, x0 - 1.8, ya + 4.3, k, 0.6); line(x0, ya + 0.8, x0 + 1.8, ya + 4.3, k, 0.6); line(x0, yb - 0.8, x0 - 1.8, yb - 4.3, k, 0.6); line(x0, yb - 0.8, x0 + 1.8, yb - 4.3, k, 0.6); }
    if (yb - ya > medir(t, 6.5, false) + 4) text(x0 + (lado === 'izq' ? -4.5 : 8.5), (ya + yb) / 2, t, 6.5, k, 'middle', false, true);
    else text(x0 + (lado === 'izq' ? -3.5 : 3.5), (ya + yb) / 2 + 2.2, t, 5.5, k, lado === 'izq' ? 'end' : 'start');
  };
  /** Marcas de reflejo (cristal / espejo): dos trazos cortos en diagonal. */
  const reflejo = (x0: number, y0: number, w: number, h: number) => {
    const l = Math.min(w, h) * 0.22;
    for (const [fx, fy] of [[0.22, 0.3], [0.62, 0.62]] as [number, number][]) {
      const cx = x0 + w * fx, cy = y0 + h * fy;
      line(cx, cy + l / 2, cx + l / 2, cy, E.suave, 0.5); line(cx + l * 0.25, cy + l * 0.6, cx + l * 0.75, cy + l * 0.1, E.suave, 0.5);
    }
  };
  /** Contorno de una zona con arco (de ancho w, radio r) como polígono. */
  const contornoArco = (x0: number, yTop: number, yBot: number, w: number, r: number): [number, number][] => {
    const rr = Math.min(r, w / 2), cxL = x0 + rr, cxR = x0 + w - rr, cy = yTop + rr, pts: [number, number][] = [[x0, yBot], [x0, cy]];
    for (let i = 0; i <= 16; i++) { const a = Math.PI + (i / 16) * Math.PI / 2; pts.push([cxL + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
    for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI / 2; pts.push([cxR + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
    pts.push([x0 + w, yBot]);
    return pts;
  };
  /** Altura (y) del borde superior de un arco en la abscisa px. */
  const yArco = (x0: number, yTop: number, w: number, r: number, px: number) => {
    const rr = Math.min(r, w / 2), cy = yTop + rr, dx = px < x0 + rr ? x0 + rr - px : px > x0 + w - rr ? px - (x0 + w - rr) : 0;
    return dx > 0 ? cy - Math.sqrt(Math.max(0, rr * rr - dx * dx)) : yTop;
  };

  // ── Cabecera y pie ──
  const logoAlto = (LOGO_ANCHO_PT * LOGO_ALTO) / LOGO_ANCHO;
  prims.push({ k: 'logo', x: pg.logo[0], y: pg.logo[1] + LOGO_CAJA_ALTO - logoAlto, h: logoAlto, color: E.tinta });
  text(pg.ml, pg.titulo, `${m.codigo}  ${m.titulo}`, 11, E.tinta, 'start', true);
  text(pg.ml, pg.subtitulo, `${m.cuerpos.length} ${m.cuerpos.length === 1 ? 'cuerpo' : 'cuerpos'}: ${m.cuerpos.map((c) => fmtCm(c.ancho)).join(' + ')} · ${fmtCm(W)} × ${fmtCm(H)} × ${fmtCm(m.fondo)} cm`, 9, E.subtitulo);
  text(pg.mr, pg.der1, [comp.principal ? 'ALZADO INTERIOR + EXTERIOR' : '', comp.lateral ? 'SECCIÓN' : '', comp.planta ? 'PLANTA' : ''].filter(Boolean).join(' + '), 8, E.cota, 'end');
  text(pg.mr, pg.der2, `${m.materiales?.exterior ? `Exterior ${m.materiales.exterior}` : 'Materiales a definir'} · cotas en cm`, 8, E.cota, 'end');
  const pie = [p.referencia ? `Presupuesto ${p.referencia}` : '', p.cliente ?? ''].filter(Boolean).join(' · ');
  if (pie) text(pg.mr, pg.pie, pie, 7.5, E.suave, 'end');
  if (m.notas) text(pg.ml, pg.pie, m.notas, 6.5, E.suave);
  const inicioDibujo = prims.length;

  // Posiciones (cm desde el borde izquierdo / desde el suelo)
  const xCuerpo = (i: number) => mt + m.cuerpos.slice(0, i).reduce((s2, c) => s2 + c.ancho + mt, 0);
  const yZona = (c: number, iz: number) => z + m.cuerpos[c].zonas.slice(0, iz).reduce((s2, zz) => s2 + zz.alto, 0);

  if (comp.principal) { separar(E.hueco_cuerpos); alzado('interior'); separar(E.hueco_vistas); alzado('exterior'); }
  if (comp.lateral) { separar(E.hueco_cuerpos); seccion(); }
  if (comp.planta) { separar(E.hueco_cuerpos); planta(); }

  function carcasa(x0: number) {
    const yTop = suelo - cm(H);
    rect(x0, yTop, cm(W), cm(H - z), { fill: E.fondoInterior });
    if (z > 0) rect(x0 + cm(mt), suelo - cm(z), cm(W - 2 * mt), cm(z), { fill: E.zocalo, stroke: E.tinta, sw: 0.6 });
    for (let i = 0; i <= m.cuerpos.length; i++) tablero(x0 + cm(i === 0 ? 0 : xCuerpo(i) - mt), yTop + cm(tapa), cm(mt), cm(H - z - tapa));
    if (tapa > 0) tablero(x0, yTop, cm(W), cm(tapa));
    line(x0 - cm(E.suelo_extra), suelo, x0 + cm(W) + cm(E.suelo_extra), suelo, E.tinta, 1.2);
  }

  function alzado(vista: 'interior' | 'exterior') {
    const x0 = x;
    carcasa(x0);
    m.cuerpos.forEach((c, ic) => {
      const cx0 = x0 + cm(xCuerpo(ic)), w = cm(c.ancho);
      c.zonas.forEach((zn, iz) => {
        const yBot = suelo - cm(yZona(ic, iz)), yTop = suelo - cm(yZona(ic, iz) + zn.alto);
        if (iz > 0) line(cx0, yBot, cx0 + w, yBot, E.tinta, 0.8);
        if (vista === 'exterior') zonaExterior(zn, cx0, w, yTop, yBot);
        else zonaInterior(zn, cx0, w, yTop, yBot);
      });
    });
    // Cotas: cadena de montantes y cuerpos (suma el total) y total encima; alturas a la derecha y total a la izquierda
    const yCad = suelo + 13;
    let acc = 0;
    const tramos: [number, number, boolean][] = [];
    m.cuerpos.forEach((c) => { tramos.push([mt, acc, true]); acc += mt; tramos.push([c.ancho, acc, false]); acc += c.ancho; });
    tramos.push([mt, acc, true]);
    for (const [v, a, chico] of tramos) cotaH(x0 + cm(a), x0 + cm(a + v), yCad, fmtCm(v), chico);
    cotaH(x0, x0 + cm(W), suelo - cm(H) - 12, `${fmtCm(W)} cm`);
    if (vista === 'exterior') {
      const xd = x0 + cm(W) + 9;
      let y = 0;
      const cad = [...(z ? [z] : []), ...m.cuerpos[0].zonas.map((zz) => zz.alto), ...(tapa ? [tapa] : [])];
      for (const v of cad) { cotaV(xd, suelo - cm(y + v), suelo - cm(y), fmtCm(v)); y += v; }
    } else cotaV(x0 - 12, suelo - cm(H), suelo, `${fmtCm(H)} cm`, 'izq');
    text(x0 + cm(W) / 2, suelo + cm(E.pie_vista) * 0.62 + 14, vista === 'interior' ? 'INTERIOR' : 'EXTERIOR', 8.5, E.tinta, 'middle', true);
    x += cm(W);
  }

  function zonaExterior(zn: ZonaMueble, cx0: number, w: number, yTop: number, yBot: number) {
    const pz = zn.puertas;
    if (zn.tipo === 'puertas' && pz) {
      const fill = pz.vitrina ? D.cristal : D.frente, r = pz.arco ? cm(pz.radio ?? 1e6) : 0;
      if (pz.arco) poly(contornoArco(cx0, yTop, yBot, w, r), { fill, stroke: E.tinta, sw: 0.9 });
      else rect(cx0, yTop, w, yBot - yTop, { fill, stroke: E.tinta, sw: 0.9 });
      // Vitrina: los estantes se ven a través del cristal
      if (pz.vitrina) estantes(zn, cx0, w, yTop + (pz.arco ? Math.min(r, w / 2) : 0), yBot);
      const wp = w / pz.n;
      for (let k = 0; k < pz.n; k++) {
        const px = cx0 + k * wp;
        if (k > 0) line(px, pz.arco ? yArco(cx0, yTop, w, r, px) : yTop, px, yBot, E.tinta, 0.9);
        const yi = pz.arco ? Math.max(yArco(cx0, yTop, w, r, px + wp / 2), yTop) + Math.min(r, w / 2) * 0.5 : yTop;
        if (pz.vitrina) reflejo(px, yi, wp, yBot - yi);
        // Agarre: push señalado, tirador junto al canto de apertura (por parejas), uñero arriba
        const ladoDer = pz.n === 1 ? true : k % 2 === 0;
        if (pz.agarre === 'push') { const cy = (yi + yBot) / 2; poly(circuloPts(px + (ladoDer ? wp - 5 : 5), cy, 1.3), { fill: E.tinta }); text(px + wp / 2, yBot - 3.5, 'push', 5.5, E.cota, 'middle'); }
        else if (pz.agarre === 'unero') rect(px + 0.6, (pz.arco ? yi : yTop) + 0.6, wp - 1.2, Math.min(2.2, (yBot - yTop) * 0.06), { fill: E.uneroDm, stroke: E.tinta, sw: 0.3 });
        else if (pz.agarre !== 'ninguno') { const tx = px + (ladoDer ? wp - 3.2 : 3.2), cy = (yi + yBot) / 2; line(tx, cy - cm(D.tirador) / 2, tx, cy + cm(D.tirador) / 2, E.tinta, 1.4); }
      }
    } else if (zn.tipo === 'cajones' && zn.cajones) {
      let y = yTop;
      for (const hc of zn.cajones.alturas) {
        const h = cm(hc);
        rect(cx0 + 0.6, y + 0.6, w - 1.2, h - 1.2, { fill: D.frente, stroke: E.tinta, sw: 0.8 });
        const cy = y + h / 2;
        if (zn.cajones.agarre === 'push') poly(circuloPts(cx0 + w / 2, cy, 1.3), { fill: E.tinta });
        else if (zn.cajones.agarre === 'unero') rect(cx0 + 1.2, y + 1.2, w - 2.4, Math.min(2.2, h * 0.2), { fill: E.uneroDm, stroke: E.tinta, sw: 0.3 });
        else if (zn.cajones.agarre !== 'ninguno') line(cx0 + w / 2 - cm(D.tirador) / 2, y + Math.min(h / 2, cm(4)), cx0 + w / 2 + cm(D.tirador) / 2, y + Math.min(h / 2, cm(4)), E.tinta, 1.2);
        y += h;
      }
    } else {
      // Hueco abierto: fondo y estantes a la vista
      const fill = zn.fondo === 'espejo' ? D.espejo : zn.fondo === 'madera' ? D.madera : zn.fondo === 'lacado' ? D.lacado : E.fondoInterior;
      rect(cx0, yTop, w, yBot - yTop, { fill });
      if (zn.fondo === 'espejo') { reflejo(cx0, yTop, w, yBot - yTop); etiqueta(cx0 + w / 2, yBot - 8, 'Fondo de espejo'); }
      estantes(zn, cx0, w, yTop, yBot);
    }
  }

  function zonaInterior(zn: ZonaMueble, cx0: number, w: number, yTop: number, yBot: number) {
    const it = zn.interior ?? {}, pz = zn.puertas;
    if (zn.tipo === 'abierta' && zn.fondo === 'espejo') { rect(cx0, yTop, w, yBot - yTop, { fill: D.espejo }); reflejo(cx0, yTop, w, yBot - yTop); etiqueta(cx0 + w / 2, yBot - 8, 'Fondo de espejo'); }
    if (pz?.arco) poly(contornoArco(cx0, yTop, yBot, w, cm(pz.radio ?? 1e6)), { stroke: E.tinta, sw: 0.7 });
    if (zn.tipo === 'cajones' && zn.cajones) {
      let y = yTop;
      zn.cajones.alturas.forEach((hc, k) => { const h = cm(hc); rect(cx0 + 1.5, y + 1, w - 3, h - 2, { fill: E.cajonInterior, stroke: E.suave, sw: 0.5 }); if (k === 0) etiqueta(cx0 + w / 2, y + h / 2, zn.cajones!.etiqueta ?? (zn.cajones!.cubertero ? 'Cajón con cubertero' : 'Cajón')); y += h; });
      return;
    }
    // De arriba abajo: cajones interiores, cuberteros, baldas extraíbles; los estantes, en el espacio que queda
    let y = yTop + (pz?.arco ? Math.min(cm(pz.radio ?? 1e6), w / 2) : 0);
    const rotulo = (re: RegExp, def: string) => it.etiquetas?.find((e) => re.test(e)) ?? def;
    for (let k = 0; k < (it.cajones ?? 0); k++) { const h = cm(D.cajon_interior); rect(cx0 + 1.5, y + 1, w - 3, h - 2, { fill: E.cajonInterior, stroke: E.suave, sw: 0.5 }); etiqueta(cx0 + w / 2, y + h / 2, rotulo(/caj[oó]n/i, 'Cajón')); y += h; }
    for (let k = 0; k < (it.cuberteros ?? 0); k++) { const h = cm(D.cubertero + 2); rect(cx0 + 1.5, y + 1, w - 3, cm(D.cubertero), { fill: E.cajonInterior, stroke: E.suave, sw: 0.5 }); etiqueta(cx0 + w / 2, y + 1 + cm(D.cubertero) / 2, rotulo(/cubert/i, 'Cubertero')); y += h; }
    for (let k = 0; k < (it.baldas_extraibles ?? 0); k++) { const h = cm(D.balda_paso); tablero(cx0 + 1.5, y + h - cm(D.balda), w - 3, cm(D.balda)); etiqueta(cx0 + w / 2, y + h - cm(D.balda) - 5, rotulo(/balda/i, 'Balda extraíble')); y += h; }
    estantes(zn, cx0, w, y, yBot, true);
    if (it.led) line(cx0 + 2, yTop + 2.5, cx0 + w - 2, yTop + 2.5, D.led, 1.4);
  }

  function estantes(zn: ZonaMueble, cx0: number, w: number, yTop: number, yBot: number, rotular = false) {
    const it = zn.interior ?? {}, n = (it.estantes ?? 0) + (it.estantes_vidrio ?? 0);
    if (!n || yBot - yTop < 4) return;
    const g = cm(it.grosor_estantes ?? 1.9), paso = (yBot - yTop - n * g) / (n + 1);
    for (let k = 1; k <= n; k++) {
      const y = yTop + k * paso + (k - 1) * g;
      if (k > (it.estantes ?? 0)) rect(cx0 + 1, y, w - 2, g, { fill: D.cristal, stroke: E.tinta, sw: 0.5 }); else tablero(cx0 + 1, y, w - 2, g);
    }
    if (rotular) { const t = it.etiquetas?.find((e) => /estante/i.test(e)); if (t || (it.grosor_estantes && it.grosor_estantes > 2.05)) etiqueta(cx0 + w / 2, yTop + paso / 2, t ?? `Estantes ${Math.round((it.grosor_estantes ?? 1.9) * 10)} mm`); }
  }

  function circuloPts(cx: number, cy: number, r: number): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < 12; i++) out.push([cx + r * Math.cos((i / 12) * 2 * Math.PI), cy + r * Math.sin((i / 12) * 2 * Math.PI)]);
    return out;
  }

  function seccion() {
    const x0 = x, F = m.fondo, c0 = m.cuerpos[0], puerta = 2;
    const yTop = suelo - cm(H);
    rect(x0, yTop, cm(F), cm(H - z), { fill: E.fondoInterior, stroke: E.tinta, sw: 0.8 });
    tablero(x0, yTop + cm(tapa), cm(1.9), cm(H - z - tapa));   // trasera
    if (tapa) tablero(x0, yTop, cm(F), cm(tapa));
    if (z) rect(x0 + cm(3), suelo - cm(z), cm(F - 6), cm(z), { fill: E.zocalo, stroke: E.tinta, sw: 0.6 });
    line(x0 - cm(E.suelo_extra), suelo, x0 + cm(F) + cm(E.suelo_extra), suelo, E.tinta, 1.2);
    c0.zonas.forEach((zn, iz) => {
      const yBot = suelo - cm(yZona(0, iz)), yT = suelo - cm(yZona(0, iz) + zn.alto);
      if (iz > 0) tablero(x0, yBot - cm(1.9) / 2, cm(F), cm(1.9));
      if (zn.tipo !== 'abierta') rect(x0 + cm(F - puerta), yT + 0.6, cm(puerta), yBot - yT - 1.2, { fill: zn.puertas?.vitrina ? D.cristal : D.frente, stroke: E.tinta, sw: 0.7 });
      if (zn.tipo === 'abierta' && zn.fondo === 'espejo') rect(x0 + cm(1.9), yT, cm(0.6), yBot - yT, { fill: D.espejo, stroke: E.suave, sw: 0.4 });
      // Interior de perfil, con el mismo orden que el alzado interior (de arriba abajo: cajones, cuberteros, baldas; estantes en lo que queda)
      const it = zn.interior ?? {}, xi = x0 + cm(1.9) + 1, wi = cm(F - 1.9 - puerta - 1) - 2;
      let y = yT + (zn.puertas?.arco ? Math.min(cm(zn.puertas.radio ?? 1e6), cm(c0.ancho) / 2) * 0.35 : 0);
      if (zn.tipo === 'cajones' && zn.cajones) for (const hc of zn.cajones.alturas) { rect(xi, y + 1, wi, cm(hc) - 2, { fill: E.cajonInterior, stroke: E.suave, sw: 0.5 }); y += cm(hc); }
      for (let k = 0; k < (it.cajones ?? 0); k++) { rect(xi, y + 1, wi, cm(D.cajon_interior) - 2, { fill: E.cajonInterior, stroke: E.suave, sw: 0.5 }); y += cm(D.cajon_interior); }
      for (let k = 0; k < (it.cuberteros ?? 0); k++) { rect(xi, y + 1, wi, cm(D.cubertero), { fill: E.cajonInterior, stroke: E.suave, sw: 0.5 }); y += cm(D.cubertero + 2); }
      for (let k = 0; k < (it.baldas_extraibles ?? 0); k++) { tablero(xi, y + cm(D.balda_paso) - cm(D.balda), wi, cm(D.balda)); y += cm(D.balda_paso); }
      const n = (it.estantes ?? 0) + (it.estantes_vidrio ?? 0);
      if (n && yBot - y > 4) { const g = cm(it.grosor_estantes ?? 1.9), paso = (yBot - y - n * g) / (n + 1); for (let k = 1; k <= n; k++) tablero(xi, y + k * paso + (k - 1) * g, wi, g); }
    });
    cotaH(x0, x0 + cm(F), yTop - 12, `fondo ${fmtCm(F)}`);
    cotaV(x0 - 12, yTop, suelo, `${fmtCm(H)} cm`, 'izq');
    { let y = 0; for (const v of [...(z ? [z] : []), ...c0.zonas.map((zz) => zz.alto), ...(tapa ? [tapa] : [])]) { cotaV(x0 + cm(F) + 9, suelo - cm(y + v), suelo - cm(y), fmtCm(v)); y += v; } }
    text(x0 + cm(F) / 2, suelo + cm(E.pie_vista) * 0.62 + 14, 'SECCIÓN', 8.5, E.tinta, 'middle', true);
    text(x0 + cm(F) / 2, suelo + cm(E.pie_vista) * 0.62 + 24, (m.cuerpos[0].nombre || (m.cuerpos.length > 1 ? 'cuerpo izquierdo' : 'cuerpo')).toLowerCase(), 7.5, E.cota, 'middle');
    x += cm(F);
  }

  function planta() {
    const x0 = x, F = m.fondo;
    const yTop = (comp.principal || comp.lateral) ? suelo - cm(H) / 2 - cm(F) / 2 : pg.h * CENTRO_VERTICAL - cm(F) / 2;
    rect(x0, yTop, cm(W), cm(F), { fill: E.fondoInterior, stroke: E.tinta, sw: 0.8 });
    tablero(x0, yTop, cm(W), cm(1.9));
    for (let i = 0; i <= m.cuerpos.length; i++) tablero(x0 + cm(i === 0 ? 0 : xCuerpo(i) - mt), yTop, cm(mt), cm(F));
    line(x0, yTop + cm(F), x0 + cm(W), yTop + cm(F), E.tinta, 1.2);
    cotaH(x0, x0 + cm(W), yTop - 12, `${fmtCm(W)} cm`);
    cotaV(x0 - 12, yTop, yTop + cm(F), `fondo ${fmtCm(F)}`, 'izq');
    text(x0 + cm(W) / 2, yTop + cm(F) + 30, 'PLANTA', 8.5, E.tinta, 'middle', true);
    x += cm(W);
  }

  return { codigo: m.codigo, formato: fmt, ancho: pg.w, alto: pg.h, prims, inicioDibujo, pagina: comp.principal ? 1 : 2 };
}
