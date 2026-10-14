// supabase/functions/_shared/estudio/cocina-puntos.ts
//
// Estudio Curino · COCINAS en PUNTOS (fase 2).
//
// La tarifa del proveedor (cocina-tarifa.ts, en €) se pasa a puntos al alza
// (puntosBaseCocina). Cada usuario guarda su «precio del punto cocina» (null =
// PENDIENTE) y solo los puntos que cambie, como en armarios.
//
// Medidas: ancho o alto entre escalones → el siguiente hacia arriba con precio
// (ancho 80 de puerta → 90; alto 10 → siguiente ancho disponible). Por encima
// del último escalón, o sin ningún precio más arriba: «fuera de tarifa –
// revisar» (no se extrapola). Las claves que vienen de una duda del PDF
// (REVISAR_COCINA) salen con aviso «revisar (tarifa)».
//
// Una lista de líneas por tramo: cuerpos, puertas por grupo y medida, cajones
// (kit + base y trasera + montaje), Aventos, herrajes, encimera (placas sin
// decimales), laterales y tiradores (salvo uñero: grupos 12 / 14 o agarre
// «unero»). Tirador (15 / premium 45) y zócalo (15 pt/m) no están en la
// tarifa del proveedor: valores propios del Estudio, editables. Si un acabado
// no tiene precio en una medida, se usa el más caro que sí lo tenga («revisar»).

import {
  MODULOS_COCINA, ENCIMERAS_COCINA, HERRAJES_COCINA, CAJON_ADVANCED, CAJON_LEGRABOX, TABLEROS_COCINA,
  PUERTAS_COCINA, ALTOS_PUERTA, ANCHOS_PUERTA, GRUPOS_PUERTA, puntosDeEur
} from './cocina-tarifa.ts';
import {
  type Cocina, type ModuloCocina, type TramoCocina, type AcabadoCuerpo, type TipoModuloCocina,
  completarCocina, alturasCajones, anchoPuerta, cmEncimera, esUnero, ACABADO_TXT, TIPO_TXT, COCINA_DEF
} from './cocina.ts';

export interface LineaCocina {
  clave: string; nombre: string; cantidad: number; puntos: number;   // puntos por unidad
  aviso?: string;
}

// ── Claves de la tarifa ──────────────────────────────────────────────
const TIPO_FILA: Record<string, TipoModuloCocina | 'lateral_bajo' | 'lateral_alto'> = {
  'MÓDULO BAJO': 'bajo', 'HORNO': 'horno', 'FREGADERO': 'fregadero', 'ESQUINERO BAJO': 'esquinero', 'MODULO ALTO': 'alto',
  'ESQUINERO ALTO': 'esquinero_alto', 'COLUMNA UNIV.': 'columna', 'COLUMNA H+M': 'columna_hm', 'SOBRENEVERA': 'sobrenevera',
  'TRANSVERSAL': 'transversal', 'LATERAL BAJO': 'lateral_bajo', 'LATERAL ALTO': 'lateral_alto'
};
interface EntradaModulo { clave: string; tipo: string; alto: number | null; ancho: number | null; acabado: AcabadoCuerpo; eur: number; revisar?: string }
const medida = (m: string | null): [number, number] | null => {
  if (!m) return null;
  const p = m.split('x').map(Number);
  return [p[0], p[1]];
};
const slug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Precios de cuerpos por (tipo, alto, ancho, acabado), con la asignación de columnas explicada en REVISAR_COCINA. */
export const ENTRADAS_MODULO: EntradaModulo[] = (() => {
  const out: EntradaModulo[] = [];
  const add = (tipo: string, med: [number, number] | null, acabado: AcabadoCuerpo, eur: number | null, revisar?: string) => {
    if (eur === null) return;
    const esLateral = tipo.startsWith('lateral');
    const alto = esLateral || !med ? null : med[0], ancho = esLateral || !med ? null : med[1];
    const clave = `mod_${tipo}${alto !== null ? `_${alto}x${ancho}` : ''}_${acabado}`;
    if (out.some((e) => e.clave === clave)) return;   // no pasa con el PDF actual (test)
    out.push({ clave, tipo, alto, ancho, acabado, eur, revisar });
  };
  for (const r of MODULOS_COCINA) {
    const tipo = TIPO_FILA[r.descripcion];
    const a = medida(r.medida_a), b = medida(r.medida_b);
    add(tipo, a, 'blanco16', r.blanco16_a);
    add(tipo, b, 'blanco16', r.blanco16_b);
    // Gris plomo y Blanco Plus: a la 2.ª medida si la hay (duda 1); columna 230: a 230 x 60 (duda 2)
    let destino = b ?? a, revisar: string | undefined = b ? 'columna Gris plomo / Blanco Plus: medida por confirmar' : undefined;
    if (tipo === 'columna' && a && b) { destino = a; revisar = 'columna 230: medida por confirmar con el proveedor'; }
    if (tipo === 'columna_hm') revisar = 'columna H+M: sin medida en la tarifa';
    if (tipo.startsWith('lateral') && r.blanco_plus18 !== null) add(tipo, destino, 'blanco_plus18', r.blanco_plus18, `Blanco Plus a ${r.nota?.replace('Blanco Plus: medida ', '')} (no 366)`);
    else add(tipo, destino, 'blanco_plus18', r.blanco_plus18, revisar);
    add(tipo, destino, 'gris_plomo16', r.gris_plomo16, tipo === 'columna' && !b && r.medida_a === '230x40' ? 'columna 230 x 40: dos precios distintos en la tarifa' : revisar);
  }
  // Columna 230 x 40 Blanco 16 viene en la fila de 230 x 60 (medida «NOVEDAD»)
  const c = out.find((e) => e.clave === 'mod_columna_230x40_blanco16'); if (c) c.revisar = 'columna 230: medida por confirmar con el proveedor';
  const c60 = out.find((e) => e.clave === 'mod_columna_230x60_blanco16'); if (c60) c60.revisar = 'más barata que la de 220 x 60: revisar';
  return out;
})();

/** Puertas: (grupo, alto, ancho) con dudas del PDF. */
const REVISAR_PUERTAS: Record<string, string> = {
  puerta_g7_70x60: 'precio dudoso en la tarifa', puerta_g7_28x70: 'precio dudoso en la tarifa', puerta_g7_28x90: 'precio dudoso en la tarifa', puerta_g7_35x70: 'precio dudoso en la tarifa',
  puerta_g3_240x45: 'precio dudoso en la tarifa', puerta_g3_240x50: 'precio dudoso en la tarifa', puerta_g3_270x45: 'precio dudoso en la tarifa',
  puerta_g14_28x45: 'precio dudoso en la tarifa', puerta_g14_35x45: 'precio dudoso en la tarifa', puerta_g14_28x40: 'precio dudoso en la tarifa', puerta_g14_35x40: 'precio dudoso en la tarifa',
  puerta_g6_130x40: 'precio dudoso en la tarifa', puerta_g6_110x40: 'precio dudoso en la tarifa'
};
const clavePuerta = (g: number, alto: number, ancho: number) => `puerta_g${g}_${String(alto).replace('.', '_')}x${ancho}`;
export const claveEncimera = (ref: string) => `encimera_${slug(ref)}`;
export const claveTablero = (t: { grupo: number | null; descripcion: string }) => `tablero_${slug(t.descripcion)}`;

/** Todos los puntos de la tarifa original (€ al alza), por clave. Tirador y zócalo: 0 (no están en el PDF). */
export function puntosBaseCocina(): Record<string, number> {
  const b: Record<string, number> = {};
  for (const e of ENTRADAS_MODULO) b[e.clave] = puntosDeEur(e.eur);
  for (const g of GRUPOS_PUERTA) ALTOS_PUERTA.forEach((a, i) => ANCHOS_PUERTA.forEach((w, j) => { const v = PUERTAS_COCINA[g][i][j]; if (v !== null) b[clavePuerta(g, a, w)] = puntosDeEur(v); }));
  for (const e of ENCIMERAS_COCINA) b[claveEncimera(e.ref)] = puntosDeEur(e.eur);
  for (const h of HERRAJES_COCINA) if (h.eur !== null) b[`herraje_${h.codigo}`] = puntosDeEur(h.eur);
  for (const k of CAJON_ADVANCED.kits) b[`advanced_h${k.altura}_f${k.fondo}`] = puntosDeEur(k.eur);
  b.advanced_base_blanco = puntosDeEur(CAJON_ADVANCED.base_trasera.blanco);
  b.advanced_base_antracita = puntosDeEur(CAJON_ADVANCED.base_trasera.antracita);
  b.advanced_montaje = puntosDeEur(CAJON_ADVANCED.montaje);
  for (const k of CAJON_LEGRABOX.kits) b[`legrabox_${k.altura}`] = puntosDeEur(k.eur);
  b.legrabox_base_antracita = puntosDeEur(CAJON_LEGRABOX.base_trasera.antracita);
  b.legrabox_montaje = puntosDeEur(CAJON_LEGRABOX.montaje);
  for (const t of TABLEROS_COCINA) if (t.eur_m2 !== null) b[claveTablero(t)] = puntosDeEur(t.eur_m2);
  // No están en el PDF: mismos puntos que en armarios (tirador) y zócalo por metro lineal
  b.tirador = 15;
  b.tirador_premium = 45;
  b.zocalo_ml = 15;
  b.regleta = 10;
  return b;
}
/** Avisos fijos por clave (dudas del PDF). */
export function revisarCocina(): Record<string, string> {
  const r: Record<string, string> = { ...REVISAR_PUERTAS };
  for (const e of ENTRADAS_MODULO) if (e.revisar) r[e.clave] = e.revisar;
  return r;
}
const REVISAR = revisarCocina();

// ── Búsqueda por escalones ───────────────────────────────────────────
type Hallado = { clave: string; puntos: number; aviso?: string; medida: string } | { clave: null; aviso: string };
const FUERA = 'fuera de tarifa – revisar';

/**
 * Cuerpo: alto → escalón superior; ancho → siguiente escalón (de cualquier
 * acabado). En esa medida, el acabado pedido; si no tiene precio, el más caro
 * de los que sí lo tienen, con aviso «revisar». Nada a 0 salvo fuera de tarifa.
 */
export function buscarModulo(p: Record<string, number>, tipo: string, alto: number | null, ancho: number | null, acabado: AcabadoCuerpo): Hallado {
  const deTipo = ENTRADAS_MODULO.filter((e) => e.tipo === tipo && p[e.clave] !== undefined);
  if (!deTipo.length) return { clave: null, aviso: FUERA };
  let enMedida: EntradaModulo[];
  if (deTipo[0].alto === null) enMedida = deTipo;
  else {
    const altos = [...new Set(deTipo.map((e) => e.alto!))].sort((a, b) => a - b);
    const aAlto = alto === null ? altos[0] : altos.find((a) => a >= alto - 0.01);
    if (aAlto === undefined) return { clave: null, aviso: FUERA };
    const anchos = [...new Set(deTipo.filter((e) => e.alto === aAlto).map((e) => e.ancho!))].sort((a, b) => a - b);
    const aAncho = ancho === null ? anchos[0] : anchos.find((a) => a >= ancho - 0.01);
    if (aAncho === undefined) return { clave: null, aviso: FUERA };
    enMedida = deTipo.filter((e) => e.alto === aAlto && e.ancho === aAncho);
  }
  const pedido = enMedida.find((e) => e.acabado === acabado);
  const e = pedido ?? [...enMedida].sort((a, b) => p[b.clave] - p[a.clave])[0];
  const aviso = [pedido ? '' : `sin precio en ${ACABADO_TXT[acabado]}: se usa ${ACABADO_TXT[e.acabado]} (el más caro con precio) – revisar`, REVISAR[e.clave] ?? ''].filter(Boolean).join(' · ') || undefined;
  return { clave: e.clave, puntos: p[e.clave], aviso, medida: e.alto === null ? '' : `${fmt(e.alto)} × ${fmt(e.ancho!)}` };
}
/** Puerta: alto → escalón superior; ancho → siguiente con precio a ese alto. */
export function buscarPuerta(p: Record<string, number>, grupo: number, alto: number, ancho: number): Hallado {
  const aAlto = ALTOS_PUERTA.find((a) => a >= alto - 0.01);
  if (aAlto === undefined) return { clave: null, aviso: FUERA };
  for (const w of ANCHOS_PUERTA) {
    if (w < ancho - 0.01) continue;
    const k = clavePuerta(grupo, aAlto, w);
    if (p[k] !== undefined) return { clave: k, puntos: p[k], aviso: REVISAR[k], medida: `${fmt(aAlto)} × ${w}` };
  }
  return { clave: null, aviso: FUERA };
}
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Kit de cajón por alto del frente (cm) y sistema. */
function kitCajon(p: Record<string, number>, sistema: 'advanced' | 'legrabox', frente: number, fondoCm: number): Hallado {
  if (sistema === 'legrabox') {
    const t = frente < 20 ? 'M' : frente < 30 ? 'C' : 'F';
    const k = `legrabox_${t}`;
    return p[k] !== undefined ? { clave: k, puntos: p[k], medida: `${t} · fondo 500` } : { clave: null, aviso: FUERA };
  }
  const h = frente < 15 ? 87 : frente < 20 ? 117 : frente < 30 ? 167 : 183;
  const fondos = CAJON_ADVANCED.kits.filter((k) => k.altura === h && k.fondo <= fondoCm * 10 - 50).map((k) => k.fondo).sort((a, b) => b - a);
  const k = fondos.length ? `advanced_h${h}_f${fondos[0]}` : '';
  return k && p[k] !== undefined ? { clave: k, puntos: p[k], medida: `H=${h} · fondo ${fondos[0]}` } : { clave: null, aviso: FUERA };
}

// ── Cálculo ──────────────────────────────────────────────────────────
export interface TramoPuntos { tramo: number; nombre: string; lineas: LineaCocina[]; puntos: number; revisar: number }
export interface CocinaPuntos { cocina: Cocina; tramos: TramoPuntos[]; puntos: number; avisos: string[]; supuestos: string[] }

export function puntosCocina(entrada: Cocina, puntos: Record<string, number>): CocinaPuntos {
  const c = completarCocina(entrada);
  const avisos: string[] = [];
  const tramos = c.tramos.map((t, it) => calcularTramo(c, t, it, puntos));
  for (const t of tramos) if (t.revisar) avisos.push(`${t.nombre}: ${t.revisar} ${t.revisar === 1 ? 'línea' : 'líneas'} a revisar`);
  return { cocina: c, tramos, puntos: tramos.reduce((s, t) => s + t.puntos, 0), avisos, supuestos: c.supuestos ?? [] };
}

function calcularTramo(c: Cocina, t: TramoCocina, it: number, p: Record<string, number>): TramoPuntos {
  const nombre = t.nombre ?? (c.tramos.length > 1 ? `Tramo ${it + 1}` : c.titulo);
  const L: LineaCocina[] = [];
  const grupos = new Map<string, LineaCocina>();
  /** Suma a una línea agrupada por clave (mismo concepto y medida). */
  const sumar = (clave: string, nombre: string, puntos: number, n = 1, aviso?: string) => {
    const g = grupos.get(clave);
    if (g) { g.cantidad += n; return; }
    const l: LineaCocina = { clave, nombre, cantidad: n, puntos, aviso };
    grupos.set(clave, l); L.push(l);
  };
  const sinPrecio = (clave: string, nombre: string, aviso: string, n = 1) => sumar(`x_${clave}`, nombre, 0, n, aviso);
  let tiradores = 0, premium = 0;

  const puerta = (m: ModuloCocina, alto: number, ancho: number, n: number) => {
    const g = m.grupo ?? c.grupo!;
    const h = buscarPuerta(p, g, alto, ancho);
    const txt = `Puerta grupo ${g} · ${fmt(alto)} × ${fmt(ancho)}`;
    if (h.clave === null) sinPrecio(`puerta_g${g}_${alto}x${ancho}`, txt, h.aviso, n);
    else sumar(`${h.clave}`, `${txt}${h.medida !== `${fmt(alto)} × ${fmt(ancho)}` ? ` (tarifa ${h.medida})` : ''}`, h.puntos, n, h.aviso);
    const ag = m.agarre ?? c.agarre;
    if (!esUnero(g, ag)) { if (ag === 'tirador_premium') premium += n; else tiradores += n; }
  };

  for (const [fila, mods] of [['bajos', t.bajos], ['altos', t.altos ?? []]] as const) {
    for (const m of mods) {
      if (m.tipo === 'hueco') continue;
      if (m.tipo === 'regleta') { sumar('regleta', `Regleta de ajuste (${fila})`, p.regleta ?? 0, 1, p.regleta ? undefined : 'sin precio – revisar'); continue; }
      const acabado = m.acabado ?? c.acabado!;
      // Cuerpo
      const h = buscarModulo(p, m.tipo, m.alto ?? null, m.ancho, acabado);
      const txt = `${TIPO_TXT[m.tipo]} ${fmt(m.alto ?? 0)} × ${fmt(m.ancho)} · ${ACABADO_TXT[acabado]}`;
      if (h.clave === null) sinPrecio(`mod_${m.tipo}_${m.alto}x${m.ancho}_${acabado}`, `Cuerpo ${txt}`, h.aviso);
      else sumar(h.clave, `Cuerpo ${txt}${h.medida && h.medida !== `${fmt(m.alto ?? 0)} × ${fmt(m.ancho)}` ? ` (tarifa ${h.medida})` : ''}`, h.puntos, 1, h.aviso);
      // Frente
      const f = m.frente!;
      if (f.tipo === 'puertas') {
        const n = Math.max(1, f.puertas ?? 1);
        const altos = f.alturas?.length ? f.alturas : [m.alto ?? COCINA_DEF.alto_bajo];
        for (const a of altos) puerta(m, a, anchoPuerta(m, n), n);
      } else if (f.tipo === 'cajones') {
        const sistema = f.sistema ?? COCINA_DEF.sistema_cajon;
        const fondo = fila === 'altos' ? COCINA_DEF.fondo_alto : COCINA_DEF.fondo_bajo;
        const altos = alturasCajones(m);
        for (const a of altos) {
          puerta(m, a, m.ancho, 1);
          if (m.tipo === 'horno') continue;   // frente bajo el horno: sin cajón (hueco técnico)
          const k = kitCajon(p, sistema, a, fondo);
          const nom = sistema === 'legrabox' ? 'Legrabox' : 'Advänced';
          if (k.clave === null) sinPrecio(`cajon_${sistema}_${a}`, `Cajón ${nom} · frente ${fmt(a)}`, k.aviso);
          else sumar(k.clave, `Cajón ${nom} · kit ${k.medida}`, k.puntos);
          const color = sistema === 'legrabox' ? 'antracita' : f.color_cajon ?? 'blanco';
          sumar(`${sistema}_base_${color}`, `Base + trasera ${nom} ${color}`, p[`${sistema}_base_${color}`] ?? 0, 1, p[`${sistema}_base_${color}`] === undefined ? 'sin precio – revisar' : undefined);
          sumar(`${sistema}_montaje`, `Montaje cajón ${nom}`, p[`${sistema}_montaje`]);
        }
      } else if (f.tipo === 'aventos_hf' || f.tipo === 'aventos_hk') {
        const hf = f.tipo === 'aventos_hf', codigo = hf ? (m.ancho <= 70 ? '05269' : '05268') : (m.ancho <= 70 ? '05280' : '05281');
        if (m.ancho < 50 || m.ancho > 100) sinPrecio(`aventos_${f.tipo}_${m.ancho}`, `Aventos ${hf ? 'HF plegable' : 'HK abatible'} · ancho ${fmt(m.ancho)}`, FUERA);
        else sumar(`herraje_${codigo}`, `Aventos ${hf ? 'HF plegable' : 'HK abatible'} (${codigo})`, p[`herraje_${codigo}`]);
        const altoF = m.alto ?? COCINA_DEF.alto_alto;
        if (hf) puerta(m, altoF / 2, m.ancho, 2); else puerta(m, altoF, m.ancho, 1);
      }
      // Herrajes del módulo
      for (const hz of m.herrajes ?? []) herraje(hz.codigo, hz.cantidad ?? 1);
    }
  }
  for (const hz of t.herrajes ?? []) herraje(hz.codigo, hz.cantidad ?? 1);
  function herraje(codigo: string, n: number) {
    const h = HERRAJES_COCINA.find((x) => x.codigo === codigo);
    if (!h) return sinPrecio(`herraje_${codigo}`, `Herraje ${codigo}`, 'no está en la tarifa – revisar', n);
    if (p[`herraje_${codigo}`] === undefined) return sinPrecio(`herraje_${codigo}`, `${h.articulo} (${codigo})`, 'sin precio – revisar', n);
    sumar(`herraje_${codigo}`, `${h.articulo} (${codigo})`, p[`herraje_${codigo}`], n);
  }
  // Tiradores (no están en la tarifa del proveedor)
  if (tiradores) sumar('tirador', 'Tirador estándar', p.tirador ?? 0, tiradores, p.tirador ? undefined : 'sin precio – revisar');
  if (premium) sumar('tirador_premium', 'Tirador premium', p.tirador_premium ?? 0, premium, p.tirador_premium ? undefined : 'sin precio – revisar');
  // Encimera: placas enteras
  const cmE = cmEncimera(t);
  if (cmE > 0 && c.encimera?.ref) {
    const e = ENCIMERAS_COCINA.find((x) => x.ref === c.encimera!.ref)!;
    const placas = Math.ceil(cmE / (e.largo / 10) - 1e-9);
    const k = claveEncimera(e.ref);
    sumar(k, `Encimera compacto ${e.ref} · ${fmt(cmE / 100)} m → ${placas} ${placas === 1 ? 'placa' : 'placas'} de ${e.largo} × ${e.ancho} × ${e.grueso}`, p[k], placas);
  }
  // Laterales vistos
  for (const tipo of ['bajo', 'alto'] as const) {
    const n = t.laterales?.[tipo] ?? 0;
    if (!n) continue;
    const h = buscarModulo(p, `lateral_${tipo}`, null, null, c.acabado!);
    if (h.clave === null) sinPrecio(`lateral_${tipo}`, `Lateral visto ${tipo} · ${ACABADO_TXT[c.acabado!]}`, h.aviso, n);
    else sumar(h.clave, `Lateral visto ${tipo} · ${ACABADO_TXT[c.acabado!]}`, h.puntos, n, h.aviso);
  }
  // Zócalo (metros de bajos)
  const mlZocalo = t.bajos.filter((m) => m.tipo !== 'hueco').reduce((s, m) => s + m.ancho, 0) / 100;
  if ((c.zocalo ?? 0) > 0 && mlZocalo > 0) {
    const ml = Math.ceil(mlZocalo * 10) / 10;
    sumar('zocalo_ml', `Zócalo ${fmt(c.zocalo!)} cm · ${fmt(ml)} m`, p.zocalo_ml ?? 0, ml, p.zocalo_ml ? undefined : 'sin precio – revisar');
  }
  const total = Math.round(L.reduce((s, l) => s + l.puntos * l.cantidad, 0) * 100) / 100;
  return { tramo: it, nombre, lineas: L, puntos: total, revisar: L.filter((l) => l.aviso).length };
}

/** Precio: puntos × precio del punto cocina (null = PENDIENTE). */
export function precioCocina(puntos: number, precioPunto: number | null): number | null {
  return precioPunto === null ? null : Math.round(puntos * precioPunto * 100) / 100;
}
