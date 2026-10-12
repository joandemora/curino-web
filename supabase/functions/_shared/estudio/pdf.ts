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
interface Fuente { widthOfTextAtSize(t: string, size: number): number }
interface Color { type: string }
interface Pagina {
  drawRectangle(o: Record<string, unknown>): void;
  drawLine(o: Record<string, unknown>): void;
  drawSvgPath(path: string, o: Record<string, unknown>): void;
  drawText(t: string, o: Record<string, unknown>): void;
}
interface Documento { addPage(size: [number, number]): Pagina }
export interface LibPdf {
  rgb(r: number, g: number, b: number): Color;
  degrees(d: number): unknown;
}
export interface FuentesPdf { regular: Fuente; bold: Fuente }

export function medirConFuentes(f: FuentesPdf): Medir {
  return (t, size, bold) => (bold ? f.bold : f.regular).widthOfTextAtSize(t, size);
}

export function pintarLaminas(doc: Documento, laminas: Lamina[], fuentes: FuentesPdf, lib: LibPdf): void {
  const color = (hex: string) => {
    const v = parseInt(hex.slice(1), 16);
    return lib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
  };
  for (const l of laminas) {
    const page = doc.addPage([l.ancho, l.alto]);
    const H = l.alto;
    for (const p of l.prims) pintar(page, p, H);
  }

  function pintar(page: Pagina, p: Prim, H: number) {
    switch (p.k) {
      case 'rect':
        page.drawRectangle({
          x: p.x, y: H - p.y - p.h, width: p.w, height: p.h,
          ...(p.fill ? { color: color(p.fill), opacity: p.opacity ?? 1 } : {}),
          ...(p.stroke ? { borderColor: color(p.stroke), borderWidth: p.sw ?? 1 } : { borderWidth: 0 })
        });
        break;
      case 'line':
        page.drawLine({ start: { x: p.x1, y: H - p.y1 }, end: { x: p.x2, y: H - p.y2 }, thickness: p.sw, color: color(p.stroke) });
        break;
      case 'poly': {
        const d = 'M ' + p.pts.map(([x, y]) => `${x} ${y}`).join(' L ') + ' Z';
        page.drawSvgPath(d, {
          x: 0, y: H,
          ...(p.fill ? { color: color(p.fill), opacity: p.opacity ?? 1 } : {}),
          ...(p.stroke ? { borderColor: color(p.stroke), borderWidth: p.sw ?? 1, borderOpacity: p.opacity ?? 1 } : {})
        });
        break;
      }
      case 'text': {
        const font = p.bold ? fuentes.bold : fuentes.regular;
        const w = font.widthOfTextAtSize(p.t, p.size);
        const off = p.anchor === 'middle' ? w / 2 : p.anchor === 'end' ? w : 0;
        if (p.vertical) {
          // Se lee de abajo arriba; el ancla va a lo largo del eje vertical.
          page.drawText(p.t, { x: p.x, y: H - p.y - off, size: p.size, font, color: color(p.color), rotate: lib.degrees(90) });
        } else {
          page.drawText(p.t, { x: p.x - off, y: H - p.y, size: p.size, font, color: color(p.color) });
        }
        break;
      }
      case 'logo':
        page.drawSvgPath(LOGO_PATH, { x: p.x, y: H - p.y, scale: p.h / LOGO_ALTO, color: color(p.color) });
        break;
    }
  }
}
