// supabase/functions/estudio-ia/render.ts
//
// Láminas del proyecto → SVG (vista previa) y PDF (descarga) en Deno, con
// las métricas reales de Inter (pdf-lib + fontkit) para medir textos.

import { PDFDocument, rgb, degrees } from 'https://esm.sh/pdf-lib@1.17.1'
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1'
import { laminasProyecto } from '../_shared/estudio/alzado.ts'
import { laminaSvg } from '../_shared/estudio/svg.ts'
import { pintarLaminas, medirConFuentes } from '../_shared/estudio/pdf.ts'
import { interRegular, interBold } from '../_shared/estudio/fuentes/inter.ts'
import type { Proyecto } from '../_shared/estudio/esquema.ts'

async function documento() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(interRegular(), { subset: true });
  const bold = await doc.embedFont(interBold(), { subset: true });
  return { doc, fuentes: { regular, bold } };
}

/** Una entrada por lámina; «vistas» del armario para los botones de Diseño (pagina 2 = hoja extra). */
export async function svgsProyecto(p: Proyecto): Promise<{ codigo: string; svg: string; pagina: number; vistas: string[] }[]> {
  const { fuentes } = await documento();
  return laminasProyecto(p, medirConFuentes(fuentes)).map((l) => ({
    codigo: l.codigo, svg: laminaSvg(l), pagina: l.pagina ?? 1,
    vistas: p.armarios.find((a) => a.codigo === l.codigo)?.vistas ?? []
  }));
}

export async function pdfProyecto(p: Proyecto, titulo: string): Promise<Uint8Array> {
  const { doc, fuentes } = await documento();
  pintarLaminas(doc, laminasProyecto(p, medirConFuentes(fuentes)), fuentes, { rgb, degrees });
  doc.setTitle(titulo);
  doc.setCreator('Estudio Curino');
  return await doc.save();
}
