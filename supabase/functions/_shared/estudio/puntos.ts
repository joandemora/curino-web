// supabase/functions/_shared/estudio/puntos.ts
//
// Estudio Curino · tarifa de armarios por PUNTOS (sistema de los carpinteros).
// Fuente: tarifa OTG Armaris / Rialvi, versión «OTG 2026» (solo lectura: es la
// base a la que vuelve «Restablecer»). Cada usuario guarda su precio del punto y
// solo los puntos que cambie (overrides). Precio = puntos × precio del punto.
//
// Reglas de medida:
//   - ancho del módulo en mm → tramo inmediatamente superior (400…1000);
//   - más de 1000 mm: se prolonga la tabla con la subida media de sus últimos
//     escalones (EXTRAPOLAR_ESCALONES) por cada 100 mm; la línea queda marcada
//     «fuera de tabla, valor extrapolado: revisar» (no bloquea el PDF);
//   - la tabla es para 2600 mm de alto y fondo 550 (650 con puertas): más alto
//     → aviso «altura fuera de tabla» (sin recargo inventado).
// Cada módulo recibe el modelo de interior que más se parece (1–6) y los
// extras (cajones, estantes, barras) suman o restan sobre ese modelo.

import type { Armario, Zona } from './esquema.ts';
import { repartoZonas, ZOCALO_DEF, GROSOR_DEF, SEPARACION_SUELO_DEF, materialPieza, agarrePuerta, tapetasCajonera } from './esquema.ts';

export const VERSION_PUNTOS = 'OTG 2026';
export const ANCHOS = [400, 500, 600, 700, 800, 900, 1000];
export const ALTO_TABLA = 2600;

export const MODELOS: Record<string, { nombre: string; incluye: string; puntos: number[] }> = {
  m1: { nombre: 'Modelo 1', incluye: 'altillo + estantes + cajonera de 3 cajones', puntos: [326, 351, 381, 413, 445, 477, 512] },
  m2: { nombre: 'Modelo 2', incluye: 'altillo + estante + barra de colgar', puntos: [217, 235, 253, 275, 297, 317, 335] },
  m3: { nombre: 'Modelo 3', incluye: 'altillo + estantes', puntos: [259, 275, 297, 319, 343, 370, 395] },
  m4: { nombre: 'Modelo 4', incluye: 'altillo + doble barra / doble perchero', puntos: [204, 222, 239, 257, 277, 297, 321] },
  m5: { nombre: 'Modelo 5', incluye: 'altillo + barra de colgar largo', puntos: [201, 217, 235, 252, 269, 286, 308] },
  m6: { nombre: 'Modelo 6', incluye: 'altillo + hueco libre', puntos: [161, 177, 194, 211, 228, 245, 267] }
};
export const EXTRAS: Record<string, { nombre: string; puntos: number[] }> = {
  cajon: { nombre: 'Cajón', puntos: [34, 35, 37, 38, 39, 41, 42] },
  estante: { nombre: 'Estante 19 mm', puntos: [11, 14, 17, 20, 22, 25, 27] },
  barra: { nombre: 'Barra', puntos: [13, 13, 13, 13, 13, 14, 14] }
};
// Estantes gruesos (no están en la tabla OTG): estante 19 mm × 1,25 / × 1,5, redondeado
EXTRAS.estante25 = { nombre: 'Estante 25 mm', puntos: EXTRAS.estante.puntos.map((p) => Math.round(p * 1.25)) };
EXTRAS.estante30 = { nombre: 'Estante 30 mm', puntos: EXTRAS.estante.puntos.map((p) => Math.round(p * 1.5)) };

/** Concepto de tarifa de un estante / balda por su grosor (cm): null = el de 19 mm, incluido. */
export function conceptoGrosor(cm: number): { clave: 'estante25' | 'estante30'; aviso?: string } | null {
  if (cm <= 2.05) return null;
  if (cm <= 2.55) return { clave: 'estante25' };
  return { clave: 'estante30', aviso: cm > 3.05 ? `grosor ${Math.round(cm * 10)} mm: con la tarifa de 30 mm, revisar` : undefined };
}
export const SUELTOS: Record<string, { nombre: string; puntos: number }> = {
  rinconero: { nombre: 'Módulo rinconero 1100 × 1100 mm', puntos: 830 },
  division: { nombre: 'División vertical interior (1500 a 2000 × 19)', puntos: 59 },
  // No está en la tabla OTG: valor propio (½ división vertical) hasta que lo confirme el proveedor
  tapeta_cajonera: { nombre: 'Tapeta lateral cajonera (por unidad)', puntos: 30 }
};
/** Conceptos propios pendientes de confirmar con OTG: sus líneas salen con «revisar». */
export const REVISAR_PUNTOS: Record<string, string> = { tapeta_cajonera: 'valor propio, pendiente de confirmar con OTG: revisar' };
// Puertas: puntos fijos por puerta hasta 2800 × 650 × 19 mm (frente fijo = su material, sin bisagras)
export const PUERTA_MAX = { alto: 2800, ancho: 650 };
export const PUERTAS: Record<string, { nombre: string; puntos: number }> = {
  lisa_melamina: { nombre: 'Puerta lisa melamina', puntos: 110 },
  lisa_lacada: { nombre: 'Puerta lisa lacada', puntos: 330 },
  moldurada_lacada: { nombre: 'Puerta moldurada lacada', puntos: 475 },
  chapa_madera: { nombre: 'Puerta chapa madera natural barnizada', puntos: 400 },
  textil: { nombre: 'Puerta textil (bastidor tapizado)', puntos: 455 },
  ratan: { nombre: 'Puerta ratán (bastidor madera + rejilla)', puntos: 580 }
};
export const HERRAJES: Record<string, { nombre: string; puntos: number }> = {
  bisagras: { nombre: 'Bisagras puerta abatible (por puerta)', puntos: 25 },
  corredera: { nombre: 'Sistema corredera (por puerta)', puntos: 180 },
  coplanar: { nombre: 'Sistema coplanar (juego de 2 puertas)', puntos: 700 },
  escamoteable: { nombre: 'Sistema escamoteable (por puerta)', puntos: 800 },
  tirador: { nombre: 'Tirador estándar', puntos: 15 },
  tirador_premium: { nombre: 'Tirador latón / premium', puntos: 45 },
  unero_dm: { nombre: 'Uñero fresado en DM lacado (por puerta)', puntos: 35 },
  unero_madera: { nombre: 'Uñero en madera maciza (por puerta)', puntos: 60 },
  perchero_extraible: { nombre: 'Perchero extraíble', puntos: 45 }
};
export const COSTADOS: Record<string, { nombre: string; puntos: number }> = {
  // 2800 × 650 × 19
  madera_barnizada: { nombre: 'Costado visto madera barnizada', puntos: 263 },
  melamina: { nombre: 'Costado visto melamina', puntos: 89 },
  dm_lacado: { nombre: 'Costado visto DM lacado', puntos: 284 },
  espejo: { nombre: 'Costado visto con espejo', puntos: 292 }
};
export const RECARGOS: Record<string, { nombre: string; pct: number }> = {
  cajeado: { nombre: 'Cajeados (vertical u horizontal)', pct: 10 },
  inclinacion: { nombre: 'Recargo por inclinación', pct: 25 }
};
export const REMATES = [
  { hasta: 125, barniz: 151, lacado: 159 },
  { hasta: 260, barniz: 168, lacado: 178 },
  { hasta: 380, barniz: 202, lacado: 214 },
  { hasta: 520, barniz: 236, lacado: 250 }
];

/** Todos los puntos de la tabla original, por clave (para editar y restablecer). */
export function puntosBase(): Record<string, number> {
  const b: Record<string, number> = {};
  for (const [k, m] of Object.entries(MODELOS)) ANCHOS.forEach((a, i) => { b[`${k}_${a}`] = m.puntos[i]; });
  for (const [k, e] of Object.entries(EXTRAS)) ANCHOS.forEach((a, i) => { b[`${k}_${a}`] = e.puntos[i]; });
  for (const [k, s] of Object.entries(SUELTOS)) b[k] = s.puntos;
  for (const [k, c] of Object.entries(COSTADOS)) b[`costado_${k}`] = c.puntos;
  for (const [k, c] of Object.entries(PUERTAS)) b[`puerta_${k}`] = c.puntos;
  for (const [k, c] of Object.entries(HERRAJES)) b[k] = c.puntos;
  for (const [k, r] of Object.entries(RECARGOS)) b[`recargo_${k}`] = r.pct;
  for (const r of REMATES) { b[`remate_${r.hasta}_barniz`] = r.barniz; b[`remate_${r.hasta}_lacado`] = r.lacado; }
  return b;
}

/** Opciones de cada partida que el diseño no indica (las elige el usuario). */
export interface OpcionesPuntos {
  modelos?: Record<string, string>;            // «c0m1» → 'm3' (cambia el modelo asignado)
  costados?: { tipo: string; n: number }[];    // costados vistos
  remate?: 'barniz' | 'lacado' | null;
  cajeado?: boolean;
  inclinacion?: boolean;
  divisiones?: number;
  rinconeros?: number;
  tapetas?: boolean;   // cuenta las tapetas de cajonera por defecto (presupuestos nuevos o recalculados)
}

export interface LineaPuntos {
  clave: string; nombre: string; cantidad: number; puntos: number;   // puntos por unidad
  aviso?: string;                                                   // «fuera de tabla», «revisar»…
}
export interface ModuloAsignado { clave: string; cuerpo: number; modulo: number; ancho_mm: number; modelo: string; automatico: string; nota?: string }

/** Escalones de la tabla (de 100 mm) cuya subida media prolonga la tabla por encima de 1000 mm. */
export const EXTRAPOLAR_ESCALONES = 3;
export const AVISO_EXTRAPOLADO = 'fuera de tabla, valor extrapolado: revisar';
/** Puntos por tramo de ancho: tramo superior; > 1000 mm, + subida media de los últimos escalones por cada 100 mm. */
export function porAncho(serie: number[], mm: number): { puntos: number; tramo: number; fuera: boolean } {
  const i = ANCHOS.findIndex((a) => mm <= a);
  if (i >= 0) return { puntos: serie[i], tramo: ANCHOS[i], fuera: false };
  const n = ANCHOS.length - 1, k = Math.min(EXTRAPOLAR_ESCALONES, n);
  const inc = (serie[n] - serie[n - k]) / k, pasos = Math.ceil((mm - ANCHOS[n]) / 100);
  return { puntos: Math.round((serie[n] + inc * pasos) * 100) / 100, tramo: ANCHOS[n] + 100 * pasos, fuera: true };
}

export const serieDe = (p: Record<string, number>, k: string) => ANCHOS.map((a) => p[`${k}_${a}`]);

/** Modelo de interior que más se parece a las zonas del módulo, y extras sobre ese modelo. */
export function asignarModelo(zonas: Zona[]): { modelo: string; extras: Record<string, number>; altillo: boolean } {
  let cajones = 0, barras = 0, largas = 0, estantes = 0, altillo = false;
  for (const z of zonas) {
    if (z.tipo === 'altillo') altillo = true;
    else if (z.tipo === 'cajonera') cajones += z.cajones;
    else if (z.tipo === 'perchero') { barras++; if (z.prendas === 'largas') largas++; }
    else if (z.tipo === 'estantes') estantes += z.estantes;
  }
  if (cajones > 0) return { modelo: 'm1', extras: { cajon: cajones - 3, barra: barras }, altillo };
  if (barras >= 2) return { modelo: 'm4', extras: { barra: barras - 2, estante: estantes }, altillo };
  if (largas >= 1) return { modelo: 'm5', extras: { barra: barras - 1, estante: estantes }, altillo };
  if (barras === 1) return { modelo: 'm2', extras: { estante: Math.max(0, estantes - 1) }, altillo };
  if (estantes > 0) return { modelo: 'm3', extras: {}, altillo };
  return { modelo: 'm6', extras: {}, altillo };
}

/** Líneas en puntos de un armario: interiores por modelo, extras, recargos y opciones de la partida. */
export function puntosArmario(a: Armario, puntos: Record<string, number>, op: OpcionesPuntos = {}): { lineas: LineaPuntos[]; modulos: ModuloAsignado[]; avisos: string[] } {
  const lineas: LineaPuntos[] = [], modulos: ModuloAsignado[] = [], avisos: string[] = [];
  let interior = 0;
  a.cuerpos.forEach((c, ci) => {
    if (c.alto * 10 > ALTO_TABLA) avisos.push(`Altura fuera de tabla: ${Math.round(c.alto * 10)} mm (tabla para ${ALTO_TABLA} mm)`);
    const g = c.grosor ?? GROSOR_DEF;
    c.modulos.forEach((m, mi) => {
      const mm = Math.round(m.ancho * 10), clave = `c${ci}m${mi}`;
      const zonas = repartoZonas(m.interior, { alto: c.alto, zocalo: c.zocalo ?? ZOCALO_DEF, grosor: g }).zonas.map((z) => z.zona);
      const auto = asignarModelo(zonas.length ? zonas : m.interior);
      const modelo = op.modelos?.[clave] && MODELOS[op.modelos[clave]] ? op.modelos[clave] : auto.modelo;
      const base = porAncho(serieDe(puntos, modelo), mm);
      const fuera = base.fuera ? AVISO_EXTRAPOLADO : undefined;
      const nota = auto.altillo ? undefined : 'sin altillo (la tabla incluye altillo): revisar';
      modulos.push({ clave, cuerpo: ci, modulo: mi, ancho_mm: mm, modelo, automatico: auto.modelo, nota });
      lineas.push({ clave: `int_${clave}`, nombre: `Interior módulo ${mi + 1}${a.cuerpos.length > 1 ? ` (cuerpo ${ci + 1})` : ''} · ${MODELOS[modelo].nombre} · ${base.tramo} mm`, cantidad: 1, puntos: base.puntos, aviso: [fuera, nota].filter(Boolean).join(' · ') || undefined });
      interior += base.puntos;
      // Estantes y baldas gruesos: diferencia sobre el de 19 mm (que ya cuentan el modelo o los extras)
      const gruesos = new Map<string, { n: number; aviso?: string; balda: boolean }>();
      for (const zm of repartoZonas(m.interior, { alto: c.alto, zocalo: c.zocalo ?? ZOCALO_DEF, grosor: g }).zonas) {
        const sumar = (cmG: number, n: number, balda: boolean) => {
          const k = conceptoGrosor(cmG);
          if (!k) return;
          const id = `${k.clave}${balda ? '_balda' : ''}`, e = gruesos.get(id) ?? { n: 0, balda };
          e.n += n; e.aviso = e.aviso ?? k.aviso; gruesos.set(id, e);
        };
        if (zm.zona.tipo === 'estantes' && zm.grosor_estantes !== undefined) sumar(zm.grosor_estantes, zm.zona.estantes, false);
        if (zm.zona.grosor_balda_encima !== undefined) sumar(zm.zona.grosor_balda_encima, 1, true);
      }
      for (const [id, e] of gruesos) {
        const k = id.replace('_balda', '');
        const grueso = porAncho(serieDe(puntos, k), mm), fino = porAncho(serieDe(puntos, 'estante'), mm);
        const pts = Math.round((grueso.puntos - fino.puntos) * 100) / 100;
        lineas.push({ clave: `grueso_${id}_${clave}`, nombre: `${e.balda ? (e.n === 1 ? 'Balda' : 'Baldas') : 'Estantes'} ${k.slice(-2)} mm · módulo ${mi + 1} · ${grueso.tramo} mm (diferencia sobre 19 mm)`, cantidad: e.n, puntos: pts, aviso: [grueso.fuera ? AVISO_EXTRAPOLADO : '', e.aviso ?? ''].filter(Boolean).join(' · ') || undefined });
        interior += pts * e.n;
      }
      // Tapetas laterales de las cajoneras (2 por cajonera); las de por defecto, solo si la partida las cuenta
      const tapetas = new Map<number, number>();
      for (const z of m.interior) {
        if (z.tipo !== 'cajonera') continue;
        const t = tapetasCajonera(z, c.frente.apertura);
        if (t > 0 && (z.tapetas !== undefined || op.tapetas)) tapetas.set(t, (tapetas.get(t) ?? 0) + 2);
      }
      for (const [t, n] of tapetas) {
        lineas.push({ clave: `tapeta_cajonera_${clave}${tapetas.size > 1 ? `_${t}` : ''}`, nombre: `${SUELTOS.tapeta_cajonera.nombre} · ${String(t).replace('.', ',')} cm · módulo ${mi + 1}`, cantidad: n, puntos: puntos.tapeta_cajonera, aviso: REVISAR_PUNTOS.tapeta_cajonera });
        interior += puntos.tapeta_cajonera * n;
      }
      // Extras solo con el modelo asignado automáticamente (si el usuario cambia el modelo, no se recalculan)
      if (modelo === auto.modelo) {
        for (const [k, n] of Object.entries(auto.extras)) {
          if (!n) continue;
          const e = porAncho(serieDe(puntos, k), mm);
          lineas.push({ clave: `ext_${k}_${clave}`, nombre: `${EXTRAS[k].nombre} ${n > 0 ? 'extra' : 'de menos'} · módulo ${mi + 1} · ${e.tramo} mm`, cantidad: n, puntos: e.puntos, aviso: e.fuera ? AVISO_EXTRAPOLADO : undefined });
          interior += e.puntos * n;
        }
      }
    });
  });
  // Puertas, frentes fijos y herrajes de cada cuerpo
  a.cuerpos.forEach((c, ci) => {
    const f = c.frente, sep = f.separacion_suelo ?? SEPARACION_SUELO_DEF;
    const altoMm = Math.round((c.alto - sep) * 10), suf = a.cuerpos.length > 1 ? ` (cuerpo ${ci + 1})` : '';
    const grupos = new Map<string, LineaPuntos>();
    let nPuertas = 0;
    const agarres: Record<string, number> = {};
    for (const p of f.piezas) {
      const mat = materialPieza(f, p), anchoMm = Math.round(p.ancho * 10);
      // Fuera de medida: proporcional al exceso de superficie
      const fuera = altoMm > PUERTA_MAX.alto || anchoMm > PUERTA_MAX.ancho;
      const factor = fuera ? Math.max(1, (altoMm * anchoMm) / (PUERTA_MAX.alto * PUERTA_MAX.ancho)) : 1;
      const pts = Math.round(puntos[`puerta_${mat}`] * factor * 100) / 100;
      const nombre = `${p.tipo === 'fijo' ? `Frente fijo · ${PUERTAS[mat].nombre.replace('Puerta ', '')}` : PUERTAS[mat].nombre}${fuera ? ` · ${altoMm} × ${anchoMm} mm` : ''}${suf}`;
      const k = `${p.tipo}_${mat}_${pts}_${ci}`;
      const g = grupos.get(k);
      if (g) g.cantidad++;
      else grupos.set(k, { clave: `puerta_${mat}_${ci}`, nombre, cantidad: 1, puntos: pts, aviso: fuera ? 'fuera de medida (más de 2800 × 650): proporcional a la superficie, revisar' : undefined });
      if (p.tipo === 'puerta') {
        nPuertas++;
        const ag = agarrePuerta(f, p);
        if (ag !== 'ninguno') agarres[ag] = (agarres[ag] ?? 0) + 1;
      }
    }
    lineas.push(...grupos.values());
    if (nPuertas) {
      const ap = f.apertura;
      if (ap === 'abatible') lineas.push({ clave: `bisagras_${ci}`, nombre: HERRAJES.bisagras.nombre + suf, cantidad: nPuertas, puntos: puntos.bisagras });
      else if (ap === 'corredera') lineas.push({ clave: `corredera_${ci}`, nombre: HERRAJES.corredera.nombre + suf, cantidad: nPuertas, puntos: puntos.corredera });
      else if (ap === 'coplanar') lineas.push({ clave: `coplanar_${ci}`, nombre: `${HERRAJES.coplanar.nombre} · ${nPuertas} ${nPuertas === 1 ? 'puerta' : 'puertas'}${suf}`, cantidad: Math.ceil(nPuertas / 2), puntos: puntos.coplanar });
      else if (ap === 'escamoteable') lineas.push({ clave: `escamoteable_${ci}`, nombre: HERRAJES.escamoteable.nombre + suf, cantidad: nPuertas, puntos: puntos.escamoteable });
    }
    for (const [ag, n] of Object.entries(agarres)) lineas.push({ clave: `${ag}_${ci}`, nombre: HERRAJES[ag].nombre + suf, cantidad: n, puntos: puntos[ag] });
    // Percheros extraíbles del interior
    const g = c.grosor ?? GROSOR_DEF;
    let perch = 0;
    for (const m of c.modulos) {
      const zonas = repartoZonas(m.interior, { alto: c.alto, zocalo: c.zocalo ?? ZOCALO_DEF, grosor: g }).zonas.map((z) => z.zona);
      for (const z of zonas.length ? zonas : m.interior) if (z.tipo === 'perchero_extraible') perch++;
    }
    if (perch) lineas.push({ clave: `perchero_extraible_${ci}`, nombre: HERRAJES.perchero_extraible.nombre + suf, cantidad: perch, puntos: puntos.perchero_extraible });
  });
  if (op.rinconeros) { lineas.push({ clave: 'rinconero', nombre: SUELTOS.rinconero.nombre, cantidad: op.rinconeros, puntos: puntos.rinconero }); interior += puntos.rinconero * op.rinconeros; }
  if (op.divisiones) { lineas.push({ clave: 'division', nombre: SUELTOS.division.nombre, cantidad: op.divisiones, puntos: puntos.division }); interior += puntos.division * op.divisiones; }
  // Recargos sobre el interior
  for (const k of ['cajeado', 'inclinacion'] as const) {
    if (!op[k]) continue;
    const pct = puntos[`recargo_${k}`];
    lineas.push({ clave: `recargo_${k}`, nombre: `${RECARGOS[k].nombre} (+${pct} % sobre el interior)`, cantidad: 1, puntos: Math.round(interior * pct) / 100 });
  }
  for (const c of op.costados ?? []) {
    if (!c?.n || !COSTADOS[c.tipo]) continue;
    lineas.push({ clave: `costado_${c.tipo}`, nombre: COSTADOS[c.tipo].nombre, cantidad: c.n, puntos: puntos[`costado_${c.tipo}`] });
  }
  if (op.remate) {
    const ancho = a.cuerpos.reduce((s, c) => s + c.ancho, 0);
    const t = REMATES.find((r) => ancho <= r.hasta);
    if (t) lineas.push({ clave: `remate_${t.hasta}_${op.remate}`, nombre: `Remate armario · ${op.remate} · hasta ${t.hasta} cm`, cantidad: 1, puntos: puntos[`remate_${t.hasta}_${op.remate}`] });
    else avisos.push(`Remate fuera de tabla: ${ancho} cm (tabla hasta 520 cm)`);
  }
  return { lineas, modulos, avisos };
}
