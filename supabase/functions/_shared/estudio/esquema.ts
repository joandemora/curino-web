// supabase/functions/_shared/estudio/esquema.ts
//
// Estudio Curino · esquema del proyecto (F1, 2026-10).
//
// Un proyecto es una lista de armarios (A.01, A.02…). Cada armario tiene uno o
// varios cuerpos (p. ej. cuerpo principal + lateral de un armario en L) y cada
// cuerpo, sus módulos (de izquierda a derecha) y su frente. Todas las medidas
// en cm. El JSON lo escribe Claude (F2, tool use con ESQUEMA_JSON) o una
// persona; el renderizador (alzado.ts) y el motor de precios (F3) solo leen
// este formato. Ninguna cota se inventa: o viene en el JSON o se deduce de él
// (el hueco sin «alto» se queda con el resto del módulo).
//
// Interior de cada módulo: zonas de arriba abajo. Entre dos zonas seguidas
// hay siempre una balda (del grosor del tablero). Alturas:
//   - altillo.alto = la cota del alzado: desde arriba del cuerpo hasta debajo
//     de la balda del altillo («altillo 50»);
//   - resto de zonas: alto libre del hueco. Una zona por módulo puede ir sin
//     «alto» y ocupa lo que quede; si van varias sin alto, se reparten igual.
//   - cajonera sin alto: CAJON_ALTO_DEF por cajón.
// Grosores (cm): la balda entre dos zonas mide lo que el tablero del cuerpo
// salvo que la zona de debajo diga «grosor_balda_encima» (p. ej. 3 para una
// balda gruesa sobre la cajonera); los estantes de una zona «estantes» miden
// «grosor_estantes» (def. el del tablero). Los estantes van dentro del alto
// libre de su zona, así que su grosor cambia los huecos entre estantes.
//
// Vistas (F6): cada armario saca siempre «Interior» y «Cerrado»; «vistas»
// añade «lateral» (sección de cada módulo distinto) y/o «planta». Cada cuerpo
// tiene «colocacion»: en línea con el anterior (def., alineados por detrás) o
// en esquina a la izquierda / derecha de la fila principal (cuerpo 0 + los que
// le siguen en línea): girado 90°, arrancando en su frente y enrasado con su
// lado exterior (armario en L; con las dos esquinas, en U).
//
// validarProyecto() hace dos comprobaciones: formato estricto (tipos, campos
// conocidos, rangos) y coherencia (módulos y frente suman el ancho del cuerpo,
// las zonas caben en el alto). Devuelve errores legibles con su ruta para
// que Claude pregunte en vez de suponer.

import { ESQUEMA_COCINA_JSON, validarCocinas, type Cocina } from './cocina.ts';

export type Formato = 'A3' | 'A4';
export type LadoTirador = 'izq' | 'der';
export type ModeloPuerta = 'moldurada' | 'lisa';

/**
 * Cajones: frente cerrado (def.), abierto (zapatero abierto —«frente_bajo», def.— o
 * con escote) o con hueco de mano (frente completo con un hueco libre encima,
 * sin tirador); agarre propio, independiente de las puertas. Detrás de puertas
 * abatibles la cajonera lleva tapetas laterales (def. 3 cm) para salvar las bisagras.
 */
export type FrenteCajon = 'cerrado' | 'abierto' | 'hueco_mano';
export type CajonAbierto = 'frente_bajo' | 'escote';
export type AgarreCajon = 'tirador' | 'unero' | 'ninguno';
// Todas las zonas salvo la primera admiten «grosor_balda_encima» (cm).
type ConBalda = { grosor_balda_encima?: number };
export type Zona = ConBalda & (
  | { tipo: 'altillo'; alto: number; etiqueta?: string }
  | { tipo: 'perchero'; alto?: number; prendas?: 'cortas' | 'largas'; etiqueta?: string }
  | { tipo: 'perchero_extraible'; alto?: number; etiqueta?: string }
  | { tipo: 'cajonera'; cajones: number; alto?: number; etiqueta?: string; frente?: FrenteCajon; abierto?: CajonAbierto; agarre?: AgarreCajon; hueco?: number; tapetas?: number }
  | { tipo: 'estantes'; estantes: number; alto?: number; etiqueta?: string; grosor_estantes?: number }
  | { tipo: 'hueco'; alto?: number; etiqueta?: string }
  | { tipo: 'balda_inferior'; alto?: number; etiqueta?: string });

export type TipoZona = Zona['tipo'];

export interface Modulo {
  ancho: number;
  interior: Zona[];
}

/** Material de la puerta (tarifa por puntos y dibujo). */
export type MaterialPuerta = 'lisa_melamina' | 'lisa_lacada' | 'moldurada_lacada' | 'chapa_madera' | 'textil' | 'ratan';
/** Agarre de cada puerta: el uñero sustituye al tirador. */
export type Agarre = 'tirador' | 'tirador_premium' | 'unero_dm' | 'unero_madera' | 'ninguno';
export const MATERIALES_PUERTA: MaterialPuerta[] = ['lisa_melamina', 'lisa_lacada', 'moldurada_lacada', 'chapa_madera', 'textil', 'ratan'];
export const AGARRES: Agarre[] = ['tirador', 'tirador_premium', 'unero_dm', 'unero_madera', 'ninguno'];
export const APERTURAS = ['abatible', 'corredera', 'coplanar', 'escamoteable'] as const;

export type PiezaFrente =
  | { tipo: 'puerta'; ancho: number; tirador?: LadoTirador; modelo?: ModeloPuerta; material?: MaterialPuerta; agarre?: Agarre }
  | { tipo: 'fijo'; ancho: number; etiqueta?: string; material?: MaterialPuerta };

export interface Frente {
  apertura: typeof APERTURAS[number];
  modelo: ModeloPuerta;        // por defecto de todas las puertas del frente
  material?: MaterialPuerta;   // por defecto de todas las puertas del frente (si falta, se deduce de modelo + acabado)
  agarre?: Agarre;             // por defecto de todas las puertas del frente (si falta, del campo tirador)
  acabado?: string;            // «lacada», «roble natural»…
  tirador?: 'laton' | 'ninguno';
  separacion_suelo?: number;   // cm entre puertas y suelo (def. 2)
  piezas: PiezaFrente[];       // de izquierda a derecha
}

/** Material de una pieza: el suyo, el del frente o el deducido del modelo y el acabado (diseños anteriores). */
export function materialPieza(f: Frente, p: PiezaFrente): MaterialPuerta {
  if (p.material) return p.material;
  if (f.material) return f.material;
  const modelo = p.tipo === 'puerta' ? (p.modelo ?? f.modelo) : 'lisa';
  const a = (f.acabado || '').toLowerCase();
  if (/rat[aá]n|rejilla/.test(a)) return 'ratan';
  if (/textil|tapiz|tela/.test(a)) return 'textil';
  if (modelo === 'moldurada') return 'moldurada_lacada';
  if (/laca/.test(a)) return 'lisa_lacada';
  if (/roble|nogal|madera|chapa|fresno|haya|cerezo/.test(a)) return 'chapa_madera';
  return 'lisa_melamina';
}
/** Agarre de una puerta: el suyo, el del frente o el del campo «tirador» (latón = premium; ninguno). */
export function agarrePuerta(f: Frente, p: PiezaFrente): Agarre {
  if (p.tipo === 'puerta' && p.agarre) return p.agarre;
  if (f.agarre) return f.agarre;
  return f.tirador === 'laton' ? 'tirador_premium' : f.tirador === 'ninguno' ? 'ninguno' : 'tirador';
}

export type Colocacion = 'linea' | 'esquina_izq' | 'esquina_der';
export const COLOCACIONES: Colocacion[] = ['linea', 'esquina_izq', 'esquina_der'];
export type Vista = 'lateral' | 'planta';
export const VISTAS: Vista[] = ['lateral', 'planta'];

export interface Cuerpo {
  nombre?: string;             // «CUERPO PRINCIPAL», «LATERAL · fondo 40»
  colocacion?: Colocacion;     // respecto al cuerpo anterior (def. en línea)
  ancho: number;
  alto: number;                // total, con zócalo
  fondo: number;
  zocalo?: number;             // def. 10
  grosor?: number;             // tablero, def. 1.9
  modulos: Modulo[];
  frente: Frente;
}

export interface Armario {
  codigo: string;              // «A.01»
  titulo: string;              // «ARMARIO A MEDIDA EN L»
  subtitulo?: string;          // si falta, se genera con las medidas
  formato?: Formato;           // si falta, A3 o A4 según el ancho
  notas?: string;              // pie izquierdo
  vistas?: Vista[];            // además de interior + cerrado
  cuerpos: Cuerpo[];
}

export interface Proyecto {
  version: 1;
  referencia?: string;         // nº de presupuesto
  cliente?: string;
  armarios: Armario[];
  cocinas?: Cocina[];          // cocinas (cocina.ts): tramos de bajos, altos y columnas
}

// ── Constantes de construcción (cm) ──────────────────────────────────
export const ZOCALO_DEF = 10;
export const GROSOR_DEF = 1.9;
export const SEPARACION_SUELO_DEF = 2;
export const CAJON_ALTO_DEF = 19.5;
export const HUECO_MANO_DEF = 3;        // cm libres encima de cada frente (cajón con hueco de mano)
export const TAPETA_CAJONERA_DEF = 3;   // cm de tapeta a cada lado de una cajonera detrás de puertas abatibles

type Cajonera = Extract<Zona, { tipo: 'cajonera' }>;
/** Hueco de mano de una cajonera (0 si no es de ese tipo). */
export const huecoMano = (z: Cajonera): number => (z.frente === 'hueco_mano' ? z.hueco ?? HUECO_MANO_DEF : 0);
/** Tapeta lateral de una cajonera (cm por lado): la suya o, detrás de puertas abatibles, la de por defecto. */
export const tapetasCajonera = (z: Cajonera, apertura?: string): number => z.tapetas ?? (apertura === 'abatible' ? TAPETA_CAJONERA_DEF : 0);
export const HUECO_ESTANTE_MIN = 5;   // cm libres entre estantes

const TIPOS_ZONA: TipoZona[] = ['altillo', 'perchero', 'perchero_extraible', 'cajonera', 'estantes', 'hueco', 'balda_inferior'];
const TOLERANCIA = 0.5; // cm

// ── JSON Schema (tool use de Claude en F2) ──────────────────────────
const num = (min: number, max: number, description: string) => ({ type: 'number', minimum: min, maximum: max, description });
const etiqueta = { type: 'string', maxLength: 60, description: 'Texto del alzado si no vale el de por defecto.' };
const altoLibre = num(5, 300, 'Alto libre del hueco en cm. Omitir para que ocupe el resto del módulo.');
const baldaEncima = num(1, 6, 'Solo si la balda ENCIMA de esta zona no es del grosor del tablero: grosor en cm (2,5 o 3 para balda gruesa). No en la primera zona.');
const grosorEstantes = num(1, 6, 'Solo si los estantes no son del grosor del tablero: grosor en cm (1,9 por defecto; 2,5 o 3 para «estantes de 25/30», «balda gruesa de 3 cm»).');

export const ESQUEMA_JSON = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'armarios'],
  properties: {
    version: { const: 1 },
    referencia: { type: 'string', maxLength: 40 },
    cliente: { type: 'string', maxLength: 80 },
    cocinas: ESQUEMA_COCINA_JSON,
    armarios: {
      type: 'array', minItems: 0, maxItems: 30, description: 'Armarios (lista vacía si el proyecto solo es una cocina).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'titulo', 'cuerpos'],
        properties: {
          codigo: { type: 'string', pattern: '^A\\.\\d{2}$', description: 'A.01, A.02…' },
          titulo: { type: 'string', maxLength: 60 },
          subtitulo: { type: 'string', maxLength: 140 },
          formato: { enum: ['A3', 'A4'] },
          notas: { type: 'string', maxLength: 220 },
          vistas: { type: 'array', uniqueItems: true, items: { enum: ['lateral', 'planta'] }, description: 'Vistas extra además de interior + cerrado: lateral (sección) y/o planta. Solo si el usuario las pide.' },
          cuerpos: {
            type: 'array', minItems: 1, maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ancho', 'alto', 'fondo', 'modulos', 'frente'],
              properties: {
                nombre: { type: 'string', maxLength: 40 },
                colocacion: { enum: ['linea', 'esquina_izq', 'esquina_der'], description: 'linea (def.: al lado del cuerpo anterior, alineado por detrás) o esquina_izq / esquina_der (lateral de un armario en L/U: girado 90°, en el extremo izquierdo / derecho de la fila principal, arranca en su frente). No en el primer cuerpo.' },
                ancho: num(20, 800, 'Ancho total del cuerpo en cm.'),
                alto: num(40, 350, 'Alto total en cm, zócalo incluido.'),
                fondo: num(20, 100, 'Fondo en cm.'),
                zocalo: num(0, 30, 'Alto del zócalo en cm (def. 10).'),
                grosor: num(1, 5, 'Grosor del tablero en cm (def. 1.9).'),
                modulos: {
                  type: 'array', minItems: 1, maxItems: 12,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['ancho', 'interior'],
                    properties: {
                      ancho: num(15, 200, 'Ancho exterior del módulo en cm.'),
                      interior: {
                        type: 'array', minItems: 1, maxItems: 12,
                        description: 'Zonas de arriba abajo; entre dos zonas hay una balda.',
                        items: {
                          oneOf: [
                            { type: 'object', additionalProperties: false, required: ['tipo', 'alto'], properties: { tipo: { const: 'altillo' }, alto: num(15, 120, 'Cota del altillo: desde arriba del cuerpo hasta debajo de su balda.'), etiqueta } },
                            { type: 'object', additionalProperties: false, required: ['tipo'], properties: { tipo: { const: 'perchero' }, alto: altoLibre, prendas: { enum: ['cortas', 'largas'] }, etiqueta, grosor_balda_encima: baldaEncima } },
                            { type: 'object', additionalProperties: false, required: ['tipo'], properties: { tipo: { const: 'perchero_extraible' }, alto: altoLibre, etiqueta, grosor_balda_encima: baldaEncima } },
                            { type: 'object', additionalProperties: false, required: ['tipo', 'cajones'], properties: { tipo: { const: 'cajonera' }, cajones: { type: 'integer', minimum: 1, maximum: 8 }, alto: altoLibre, etiqueta, grosor_balda_encima: baldaEncima,
                              frente: { enum: ['cerrado', 'abierto', 'hueco_mano'], description: 'abierto = cajón interior que deja ver el contenido («zapatero abierto», «cajones abiertos», «frente rebajado», «con escote»); hueco_mano = frente completo sin tirador con un hueco libre encima para meter la mano («hueco para la mano», «separación de 3 cm para abrir»). Omitir si es cerrado.' },
                              abierto: { enum: ['frente_bajo', 'escote'], description: 'Solo con frente abierto: frente_bajo (zapatero abierto, por defecto) o escote (frente con escote / hueco en U).' },
                              hueco: num(1, 10, 'Solo con frente hueco_mano: cm libres encima de cada frente (def. 3); se descuentan del frente.'),
                              agarre: { enum: ['tirador', 'unero', 'ninguno'], description: 'Agarre de los cajones, independiente del de las puertas: tirador (def.), unero o ninguno («sin tirador», push). Omitir si es tirador. Con hueco_mano, omitir (siempre ninguno).' },
                              tapetas: num(0, 10, 'Tapeta a cada lado de la cajonera en cm para que los cajones no choquen con las bisagras. Omitir: 3 detrás de puertas abatibles, 0 con el resto. 0 = sin tapetas.') } },
                            { type: 'object', additionalProperties: false, required: ['tipo', 'estantes'], properties: { tipo: { const: 'estantes' }, estantes: { type: 'integer', minimum: 1, maximum: 12 }, alto: altoLibre, etiqueta, grosor_estantes: grosorEstantes, grosor_balda_encima: baldaEncima } },
                            { type: 'object', additionalProperties: false, required: ['tipo'], properties: { tipo: { const: 'hueco' }, alto: altoLibre, etiqueta, grosor_balda_encima: baldaEncima } },
                            { type: 'object', additionalProperties: false, required: ['tipo'], properties: { tipo: { const: 'balda_inferior' }, alto: altoLibre, etiqueta, grosor_balda_encima: baldaEncima } }
                          ]
                        }
                      }
                    }
                  }
                },
                frente: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['apertura', 'modelo', 'piezas'],
                  properties: {
                    apertura: { enum: ['abatible', 'corredera', 'coplanar', 'escamoteable'] },
                    modelo: { enum: ['moldurada', 'lisa'] },
                    material: { enum: ['lisa_melamina', 'lisa_lacada', 'moldurada_lacada', 'chapa_madera', 'textil', 'ratan'], description: 'Material de las puertas: lisa_melamina, lisa_lacada, moldurada_lacada, chapa_madera (madera natural barnizada), textil (bastidor tapizado), ratan (bastidor de madera + rejilla).' },
                    agarre: { enum: ['tirador', 'tirador_premium', 'unero_dm', 'unero_madera', 'ninguno'], description: 'tirador estándar, tirador_premium (latón), unero_dm (uñero fresado en DM lacado), unero_madera (uñero en madera maciza) o ninguno. El uñero sustituye al tirador.' },
                    acabado: { type: 'string', maxLength: 40 },
                    tirador: { enum: ['laton', 'ninguno'] },
                    separacion_suelo: num(0, 20, 'Hueco entre puertas y suelo en cm (def. 2).'),
                    piezas: {
                      type: 'array', minItems: 1, maxItems: 16,
                      items: {
                        oneOf: [
                          { type: 'object', additionalProperties: false, required: ['tipo', 'ancho'], properties: { tipo: { const: 'puerta' }, ancho: num(20, 120, 'Ancho de la puerta en cm.'), tirador: { enum: ['izq', 'der'] }, modelo: { enum: ['moldurada', 'lisa'], description: 'Solo si esta puerta es distinta del modelo del frente.' }, material: { enum: ['lisa_melamina', 'lisa_lacada', 'moldurada_lacada', 'chapa_madera', 'textil', 'ratan'], description: 'Solo si esta puerta es de otro material que el frente.' }, agarre: { enum: ['tirador', 'tirador_premium', 'unero_dm', 'unero_madera', 'ninguno'], description: 'Solo si esta puerta lleva otro agarre que el frente.' } } },
                          { type: 'object', additionalProperties: false, required: ['tipo', 'ancho'], properties: { tipo: { const: 'fijo' }, ancho: num(3, 200, 'Ancho del frente fijo en cm.'), etiqueta, material: { enum: ['lisa_melamina', 'lisa_lacada', 'moldurada_lacada', 'chapa_madera', 'textil', 'ratan'] } } }
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

// ── Validación ──────────────────────────────────────────────────────
export interface ErrorValidacion {
  ruta: string;      // «armarios[0].cuerpos[1].modulos[0].interior[2]»
  mensaje: string;   // en español, para mostrar o para que Claude pregunte
}

export type ResultadoValidacion =
  | { ok: true; proyecto: Proyecto }
  | { ok: false; errores: ErrorValidacion[] };

type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function validarProyecto(entrada: unknown): ResultadoValidacion {
  const errores: ErrorValidacion[] = [];
  const err = (ruta: string, mensaje: string) => { errores.push({ ruta, mensaje }); };

  function campos(o: Obj, ruta: string, permitidos: string[]) {
    for (const k of Object.keys(o)) if (!permitidos.includes(k)) err(`${ruta}.${k}`, `campo desconocido «${k}»`);
  }
  function numero(o: Obj, k: string, ruta: string, min: number, max: number, obligatorio: boolean): number | undefined {
    const v = o[k];
    if (v === undefined) { if (obligatorio) err(`${ruta}.${k}`, 'falta la medida'); return undefined; }
    if (!esNum(v)) { err(`${ruta}.${k}`, 'debe ser un número (cm)'); return undefined; }
    if (v < min || v > max) { err(`${ruta}.${k}`, `${v} fuera de rango (${min}–${max})`); return undefined; }
    return v;
  }
  function entero(o: Obj, k: string, ruta: string, min: number, max: number): number | undefined {
    const v = numero(o, k, ruta, min, max, true);
    if (v !== undefined && !Number.isInteger(v)) { err(`${ruta}.${k}`, 'debe ser un número entero'); return undefined; }
    return v;
  }
  function texto(o: Obj, k: string, ruta: string, max: number, obligatorio = false) {
    const v = o[k];
    if (v === undefined) { if (obligatorio) err(`${ruta}.${k}`, 'falta el texto'); return; }
    if (typeof v !== 'string' || !v.trim()) err(`${ruta}.${k}`, 'debe ser un texto');
    else if (v.length > max) err(`${ruta}.${k}`, `texto demasiado largo (máx. ${max})`);
  }
  function opcion(o: Obj, k: string, ruta: string, valores: readonly string[], obligatorio = false) {
    const v = o[k];
    if (v === undefined) { if (obligatorio) err(`${ruta}.${k}`, `falta (${valores.join(' / ')})`); return; }
    if (typeof v !== 'string' || !valores.includes(v)) err(`${ruta}.${k}`, `valor no válido; usa ${valores.join(' / ')}`);
  }
  function lista(o: Obj, k: string, ruta: string, min: number, max: number): unknown[] {
    const v = o[k];
    if (!Array.isArray(v)) { err(`${ruta}.${k}`, 'falta la lista'); return []; }
    if (v.length < min) err(`${ruta}.${k}`, `debe tener al menos ${min}`);
    if (v.length > max) err(`${ruta}.${k}`, `máximo ${max}`);
    return v;
  }

  if (!esObj(entrada)) return { ok: false, errores: [{ ruta: '', mensaje: 'el proyecto debe ser un objeto JSON' }] };
  campos(entrada, 'proyecto', ['version', 'referencia', 'cliente', 'armarios', 'cocinas']);
  if (entrada.version !== 1) err('version', 'versión de esquema no soportada (debe ser 1)');
  texto(entrada, 'referencia', 'proyecto', 40);
  texto(entrada, 'cliente', 'proyecto', 80);

  const codigos = new Set<string>();
  validarCocinas(entrada.cocinas, err);
  const nCocinas = Array.isArray(entrada.cocinas) ? entrada.cocinas.length : 0;
  if (Array.isArray(entrada.armarios) && entrada.armarios.length === 0 && nCocinas === 0) err('proyecto.armarios', 'el proyecto necesita al menos un armario o una cocina');
  lista(entrada, 'armarios', 'proyecto', 0, 30).forEach((a, ia) => {
    const ra = `armarios[${ia}]`;
    if (!esObj(a)) { err(ra, 'debe ser un objeto'); return; }
    campos(a, ra, ['codigo', 'titulo', 'subtitulo', 'formato', 'notas', 'vistas', 'cuerpos']);
    if (a.vistas !== undefined) {
      if (!Array.isArray(a.vistas) || a.vistas.some((v) => !VISTAS.includes(v as Vista)) || new Set(a.vistas).size !== a.vistas.length) err(`${ra}.vistas`, `lista sin repetir de ${VISTAS.join(' / ')}`);
    }
    if (typeof a.codigo !== 'string' || !/^A\.\d{2}$/.test(a.codigo)) err(`${ra}.codigo`, 'formato A.01, A.02…');
    else if (codigos.has(a.codigo)) err(`${ra}.codigo`, `código repetido ${a.codigo}`);
    else codigos.add(a.codigo);
    texto(a, 'titulo', ra, 60, true);
    texto(a, 'subtitulo', ra, 140);
    texto(a, 'notas', ra, 220);
    opcion(a, 'formato', ra, ['A3', 'A4']);

    lista(a, 'cuerpos', ra, 1, 4).forEach((c, ic) => {
      const rc = `${ra}.cuerpos[${ic}]`;
      if (!esObj(c)) { err(rc, 'debe ser un objeto'); return; }
      campos(c, rc, ['nombre', 'colocacion', 'ancho', 'alto', 'fondo', 'zocalo', 'grosor', 'modulos', 'frente']);
      texto(c, 'nombre', rc, 40);
      opcion(c, 'colocacion', rc, COLOCACIONES);
      if (ic === 0 && c.colocacion !== undefined && c.colocacion !== 'linea') err(`${rc}.colocacion`, 'el primer cuerpo va en línea (la esquina es respecto al cuerpo anterior)');
      const ancho = numero(c, 'ancho', rc, 20, 800, true);
      const alto = numero(c, 'alto', rc, 40, 350, true);
      numero(c, 'fondo', rc, 20, 100, true);
      const zocalo = numero(c, 'zocalo', rc, 0, 30, false) ?? ZOCALO_DEF;
      const grosor = numero(c, 'grosor', rc, 1, 5, false) ?? GROSOR_DEF;

      // Módulos
      let sumaModulos = 0;
      let modulosOk = true;
      lista(c, 'modulos', rc, 1, 12).forEach((m, im) => {
        const rm = `${rc}.modulos[${im}]`;
        if (!esObj(m)) { err(rm, 'debe ser un objeto'); modulosOk = false; return; }
        campos(m, rm, ['ancho', 'interior']);
        const am = numero(m, 'ancho', rm, 15, 200, true);
        if (am === undefined) modulosOk = false; else sumaModulos += am;
        const zonas = lista(m, 'interior', rm, 1, 12);
        let zonasOk = true;
        zonas.forEach((z, iz) => {
          const rz = `${rm}.interior[${iz}]`;
          if (!esObj(z)) { err(rz, 'debe ser un objeto'); zonasOk = false; return; }
          const tipo = z.tipo;
          if (typeof tipo !== 'string' || !TIPOS_ZONA.includes(tipo as TipoZona)) {
            err(`${rz}.tipo`, `tipo desconocido; usa ${TIPOS_ZONA.join(' / ')}`); zonasOk = false; return;
          }
          const base = ['tipo', 'alto', 'etiqueta', 'grosor_balda_encima'];
          texto(z, 'etiqueta', rz, 60);
          if (z.grosor_balda_encima !== undefined) {
            if (iz === 0) err(`${rz}.grosor_balda_encima`, 'la primera zona no tiene balda encima (es el techo del cuerpo)');
            else if (numero(z, 'grosor_balda_encima', rz, 1, 6, false) === undefined) zonasOk = false;
          }
          if (tipo === 'altillo') {
            campos(z, rz, base);
            if (iz !== 0) err(rz, 'el altillo debe ser la primera zona (arriba)');
            if (numero(z, 'alto', rz, 15, 120, true) === undefined) zonasOk = false;
          } else {
            if (tipo === 'perchero') { campos(z, rz, [...base, 'prendas']); opcion(z, 'prendas', rz, ['cortas', 'largas']); }
            else if (tipo === 'cajonera') {
              campos(z, rz, [...base, 'cajones', 'frente', 'abierto', 'agarre', 'hueco', 'tapetas']);
              if (entero(z, 'cajones', rz, 1, 8) === undefined) zonasOk = false;
              opcion(z, 'frente', rz, ['cerrado', 'abierto', 'hueco_mano']); opcion(z, 'abierto', rz, ['frente_bajo', 'escote']); opcion(z, 'agarre', rz, ['tirador', 'unero', 'ninguno']);
              if (z.abierto !== undefined && z.frente !== 'abierto') err(`${rz}.abierto`, 'solo con frente «abierto»');
              if (z.hueco !== undefined) {
                if (z.frente !== 'hueco_mano') err(`${rz}.hueco`, 'solo con frente «hueco_mano»');
                else numero(z, 'hueco', rz, 1, 10, false);
              }
              if (z.frente === 'hueco_mano' && z.agarre !== undefined && z.agarre !== 'ninguno') err(`${rz}.agarre`, 'el cajón con hueco de mano no lleva tirador ni uñero: omite el agarre');
              const t = numero(z, 'tapetas', rz, 0, 10, false);
              if (t !== undefined && am !== undefined && am - 2 * grosor - 2 * t < 20) err(`${rz}.tapetas`, `con tapetas de ${t} cm el cajón se queda en ${r1(am - 2 * grosor - 2 * t)} cm (mín. 20)`);
              if (typeof z.cajones === 'number' && z.frente === 'hueco_mano') {
                const h = (typeof z.alto === 'number' ? z.alto : z.cajones * CAJON_ALTO_DEF) / z.cajones, hm = typeof z.hueco === 'number' ? z.hueco : HUECO_MANO_DEF;
                if (h - hm < 8) err(`${rz}.hueco`, `con un hueco de ${hm} cm el frente se queda en ${r1(h - hm)} cm (mín. 8)`);
              }
            }
            else if (tipo === 'estantes') {
              campos(z, rz, [...base, 'estantes', 'grosor_estantes']);
              if (entero(z, 'estantes', rz, 1, 12) === undefined) zonasOk = false;
              if (z.grosor_estantes !== undefined && numero(z, 'grosor_estantes', rz, 1, 6, false) === undefined) zonasOk = false;
            }
            else campos(z, rz, base);
            if (z.alto !== undefined && numero(z, 'alto', rz, 5, 300, false) === undefined) zonasOk = false;
            if (tipo === 'balda_inferior' && iz !== zonas.length - 1) err(rz, 'la balda inferior debe ser la última zona (abajo)');
          }
        });
        // Coherencia de alturas del módulo
        if (zonasOk && alto !== undefined && zonas.length) {
          const r = repartoZonas(zonas as Zona[], { alto, zocalo, grosor });
          if (r.error) err(`${rm}.interior`, r.error);
        }
      });
      if (modulosOk && ancho !== undefined && Math.abs(sumaModulos - ancho) > TOLERANCIA) {
        err(`${rc}.modulos`, `los módulos suman ${r1(sumaModulos)} cm y el cuerpo mide ${ancho} cm`);
      }

      // Frente
      const f = c.frente;
      const rf = `${rc}.frente`;
      if (!esObj(f)) { err(rf, 'falta el frente'); return; }
      campos(f, rf, ['apertura', 'modelo', 'material', 'agarre', 'acabado', 'tirador', 'separacion_suelo', 'piezas']);
      opcion(f, 'apertura', rf, [...APERTURAS], true);
      opcion(f, 'modelo', rf, ['moldurada', 'lisa'], true);
      opcion(f, 'material', rf, MATERIALES_PUERTA);
      opcion(f, 'agarre', rf, AGARRES);
      opcion(f, 'tirador', rf, ['laton', 'ninguno']);
      texto(f, 'acabado', rf, 40);
      numero(f, 'separacion_suelo', rf, 0, 20, false);
      let sumaFrente = 0;
      let frenteOk = true;
      lista(f, 'piezas', rf, 1, 16).forEach((p, ip) => {
        const rp = `${rf}.piezas[${ip}]`;
        if (!esObj(p)) { err(rp, 'debe ser un objeto'); frenteOk = false; return; }
        if (p.tipo === 'puerta') {
          campos(p, rp, ['tipo', 'ancho', 'tirador', 'modelo', 'material', 'agarre']);
          opcion(p, 'tirador', rp, ['izq', 'der']);
          opcion(p, 'modelo', rp, ['moldurada', 'lisa']);
          opcion(p, 'material', rp, MATERIALES_PUERTA);
          opcion(p, 'agarre', rp, AGARRES);
          const ap = numero(p, 'ancho', rp, 20, 120, true);
          if (ap === undefined) frenteOk = false; else sumaFrente += ap;
        } else if (p.tipo === 'fijo') {
          campos(p, rp, ['tipo', 'ancho', 'etiqueta', 'material']);
          texto(p, 'etiqueta', rp, 60);
          opcion(p, 'material', rp, MATERIALES_PUERTA);
          const ap = numero(p, 'ancho', rp, 3, 200, true);
          if (ap === undefined) frenteOk = false; else sumaFrente += ap;
        } else { err(`${rp}.tipo`, 'usa puerta / fijo'); frenteOk = false; }
      });
      if (frenteOk && ancho !== undefined && Math.abs(sumaFrente - ancho) > TOLERANCIA) {
        err(`${rf}.piezas`, `las puertas y frentes fijos suman ${r1(sumaFrente)} cm y el cuerpo mide ${ancho} cm`);
      }
    });
  });

  return errores.length ? { ok: false, errores } : { ok: true, proyecto: entrada as unknown as Proyecto };
}

// ── Reparto vertical de un módulo ───────────────────────────────────
// Alto libre de cada zona (cm), de arriba abajo. Lo usan la validación y el
// renderizador, así que la regla es una sola.
export interface ZonaMedida {
  zona: Zona;
  libre: number;   // alto libre del hueco
  arriba: number;  // cm desde arriba del cuerpo hasta el techo del hueco
  balda_encima: number;       // grosor de la balda encima (0 en la primera zona)
  grosor_estantes?: number;   // zona «estantes»: grosor de sus estantes
  hueco_estantes?: number;    // zona «estantes»: alto libre entre estantes
}

/** 19 · 30 · 25 — grosor en mm a partir de cm. */
export const fmtMm = (cm: number) => String(Math.round(cm * 10));
function fmtGrosores(v: number[], def: number): string {
  const distintos = [...new Set(v.length ? v : [def])];
  return distintos.map((g) => `${fmtMm(g)} mm`).join(' / ');
}

export function repartoZonas(
  zonas: Zona[],
  c: { alto: number; zocalo: number; grosor: number }
): { zonas: ZonaMedida[]; error?: string } {
  const interior = c.alto - c.zocalo - 2 * c.grosor;
  const encima = zonas.map((z, i) => (i === 0 ? 0 : z.grosor_balda_encima ?? c.grosor));   // balda encima de cada zona
  const baldas = encima.reduce((s, v) => s + v, 0);
  const libres: (number | null)[] = zonas.map((z) => {
    if (z.tipo === 'altillo') return z.alto - c.grosor - (encima[1] ?? c.grosor);
    if (z.alto !== undefined) return z.alto;
    if (z.tipo === 'cajonera') return z.cajones * CAJON_ALTO_DEF;
    return null;
  });
  const fijos = libres.reduce<number>((s, v) => s + (v ?? 0), 0);
  const sueltas = libres.filter((v) => v === null).length;
  const resto = interior - baldas - fijos;
  if (sueltas === 0 && Math.abs(resto) > TOLERANCIA) {
    return { zonas: [], error: `las zonas suman ${r1(fijos + baldas + 2 * c.grosor + c.zocalo)} cm y el cuerpo mide ${c.alto} cm de alto (incluye baldas de ${fmtGrosores(encima.slice(1), c.grosor)} y zócalo de ${c.zocalo})` };
  }
  if (sueltas > 0 && resto / sueltas < 10) {
    return { zonas: [], error: `no queda sitio: las zonas con medida ya ocupan ${r1(fijos)} cm de ${r1(interior - baldas)} cm libres` };
  }
  if (libres.some((v) => v !== null && v < 5)) return { zonas: [], error: 'hay una zona de menos de 5 cm' };
  const reparto = sueltas ? resto / sueltas : 0;
  let arriba = c.grosor;
  const out: ZonaMedida[] = zonas.map((zona, i) => {
    arriba += encima[i];
    const libre = libres[i] ?? reparto;
    const zm: ZonaMedida = { zona, libre, arriba, balda_encima: encima[i] };
    if (zona.tipo === 'estantes') {
      zm.grosor_estantes = zona.grosor_estantes ?? c.grosor;
      zm.hueco_estantes = (libre - zona.estantes * zm.grosor_estantes) / (zona.estantes + 1);
    }
    arriba += libre;
    return zm;
  });
  const estrecho = out.find((z) => z.hueco_estantes !== undefined && z.hueco_estantes < HUECO_ESTANTE_MIN);
  if (estrecho && estrecho.zona.tipo === 'estantes') {
    return { zonas: [], error: `${estrecho.zona.estantes} estantes de ${fmtMm(estrecho.grosor_estantes!)} mm no caben en ${r1(estrecho.libre)} cm: quedan huecos de ${r1(estrecho.hueco_estantes!)} cm (mín. ${HUECO_ESTANTE_MIN})` };
  }
  return { zonas: out };
}
