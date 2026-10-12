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
//
// validarProyecto() hace dos comprobaciones: formato estricto (tipos, campos
// conocidos, rangos) y coherencia (módulos y frente suman el ancho del cuerpo,
// las zonas caben en el alto). Devuelve errores legibles con su ruta para
// que Claude pregunte en vez de suponer.

export type Formato = 'A3' | 'A4';
export type LadoTirador = 'izq' | 'der';
export type ModeloPuerta = 'moldurada' | 'lisa';

export type Zona =
  | { tipo: 'altillo'; alto: number; etiqueta?: string }
  | { tipo: 'perchero'; alto?: number; prendas?: 'cortas' | 'largas'; etiqueta?: string }
  | { tipo: 'perchero_extraible'; alto?: number; etiqueta?: string }
  | { tipo: 'cajonera'; cajones: number; alto?: number; etiqueta?: string }
  | { tipo: 'estantes'; estantes: number; alto?: number; etiqueta?: string }
  | { tipo: 'hueco'; alto?: number; etiqueta?: string }
  | { tipo: 'balda_inferior'; alto?: number; etiqueta?: string };

export type TipoZona = Zona['tipo'];

export interface Modulo {
  ancho: number;
  interior: Zona[];
}

export type PiezaFrente =
  | { tipo: 'puerta'; ancho: number; tirador?: LadoTirador; modelo?: ModeloPuerta }
  | { tipo: 'fijo'; ancho: number; etiqueta?: string };

export interface Frente {
  apertura: 'abatible' | 'corredera';
  modelo: ModeloPuerta;        // por defecto de todas las puertas del frente
  acabado?: string;            // «lacada», «roble natural»…
  tirador?: 'laton' | 'ninguno';
  separacion_suelo?: number;   // cm entre puertas y suelo (def. 2)
  piezas: PiezaFrente[];       // de izquierda a derecha
}

export interface Cuerpo {
  nombre?: string;             // «CUERPO PRINCIPAL», «LATERAL · fondo 40»
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
  cuerpos: Cuerpo[];
}

export interface Proyecto {
  version: 1;
  referencia?: string;         // nº de presupuesto
  cliente?: string;
  armarios: Armario[];
}

// ── Constantes de construcción (cm) ──────────────────────────────────
export const ZOCALO_DEF = 10;
export const GROSOR_DEF = 1.9;
export const SEPARACION_SUELO_DEF = 2;
export const CAJON_ALTO_DEF = 19.5;

const TIPOS_ZONA: TipoZona[] = ['altillo', 'perchero', 'perchero_extraible', 'cajonera', 'estantes', 'hueco', 'balda_inferior'];
const TOLERANCIA = 0.5; // cm

// ── JSON Schema (tool use de Claude en F2) ──────────────────────────
const num = (min: number, max: number, description: string) => ({ type: 'number', minimum: min, maximum: max, description });
const etiqueta = { type: 'string', maxLength: 60, description: 'Texto del alzado si no vale el de por defecto.' };
const altoLibre = num(5, 300, 'Alto libre del hueco en cm. Omitir para que ocupe el resto del módulo.');

export const ESQUEMA_JSON = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'armarios'],
  properties: {
    version: { const: 1 },
    referencia: { type: 'string', maxLength: 40 },
    cliente: { type: 'string', maxLength: 80 },
    armarios: {
      type: 'array', minItems: 1, maxItems: 30,
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
          cuerpos: {
            type: 'array', minItems: 1, maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ancho', 'alto', 'fondo', 'modulos', 'frente'],
              properties: {
                nombre: { type: 'string', maxLength: 40 },
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
                            { type: 'object', additionalProperties: false, required: ['tipo'], properties: { tipo: { const: 'perchero' }, alto: altoLibre, prendas: { enum: ['cortas', 'largas'] }, etiqueta } },
                            { type: 'object', additionalProperties: false, required: ['tipo'], properties: { tipo: { const: 'perchero_extraible' }, alto: altoLibre, etiqueta } },
                            { type: 'object', additionalProperties: false, required: ['tipo', 'cajones'], properties: { tipo: { const: 'cajonera' }, cajones: { type: 'integer', minimum: 1, maximum: 8 }, alto: altoLibre, etiqueta } },
                            { type: 'object', additionalProperties: false, required: ['tipo', 'estantes'], properties: { tipo: { const: 'estantes' }, estantes: { type: 'integer', minimum: 1, maximum: 12 }, alto: altoLibre, etiqueta } },
                            { type: 'object', additionalProperties: false, required: ['tipo'], properties: { tipo: { const: 'hueco' }, alto: altoLibre, etiqueta } },
                            { type: 'object', additionalProperties: false, required: ['tipo'], properties: { tipo: { const: 'balda_inferior' }, alto: altoLibre, etiqueta } }
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
                    apertura: { enum: ['abatible', 'corredera'] },
                    modelo: { enum: ['moldurada', 'lisa'] },
                    acabado: { type: 'string', maxLength: 40 },
                    tirador: { enum: ['laton', 'ninguno'] },
                    separacion_suelo: num(0, 20, 'Hueco entre puertas y suelo en cm (def. 2).'),
                    piezas: {
                      type: 'array', minItems: 1, maxItems: 16,
                      items: {
                        oneOf: [
                          { type: 'object', additionalProperties: false, required: ['tipo', 'ancho'], properties: { tipo: { const: 'puerta' }, ancho: num(20, 120, 'Ancho de la puerta en cm.'), tirador: { enum: ['izq', 'der'] }, modelo: { enum: ['moldurada', 'lisa'], description: 'Solo si esta puerta es distinta del modelo del frente.' } } },
                          { type: 'object', additionalProperties: false, required: ['tipo', 'ancho'], properties: { tipo: { const: 'fijo' }, ancho: num(3, 200, 'Ancho del frente fijo en cm.'), etiqueta } }
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
  campos(entrada, 'proyecto', ['version', 'referencia', 'cliente', 'armarios']);
  if (entrada.version !== 1) err('version', 'versión de esquema no soportada (debe ser 1)');
  texto(entrada, 'referencia', 'proyecto', 40);
  texto(entrada, 'cliente', 'proyecto', 80);

  const codigos = new Set<string>();
  lista(entrada, 'armarios', 'proyecto', 1, 30).forEach((a, ia) => {
    const ra = `armarios[${ia}]`;
    if (!esObj(a)) { err(ra, 'debe ser un objeto'); return; }
    campos(a, ra, ['codigo', 'titulo', 'subtitulo', 'formato', 'notas', 'cuerpos']);
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
      campos(c, rc, ['nombre', 'ancho', 'alto', 'fondo', 'zocalo', 'grosor', 'modulos', 'frente']);
      texto(c, 'nombre', rc, 40);
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
          const base = ['tipo', 'alto', 'etiqueta'];
          texto(z, 'etiqueta', rz, 60);
          if (tipo === 'altillo') {
            campos(z, rz, base);
            if (iz !== 0) err(rz, 'el altillo debe ser la primera zona (arriba)');
            if (numero(z, 'alto', rz, 15, 120, true) === undefined) zonasOk = false;
          } else {
            if (tipo === 'perchero') { campos(z, rz, [...base, 'prendas']); opcion(z, 'prendas', rz, ['cortas', 'largas']); }
            else if (tipo === 'cajonera') { campos(z, rz, [...base, 'cajones']); if (entero(z, 'cajones', rz, 1, 8) === undefined) zonasOk = false; }
            else if (tipo === 'estantes') { campos(z, rz, [...base, 'estantes']); if (entero(z, 'estantes', rz, 1, 12) === undefined) zonasOk = false; }
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
      campos(f, rf, ['apertura', 'modelo', 'acabado', 'tirador', 'separacion_suelo', 'piezas']);
      opcion(f, 'apertura', rf, ['abatible', 'corredera'], true);
      opcion(f, 'modelo', rf, ['moldurada', 'lisa'], true);
      opcion(f, 'tirador', rf, ['laton', 'ninguno']);
      texto(f, 'acabado', rf, 40);
      numero(f, 'separacion_suelo', rf, 0, 20, false);
      let sumaFrente = 0;
      let frenteOk = true;
      lista(f, 'piezas', rf, 1, 16).forEach((p, ip) => {
        const rp = `${rf}.piezas[${ip}]`;
        if (!esObj(p)) { err(rp, 'debe ser un objeto'); frenteOk = false; return; }
        if (p.tipo === 'puerta') {
          campos(p, rp, ['tipo', 'ancho', 'tirador', 'modelo']);
          opcion(p, 'tirador', rp, ['izq', 'der']);
          opcion(p, 'modelo', rp, ['moldurada', 'lisa']);
          const ap = numero(p, 'ancho', rp, 20, 120, true);
          if (ap === undefined) frenteOk = false; else sumaFrente += ap;
        } else if (p.tipo === 'fijo') {
          campos(p, rp, ['tipo', 'ancho', 'etiqueta']);
          texto(p, 'etiqueta', rp, 60);
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
}

export function repartoZonas(
  zonas: Zona[],
  c: { alto: number; zocalo: number; grosor: number }
): { zonas: ZonaMedida[]; error?: string } {
  const interior = c.alto - c.zocalo - 2 * c.grosor;
  const baldas = (zonas.length - 1) * c.grosor;
  const libres: (number | null)[] = zonas.map((z) => {
    if (z.tipo === 'altillo') return z.alto - 2 * c.grosor;
    if (z.alto !== undefined) return z.alto;
    if (z.tipo === 'cajonera') return z.cajones * CAJON_ALTO_DEF;
    return null;
  });
  const fijos = libres.reduce<number>((s, v) => s + (v ?? 0), 0);
  const sueltas = libres.filter((v) => v === null).length;
  const resto = interior - baldas - fijos;
  if (sueltas === 0 && Math.abs(resto) > TOLERANCIA) {
    return { zonas: [], error: `las zonas suman ${r1(fijos + baldas + 2 * c.grosor + c.zocalo)} cm y el cuerpo mide ${c.alto} cm de alto (incluye baldas de ${c.grosor} y zócalo de ${c.zocalo})` };
  }
  if (sueltas > 0 && resto / sueltas < 10) {
    return { zonas: [], error: `no queda sitio: las zonas con medida ya ocupan ${r1(fijos)} cm de ${r1(interior - baldas)} cm libres` };
  }
  if (libres.some((v) => v !== null && v < 5)) return { zonas: [], error: 'hay una zona de menos de 5 cm' };
  const reparto = sueltas ? resto / sueltas : 0;
  let arriba = c.grosor;
  const out: ZonaMedida[] = zonas.map((zona, i) => {
    const libre = libres[i] ?? reparto;
    const zm = { zona, libre, arriba };
    arriba += libre + c.grosor;
    return zm;
  });
  return { zonas: out };
}
