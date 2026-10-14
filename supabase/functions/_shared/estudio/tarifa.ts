// supabase/functions/_shared/estudio/tarifa.ts
//
// Estudio Curino · tarifas y motor de precios (F3, 2026-10).
//
// Determinista: Claude no interviene. Cada concepto del catálogo tiene una
// unidad y un precio PVP sin IVA (null = PENDIENTE). El motor cuenta en el
// JSON del armario cuántas unidades hay de cada concepto y suma:
//   - cuerpo: metro lineal de cada cuerpo, precio según fondo y alto (matriz);
//   - puertas por unidad según modelo (lisa / moldurada) + extra corredera;
//     recargo % por acabado (lacado / madera) sobre el total de puertas;
//   - frente fijo por metro lineal; tiradores por unidad;
//   - interior por unidad: altillo (por módulo), estante (estantes + baldas
//     entre zonas, sin contar la del altillo), barra de colgar, perchero
//     extraíble, cajón.
// Si un concepto usado está PENDIENTE, el armario sale sin precio y la
// partida lo indica (se puede poner el precio a mano en el presupuesto).
// Descuento profesional e IVA van en la tarifa; IMPORTE = PVP × (1 − dto).

import type { Armario, Cuerpo } from './esquema.ts';
import { repartoZonas, ZOCALO_DEF, GROSOR_DEF } from './esquema.ts';
import { puntosArmario, puntosBase, type ModuloAsignado, type OpcionesPuntos } from './puntos.ts';

// 2026-10: el cuerpo y el interior (altillo, estantes, barras, cajones) se
// calculan por PUNTOS con la tabla OTG 2026 (puntos.ts). Aquí quedan en € los
// conceptos que la tabla no cubre (puertas, frentes, tiradores, perchero
// extraíble); se pasarán a puntos con sus hojas.

export type Unidad = 'ml' | 'ud' | '%';
export interface Concepto { clave: string; grupo: string; nombre: string; unidad: Unidad; ayuda?: string }

export const FONDOS = [{ hasta: 45, nombre: 'fondo hasta 45' }, { hasta: 65, nombre: 'fondo 46–65' }, { hasta: Infinity, nombre: 'fondo más de 65' }];
export const ALTOS = [{ hasta: 240, nombre: 'alto hasta 240' }, { hasta: 270, nombre: 'alto 241–270' }, { hasta: Infinity, nombre: 'alto más de 270' }];

// 2026-10: todo el armario va por puntos (puertas y herrajes incluidos); ya no
// quedan conceptos en € (los recargos de lacado y madera natural desaparecen:
// el material va en cada tipo de puerta).
export const CONCEPTOS: Concepto[] = [];

export interface Tarifa {
  valores: Record<string, number | null>;  // por clave; null o ausente = PENDIENTE
  descuento_pct: number | null;            // descuento profesional por defecto
  iva_pct: number | null;
  precio_punto?: number | null;            // € por punto (null = PENDIENTE)
  puntos?: Record<string, number>;         // solo los puntos cambiados sobre la tabla OTG 2026
  precio_punto_cocina?: number | null;     // € por punto de cocina (null = PENDIENTE)
  puntos_cocina?: Record<string, number>;  // solo los cambiados sobre la tarifa del proveedor
}

/** Puntos de una línea: unidades × puntos por unidad, al alza y sin decimales (3,2 m × 15 = 48; 1,5 × 15 = 23). */
export const puntosLinea = (puntos: number, cantidad: number) => Math.ceil(Math.round(puntos * cantidad * 1e6) / 1e6 - 1e-9);

/** Puntos que usa la tarifa: la tabla original + lo que el usuario haya cambiado. */
export const puntosDe = (t: Tarifa): Record<string, number> => ({ ...puntosBase(), ...(t.puntos ?? {}) });

export const TARIFA_PENDIENTE: Tarifa = {
  valores: Object.fromEntries(CONCEPTOS.map((c) => [c.clave, null])),
  descuento_pct: 0,
  iva_pct: 21,
  precio_punto: null,
  puntos: {}
};

export interface LineaDesglose {
  clave: string;
  nombre: string;
  cantidad: number;
  unidad: Unidad;
  precio: number | null;   // por unidad (o % si unidad '%')
  importe: number | null;
  puntos?: number;         // por unidad, si va por puntos
  puntos_linea?: number;   // puntos de la línea (unidades × puntos, al alza sin decimales)
  aviso?: string;          // «fuera de tabla», «revisar»…
}
export interface PrecioArmario {
  pvp: number | null;            // null si hay conceptos PENDIENTE
  desglose: LineaDesglose[];
  pendientes: string[];          // nombres de conceptos sin precio
  puntos_total: number;          // suma de puntos del armario
  modulos: ModuloAsignado[];     // modelo de interior asignado a cada módulo
  avisos: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const nombre = (clave: string) => CONCEPTOS.find((c) => c.clave === clave)?.nombre ?? clave;

export function claveCuerpo(c: Pick<Cuerpo, 'fondo' | 'alto'>): string {
  const i = FONDOS.findIndex((f) => c.fondo <= f.hasta);
  const j = ALTOS.findIndex((a) => c.alto <= a.hasta);
  return `cuerpo_f${i}_a${j}`;
}

export function tipoAcabado(acabado?: string): 'lacado' | 'madera' | null {
  const a = (acabado || '').toLowerCase();
  if (/laca/.test(a)) return 'lacado';
  if (/roble|nogal|madera|chapa|fresno|haya|cerezo/.test(a)) return 'madera';
  return null;
}

/** Cantidades en € de un armario: ya no hay conceptos en € (todo va por puntos). */
export function contarArmario(_a: Armario): Record<string, number> {
  return {};
}

export function precioArmario(a: Armario, t: Tarifa, op: OpcionesPuntos = {}): PrecioArmario {
  const cantidades = contarArmario(a);
  const desglose: LineaDesglose[] = [];
  const pendientes: string[] = [];
  // Cuerpo e interior por puntos (tabla OTG 2026 + cambios del usuario)
  const pp = typeof t.precio_punto === 'number' && Number.isFinite(t.precio_punto) && t.precio_punto > 0 ? t.precio_punto : null;
  const pt = puntosArmario(a, puntosDe(t), op);
  let puntosTotal = 0, totalPuntos = 0;
  for (const l of pt.lineas) {
    const pts = puntosLinea(l.puntos, l.cantidad);
    puntosTotal += pts;
    const precio = pp === null ? null : r2(l.puntos * pp);
    desglose.push({ clave: l.clave, nombre: l.nombre, cantidad: l.cantidad, unidad: 'ud', precio, importe: pp === null ? null : r2(pts * pp), puntos: l.puntos, puntos_linea: pts, aviso: l.aviso });
    if (pp !== null) totalPuntos += r2(pts * pp);
  }
  if (pt.lineas.length && pp === null) pendientes.push('Precio del punto');
  const valor = (k: string) => {
    const v = t.valores[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  let total = 0;
  let puertas = 0;
  const orden = CONCEPTOS.map((c) => c.clave).filter((k) => cantidades[k] && CONCEPTOS.find((c) => c.clave === k)!.unidad !== '%');
  for (const k of orden) {
    const precio = valor(k);
    const importe = precio === null ? null : r2(precio * cantidades[k]);
    const unidad = CONCEPTOS.find((c) => c.clave === k)!.unidad;
    desglose.push({ clave: k, nombre: nombre(k), cantidad: cantidades[k], unidad, precio, importe });
    if (importe === null) pendientes.push(nombre(k));
    else {
      total += importe;
      if (k.startsWith('puerta_')) puertas += importe;
    }
  }
  total += totalPuntos;
  return { pvp: pendientes.length ? null : r2(total), desglose, pendientes, puntos_total: Math.round(puntosTotal * 100) / 100, modulos: pt.modulos, avisos: pt.avisos };
}

/** Importe de una línea del presupuesto. */
export function importeLinea(precio: number | null, cantidad: number, dtoPct: number): { pvp: number | null; importe: number | null } {
  if (precio === null) return { pvp: null, importe: null };
  const pvp = r2(precio * cantidad);
  return { pvp, importe: r2(pvp * (1 - dtoPct / 100)) };
}

/** 4.073,65 € */
export function eur(n: number): string {
  const [e, d] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d} €`;
}
