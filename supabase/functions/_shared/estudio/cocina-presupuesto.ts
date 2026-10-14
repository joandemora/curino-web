// supabase/functions/_shared/estudio/cocina-presupuesto.ts
//
// Estudio Curino · partidas de COCINA en el presupuesto (fase 4).
//
// Una partida por tramo (pared o isla), con su desglose en puntos: cuerpos,
// puertas por grupo y medida, cajones con montaje, herrajes, encimera,
// laterales, regletas, tiradores y zócalo. Precio = puntos × precio del punto
// cocina (independiente del de armarios; null = PENDIENTE: se ven los puntos,
// no el importe). Los dibujos de la cocina van bajo la primera partida
// (`dibujo` = código de la lámina, «C.01»). La ficha técnica marca los
// valores por defecto como «supuesto».

import type { Proyecto } from './esquema.ts';
import { type Cocina, type ModuloCocina, type TramoCocina, completarCocina, alturasCajones, largoUtil, ACABADO_TXT, TIPO_TXT, esUnero } from './cocina.ts';
import { puntosCocina, puntosBaseCocina } from './cocina-puntos.ts';
import { puntosLinea, type LineaDesglose } from './tarifa.ts';

export interface PrecioTramo {
  pvp: number | null; desglose: LineaDesglose[]; pendientes: string[]; puntos_total: number; avisos: string[];
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const cmTxt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Puntos que usa la tarifa de cocina: la del proveedor + lo que el usuario haya cambiado. */
export const puntosCocinaDe = (cambiados?: Record<string, number> | null) => ({ ...puntosBaseCocina(), ...(cambiados ?? {}) });

/** Desglose y precio de cada tramo de una cocina. */
export function preciosCocina(c: Cocina, puntos: Record<string, number>, precioPunto: number | null): { cocina: Cocina; tramos: PrecioTramo[] } {
  const pp = typeof precioPunto === 'number' && Number.isFinite(precioPunto) && precioPunto > 0 ? precioPunto : null;
  const r = puntosCocina(c, puntos);
  return {
    cocina: r.cocina,
    tramos: r.tramos.map((t) => {
      const desglose: LineaDesglose[] = t.lineas.map((l) => {
        const pts = puntosLinea(l.puntos, l.cantidad);
        return { clave: l.clave, nombre: l.nombre, cantidad: l.cantidad, unidad: 'ud', precio: pp === null ? null : r2(l.puntos * pp), importe: pp === null ? null : r2(pts * pp), puntos: l.puntos, puntos_linea: pts, aviso: l.aviso };
      });
      const total = desglose.reduce((s, l) => s + (l.importe ?? 0), 0);
      return { pvp: pp === null ? null : r2(total), desglose, pendientes: pp === null ? ['Precio del punto cocina'] : [], puntos_total: t.puntos, avisos: t.lineas.filter((l) => l.aviso).map((l) => `${l.nombre}: ${l.aviso}`) };
    })
  };
}

// ── Textos ──────────────────────────────────────────────────────────
const forma = (c: Cocina) => c.tramos.some((t) => t.colocacion === 'isla') ? 'con isla' : c.tramos.filter((t) => t.colocacion === 'esquina_izq' || t.colocacion === 'esquina_der').length >= 2 ? 'en U' : c.tramos.some((t) => t.colocacion === 'esquina_izq' || t.colocacion === 'esquina_der') ? 'en L' : 'lineal';
function modulo(c: Cocina, m: ModuloCocina): string {
  if (m.tipo === 'hueco') return `${m.electro?.join(' + ') || m.etiqueta?.toLowerCase() || 'hueco'} ${cmTxt(m.ancho)}`;
  if (m.tipo === 'regleta') return `regleta de ajuste ${cmTxt(m.ancho)}`;
  const f = m.frente;
  const fr = !f ? '' : f.tipo === 'cajones' && m.tipo !== 'horno' ? ` con ${alturasCajones(m).length} cajones ${f.sistema === 'legrabox' ? 'Legrabox' : 'Advänced'}` : f.tipo === 'aventos_hf' ? ' con Aventos HF' : f.tipo === 'aventos_hk' ? ' con Aventos HK' : f.tipo === 'puertas' && m.tipo !== 'columna_hm' ? ` de ${f.puertas ?? 1} ${(f.puertas ?? 1) === 1 ? 'puerta' : 'puertas'}` : '';
  const g = m.grupo && m.grupo !== c.grupo ? ` (grupo ${m.grupo}${esUnero(m.grupo, m.agarre) ? ', uñero' : ''})` : '';
  const ev = m.electro?.filter((e) => !(m.tipo === 'fregadero' && e === 'fregadero')).length ? ` · ${m.electro!.filter((e) => !(m.tipo === 'fregadero' && e === 'fregadero')).join(', ')}` : '';
  return `${TIPO_TXT[m.tipo].toLowerCase()} ${cmTxt(m.ancho)}${fr}${g}${ev}`;
}

export function textosTramo(c: Cocina, t: TramoCocina, i: number): { titulo: string; subtitulo: string; tecnico: string; materiales: string } {
  const nombre = t.nombre ?? (c.tramos.length > 1 ? `TRAMO ${i + 1}` : '');
  const ancho = t.bajos.reduce((s, m) => s + m.ancho, 0);
  const lineas = [
    `Tramo: ${nombre ? nombre.toLowerCase() : 'cocina'}${t.colocacion && t.colocacion !== 'linea' ? ` (${t.colocacion === 'isla' ? 'isla' : t.colocacion === 'esquina_izq' ? 'pared izquierda' : 'pared derecha'})` : ''} · ${cmTxt(ancho)} cm${t.largo ? ` · pared ${cmTxt(t.largo)} cm${largoUtil(t) !== t.largo ? ` (${cmTxt(largoUtil(t)!)} útiles desde el rincón)` : ''}` : ''}`,
    `Bajos y columnas: ${t.bajos.map((m) => modulo(c, m)).join(' · ')}.`
  ];
  if (t.altos?.length) lineas.push(`Altos: ${t.altos.map((m) => modulo(c, m)).join(' · ')}.`);
  const sup = c.supuestos ?? [];
  const s = (txt: string, clave: RegExp) => sup.some((x) => clave.test(x)) ? `${txt} (supuesto)` : txt;
  const materiales = [
    s(`Cuerpo: ${ACABADO_TXT[c.acabado!]}`, /^cuerpo /),
    s(`Puertas: grupo ${c.grupo}${esUnero(c.grupo!, c.agarre) ? ' con uñero' : c.agarre === 'tirador_premium' ? ' con tirador premium' : ' con tirador'}`, /^puerta grupo|^tirador/),
    c.encimera?.ref && t.encimera !== false ? s(`Encimera compacto ${c.encimera.ref}`, /^encimera/) : '',
    s(`Zócalo ${cmTxt(c.zocalo ?? 10)} cm`, /^zócalo/)
  ].filter(Boolean);
  const otros = sup.filter((x) => !/^(cuerpo |puerta grupo|tirador|encimera|zócalo)/.test(x));
  if (otros.length) materiales.push(`Supuestos: ${otros.join(' · ')}`);
  return {
    titulo: `${c.codigo} ${c.titulo}${nombre && c.tramos.length > 1 ? ` · ${nombre}` : ''}`.toUpperCase(),
    subtitulo: `Cocina ${forma(c)} a medida${c.tramos.length > 1 && nombre ? ` · ${nombre.toLowerCase()}` : ''} de ${cmTxt(ancho)} cm`,
    tecnico: lineas.join('\n'),
    materiales: materiales.join('\n')
  };
}

/** Las cocinas elegidas del proyecto (por código; vacío = todas). */
export function cocinasDe(p: Proyecto, codigos?: string[]): Cocina[] {
  const todas = p.cocinas ?? [];
  return codigos?.length ? todas.filter((c) => codigos.includes(c.codigo)) : todas;
}
export { completarCocina };
