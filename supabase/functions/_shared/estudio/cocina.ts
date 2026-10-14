// supabase/functions/_shared/estudio/cocina.ts
//
// Estudio Curino · COCINAS (fase 2): esquema, validación y valores por defecto.
//
// Una cocina (C.01, C.02…) va en `proyecto.cocinas`, junto a los armarios.
// Tiene tramos (una pared cada uno, o la isla) y cada tramo, su fila de
// módulos bajos (bajos, fregadero, horno, esquinero, columnas…) y su fila de
// altos, de izquierda a derecha. En la fila de altos, «hueco» deja sitio
// (campana, ventana, encima de una columna) para que cuadren con los bajos.
// Medidas en cm; los fondos son los de la tarifa (bajos 58 de cuerpo, altos 33).
//
// completarCocina() rellena lo que falta con los valores por defecto y anota
// cada uno en `supuestos` (la ficha técnica los marca «supuesto»): bajos de 70,
// altos de 70, columnas de 220, cuerpo Blanco 16, puerta grupo 1, encimera
// compacto núcleo negro, zócalo 10, cajones Advänced…

import type { Colocacion, Vista } from './esquema.ts';
import { ENCIMERAS_COCINA, GRUPOS_UNERO, type NucleoEncimera } from './cocina-tarifa.ts';

export type AcabadoCuerpo = 'blanco16' | 'gris_plomo16' | 'blanco_plus18';
export const ACABADOS_CUERPO: AcabadoCuerpo[] = ['blanco16', 'gris_plomo16', 'blanco_plus18'];
export const ACABADO_TXT: Record<AcabadoCuerpo, string> = { blanco16: 'Blanco 16', gris_plomo16: 'Gris plomo 16', blanco_plus18: 'Blanco Plus 18 hidrófugo' };

export type TipoModuloCocina = 'bajo' | 'fregadero' | 'horno' | 'esquinero' | 'alto' | 'esquinero_alto' | 'columna' | 'columna_hm' | 'sobrenevera' | 'transversal' | 'hueco';
export const TIPOS_BAJOS: TipoModuloCocina[] = ['bajo', 'fregadero', 'horno', 'esquinero', 'columna', 'columna_hm', 'hueco'];
export const TIPOS_ALTOS: TipoModuloCocina[] = ['alto', 'esquinero_alto', 'sobrenevera', 'transversal', 'hueco'];
export const TIPO_TXT: Record<TipoModuloCocina, string> = {
  bajo: 'Bajo', fregadero: 'Fregadero', horno: 'Horno', esquinero: 'Esquinero bajo', alto: 'Alto', esquinero_alto: 'Esquinero alto',
  columna: 'Columna', columna_hm: 'Columna horno + micro', sobrenevera: 'Sobrenevera', transversal: 'Transversal', hueco: 'Hueco'
};

export type Electro = 'placa' | 'horno' | 'microondas' | 'fregadero' | 'campana' | 'nevera' | 'lavavajillas' | 'lavadora';
export const ELECTROS: Electro[] = ['placa', 'horno', 'microondas', 'fregadero', 'campana', 'nevera', 'lavavajillas', 'lavadora'];
export type GrupoPuerta = 1 | 3 | 6 | 7 | 13 | 10 | 12 | 14;
export const GRUPOS: GrupoPuerta[] = [1, 3, 6, 7, 13, 10, 12, 14];
export type AgarreCocina = 'tirador' | 'tirador_premium' | 'unero';
export type SistemaCajon = 'advanced' | 'legrabox';
export type TipoFrente = 'puertas' | 'cajones' | 'aventos_hf' | 'aventos_hk' | 'abierto';

export interface FrenteCocina {
  tipo: TipoFrente;
  puertas?: number;          // puertas: de lado a lado (def. 1 hasta 50 cm, 2 más)
  alturas?: number[];        // cajones o puertas apiladas: alto de cada frente (cm), de arriba abajo
  cajones?: number;          // cajones: número (si no hay alturas, se reparten iguales)
  sistema?: SistemaCajon;    // cajones (def. Advänced)
  color_cajon?: 'blanco' | 'antracita';
}
export interface HerrajeUso { codigo: string; cantidad?: number }
export interface ModuloCocina {
  tipo: TipoModuloCocina;
  ancho: number;
  alto?: number;             // cuerpo (sin zócalo ni encimera)
  acabado?: AcabadoCuerpo;   // si es distinto del de la cocina
  frente?: FrenteCocina;
  grupo?: GrupoPuerta;       // puerta, si es distinto del de la cocina
  agarre?: AgarreCocina;
  electro?: Electro[];       // electrodomésticos del módulo (placa encima, horno, nevera en un hueco…)
  etiqueta?: string;
  herrajes?: HerrajeUso[];
}
export interface TramoCocina {
  nombre?: string;           // «PARED VENTANA», «ISLA»
  colocacion?: Colocacion | 'isla';
  bajos: ModuloCocina[];
  altos?: ModuloCocina[];
  encimera?: boolean;        // def. sí (si hay bajos con encimera)
  metros_encimera?: number;  // si no, suma de los bajos (sin columnas ni huecos de nevera)
  laterales?: { bajo?: number; alto?: number };   // laterales vistos (piezas)
  herrajes?: HerrajeUso[];
}
export interface EncimeraCocina { nucleo?: NucleoEncimera; ref?: string }
export interface Cocina {
  codigo: string;            // «C.01»
  titulo: string;
  notas?: string;
  vistas?: Vista[];
  acabado?: AcabadoCuerpo;
  grupo?: GrupoPuerta;
  agarre?: AgarreCocina;
  zocalo?: number;           // cm (def. 10)
  encimera?: EncimeraCocina;
  tramos: TramoCocina[];
  supuestos?: string[];      // lo que ha rellenado completarCocina (no lo escribe Claude)
}

// ── Valores por defecto ──────────────────────────────────────────────
export const COCINA_DEF = {
  alto_bajo: 70, alto_alto: 70, alto_columna: 220, alto_sobrenevera: 35, alto_transversal: 45,
  acabado: 'blanco16' as AcabadoCuerpo, grupo: 1 as GrupoPuerta, nucleo: 'negro' as NucleoEncimera,
  zocalo: 10, fondo_bajo: 58, fondo_alto: 33, fondo_encimera: 65, encimera_grueso: 1.2,
  sistema_cajon: 'advanced' as SistemaCajon, horno_hueco: 60, micro_hueco: 38
};
/** Fondo del cuerpo (cm). */
export const fondoModulo = (t: TipoModuloCocina) => TIPOS_ALTOS.includes(t) && t !== 'hueco' ? COCINA_DEF.fondo_alto : COCINA_DEF.fondo_bajo;
export const esUnero = (grupo: number, agarre?: AgarreCocina) => agarre === 'unero' || GRUPOS_UNERO.includes(grupo);

const altoDef = (t: TipoModuloCocina, fila: 'bajos' | 'altos'): number | null => {
  if (t === 'columna' || t === 'columna_hm') return COCINA_DEF.alto_columna;
  if (t === 'sobrenevera') return COCINA_DEF.alto_sobrenevera;
  if (t === 'transversal') return COCINA_DEF.alto_transversal;
  if (t === 'hueco') return null;
  return fila === 'altos' ? COCINA_DEF.alto_alto : COCINA_DEF.alto_bajo;
};

/** Rellena los valores por defecto y anota los supuestos (no cambia lo que viene). */
export function completarCocina(entrada: Cocina): Cocina {
  const c: Cocina = JSON.parse(JSON.stringify(entrada));
  const sup = new Set<string>();
  if (!c.acabado) { c.acabado = COCINA_DEF.acabado; sup.add(`cuerpo ${ACABADO_TXT[COCINA_DEF.acabado]}`); }
  if (!c.grupo) { c.grupo = COCINA_DEF.grupo; sup.add(`puerta grupo ${COCINA_DEF.grupo}`); }
  if (!c.agarre) { c.agarre = GRUPOS_UNERO.includes(c.grupo) ? 'unero' : 'tirador'; if (!GRUPOS_UNERO.includes(c.grupo)) sup.add('tirador'); }
  if (c.zocalo === undefined) { c.zocalo = COCINA_DEF.zocalo; sup.add(`zócalo ${COCINA_DEF.zocalo} cm`); }
  const hayEncimera = c.tramos.some((t) => t.encimera !== false && t.bajos.some((m) => m.tipo !== 'columna' && m.tipo !== 'columna_hm' && m.tipo !== 'hueco'));
  if (hayEncimera) {
    c.encimera = c.encimera ?? {};
    if (!c.encimera.nucleo) { c.encimera.nucleo = COCINA_DEF.nucleo; sup.add('encimera compacto núcleo negro'); }
    if (!c.encimera.ref || !ENCIMERAS_COCINA.some((e) => e.ref === c.encimera!.ref)) {
      // La más barata de su núcleo
      const ref = ENCIMERAS_COCINA.filter((e) => e.nucleo === c.encimera!.nucleo).sort((a, b) => a.eur - b.eur)[0].ref;
      if (c.encimera.ref) sup.add(`encimera «${c.encimera.ref}» no está en la tarifa: ${ref}`); else sup.add(`encimera ${ref} (la más barata de su núcleo)`);
      c.encimera.ref = ref;
    }
  }
  for (const t of c.tramos) {
    for (const [fila, mods] of [['bajos', t.bajos], ['altos', t.altos ?? []]] as const) {
      for (const m of mods) {
        if (m.alto === undefined) {
          const a = altoDef(m.tipo, fila);
          if (a !== null) {
            m.alto = a;
            sup.add(m.tipo === 'columna' || m.tipo === 'columna_hm' ? `columnas de ${a}` : m.tipo === 'sobrenevera' || m.tipo === 'transversal' ? `${TIPO_TXT[m.tipo].toLowerCase()} de ${a}` : fila === 'altos' ? `altos de ${a} de alto` : `bajos de ${a} de alto`);
          }
        }
        if (m.tipo === 'hueco') continue;
        if (!m.frente) {
          if (m.tipo === 'horno') m.frente = { tipo: 'cajones', cajones: 1, alturas: [Math.max(10, (m.alto ?? 70) - COCINA_DEF.horno_hueco)] };
          else if (m.tipo === 'columna_hm') {
            const resto = (m.alto ?? 220) - COCINA_DEF.horno_hueco - COCINA_DEF.micro_hueco;
            const abajo = Math.min(COCINA_DEF.alto_bajo, resto - 20);
            m.frente = { tipo: 'puertas', puertas: 1, alturas: [resto - abajo, abajo] };
            sup.add('columna horno + micro: puerta arriba y abajo');
          } else if (m.tipo === 'esquinero' || m.tipo === 'esquinero_alto') {
            m.frente = { tipo: 'puertas', puertas: 2 };
            sup.add('esquineros con 2 puertas en L (ancho − fondo cada una)');
          } else {
            m.frente = { tipo: 'puertas', puertas: m.ancho > 50 ? 2 : 1 };
            sup.add('frentes de puertas (1 hasta 50 cm, 2 más)');
          }
        }
        if (m.frente.tipo === 'cajones' && !m.frente.sistema) { m.frente.sistema = COCINA_DEF.sistema_cajon; sup.add('cajones Advänced'); }
      }
    }
  }
  c.supuestos = [...sup];
  return c;
}

/** Ancho de cada puerta: el módulo entre sus puertas; en esquineros, puertas en L de (ancho − fondo). */
export function anchoPuerta(m: ModuloCocina, puertas: number): number {
  if (m.tipo === 'esquinero' || m.tipo === 'esquinero_alto') return m.ancho - fondoModulo(m.tipo);
  return m.ancho / puertas;
}

/** Alturas de los frentes de cajón (cm, de arriba abajo). */
export function alturasCajones(m: ModuloCocina): number[] {
  const f = m.frente!;
  if (f.alturas?.length) return f.alturas;
  const n = Math.max(1, f.cajones ?? 3), alto = m.alto ?? COCINA_DEF.alto_bajo;
  return Array.from({ length: n }, () => Math.round((alto / n) * 10) / 10);
}

/** Metros lineales de encimera de un tramo (cm): los suyos o la suma de los bajos que llevan encimera. */
export function cmEncimera(t: TramoCocina): number {
  if (t.encimera === false) return 0;
  if (t.metros_encimera) return t.metros_encimera * 100;
  return t.bajos.filter((m) => m.tipo !== 'columna' && m.tipo !== 'columna_hm' && !(m.tipo === 'hueco' && m.electro?.includes('nevera'))).reduce((s, m) => s + m.ancho, 0);
}

// ── JSON Schema (tool use de Claude) ─────────────────────────────────
const num = (min: number, max: number, description: string) => ({ type: 'number', minimum: min, maximum: max, description });
const herrajes = { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['codigo'], properties: { codigo: { type: 'string', pattern: '^\\d{5}$', description: 'Código de la tarifa (00817 porta-botellas, 00803–00805 cesto fregadero, 00800–00802 cubos reciclaje, 00834–00837 cubos basura).' }, cantidad: { type: 'integer', minimum: 1, maximum: 20 } } } };
const modulo = {
  type: 'object', additionalProperties: false, required: ['tipo', 'ancho'],
  properties: {
    tipo: { enum: ['bajo', 'fregadero', 'horno', 'esquinero', 'alto', 'esquinero_alto', 'columna', 'columna_hm', 'sobrenevera', 'transversal', 'hueco'] },
    ancho: num(10, 200, 'Ancho en cm (esquinero bajo 93, esquinero alto 63).'),
    alto: num(10, 280, 'Alto del cuerpo en cm, solo si lo dicen (bajos 70/80, altos 70/80/90, columnas 220/230).'),
    acabado: { enum: ['blanco16', 'gris_plomo16', 'blanco_plus18'], description: 'Solo si es distinto del de la cocina.' },
    frente: {
      type: 'object', additionalProperties: false, required: ['tipo'],
      properties: {
        tipo: { enum: ['puertas', 'cajones', 'aventos_hf', 'aventos_hk', 'abierto'] },
        puertas: { type: 'integer', minimum: 1, maximum: 4 },
        cajones: { type: 'integer', minimum: 1, maximum: 6 },
        alturas: { type: 'array', minItems: 1, maxItems: 6, items: num(8, 270, 'Alto del frente en cm.'), description: 'Alto de cada frente (cajones o puertas apiladas), de arriba abajo.' },
        sistema: { enum: ['advanced', 'legrabox'] },
        color_cajon: { enum: ['blanco', 'antracita'] }
      }
    },
    grupo: { enum: [1, 3, 6, 7, 13, 10, 12, 14], description: 'Grupo de puerta solo si es distinto del de la cocina.' },
    agarre: { enum: ['tirador', 'tirador_premium', 'unero'], description: 'tirador estándar, tirador_premium (latón u otro premium) o unero (uñero / fingerpull, sin tirador).' },
    electro: { type: 'array', uniqueItems: true, items: { enum: ['placa', 'horno', 'microondas', 'fregadero', 'campana', 'nevera', 'lavavajillas', 'lavadora'] } },
    etiqueta: { type: 'string', maxLength: 40 },
    herrajes
  }
};
export const ESQUEMA_COCINA_JSON = {
  type: 'array', maxItems: 10,
  items: {
    type: 'object', additionalProperties: false, required: ['codigo', 'titulo', 'tramos'],
    properties: {
      codigo: { type: 'string', pattern: '^C\\.\\d{2}$', description: 'C.01, C.02…' },
      titulo: { type: 'string', maxLength: 60 },
      notas: { type: 'string', maxLength: 220 },
      vistas: { type: 'array', uniqueItems: true, items: { enum: ['lateral', 'planta'] } },
      acabado: { enum: ['blanco16', 'gris_plomo16', 'blanco_plus18'], description: 'Cuerpo: Blanco 16, Gris plomo 16 o Blanco Plus 18 hidrófugo.' },
      grupo: { enum: [1, 3, 6, 7, 13, 10, 12, 14], description: 'Grupo de puerta de la tarifa (12 y 14 = uñero).' },
      agarre: { enum: ['tirador', 'tirador_premium', 'unero'], description: 'tirador estándar, tirador_premium (latón u otro premium) o unero (uñero / fingerpull, sin tirador).' },
      zocalo: num(0, 20, 'Alto del zócalo en cm.'),
      encimera: { type: 'object', additionalProperties: false, properties: { nucleo: { enum: ['negro', 'al_tono', 'blanco'] }, ref: { type: 'string', maxLength: 60, description: 'Referencia exacta de la tarifa si la dicen.' } } },
      tramos: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false, required: ['bajos'],
          properties: {
            nombre: { type: 'string', maxLength: 40 },
            colocacion: { enum: ['linea', 'esquina_izq', 'esquina_der', 'isla'], description: 'Como en armarios: el primero es la pared principal; esquina_izq / esquina_der = pared de la izquierda / derecha (cocina en L o U); isla = exenta, delante.' },
            bajos: { type: 'array', maxItems: 20, items: modulo, description: 'Bajos y columnas de izquierda a derecha.' },
            altos: { type: 'array', maxItems: 20, items: modulo, description: 'Altos de izquierda a derecha, alineados con los bajos (hueco = sin mueble: campana, ventana, encima de columnas).' },
            encimera: { type: 'boolean' },
            metros_encimera: num(0.3, 20, 'Metros lineales de encimera si no son la suma de los bajos.'),
            laterales: { type: 'object', additionalProperties: false, properties: { bajo: { type: 'integer', minimum: 0, maximum: 6 }, alto: { type: 'integer', minimum: 0, maximum: 6 } } },
            herrajes
          }
        }
      }
    }
  }
} as const;

// ── Validación ───────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valida las cocinas del proyecto (mismas reglas de mensajes que validarProyecto). */
export function validarCocinas(lista: unknown, err: (ruta: string, mensaje: string) => void): void {
  if (lista === undefined) return;
  if (!Array.isArray(lista)) { err('proyecto.cocinas', 'debe ser una lista'); return; }
  if (lista.length > 10) err('proyecto.cocinas', 'máximo 10');
  const codigos = new Set<string>();
  const campos = (o: Obj, ruta: string, ok: string[]) => { for (const k of Object.keys(o)) if (!ok.includes(k)) err(`${ruta}.${k}`, `campo desconocido «${k}»`); };
  const numero = (o: Obj, k: string, ruta: string, min: number, max: number, oblig = false) => {
    const v = o[k];
    if (v === undefined) { if (oblig) err(`${ruta}.${k}`, 'falta la medida'); return; }
    if (!esNum(v) || v < min || v > max) err(`${ruta}.${k}`, `debe ser un número entre ${min} y ${max}`);
  };
  const opcion = (o: Obj, k: string, ruta: string, vals: readonly (string | number)[]) => {
    if (o[k] !== undefined && !vals.includes(o[k] as string)) err(`${ruta}.${k}`, `valor no válido; usa ${vals.join(' / ')}`);
  };
  const herr = (o: Obj, ruta: string) => {
    if (o.herrajes === undefined) return;
    if (!Array.isArray(o.herrajes)) return err(`${ruta}.herrajes`, 'debe ser una lista');
    o.herrajes.forEach((h, i) => { if (!esObj(h) || typeof h.codigo !== 'string' || !/^\d{5}$/.test(h.codigo)) err(`${ruta}.herrajes[${i}]`, 'código de 5 cifras de la tarifa'); });
  };
  lista.forEach((c, ic) => {
    const rc = `cocinas[${ic}]`;
    if (!esObj(c)) return err(rc, 'debe ser un objeto');
    campos(c, rc, ['codigo', 'titulo', 'notas', 'vistas', 'acabado', 'grupo', 'agarre', 'zocalo', 'encimera', 'tramos', 'supuestos']);
    if (typeof c.codigo !== 'string' || !/^C\.\d{2}$/.test(c.codigo)) err(`${rc}.codigo`, 'formato C.01, C.02…');
    else if (codigos.has(c.codigo)) err(`${rc}.codigo`, `código repetido ${c.codigo}`); else codigos.add(c.codigo);
    if (typeof c.titulo !== 'string' || !c.titulo.trim()) err(`${rc}.titulo`, 'falta el texto');
    if (c.vistas !== undefined && (!Array.isArray(c.vistas) || c.vistas.some((v) => v !== 'lateral' && v !== 'planta'))) err(`${rc}.vistas`, 'lista de lateral / planta');
    opcion(c, 'acabado', rc, ACABADOS_CUERPO); opcion(c, 'grupo', rc, GRUPOS); opcion(c, 'agarre', rc, ['tirador', 'tirador_premium', 'unero']);
    numero(c, 'zocalo', rc, 0, 20);
    if (c.encimera !== undefined) {
      if (!esObj(c.encimera)) err(`${rc}.encimera`, 'debe ser un objeto');
      else { campos(c.encimera, `${rc}.encimera`, ['nucleo', 'ref']); opcion(c.encimera, 'nucleo', `${rc}.encimera`, ['negro', 'al_tono', 'blanco']); }
    }
    if (!Array.isArray(c.tramos) || !c.tramos.length) return err(`${rc}.tramos`, 'falta la lista de tramos');
    if (c.tramos.length > 4) err(`${rc}.tramos`, 'máximo 4');
    c.tramos.forEach((t, it) => {
      const rt = `${rc}.tramos[${it}]`;
      if (!esObj(t)) return err(rt, 'debe ser un objeto');
      campos(t, rt, ['nombre', 'colocacion', 'bajos', 'altos', 'encimera', 'metros_encimera', 'laterales', 'herrajes']);
      opcion(t, 'colocacion', rt, ['linea', 'esquina_izq', 'esquina_der', 'isla']);
      if (it === 0 && t.colocacion !== undefined && t.colocacion !== 'linea') err(`${rt}.colocacion`, 'el primer tramo es la pared principal (en línea)');
      numero(t, 'metros_encimera', rt, 0.3, 20);
      herr(t, rt);
      if (t.laterales !== undefined && !esObj(t.laterales)) err(`${rt}.laterales`, 'debe ser un objeto');
      for (const fila of ['bajos', 'altos'] as const) {
        const mods = t[fila];
        if (mods === undefined && fila === 'altos') continue;
        if (!Array.isArray(mods)) { err(`${rt}.${fila}`, 'falta la lista'); continue; }
        mods.forEach((m, im) => {
          const rm = `${rt}.${fila}[${im}]`;
          if (!esObj(m)) return err(rm, 'debe ser un objeto');
          campos(m, rm, ['tipo', 'ancho', 'alto', 'acabado', 'frente', 'grupo', 'agarre', 'electro', 'etiqueta', 'herrajes']);
          const permitidos = fila === 'bajos' ? TIPOS_BAJOS : TIPOS_ALTOS;
          if (!permitidos.includes(m.tipo as TipoModuloCocina)) err(`${rm}.tipo`, `en ${fila}: ${permitidos.join(' / ')}`);
          numero(m, 'ancho', rm, 10, 200, true); numero(m, 'alto', rm, 10, 280);
          opcion(m, 'acabado', rm, ACABADOS_CUERPO); opcion(m, 'grupo', rm, GRUPOS); opcion(m, 'agarre', rm, ['tirador', 'tirador_premium', 'unero']);
          if (m.electro !== undefined && (!Array.isArray(m.electro) || m.electro.some((e) => !ELECTROS.includes(e as Electro)))) err(`${rm}.electro`, `lista de ${ELECTROS.join(' / ')}`);
          herr(m, rm);
          if (m.frente !== undefined) {
            const f = m.frente, rf = `${rm}.frente`;
            if (!esObj(f)) return err(rf, 'debe ser un objeto');
            campos(f, rf, ['tipo', 'puertas', 'alturas', 'cajones', 'sistema', 'color_cajon']);
            opcion(f, 'tipo', rf, ['puertas', 'cajones', 'aventos_hf', 'aventos_hk', 'abierto']);
            opcion(f, 'sistema', rf, ['advanced', 'legrabox']); opcion(f, 'color_cajon', rf, ['blanco', 'antracita']);
            if (f.alturas !== undefined && (!Array.isArray(f.alturas) || f.alturas.some((a) => !esNum(a) || a < 8 || a > 270))) err(`${rf}.alturas`, 'lista de altos en cm (8–270)');
            if (f.alturas !== undefined && Array.isArray(f.alturas) && esNum(m.alto)) {
              const suma = (f.alturas as number[]).reduce((s, a) => s + a, 0);
              if (suma > (m.alto as number) + 1) err(`${rf}.alturas`, `los frentes suman ${suma} cm y el módulo mide ${m.alto}`);
            }
          }
        });
      }
    });
  });
}
