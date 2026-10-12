// supabase/functions/_shared/estudio/svg.ts
//
// Estudio Curino · lámina (alzado.ts) → SVG para la vista previa en pantalla.
// Mismas primitivas que el PDF; la fuente es Inter (la página la carga).

import type { Lamina, Prim } from './alzado.ts';
import { LOGO_ALTO, LOGO_PATH } from './logo.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

function prim(p: Prim): string {
  switch (p.k) {
    case 'rect': {
      const fill = p.fill ? `fill="${p.fill}"` : 'fill="none"';
      const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw ?? 1}"` : '';
      const op = p.opacity !== undefined ? ` fill-opacity="${p.opacity}"` : '';
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" ${fill}${stroke}${op}/>`;
    }
    case 'line':
      return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" stroke="${p.stroke}" stroke-width="${p.sw}"/>`;
    case 'poly': {
      const op = p.opacity !== undefined ? ` opacity="${p.opacity}"` : '';
      return `<polygon points="${p.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${p.fill ?? 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw ?? 1}"` : ''}${op}/>`;
    }
    case 'text': {
      const rot = p.vertical ? ` transform="rotate(-90 ${n(p.x)} ${n(p.y)})"` : '';
      return `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${p.size}" fill="${p.color}" text-anchor="${p.anchor}"${p.bold ? ' font-weight="700"' : ''}${rot}>${esc(p.t)}</text>`;
    }
    case 'logo': {
      const k = p.h / LOGO_ALTO;
      return `<path d="${LOGO_PATH}" fill="${p.color}" transform="translate(${n(p.x)} ${n(p.y)}) scale(${n(k * 1000) / 1000})"/>`;
    }
  }
}

/** Solo el dibujo (sin cabecera), recortado a su caja; css opcional (p. ej. @font-face embebida). */
export function dibujoSvg(prims: Prim[], caja: { x: number; y: number; w: number; h: number }, css = ''): string {
  const m = 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(caja.x - m)} ${n(caja.y - m)} ${n(caja.w + 2 * m)} ${n(caja.h + 2 * m)}" width="${n(caja.w + 2 * m)}" height="${n(caja.h + 2 * m)}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">` +
    (css ? `<style>${css}</style>` : '') +
    `<rect x="${n(caja.x - m)}" y="${n(caja.y - m)}" width="100%" height="100%" fill="#ffffff"/>` +
    prims.map(prim).join('') + `</svg>`;
}

export function laminaSvg(l: Lamina): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(l.ancho)} ${n(l.alto)}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    l.prims.map(prim).join('') +
    `</svg>`;
}
