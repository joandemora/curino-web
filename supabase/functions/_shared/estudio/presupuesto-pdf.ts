// supabase/functions/_shared/estudio/presupuesto-pdf.ts
//
// Estudio Curino · PDF del presupuesto (F3). A4 vertical calcado del
// presupuesto de referencia Z2606941 v2: marco negro, Open Sans; página 1 con
// cabecera (logo, datos del emisor, lema, «PRESUPUESTO», atención/proyecto/
// nº/validez); una partida por página con su caja gris y el dibujo vectorial
// debajo; última página con forma de pago, totales, condiciones y firmas.
// Sin imports de pdf-lib: el llamador pasa documento, fuentes, helpers e
// imágenes ya incrustadas (logo/firma de la plantilla).

import type { Prim } from './alzado.ts';
import { LOGO_ALTO, LOGO_ANCHO, LOGO_PATH } from './logo.ts';
import { colorPdf, pintarPrims, type Documento, type Fuente, type FuentesPdf, type LibPdf, type Pagina } from './pdf.ts';
import { claveDe, fechaCorta, fechaLarga, precioTxt, totales, type DocPresupuesto, type Plantilla } from './presupuesto.ts';
import { eur, importeLinea } from './tarifa.ts';

export interface ImagenPdf { width: number; height: number }
interface PaginaImg extends Pagina { drawImage(img: ImagenPdf, o: Record<string, unknown>): void }
interface DocumentoImg extends Documento { addPage(size: [number, number]): PaginaImg }

export interface DibujoPartida { codigo: string; prims: Prim[]; caja: { x: number; y: number; w: number; h: number } }

const W = 595.28, H = 841.89;
const X0 = 42.8, X1 = 551.5;           // ancho útil
const MARCO = { x0: 17.7, x1: 576.6, top: 53.7, bottom: 787 };
const NEGRO = '#000000', GRIS_T = '#434343', GRIS_V = '#666666', GRIS_C = '#404040', GRIS_P = '#808080';

export function pintarPresupuesto(
  doc: DocumentoImg,
  o: { presupuesto: DocPresupuesto; plantilla: Plantilla; dibujos: DibujoPartida[]; ivaPct: number },
  f: { os: FuentesPdf; inter: FuentesPdf },
  lib: LibPdf,
  img: { logo?: ImagenPdf; firma?: ImagenPdf } = {}
): void {
  const { presupuesto: p, plantilla: pl } = o;
  // Sin ningún descuento no se muestra la columna ni la línea «DTO. PROFESIONAL»
  const conDto = p.partidas.some((x) => Number(x.dto_pct) > 0);
  const c = (hex: string) => colorPdf(lib, hex);
  const acento = pl.tipo === 'propia' && /^#[0-9a-f]{6}$/i.test(pl.color) ? pl.color : NEGRO;

  const txt = (pg: Pagina, x: number, y: number, t: string, size: number, color = NEGRO, bold = false, anchor: 'start' | 'end' | 'middle' = 'start') => {
    if (!t) return;
    const font = bold ? f.os.bold : f.os.regular;
    const w = font.widthOfTextAtSize(t, size);
    const dx = anchor === 'end' ? w : anchor === 'middle' ? w / 2 : 0;
    pg.drawText(t, { x: x - dx, y: H - y, size, font, color: c(color) });
  };
  const barra = (pg: Pagina, x0: number, y0: number, x1: number, y1: number, color = NEGRO) =>
    pg.drawRectangle({ x: x0, y: H - y1, width: x1 - x0, height: y1 - y0, color: c(color), borderWidth: 0 });
  const marco = (pg: Pagina, bottom: number, gruesoArriba: boolean, gruesoAbajo: boolean) => {
    barra(pg, MARCO.x0, MARCO.top, MARCO.x1, MARCO.top + 0.7, acento);
    barra(pg, MARCO.x0, MARCO.top, MARCO.x0 + 0.7, bottom, acento);
    barra(pg, MARCO.x1 - 0.6, MARCO.top, MARCO.x1, bottom, acento);
    barra(pg, MARCO.x0, bottom - 0.6, MARCO.x1, bottom, acento);
    if (gruesoArriba) barra(pg, MARCO.x0, MARCO.top, MARCO.x1, MARCO.top + 4.8, acento);
    if (gruesoAbajo) barra(pg, MARCO.x0, bottom - 4.7, MARCO.x1, bottom, acento);
  };
  const partir = (t: string, font: Fuente, size: number, ancho: number): string[] => {
    const out: string[] = [];
    for (const parrafo of t.split('\n')) {
      if (!parrafo.trim()) { out.push(''); continue; }
      let linea = '';
      for (const w of parrafo.split(/\s+/)) {
        const prueba = linea ? linea + ' ' + w : w;
        if (font.widthOfTextAtSize(prueba, size) > ancho && linea) { out.push(linea); linea = w; } else linea = prueba;
      }
      out.push(linea);
    }
    return out;
  };

  const cabeceraTabla = (pg: Pagina, y0: number) => {
    barra(pg, X0, y0, X1, y0 + 0.6);
    const s = 6.8, g = GRIS_C;
    txt(pg, 48, y0 + 11.5, 'CANTIDAD', s, g);
    txt(pg, 108, y0 + 11.5, 'PRODUCTO', s, g);
    txt(pg, 175, y0 + 11.5, 'MATERIAL Y GROSOR', s, g);
    txt(pg, 297, y0 + 6, 'MEDIDAS EN CM', s, g, false, 'middle');
    txt(pg, 258, y0 + 16, 'ANCHO', 5.4, g); txt(pg, 294, y0 + 16, 'ALTO', 5.4, g); txt(pg, 324, y0 + 16, 'FONDO', 5.4, g);
    txt(pg, 362, y0 + 11.5, 'PRECIO', s, g);
    txt(pg, 414, y0 + 11.5, 'PVP', s, g);
    if (conDto) { txt(pg, 470, y0 + 6, 'DTO.', s, g, false, 'middle'); txt(pg, 470, y0 + 17, 'PROFESIONAL', s, g, false, 'middle'); }
    txt(pg, 508, y0 + 11.5, 'IMPORTE', s, g);
    barra(pg, X0, y0 + 20.4, X1, y0 + 21);
    return y0 + 27;   // sin fila de «sección»
  };

  // ── Partidas ──
  const ivaTot = totales(p, o.ivaPct);
  p.partidas.forEach((pt, i) => {
    const pg = doc.addPage([W, H]);
    marco(pg, MARCO.bottom, i === 0, false);
    let y: number;
    if (i === 0) {
      // Cabecera del presupuesto
      if (pl.tipo === 'curino' || (!img.logo && !pl.empresa)) {
        const h = 27, k = h / LOGO_ALTO;
        pg.drawSvgPath(LOGO_PATH, { x: X0, y: H - 78, scale: k, color: c(acento) });
        void LOGO_ANCHO;
      } else if (img.logo) {
        const k = Math.min(150 / img.logo.width, 34 / img.logo.height);
        pg.drawImage(img.logo, { x: X0, y: H - 74 - img.logo.height * k, width: img.logo.width * k, height: img.logo.height * k });
      } else txt(pg, X0, 100, pl.empresa.toUpperCase(), 16, acento, true);
      [pl.direccion_1, pl.direccion_2, pl.email, pl.telefono].filter(Boolean)
        .forEach((l, k) => txt(pg, X1, 94 + k * 10, l, 5.4, GRIS_T, false, 'end'));
      if (pl.lema) txt(pg, X1, 151, pl.lema.toUpperCase(), 9.5, acento, true, 'end');
      txt(pg, 45, 186, 'PRESUPUESTO', 13.6, NEGRO);
      txt(pg, 45, 201, fechaCorta(p.fecha), 6.8, '#1d1e1e');
      // Cliente (nombre, NIF y dirección de facturación), proyecto (y su dirección), n.º y validez
      const campos: [number, number, string, string[]][] = [
        [45, 115, 'CLIENTE', [p.atencion, p.cliente_nif ? `NIF/CIF ${p.cliente_nif}` : '', p.direccion_facturacion || '']],
        [169, 110, 'PROYECTO', [p.proyecto, p.proyecto_2]],
        [286, 150, 'N.º DE PRESUPUESTO', [p.numero]], [445, 100, 'VALIDEZ OFERTA', [p.validez]]
      ];
      for (const [x, ancho, et, vs] of campos) {
        txt(pg, x, 224, et, 6.8, GRIS_T);
        // Como mucho 4 líneas por columna (la tabla empieza en 276,8)
        const lineas = vs.filter(Boolean).flatMap((v) => partir(String(v).toUpperCase(), f.os.regular, 5.4, ancho)).slice(0, 4);
        lineas.forEach((l, k) => txt(pg, x, 237 + k * 9, l, 5.4, GRIS_V));
      }
      y = cabeceraTabla(pg, 276.8);
    } else {
      y = cabeceraTabla(pg, MARCO.top);
    }

    // Caja gris con el texto
    const ancho = 262, lh = 10.9, s = 6.8;
    const lineas: { t: string; bold: boolean }[] = [{ t: pt.titulo, bold: true }];
    for (const l of partir(pt.subtitulo, f.os.regular, s, ancho)) lineas.push({ t: l, bold: false });
    const bloques = [pt.intro, pt.tecnico, pt.materiales].filter((b) => b && b.trim());
    for (const b of bloques) {
      lineas.push({ t: '', bold: false });
      for (const l of partir(b.trim(), f.os.regular, s, ancho)) lineas.push({ t: l, bold: false });
    }
    const top = y, alto = lineas.length * lh + 6;
    barra(pg, X0, top, X1, top + alto, '#f2f2f2');
    lineas.forEach((l, k) => txt(pg, 87, top + 6.5 + k * lh, l.t, s, NEGRO, l.bold));
    const ym = top + alto / 2 + 2.4;
    const linea = importeLinea(pt.precio, pt.cantidad, pt.dto_pct);
    txt(pg, 64, ym, String(pt.cantidad), s, NEGRO, false, 'middle');
    txt(pg, 395, ym, precioTxt(pt.precio), s, NEGRO, false, 'end');
    txt(pg, 441, ym, precioTxt(linea.pvp), s, GRIS_P, false, 'end');
    if (conDto) txt(pg, 470, ym, `${Math.round(pt.dto_pct * 100) / 100}%`, s, NEGRO, false, 'middle');
    txt(pg, 545, ym, precioTxt(linea.importe), s, NEGRO, true, 'end');

    // Dibujo(s) debajo de la partida: alzado y, si el armario tiene hoja extra (sección / planta), debajo
    const ds = pt.libre ? [] : o.dibujos.filter((x) => x.codigo === claveDe(pt));
    let y0 = top + alto + 4;
    const limite = MARCO.bottom - 12;
    for (const d of ds) {
      const hMax = Math.max(ds.length > 1 ? 90 : 120, Math.min(260, (limite - y0) / (ds.length > 1 ? ds.length - ds.indexOf(d) : 1) - 4));
      const k = Math.min(461 / d.caja.w, hMax / d.caja.h);
      const dx = 85 + (461 - d.caja.w * k) / 2 - d.caja.x * k;
      pintarPrims(pg, d.prims, H, f.inter, lib, { s: k, dx, dy: y0 - d.caja.y * k });
      y0 += d.caja.h * k + 8;
    }
  });

  // ── Última página: forma de pago, totales, condiciones y firmas ──
  let pg = doc.addPage([W, H]);
  let bottom = 770.4;
  const s = 6.8;
  txt(pg, 45, 111, 'FORMA DE PAGO', s, NEGRO, true);
  barra(pg, X0, 117, X1, 117.6);
  pl.forma_pago.forEach((fp, k) => { txt(pg, 45, 125 + k * 12, fp.concepto.toUpperCase(), s); txt(pg, 235, 125 + k * 12, `${fp.pct}%`, s); });
  let yb = 125 + pl.forma_pago.length * 12 + 6;
  if (pl.iban) {
    txt(pg, 45, yb, 'TRANSFERENCIA BANCARIA', s, NEGRO, true);
    barra(pg, X0, yb + 6, 250.9, yb + 6.6);
    txt(pg, 45, yb + 14, pl.iban, s);
    yb += 14;
  }
  const t = ivaTot;
  const pend = t.pendientes > 0;
  const fila = (y: number, et: string, v: string, colorV: string, bold = false) => {
    txt(pg, 488, y, et, s, NEGRO, bold, 'end');
    txt(pg, X1, y + 1, v, 8.2, colorV, bold, 'end');
  };
  fila(111, 'PVP SIN IVA', pend ? 'PENDIENTE' : eur(t.pvp), GRIS_P);
  if (conDto) fila(133, 'DTO.  PROFESIONAL', pend ? 'PENDIENTE' : eur(t.descuento), NEGRO);
  fila(150, 'IMPORTE TOTAL', pend ? 'PENDIENTE' : eur(t.importe), NEGRO, true);
  if (pl.mostrar_iva) {
    fila(166, `IVA (${o.ivaPct}%)`, pend ? 'PENDIENTE' : eur(t.iva), NEGRO);
    fila(183, 'TOTAL CON IVA', pend ? 'PENDIENTE' : eur(t.total), NEGRO, true);
  } else txt(pg, X1, 166, 'IMPUESTOS IVA NO INCLUIDOS', 5.4, NEGRO, false, 'end');
  if (pend) txt(pg, X1, pl.mostrar_iva ? 196 : 178, `${t.pendientes} ${t.pendientes === 1 ? 'partida' : 'partidas'} sin precio (tarifa PENDIENTE)`, 5.4, '#b42318', false, 'end');

  // Condiciones (títulos = líneas que acaban en «:»)
  let y = Math.max(263, yb + 50);
  const nueva = () => { marco(pg, MARCO.bottom, false, false); pg = doc.addPage([W, H]); y = 80; };
  for (const parrafo of pl.condiciones.split('\n')) {
    const titulo = /:\s*$/.test(parrafo.trim());
    for (const l of partir(parrafo, f.os.regular, s, X1 - 45)) {
      if (y > 740) nueva();
      txt(pg, 45, y, l, s, titulo ? NEGRO : GRIS_P);
      y += 10.4;
    }
  }

  // Lugar, fecha y firmas
  if (y > 610) nueva();
  y += 34;
  txt(pg, 45, y, `EN ${(pl.ciudad_firma || '').toUpperCase()} A,`.replace('EN  A,', ''), 8.2, GRIS_T);
  txt(pg, 45, y + 21, fechaLarga(p.fecha), 7.5, GRIS_T, true);
  y += 51;
  txt(pg, 45, y, 'CLIENTE', 8.2, GRIS_T, true);
  txt(pg, 45, y + 13, (p.atencion || '').toUpperCase(), 6.1, GRIS_T);
  txt(pg, 352, y, pl.empresa.toUpperCase(), 8.2, GRIS_T, true);
  const der = [pl.nif, [pl.direccion_1, pl.direccion_2].filter(Boolean).join(' ')].filter(Boolean);
  der.forEach((l, k) => txt(pg, 352, y + 13 + k * 10.6, l, 6.1, GRIS_T));
  let yf = y + 13 + der.length * 10.6;
  if (pl.cargo) { txt(pg, 352, yf, pl.cargo, 6.1, GRIS_T, true); yf += 10.6; }
  if (pl.firmante) { txt(pg, 352, yf, pl.firmante, 6.1, GRIS_T); yf += 10.6; }
  if (img.firma) {
    const k = Math.min(145 / img.firma.width, 67 / img.firma.height);
    pg.drawImage(img.firma, { x: 339, y: H - (yf + 4) - img.firma.height * k, width: img.firma.width * k, height: img.firma.height * k });
  }
  bottom = 770.4;
  marco(pg, bottom, false, true);
}
