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

export type Unidad = 'ml' | 'ud' | '%';
export interface Concepto { clave: string; grupo: string; nombre: string; unidad: Unidad; ayuda?: string }

export const FONDOS = [{ hasta: 45, nombre: 'fondo hasta 45' }, { hasta: 65, nombre: 'fondo 46–65' }, { hasta: Infinity, nombre: 'fondo más de 65' }];
export const ALTOS = [{ hasta: 240, nombre: 'alto hasta 240' }, { hasta: 270, nombre: 'alto 241–270' }, { hasta: Infinity, nombre: 'alto más de 270' }];

export const CONCEPTOS: Concepto[] = [
  ...FONDOS.flatMap((f, i) => ALTOS.map((a, j) => ({
    clave: `cuerpo_f${i}_a${j}`, grupo: 'Cuerpo (por metro lineal)', nombre: `Cuerpo · ${f.nombre} · ${a.nombre}`, unidad: 'ml' as Unidad
  }))),
  { clave: 'puerta_lisa', grupo: 'Frente', nombre: 'Puerta lisa', unidad: 'ud' },
  { clave: 'puerta_moldurada', grupo: 'Frente', nombre: 'Puerta moldurada', unidad: 'ud' },
  { clave: 'puerta_corredera', grupo: 'Frente', nombre: 'Extra por puerta corredera', unidad: 'ud' },
  { clave: 'acabado_lacado', grupo: 'Frente', nombre: 'Recargo acabado lacado', unidad: '%', ayuda: 'Sobre el total de puertas' },
  { clave: 'acabado_madera', grupo: 'Frente', nombre: 'Recargo acabado madera natural', unidad: '%', ayuda: 'Roble, nogal, chapa natural…' },
  { clave: 'frente_fijo', grupo: 'Frente', nombre: 'Frente fijo', unidad: 'ml' },
  { clave: 'tirador', grupo: 'Frente', nombre: 'Tirador', unidad: 'ud' },
  { clave: 'altillo', grupo: 'Interior', nombre: 'Altillo (por módulo)', unidad: 'ud' },
  { clave: 'estante', grupo: 'Interior', nombre: 'Estante / balda', unidad: 'ud' },
  { clave: 'barra', grupo: 'Interior', nombre: 'Barra de colgar', unidad: 'ud' },
  { clave: 'perchero_extraible', grupo: 'Interior', nombre: 'Perchero extraíble', unidad: 'ud' },
  { clave: 'cajon', grupo: 'Interior', nombre: 'Cajón', unidad: 'ud' }
];

export interface Tarifa {
  valores: Record<string, number | null>;  // por clave; null o ausente = PENDIENTE
  descuento_pct: number | null;            // descuento profesional por defecto
  iva_pct: number | null;
}

export const TARIFA_PENDIENTE: Tarifa = {
  valores: Object.fromEntries(CONCEPTOS.map((c) => [c.clave, null])),
  descuento_pct: 30,
  iva_pct: 21
};

export interface LineaDesglose {
  clave: string;
  nombre: string;
  cantidad: number;
  unidad: Unidad;
  precio: number | null;   // por unidad (o % si unidad '%')
  importe: number | null;
}
export interface PrecioArmario {
  pvp: number | null;            // null si hay conceptos PENDIENTE
  desglose: LineaDesglose[];
  pendientes: string[];          // nombres de conceptos sin precio
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

/** Cantidades de cada concepto en un armario (sin precios). */
export function contarArmario(a: Armario): Record<string, number> {
  const n: Record<string, number> = {};
  const sumar = (k: string, v: number) => { if (v) n[k] = r2((n[k] ?? 0) + v); };
  for (const c of a.cuerpos) {
    sumar(claveCuerpo(c), c.ancho / 100);
    const f = c.frente;
    for (const p of f.piezas) {
      if (p.tipo === 'fijo') { sumar('frente_fijo', p.ancho / 100); continue; }
      sumar((p.modelo ?? f.modelo) === 'moldurada' ? 'puerta_moldurada' : 'puerta_lisa', 1);
      if (f.apertura === 'corredera') sumar('puerta_corredera', 1);
      if (f.tirador !== 'ninguno') sumar('tirador', 1);
    }
    const g = c.grosor ?? GROSOR_DEF;
    for (const m of c.modulos) {
      const zonas = repartoZonas(m.interior, { alto: c.alto, zocalo: c.zocalo ?? ZOCALO_DEF, grosor: g }).zonas.map((z) => z.zona);
      const lista = zonas.length ? zonas : m.interior;
      // Baldas entre zonas; la que cierra el altillo va con el altillo.
      sumar('estante', Math.max(0, lista.length - 1 - (lista[0]?.tipo === 'altillo' ? 1 : 0)));
      for (const z of lista) {
        if (z.tipo === 'altillo') sumar('altillo', 1);
        else if (z.tipo === 'perchero') sumar('barra', 1);
        else if (z.tipo === 'perchero_extraible') sumar('perchero_extraible', 1);
        else if (z.tipo === 'cajonera') sumar('cajon', z.cajones);
        else if (z.tipo === 'estantes') sumar('estante', z.estantes);
      }
    }
  }
  return n;
}

export function precioArmario(a: Armario, t: Tarifa): PrecioArmario {
  const cantidades = contarArmario(a);
  const desglose: LineaDesglose[] = [];
  const pendientes: string[] = [];
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
  // Recargo por acabado sobre las puertas
  const acabados = new Set(a.cuerpos.map((c) => tipoAcabado(c.frente.acabado)).filter(Boolean) as string[]);
  for (const ac of acabados) {
    const k = `acabado_${ac}`;
    const pct = valor(k);
    const importe = pct === null ? null : r2((puertas * pct) / 100);
    desglose.push({ clave: k, nombre: nombre(k), cantidad: 1, unidad: '%', precio: pct, importe });
    if (importe === null) pendientes.push(nombre(k));
    else total += importe;
  }
  return { pvp: pendientes.length ? null : r2(total), desglose, pendientes };
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
