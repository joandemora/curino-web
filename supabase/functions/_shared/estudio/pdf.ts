// supabase/functions/_shared/estudio/pdf.ts
//
// Estudio Curino · láminas (alzado.ts) → PDF vectorial con pdf-lib.
//
// Sin imports de pdf-lib aquí: quien llama pasa el documento, las fuentes
// Inter ya incrustadas (fontkit, subset) y los helpers rgb/degrees. Así el
// mismo código corre en las Edge Functions (Deno) y en las pruebas locales.
//
//   const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
//   const regular = await doc.embedFont(interRegular, { subset: true });
//   const bold = await doc.embedFont(interBold, { subset: true });
//   pintarLaminas(doc, laminas, { regular, bold }, { rgb, degrees });

import type { Lamina, Medir, Prim } from './alzado.ts';
import { LOGO_ALTO, LOGO_PATH } from './logo.ts';

// Tipos mínimos de pdf-lib que usamos (evita depender del paquete aquí).
export interface Fuente { widthOfTextAtSize(t: string, size: number): number }
interface Color { type: string }
export interface Pagina {
  drawRectangle(o: Record<string, unknown>): void;
  drawLine(o: Record<string, unknown>): void;
  drawSvgPath(path: string, o: Record<string, unknown>): void;
  drawText(t: string, o: Record<string, unknown>): void;
}
export interface Documento { addPage(size: [number, number]): Pagina }
export interface LibPdf {
  rgb(r: number, g: number, b: number): Color;
  degrees(d: number): unknown;
}
export interface FuentesPdf { regular: Fuente; bold: Fuente }

export function medirConFuentes(f: FuentesPdf): Medir {
  return (t, size, bold) => (bold ? f.bold : f.regular).widthOfTextAtSize(t, size);
}

export function colorPdf(lib: LibPdf, hex: string): Color {
  const v = parseInt(hex.slice(1), 16);
  return lib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

export function pintarLaminas(doc: Documento, laminas: Lamina[], fuentes: FuentesPdf, lib: LibPdf): void {
  for (const l of laminas) pintarPrims(doc.addPage([l.ancho, l.alto]), l.prims, l.alto, fuentes, lib);
}

/**
 * Pinta primitivas (pt, y hacia abajo) en una página de alto H. Con t, cada
 * punto pasa a (dx + x·s, dy + y·s): así se encaja un dibujo en otra página
 * (p. ej. bajo cada partida del presupuesto); grosores y textos escalan igual.
 */
export function pintarPrims(page: Pagina, prims: Prim[], H: number, fuentes: FuentesPdf, lib: LibPdf, t = { s: 1, dx: 0, dy: 0 }): void {
  const color = (hex: string) => colorPdf(lib, hex);
  const X = (x: number) => t.dx + x * t.s;
  const Y = (y: number) => H - (t.dy + y * t.s);
  for (const p of prims) {
    switch (p.k) {
      case 'rect':
        page.drawRectangle({
          x: X(p.x), y: Y(p.y + p.h), width: p.w * t.s, height: p.h * t.s,
          ...(p.fill ? { color: color(p.fill), opacity: p.opacity ?? 1 } : {}),
          ...(p.stroke ? { borderColor: color(p.stroke), borderWidth: (p.sw ?? 1) * t.s } : { borderWidth: 0 })
        });
        break;
      case 'line':
        page.drawLine({ start: { x: X(p.x1), y: Y(p.y1) }, end: { x: X(p.x2), y: Y(p.y2) }, thickness: p.sw * t.s, color: color(p.stroke) });
        break;
      case 'poly': {
        const d = 'M ' + p.pts.map(([x, y]) => `${t.dx + x * t.s} ${t.dy + y * t.s}`).join(' L ') + ' Z';
        page.drawSvgPath(d, {
          x: 0, y: H,
          ...(p.fill ? { color: color(p.fill), opacity: p.opacity ?? 1 } : {}),
          ...(p.stroke ? { borderColor: color(p.stroke), borderWidth: (p.sw ?? 1) * t.s, borderOpacity: p.opacity ?? 1 } : {})
        });
        break;
      }
      case 'text': {
        const font = p.bold ? fuentes.bold : fuentes.regular;
        const size = p.size * t.s;
        const w = font.widthOfTextAtSize(p.t, size);
        const off = p.anchor === 'middle' ? w / 2 : p.anchor === 'end' ? w : 0;
        if (p.vertical) {
          // Se lee de abajo arriba; el ancla va a lo largo del eje vertical.
          page.drawText(p.t, { x: X(p.x), y: Y(p.y) - off, size, font, color: color(p.color), rotate: lib.degrees(90) });
        } else {
          page.drawText(p.t, { x: X(p.x) - off, y: Y(p.y), size, font, color: color(p.color) });
        }
        break;
      }
      case 'logo':
        page.drawSvgPath(LOGO_PATH, { x: X(p.x), y: Y(p.y), scale: (p.h * t.s) / LOGO_ALTO, color: color(p.color) });
        break;
    }
  }
}
