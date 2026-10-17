// supabase/functions/_shared/estudio/plano.ts
//
// Estudio Curino · presupuesto directo desde un plano (PDF o imagen de un
// interiorista), sin pasar por la pestaña Diseño.
//
// - leerPlano(): Claude lee el plano y devuelve, por mueble, sus vistas (con el
//   recuadro que ocupan en la hoja), medidas generales y de cada cuerpo, los
//   elementos con cantidad y medida, y los materiales SOLO si el plano los
//   indica. Lo que no lee con seguridad va con seguro = false («revisar»).
// - puntosMueble(): el precio lo pone la tarifa, nunca Claude. Cada cuerpo es un
//   módulo OTG por ancho (modelo 6, el cuerpo más simple) con sus extras;
//   puertas, bisagras, cajones y estantes con sus líneas; lo que no tiene línea,
//   con los conceptos «Extras de mueble» (valores propios, marcados «revisar»).
// - partidaPlano(): una partida por mueble, con desglose, avisos internos
//   («Medidas leídas del plano: …», «no medir sobre plano») y el recorte del
//   plano (página + recuadro) para dibujarlo bajo la partida.

import { ANCHOS, COSTADOS, EXTRAS, HERRAJES, PUERTAS, SUELTOS, porAncho, serieDe, puntosBase, type LineaPuntos } from './puntos.ts';
import { puntosLinea, type LineaDesglose } from './tarifa.ts';
import type { Partida } from './presupuesto.ts';
import type { Llamada, Uso } from './ia.ts';

// ── Lo que lee Claude ───────────────────────────────────────────────
export type TipoElemento = 'puerta' | 'cajon' | 'estante' | 'estante_vidrio' | 'balda_extraible' | 'cubertero' | 'hueco_abierto'
  | 'fondo_espejo' | 'iluminacion' | 'zocalo' | 'remate' | 'division' | 'costado' | 'otro';
export interface ElementoPlano {
  tipo: TipoElemento; cantidad: number; ancho?: number | null; alto?: number | null; detalle?: string | null;
  apertura?: 'abatible' | 'corredera' | null; arco?: boolean; vitrina?: boolean; push?: boolean; tirador?: boolean; material?: string | null;
  grosor?: number | null;   // estantes: grosor en cm si tiene cota («3» → estante de 30 mm)
  unero?: boolean; ninguno?: boolean;   // agarre (diseño de mueble): uñero sustituye al tirador; «ninguno», sin línea de agarre
  seguro: boolean;
}
export interface CuerpoPlano { nombre: string; ancho: number | null; alto: number | null; fondo: number | null; elementos: ElementoPlano[]; seguro: boolean }
export interface Caja { pagina: number; x0: number; y0: number; x1: number; y1: number }   // fracciones de la página (0–1), origen arriba a la izquierda
export interface MueblePlano {
  nombre: string; vistas: { nombre: string; caja: Caja }[];
  ancho: number | null; alto: number | null; fondo: number | null; medidas_seguras: boolean;
  cotas_ancho?: number[];   // cotas parciales en cadena que suman el ancho (cuerpos y montantes, sin huecos ajenos)
  materiales: { interior?: string | null; exterior?: string | null; encimera?: string | null; otros?: string | null };
  cuerpos: CuerpoPlano[]; revisar: string[];
}
export interface LecturaPlano { aviso_plano: string | null; escala: string | null; muebles: MueblePlano[] }

/**
 * Ancho total = suma en cadena de las cotas parciales del mueble (no es medir
 * sobre plano). Sin ancho devuelto, se toma la suma; si no cuadra, «revisar».
 */
export function comprobarAncho(m: MueblePlano): string | null {
  const cs = (m.cotas_ancho ?? []).filter((x) => typeof x === 'number' && x > 0);
  if (!cs.length) return null;
  const suma = Math.round(cs.reduce((s, x) => s + x, 0) * 100) / 100;
  if (m.ancho == null) { m.ancho = suma; return null; }
  return Math.abs(suma - m.ancho) > 0.5 ? `el ancho (${m.ancho}) no coincide con la suma de sus cotas (${cs.join(' + ')} = ${suma})` : null;
}

const num = (d: string) => ({ type: ['number', 'null'], description: d });
const caja = { type: 'object', additionalProperties: false, required: ['pagina', 'x0', 'y0', 'x1', 'y1'],
  description: 'Recuadro de la vista en la hoja, en fracciones de 0 a 1 (x0,y0 = esquina superior izquierda; x1,y1 = inferior derecha). Incluye las cotas de la vista.',
  properties: { pagina: { type: 'integer', minimum: 1 }, x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } } };
export const HERRAMIENTA_PLANO = {
  name: 'leer_plano',
  description: 'Devuelve lo que se lee en el plano: un elemento por mueble (aunque salga en varias vistas: alzado exterior, interior, sección). Estantes contados por las cotas; cubertero = cajón con inserto (solo como «cubertero»).',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['muebles', 'aviso_plano', 'escala'],
    properties: {
      aviso_plano: { type: ['string', 'null'], description: 'Avisos del propio plano sobre las medidas, copiados tal cual («No se debe medir sobre plano…»). null si no hay.' },
      escala: { type: ['string', 'null'], description: 'Escala indicada («1/20»), o null.' },
      muebles: {
        type: 'array', minItems: 1, maxItems: 12,
        items: {
          type: 'object', additionalProperties: false, required: ['nombre', 'vistas', 'ancho', 'alto', 'fondo', 'medidas_seguras', 'materiales', 'cuerpos', 'revisar'],
          properties: {
            nombre: { type: 'string', description: 'El nombre del plano tal cual («Mueble comedor C»).' },
            vistas: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['nombre', 'caja'], properties: { nombre: { type: 'string', description: '«Alzado AA\' - Interior», «Sección»…' }, caja } } },
            ancho: num('Ancho total en cm: la suma en cadena de las cotas parciales del mueble (cuerpos y montantes). Sin huecos ajenos al mueble (cortinas, paredes). null si alguna falta.'), alto: num('Alto total en cm, o null.'), fondo: num('Fondo en cm (de una sección o planta), o null.'),
            cotas_ancho: { type: 'array', items: { type: 'number' }, description: 'Las cotas parciales que suman el ancho, de izquierda a derecha (p. ej. [4, 100, 4, 150, 4, 100, 4]).' },
            medidas_seguras: { type: 'boolean', description: 'true solo si las tres medidas salen de cotas legibles.' },
            materiales: { type: 'object', additionalProperties: false, properties: { interior: { type: ['string', 'null'] }, exterior: { type: ['string', 'null'] }, encimera: { type: ['string', 'null'] }, otros: { type: ['string', 'null'] } }, description: 'SOLO lo que el plano indica por escrito, tal cual. null si no lo dice. Nunca inventes materiales, marcas ni colores.' },
            cuerpos: {
              type: 'array', minItems: 1, maxItems: 12, description: 'Cada cuerpo o módulo de izquierda a derecha (una columna vertical del mueble con su ancho).',
              items: {
                type: 'object', additionalProperties: false, required: ['nombre', 'ancho', 'alto', 'fondo', 'elementos', 'seguro'],
                properties: {
                  nombre: { type: 'string', description: '«Cuerpo izquierdo», «Cuerpo central»… o el del plano.' },
                  ancho: num('cm'), alto: num('cm'), fondo: num('cm'), seguro: { type: 'boolean', description: 'false si alguna medida del cuerpo es dudosa.' },
                  elementos: {
                    type: 'array',
                    items: {
                      type: 'object', additionalProperties: false, required: ['tipo', 'cantidad', 'seguro'],
                      properties: {
                        tipo: { enum: ['puerta', 'cajon', 'estante', 'estante_vidrio', 'balda_extraible', 'cubertero', 'hueco_abierto', 'fondo_espejo', 'iluminacion', 'zocalo', 'remate', 'division', 'otro'] },
                        cantidad: { type: 'integer', minimum: 1 },
                        ancho: num('cm de cada unidad, si se lee'), alto: num('cm de cada unidad, si se lee'),
                        detalle: { type: ['string', 'null'], description: 'Lo que pone el plano («Cajón servilletas», «Balda extraíble manteles»).' },
                        apertura: { enum: ['abatible', 'corredera', null], description: 'Solo puertas.' },
                        arco: { type: 'boolean', description: 'Puerta con remate en arco.' },
                        vitrina: { type: 'boolean', description: 'Puerta de vitrina (cristal o bastidor con vidrio).' },
                        push: { type: 'boolean', description: '«Apertura push», sin tirador.' },
                        tirador: { type: 'boolean', description: 'Solo si el plano dibuja o indica tirador.' },
                        material: { type: ['string', 'null'], description: 'Solo si el plano lo indica.' },
                        grosor: num('Estantes: grosor en cm si el plano lo acota (las cotas de 3 entre huecos son estantes de 3 cm).'),
                        seguro: { type: 'boolean', description: 'false si la cantidad o la medida no se lee con seguridad.' }
                      }
                    }
                  }
                }
              }
            },
            revisar: { type: 'array', items: { type: 'string' }, description: 'Lo que no se ha podido leer con seguridad, en frases cortas.' }
          }
        }
      }
    }
  }
};
const SISTEMA = `Eres técnico de oficina técnica de un taller de carpintería a medida en España. Lees planos de interioristas (alzados, secciones, plantas) para preparar un presupuesto.
Reglas:
- Un mueble = un elemento de «muebles», aunque aparezca en varias vistas (alzado exterior, alzado interior, sección): junta lo que se ve en todas.
- Medidas en cm, solo de las cotas del plano. Si una medida no tiene cota, pon null y explícalo en «revisar». Nunca la calcules a ojo ni la inventes.
- Ancho total: si no hay cota total, súmalo en cadena con las cotas parciales del propio mueble (cuerpos y montantes, p. ej. 4 + 100 + 4 + 150 + 4 + 100 + 4 = 366) y ponlas en cotas_ancho. Eso no es medir sobre plano. No cuentes huecos ajenos al mueble (cortinas, paredes, pasos). Si dudas de alguna, «revisar».
- Estantes: cuéntalos por las cotas del plano. Cada cota de 2–3 cm entre dos huecos es un estante (p. ej. 32 · 2 · 32 = dos huecos y 1 estante; 30 · 3 · 30 · 3 · 40 = 2 estantes de 3 cm). Pon su grosor en grosor. Las etiquetas («Estantes para vajilla», «Estante») dicen qué es, no cuántos hay. Si una cota no está clara, seguro = false y «revisar».
- Cubertero: es siempre un cajón con su inserto. Ponlo como tipo «cubertero» (una entrada por cubertero) y no lo cuentes además como «cajon».
- Compartimentos: si un cuerpo tiene varios compartimentos separados por una división vertical (p. ej. dos rotulados «Estantes para vajilla»), cuenta los estantes de cada compartimento por separado, cada uno con su ancho (ancho del compartimento) y la división como tipo «division». Si no está claro, seguro = false y «revisar».
- Cuerpos: cada columna vertical del mueble con su ancho de cota, de izquierda a derecha (una vitrina arriba y un bajo con puertas en la misma columna son un cuerpo). Cuenta los elementos de cada cuerpo con sus etiquetas («Cajón servilletas», «Balda extraíble manteles», «Cubertero», «Estante», «Apertura push», «Fondo de espejo»).
- Puertas: una entrada por grupo igual, con cantidad, apertura y si son en arco, vitrina o push. Cajones con push si lo pone.
- Materiales y acabados SOLO si el plano los escribe; si no, null. Nunca inventes materiales, marcas ni colores.
- Lo dudoso: seguro = false y una frase en «revisar».
- Copia tal cual los avisos del plano sobre las medidas («No se debe medir sobre plano…»).
- vistas[].caja: el recuadro de cada vista en la hoja con sus cotas, en fracciones de 0 a 1 desde la esquina superior izquierda.
Responde SIEMPRE con la herramienta leer_plano.`;

export interface AdjuntoPlano { tipo: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'; base64: string; nombre: string }

export async function leerPlano(o: { clave: string; modelo: string; adjunto: AdjuntoPlano; fetch?: typeof fetch }):
  Promise<{ lectura: LecturaPlano | null; llamadas: Llamada[]; error?: string }> {
  const f = o.fetch ?? fetch;
  const a = o.adjunto;
  const bloque = a.tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: a.tipo, data: a.base64 }, title: a.nombre }
    : { type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.base64 } };
  const r = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': o.clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: o.modelo, max_tokens: 6000, system: SISTEMA,
      tools: [HERRAMIENTA_PLANO], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [bloque, { type: 'text', text: `Plano: ${a.nombre}. Lee cada mueble para presupuestarlo.` }] }]
    })
  });
  const d = await r.json().catch(() => ({}));
  const uso: Uso = {
    input_tokens: d?.usage?.input_tokens ?? 0, output_tokens: d?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: d?.usage?.cache_creation_input_tokens ?? 0, cache_read_input_tokens: d?.usage?.cache_read_input_tokens ?? 0
  };
  const llamadas = [{ uso, ok: r.ok }];
  if (!r.ok) return { lectura: null, llamadas, error: d?.error?.message ?? d?.error?.type ?? `http_${r.status}` };
  const b = (d.content ?? []).find((x: { type: string }) => x.type === 'tool_use') as { input?: LecturaPlano } | undefined;
  const lectura = b?.input && Array.isArray(b.input.muebles) && b.input.muebles.length ? b.input : null;
  return { lectura, llamadas, error: lectura ? undefined : 'sin_datos' };
}

// ── Conceptos «Extras de mueble» (no están en la tabla OTG: valores propios, «revisar») ──
export const EXTRAS_MUEBLE: Record<string, { nombre: string; unidad: 'ud' | 'm' | 'm²'; puntos: number; referencia: string }> = {
  mueble_puerta_arco: { nombre: 'Puerta en arco (suplemento sobre la puerta)', unidad: 'ud', puntos: 150, referencia: 'sobre la puerta de su material' },
  mueble_puerta_vitrina: { nombre: 'Puerta vitrina con cristal', unidad: 'ud', puntos: 420, referencia: 'puerta lacada 330 + cristal' },
  mueble_push: { nombre: 'Apertura push (por puerta o cajón)', unidad: 'ud', puntos: 20, referencia: 'tirador estándar 15' },
  mueble_balda_extraible: { nombre: 'Balda extraíble', unidad: 'ud', puntos: 45, referencia: 'perchero extraíble 45' },
  mueble_cubertero: { nombre: 'Cubertero (inserto)', unidad: 'ud', puntos: 35, referencia: '≈ un cajón' },
  mueble_espejo_m2: { nombre: 'Fondo de espejo (m²)', unidad: 'm²', puntos: 160, referencia: 'costado visto con espejo 292 / 1,82 m²' },
  mueble_led_m: { nombre: 'Iluminación LED (metro)', unidad: 'm', puntos: 40, referencia: '—' },
  mueble_estante_vidrio: { nombre: 'Estante de vidrio', unidad: 'ud', puntos: 25, referencia: 'estante 19 mm 11–27' },
  mueble_zocalo_m: { nombre: 'Zócalo (metro)', unidad: 'm', puntos: 15, referencia: 'zócalo de cocinas' }
};
export const AVISO_EXTRA_MUEBLE = 'concepto nuevo «Extras de mueble»: revisar';
export const puntosMuebleBase = (): Record<string, number> => ({ ...puntosBase(), ...Object.fromEntries(Object.entries(EXTRAS_MUEBLE).map(([k, v]) => [k, v.puntos])) });

const r1 = (n: number) => Math.round(n * 10) / 10;
const cmTxt = (n: number) => String(r1(n)).replace('.', ',');
/** Puerta sin material en el plano: lisa lacada, marcada «supuesto». */
export const PUERTA_SUPUESTA = 'lisa_lacada';
const MAT_PUERTA: [RegExp, string][] = [[/lacad/i, 'lisa_lacada'], [/moldur/i, 'moldurada_lacada'], [/chapa|roble|nogal|madera/i, 'chapa_madera'], [/textil|tapiz/i, 'textil'], [/rat[aá]n|rejilla/i, 'ratan'], [/melamin/i, 'lisa_melamina']];

/** Líneas en puntos de cada cuerpo del mueble, con el total por cuerpo. */
export function puntosMueble(m: MueblePlano, puntos: Record<string, number>): { cuerpos: { nombre: string; ancho: number | null; lineas: LineaPuntos[]; puntos: number }[]; avisos: string[] } {
  const avisos: string[] = [];
  const cuerpos = m.cuerpos.map((c, ci) => {
    const L: LineaPuntos[] = [];
    const add = (clave: string, nombre: string, cantidad: number, pts: number, ...av: (string | undefined | false)[]) => {
      const aviso = av.filter(Boolean).join(' · ') || undefined;
      L.push({ clave: `c${ci}_${clave}_${L.length}`, nombre, cantidad, puntos: pts, aviso });
    };
    const dudoso = (e: { seguro: boolean }) => (!e.seguro ? 'cantidad o medida no segura en el plano: revisar' : undefined);
    const mm = c.ancho ? Math.round(c.ancho * 10) : null;
    // Cuerpo: módulo OTG por ancho (modelo 6, altillo + hueco libre: el cuerpo más simple)
    if (mm) {
      const b = porAncho(serieDe(puntos, 'm6'), mm);
      add('cuerpo', `Cuerpo ${cmTxt(c.ancho!)} cm · módulo OTG ${b.tramo} mm (tabla de armarios)`, 1, b.puntos,
        'tabla de armarios 2600 × 550: revisar', b.fuera && 'fuera de tabla, valor extrapolado: revisar', !c.seguro && 'medidas del cuerpo no seguras: revisar');
    } else add('cuerpo', 'Cuerpo sin ancho legible', 1, 0, 'falta el ancho en el plano: revisar');
    const anchoMm = mm ?? ANCHOS[ANCHOS.length - 1];
    const porAnchoExtra = (k: string) => porAncho(serieDe(puntos, k), anchoMm).puntos;
    for (const e of c.elementos) {
      const n = Math.max(1, e.cantidad || 1), det = e.detalle ? ` · ${e.detalle}` : '';
      switch (e.tipo) {
        case 'puerta': {
          const mat = (e.material && MAT_PUERTA.find(([re]) => re.test(e.material!))?.[1]) || null;
          if (e.vitrina) add('vitrina', `${EXTRAS_MUEBLE.mueble_puerta_vitrina.nombre}${det}`, n, puntos.mueble_puerta_vitrina, AVISO_EXTRA_MUEBLE, dudoso(e));
          else add('puerta', `${PUERTAS[mat ?? PUERTA_SUPUESTA].nombre}${mat ? '' : ' (supuesto)'}${det}`, n, puntos[`puerta_${mat ?? PUERTA_SUPUESTA}`], !mat && 'supuesto: no se indica el material (puerta lisa lacada)', dudoso(e));
          if (e.arco) add('arco', EXTRAS_MUEBLE.mueble_puerta_arco.nombre, n, puntos.mueble_puerta_arco, AVISO_EXTRA_MUEBLE);
          if (e.apertura === 'corredera') add('corredera', HERRAJES.corredera.nombre, n, puntos.corredera);
          else add('bisagras', HERRAJES.bisagras.nombre, n, puntos.bisagras);
          if (e.push) add('push', EXTRAS_MUEBLE.mueble_push.nombre, n, puntos.mueble_push, AVISO_EXTRA_MUEBLE);
          else if (e.unero) add('unero', HERRAJES.unero_dm.nombre, n, puntos.unero_dm);
          else if (!e.ninguno) add('tirador', HERRAJES.tirador.nombre, n, puntos.tirador, !e.tirador && 'agarre a definir: revisar');
          break;
        }
        case 'cajon':
          add('cajon', `${EXTRAS.cajon.nombre}${det}`, n, porAnchoExtra('cajon'), dudoso(e));
          if (e.push) add('push', EXTRAS_MUEBLE.mueble_push.nombre, n, puntos.mueble_push, AVISO_EXTRA_MUEBLE);
          else if (e.unero) add('unero', HERRAJES.unero_dm.nombre, n, puntos.unero_dm);
          else if (e.tirador) add('tirador', HERRAJES.tirador.nombre, n, puntos.tirador);
          break;
        case 'costado': add('costado', `${COSTADOS.melamina.nombre}${det}`, n, puntos.costado_melamina, 'material a definir (costado visto en melamina): revisar'); break;
        case 'estante': {
          // Con cota de grosor: 25 / 30 mm (puntos completos: aquí cada estante se suma entero)
          // En un compartimento, por su propio ancho (tramo de la tabla de ese ancho)
          const g = e.grosor ?? null, k = g && g > 2.55 ? 'estante30' : g && g > 2.05 ? 'estante25' : 'estante';
          const pts = e.ancho ? porAncho(serieDe(puntos, k), Math.round(e.ancho * 10)).puntos : porAnchoExtra(k);
          add('estante', `${EXTRAS[k].nombre}${e.ancho ? ` · ${cmTxt(e.ancho)} cm` : ''}${det}`, n, pts, dudoso(e), !!g && g > 3.05 && `grosor ${g} cm: con la tarifa de 30 mm, revisar`);
          break;
        }
        case 'estante_vidrio': add('estvid', `${EXTRAS_MUEBLE.mueble_estante_vidrio.nombre}${det}`, n, puntos.mueble_estante_vidrio, AVISO_EXTRA_MUEBLE, dudoso(e)); break;
        case 'balda_extraible': add('balda', `${EXTRAS_MUEBLE.mueble_balda_extraible.nombre}${det}`, n, puntos.mueble_balda_extraible, AVISO_EXTRA_MUEBLE, dudoso(e)); break;
        case 'cubertero':
          // Un cubertero es siempre un cajón con su inserto
          add('cajon', `${EXTRAS.cajon.nombre} con cubertero${det}`, n, porAnchoExtra('cajon'), dudoso(e));
          add('cubertero', `${EXTRAS_MUEBLE.mueble_cubertero.nombre}${det}`, n, puntos.mueble_cubertero, AVISO_EXTRA_MUEBLE, dudoso(e));
          if (e.push) add('push', EXTRAS_MUEBLE.mueble_push.nombre, n, puntos.mueble_push, AVISO_EXTRA_MUEBLE);
          else if (e.unero) add('unero', HERRAJES.unero_dm.nombre, n, puntos.unero_dm);
          else if (e.tirador) add('tirador', HERRAJES.tirador.nombre, n, puntos.tirador);
          break;
        case 'division': add('division', `${SUELTOS.division.nombre}${det}`, n, puntos.division, dudoso(e)); break;
        case 'fondo_espejo': {
          const an = e.ancho ?? c.ancho, al = e.alto;
          const m2 = an && al ? Math.round((an * al) / 100) / 100 : null;
          if (m2) add('espejo', `${EXTRAS_MUEBLE.mueble_espejo_m2.nombre} · ${cmTxt(an!)} × ${cmTxt(al!)} cm`, r1(m2 * n * 100) / 100, puntos.mueble_espejo_m2, AVISO_EXTRA_MUEBLE, dudoso(e));
          else add('espejo', `${EXTRAS_MUEBLE.mueble_espejo_m2.nombre}${det}`, n, 0, 'faltan las medidas del espejo en el plano: revisar');
          break;
        }
        case 'iluminacion': {
          const metros = (e.ancho ?? c.ancho) ? Math.round(((e.ancho ?? c.ancho)! / 100) * n * 100) / 100 : null;
          add('led', `${EXTRAS_MUEBLE.mueble_led_m.nombre}${det}`, metros ?? n, metros ? puntos.mueble_led_m : 0, AVISO_EXTRA_MUEBLE, !metros && 'falta la longitud: revisar');
          break;
        }
        case 'zocalo': {
          const metros = (e.ancho ?? c.ancho) ? Math.round(((e.ancho ?? c.ancho)! / 100) * 100) / 100 : null;
          add('zocalo', `${EXTRAS_MUEBLE.mueble_zocalo_m.nombre}${det}`, metros ?? 1, metros ? puntos.mueble_zocalo_m : 0, AVISO_EXTRA_MUEBLE, !metros && 'falta la longitud: revisar');
          break;
        }
        case 'hueco_abierto': break;   // sin coste propio (va en el cuerpo)
        default: add('otro', `${e.detalle || (e.tipo === 'remate' ? 'Remate' : 'Elemento')} (sin línea en la tarifa)`, n, 0, 'sin línea en la tarifa: revisar');
      }
    }
    return { nombre: c.nombre, ancho: c.ancho, lineas: L, puntos: L.reduce((s, l) => s + puntosLinea(l.puntos, l.cantidad), 0) };
  });
  return { cuerpos, avisos };
}

/** Texto de un cuerpo para la ficha técnica («2 puertas vitrina en arco push + 3 estantes…»). */
function textoCuerpo(c: CuerpoPlano): string {
  const partes = c.elementos.filter((e) => e.tipo !== 'hueco_abierto').map((e) => {
    const n = e.cantidad || 1;
    const nombre = e.tipo === 'puerta'
      ? `${n} ${n === 1 ? 'puerta' : 'puertas'}${e.vitrina ? ' vitrina' : ''}${e.arco ? ' en arco' : ''}${e.apertura === 'corredera' ? ' correderas' : ''}${e.push ? ' (apertura push)' : ''}`
      : `${n} × ${e.detalle || e.tipo.replace('_', ' ')}`;
    return nombre + (e.tipo === 'puerta' && e.detalle ? ` · ${e.detalle}` : '');
  });
  if (c.elementos.some((e) => e.tipo === 'hueco_abierto')) partes.push('hueco abierto');
  return partes.join(' + ') || 'sin elementos legibles';
}

/** Partida del presupuesto para un mueble leído del plano (precio = puntos × precio del punto). */
export function partidaPlano(o: {
  mueble: MueblePlano; n: number; lectura: LecturaPlano; puntos: Record<string, number>; precioPunto: number | null; dto: number;
  plano: { fichero_id: string; nombre: string };
}): Partida & { plano: Any; cuerpos_puntos: { nombre: string; puntos: number }[] } {
  const m: MueblePlano = JSON.parse(JSON.stringify(o.mueble)), pp = typeof o.precioPunto === 'number' && o.precioPunto > 0 ? o.precioPunto : null;
  const descuadre = comprobarAncho(m);
  if (descuadre) m.revisar = [...(m.revisar ?? []), descuadre];
  const pm = puntosMueble(m, o.puntos);
  const desglose: LineaDesglose[] = pm.cuerpos.flatMap((c) => c.lineas.map((l) => {
    const pts = puntosLinea(l.puntos, l.cantidad);
    return { clave: l.clave, nombre: `${c.nombre} · ${l.nombre}`, cantidad: l.cantidad, unidad: 'ud' as const, precio: pp === null ? null : Math.round(l.puntos * pp * 100) / 100, importe: pp === null ? null : Math.round(pts * pp * 100) / 100, puntos: l.puntos, puntos_linea: pts, aviso: l.aviso };
  }));
  const total = pm.cuerpos.reduce((s, c) => s + c.puntos, 0);
  const med = (v: number | null) => (v == null ? '¿?' : cmTxt(v));
  const medidas = `${med(m.ancho)} × ${med(m.alto)} × ${med(m.fondo)} cm`;
  const mm = (v: number | null) => (v == null ? 'a definir' : String(Math.round(v * 100) / 10).replace('.', ','));
  const tecnico = [
    `Medidas: ${mm(m.ancho)} x ${mm(m.alto)} x ${mm(m.fondo)} mm`,
    `Distribución: ${m.cuerpos.map((c) => `${c.nombre.toLowerCase()} de ${mm(c.ancho)} mm`).join(' + ')}`,
    ...m.cuerpos.map((c) => `${c.nombre} – ${med(c.ancho)} cm: ${textoCuerpo(c)}.`)
  ].join('\n');
  const mat = m.materiales ?? {};
  const def = (v?: string | null) => (v && v.trim()) || 'a definir';
  // Puertas sin material en el plano: lisa lacada, marcada «supuesto» (al cliente sale sin la palabra)
  const supuestaPuerta = m.cuerpos.some((c) => c.elementos.some((e) => e.tipo === 'puerta' && !e.vitrina && !e.material));
  const exterior = mat.exterior?.trim() || (supuestaPuerta ? 'puertas lisas lacadas (supuesto)' : 'a definir');
  const materiales = [`Interior: ${def(mat.interior)}`, `Exterior: ${exterior}`, mat.encimera ? `Encimera: ${mat.encimera}` : '', `Herrajes: a definir`, mat.otros ? `Otros: ${mat.otros}` : ''].filter(Boolean).join('\n');
  // Vista interna: lo que hay que comprobar antes de enviar
  const avisos = [
    `Medidas leídas del plano: ${medidas}${m.medidas_seguras ? '' : ' (no seguras: revisar)'} · ${m.cuerpos.map((c) => `${c.nombre} ${med(c.ancho)} × ${med(c.alto)} × ${med(c.fondo)}`).join(' · ')}`,
    o.lectura.aviso_plano ? `El plano dice: «${o.lectura.aviso_plano}»` : '',
    ...m.revisar.map((x) => `Revisar: ${x}`),
    ...pm.avisos
  ].filter(Boolean);
  return {
    codigo: `M.${String(o.n).padStart(2, '0')}`, clave: `plano:${o.plano.fichero_id.slice(0, 8)}:${o.n}`,
    cantidad: 1, titulo: m.nombre.toUpperCase().slice(0, 120), subtitulo: `${m.nombre} a medida${m.ancho ? ` de ${cmTxt(m.ancho)} cm` : ''}`, intro: '',
    tecnico, materiales, precio: pp === null ? null : Math.round(desglose.reduce((s, l) => s + (l.importe ?? 0), 0) * 100) / 100, precio_manual: false,
    dto_pct: o.dto, desglose, pendientes: pp === null ? ['Precio del punto'] : [], puntos: total, avisos,
    tipo: 'plano' as const,
    plano: { fichero_id: o.plano.fichero_id, nombre: o.plano.nombre, cajas: m.vistas.map((v) => v.caja), escala: o.lectura.escala, aviso_plano: o.lectura.aviso_plano, lectura: o.mueble },
    cuerpos_puntos: pm.cuerpos.map((c) => ({ nombre: c.nombre, puntos: c.puntos }))
  };
}
// deno-lint-ignore no-explicit-any
type Any = any;

/** Recuadro que une las vistas de un mueble en una página (con un margen), en fracciones. */
export function cajaUnion(cajas: Caja[], margen = 0.01): Caja | null {
  if (!cajas.length) return null;
  const pag = cajas[0].pagina, cs = cajas.filter((c) => c.pagina === pag);
  const cl = (v: number) => Math.min(1, Math.max(0, v));
  return { pagina: pag, x0: cl(Math.min(...cs.map((c) => Math.min(c.x0, c.x1))) - margen), y0: cl(Math.min(...cs.map((c) => Math.min(c.y0, c.y1))) - margen),
    x1: cl(Math.max(...cs.map((c) => Math.max(c.x0, c.x1))) + margen), y1: cl(Math.max(...cs.map((c) => Math.max(c.y0, c.y1))) + margen) };
}

/**
 * Recuadro visto en la hoja (fracciones, con el giro /Rotate aplicado) → recuadro
 * en las coordenadas sin girar de la página (para embedPage) y tamaño visto.
 */
export function recorteGirado(rotacion: number, w: number, h: number, c: Caja) {
  const r = ((Math.round(rotacion) % 360) + 360) % 360;
  const map = (u: number, v: number): [number, number] => r === 90 ? [v * w, u * h] : r === 180 ? [(1 - u) * w, v * h] : r === 270 ? [(1 - v) * w, (1 - u) * h] : [u * w, (1 - v) * h];
  const ps = [map(c.x0, c.y0), map(c.x1, c.y0), map(c.x0, c.y1), map(c.x1, c.y1)];
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  const bb = { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
  const bw = bb.right - bb.left, bh = bb.top - bb.bottom, gira = r === 90 || r === 270;
  return { bb, r, bw, bh, w: gira ? bh : bw, h: gira ? bw : bh };
}
/** Dónde va el origen del recorte embebido y su giro para que se vea derecho en el recuadro (X0, Ybot) con escala k. */
export function colocarRecorte(rc: { r: number; bw: number; bh: number }, X0: number, Ybot: number, k: number) {
  const W = rc.bw * k, H = rc.bh * k;
  const o = rc.r === 90 ? { x: X0, y: Ybot + W } : rc.r === 180 ? { x: X0 + W, y: Ybot + H } : rc.r === 270 ? { x: X0 + H, y: Ybot } : { x: X0, y: Ybot };
  return { ...o, width: W, height: H, angulo: -rc.r };
}

/** Rehace una partida leída del plano con la tarifa actual (sin volver a llamar a Claude). */
export function recalcularPlano(p: Partida, puntos: Record<string, number>, precioPunto: number | null, n: number) {
  const pl = p.plano as Any;
  if (!pl?.lectura) return null;
  return partidaPlano({ mueble: pl.lectura, n, lectura: { aviso_plano: pl.aviso_plano ?? null, escala: pl.escala ?? null, muebles: [pl.lectura] }, puntos, precioPunto, dto: p.dto_pct, plano: { fichero_id: pl.fichero_id, nombre: pl.nombre } });
}
