// supabase/functions/_shared/estudio/presupuesto.ts
//
// Estudio Curino · presupuesto (F3, 2026-10).
//
// Un presupuesto = una partida por armario (A.01, A.02…) con su texto, su
// precio (motor de tarifa.ts o a mano) y el dibujo debajo; al final forma de
// pago, totales, condiciones y firmas. Maquetación calcada del presupuesto
// de referencia Z2606941 v2 (A4 vertical, marco negro, Open Sans).
//
// Plantilla = datos del emisor y textos. Regla: desde la cuenta de admin el
// emisor es SISTEMA & CURINO (PLANTILLA_ADMIN); un alumno siempre emite con
// SUS datos («Plantilla Curino» = estilo Curino, «propia» = su logo y color)
// y validarPlantilla() rechaza los datos fiscales de Curino.
//
// Textos de cada partida: técnicos y deterministas desde el JSON (medidas,
// distribución, puertas, módulos) + líneas de materiales de la plantilla.
// Claude (estudio-ia, acción presupuesto_textos) solo reescribe subtítulo e
// introducción, sin tocar medidas.

import type { Armario, Cuerpo, Frente, Proyecto, Zona } from './esquema.ts';
import { modelosPuertas } from './alzado.ts';
import { eur, importeLinea, precioArmario } from './tarifa.ts';
import type { LineaDesglose, Tarifa } from './tarifa.ts';

// ── Tipos ───────────────────────────────────────────────────────────
export interface Partida {
  codigo: string;
  cantidad: number;
  titulo: string;          // «A.01 ARMARIO A MEDIDA»
  subtitulo: string;       // frase comercial
  intro: string;           // párrafo opcional (Claude)
  tecnico: string;         // líneas técnicas (JSON) — editable
  materiales: string;      // líneas de materiales — editable
  precio: number | null;   // PVP unitario sin IVA; null = PENDIENTE
  precio_manual: boolean;
  dto_pct: number;
  desglose: LineaDesglose[];
  pendientes: string[];
  version?: number;        // versión del diseño de la que sale (varias versiones en un presupuesto)
  clave?: string;          // identificador único en el presupuesto («v2:A.01» o «libre:…»)
  libre?: boolean;         // partida a mano o propuesta por Claude: sin dibujo ni tarifa
}

/** Comisión del interiorista: dos versiones del PDF/Excel (cliente PVP / interiorista con DTO). */
export interface Comision { activa: boolean; pct: number; paga: 'cliente' | 'interiorista' }

export interface DocPresupuesto {
  numero: string;
  fecha: string;           // AAAA-MM-DD
  atencion: string;
  proyecto: string;
  proyecto_2: string;      // segunda línea (ciudad…)
  validez: string;         // «30 DÍAS»
  seccion: string;         // «MOBILIARIO A MEDIDA»
  version: number;         // versión del proyecto de la que sale (la primera si hay varias)
  versiones?: number[];    // versiones del diseño usadas
  comision?: Comision;
  partidas: Partida[];
}

export const claveDe = (p: Partida) => p.clave || p.codigo;

/**
 * Variante para descargar: sin comisión, el documento tal cual. Con comisión,
 * «cliente» = PVP sin descuento y «interiorista» = DTO. PROFESIONAL al % de la comisión.
 */
export function docVariante(d: DocPresupuesto, v: 'cliente' | 'interiorista' | null): DocPresupuesto {
  if (!v || !d.comision?.activa) return d;
  const dto = v === 'cliente' ? 0 : Number(d.comision.pct) || 0;
  return { ...d, partidas: d.partidas.map((p) => ({ ...p, dto_pct: dto })) };
}

/**
 * Importes para métricas: facturación (sin IVA), PVP y comisión que cuenta como
 * coste. Comisión con «paga el cliente»: facturación = PVP y la comisión es coste;
 * «paga el interiorista» (compra a neto): facturación = neto, sin comisión.
 */
export function importesNegocio(d: DocPresupuesto, ivaPct: number): { importe: number | null; pvp: number | null; comision: number | null } {
  if (d.comision?.activa) {
    const t = totales(docVariante(d, 'cliente'), ivaPct);
    if (t.pendientes) return { importe: null, pvp: null, comision: null };
    const pct = (Number(d.comision.pct) || 0) / 100, r = (n: number) => Math.round(n * 100) / 100;
    return d.comision.paga === 'interiorista'
      ? { importe: r(t.pvp * (1 - pct)), pvp: t.pvp, comision: 0 }
      : { importe: t.pvp, pvp: t.pvp, comision: r(t.pvp * pct) };
  }
  const t = totales(d, ivaPct);
  return t.pendientes ? { importe: null, pvp: null, comision: null } : { importe: t.importe, pvp: t.pvp, comision: 0 };
}

/** Partida libre (a mano o propuesta por Claude desde documentos). */
export function partidaLibre(o: { n: number; titulo?: string; descripcion?: string; cantidad?: number; precio?: number | null; dto?: number }): Partida {
  const codigo = `P.${String(o.n).padStart(2, '0')}`;
  return {
    codigo, clave: `libre:${crypto.randomUUID().slice(0, 8)}`, libre: true,
    cantidad: Math.max(1, Math.round(o.cantidad ?? 1)),
    titulo: (o.titulo || 'PARTIDA').toUpperCase().slice(0, 120), subtitulo: '', intro: '',
    tecnico: (o.descripcion || '').slice(0, 3000), materiales: '',
    precio: o.precio ?? null, precio_manual: true, dto_pct: o.dto ?? 0, desglose: [], pendientes: []
  };
}

export interface FormaPago { concepto: string; pct: number }

export interface Plantilla {
  tipo: 'curino' | 'propia';
  empresa: string;
  nif: string;
  direccion_1: string;
  direccion_2: string;
  email: string;
  telefono: string;
  lema: string;            // «TAILOR MADE HAUTE FURNITURE»
  iban: string;
  forma_pago: FormaPago[];
  condiciones: string;     // líneas; las que acaban en «:» son títulos
  ciudad_firma: string;
  firmante: string;
  cargo: string;
  firma_path: string | null;
  logo_path: string | null;
  color: string;           // acento de la plantilla propia (#rrggbb)
  materiales: string;      // líneas por defecto de cada partida
  mostrar_iva: boolean;    // false → «IMPUESTOS IVA NO INCLUIDOS»
}

export const CONDICIONES_DEF = `IVA NO INCLUIDO EN EL PRECIO:
SOBRE EL PRECIO INDICADO SE REPERCUTIRÁ EL TIPO DE IVA QUE LEGALMENTE CORRESPONDA.
GARANTIA:
LA GARANTÍA DE LOS MATERIALES QUEDARÁ SUJETA A LO ESTABLECIDO POR EL FABRICANTE. TODOS NUESTROS TRABAJOS TIENEN GARANTÍA DE UN AÑO.
EXCLUSIONES:
LOS TRABAJOS A REALIZAR SON EXCLUSIVAMENTE LOS ESPECIFICADOS EN EL PRESUPUESTO, NO CONTEMPLÁNDOSE LAS PATOLOGÍAS O VICIOS OCULTOS DE OBRA, IMPOSIBLES DE DETERMINAR A SIMPLE VISTA, TENIENDO EN CUENTA QUE DICHA VARIACIÓN PUEDA ALTERAR EL RESTO DE PARTIDAS PRESUPUESTADAS.
SERÁ DE CUENTA DEL CLIENTE LA OBTENCIÓN Y TRAMITACIÓN DE LOS PERMISOS DE OBRA QUE FUEREN NECESARIOS, ASÍ COMO LA DIRECCIÓN FACULTATIVA DE LA OBRA.
ESTE PRESUPUESTO NO INCLUYE CONTRATACIONES CON LAS COMPAÑÍAS SUMINISTRADORAS, ASÍ COMO TAMPOCO EL SUMINISTRO DE AGUA Y LUZ PARA LA REALIZACIÓN DE LOS TRABAJOS, QUE SERÁN EN TODO CASO A CARGO DEL CLIENTE. TAMBIÉN QUEDAN EXCLUIDAS TASAS Y/O CUALQUIER OTRO TRIBUTO QUE HUBIERE QUE SATISFACERSE POR RAZÓN DE LAS OBRAS A EJECUTAR.
CUALQUIER TRABAJO SOLICITADO POR EL CLIENTE O POR LA DIRECCIÓN FACULTATIVA NO INCLUIDO EN EL PRESUPUESTO DEBERÁ SER PREVIAMENTE VALORADO Y ACEPTADO POR EL MISMO.
VALIDEZ DE LA OFERTA:
15 DÍAS FECHA PRESUPUESTO.
ACUERDO DE REVISIÓN DE PRECIO DE LA EJECUCIÓN DE OBRA POR AUMENTO DEL PRECIO DE LOS MATERIALES:
DADO QUE LA EJECUCIÓN DE LA OBRA TIENE UNA DURACIÓN PROLONGADA EN EL TIEMPO Y EL PRECIO DE LAS MATERIAS PRIMAS PUEDE VARIAR, AMBAS PARTES ACUERDAN QUE EN CASO DE QUE EL PRECIO DE LOS MATERIALES SE INCREMENTE (EN MÁS DE UN 5%) RESPECTO DEL TOMADO EN CONSIDERACIÓN EN LA ELABORACIÓN DEL PRESUPUESTO, DICHO AUMENTO DE PRECIO SE REPERCUTIRÁ EN EL PRESUPUESTO, QUEDANDO OBLIGADO EL CLIENTE A SATISFACER ESTE INCREMENTO.`;

export const FORMA_PAGO_DEF: FormaPago[] = [
  { concepto: 'CONFIRMACIÓN PRESUPUESTO', pct: 50 },
  { concepto: 'ENTREGA MATERIALES', pct: 40 },
  { concepto: 'FINAL DE OBRA', pct: 10 }
];

export const MATERIALES_DEF = `Interior: melamina Egger Roble Vicenza, cantos ABS
Herrajes: Blum con cierre amortiguado`;

/** Emisor de los presupuestos hechos desde la cuenta de admin (como Z2606941 v2). El IBAN lo pone Juan en el panel. */
export const PLANTILLA_ADMIN: Plantilla = {
  tipo: 'curino',
  empresa: 'SISTEMA & CURINO SLU',
  nif: 'B24788580',
  direccion_1: 'Carrer de Balmes 252, 5-2',
  direccion_2: '08006 Barcelona',
  email: 'info@casacurino.com',
  telefono: '(+34) 678 660 324',
  lema: 'TAILOR MADE HAUTE FURNITURE',
  iban: '',
  forma_pago: FORMA_PAGO_DEF,
  condiciones: CONDICIONES_DEF,
  ciudad_firma: 'BARCELONA',
  firmante: 'Joan de Deu de Mora Oliveras',
  cargo: 'General Manager',
  firma_path: null,
  logo_path: null,
  color: '#1d1d1b',
  materiales: MATERIALES_DEF,
  mostrar_iva: false
};

/** Plantilla inicial de un alumno: estilo Curino, sin datos de nadie. */
export const PLANTILLA_ALUMNO: Plantilla = {
  ...PLANTILLA_ADMIN,
  empresa: '', nif: '', direccion_1: '', direccion_2: '', email: '', telefono: '',
  lema: '', iban: '', ciudad_firma: '', firmante: '', cargo: ''
};

/** Datos que un alumno tiene que rellenar antes de descargar el presupuesto. */
export function faltanPlantilla(p: Plantilla): string[] {
  const f: string[] = [];
  const vacio = (v: string | null | undefined) => !v || !String(v).trim();
  if (vacio(p.empresa)) f.push('Empresa');
  if (vacio(p.nif)) f.push('NIF / CIF');
  if (vacio(p.direccion_1) || vacio(p.direccion_2)) f.push('Dirección completa');
  if (vacio(p.email)) f.push('Email');
  if (vacio(p.telefono)) f.push('Teléfono');
  if (vacio(p.iban)) f.push('IBAN');
  if (vacio(p.firmante)) f.push('Firmante');
  if (!p.firma_path) f.push('Firma');
  if (vacio(p.condiciones)) f.push('Condiciones');
  if (!p.forma_pago?.length) f.push('Forma de pago');
  if (p.tipo === 'propia' && !p.logo_path) f.push('Logo (plantilla propia)');
  return f;
}

const NIF_CURINO = /B-?24788580/i;
/** Un alumno nunca puede emitir con los datos de SISTEMA & CURINO. */
export function validarPlantilla(p: Plantilla, esAdmin: boolean, ibanCurino = ''): string | null {
  if (esAdmin) return null;
  const datos = [p.empresa, p.nif, p.iban, p.direccion_1, p.firmante].join(' ');
  if (NIF_CURINO.test(p.nif.replace(/\s/g, '')) || /sistema\s*&\s*curino/i.test(datos) || /joan de deu de mora/i.test(datos)) {
    return 'Los presupuestos de alumnos se emiten con tus datos, no con los de SISTEMA & CURINO.';
  }
  const limpio = (x: string) => x.replace(/\s/g, '').toUpperCase();
  if (ibanCurino && p.iban && limpio(p.iban) === limpio(ibanCurino)) return 'Ese IBAN es de Curino: pon el tuyo.';
  return null;
}

// ── Textos técnicos desde el JSON ───────────────────────────────────
const mm = (cm: number) => String(Math.round(cm * 10));
const cmTxt = (cm: number) => (Number.isInteger(cm) ? String(cm) : String(Math.round(cm * 10) / 10).replace('.', ','));
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const capital = (s: string) => s.toLowerCase().replace(/^./, (c) => c.toUpperCase());

function grupos(anchos: number[]): string {
  const g: { a: number; n: number }[] = [];
  for (const a of anchos) { const x = g.find((y) => y.a === a); if (x) x.n++; else g.push({ a, n: 1 }); }
  return g.map((x) => `${plural(x.n, 'módulo', 'módulos')} de ${mm(x.a)} mm`).join(' + ');
}

function adjetivos(f: Frente): string {
  const mods = modelosPuertas(f);
  const modelo = mods.length > 1 ? 'molduradas y lisas' : (mods[0] ?? f.modelo) === 'moldurada' ? 'molduradas' : 'lisas';
  const acabado = (f.acabado || '').trim().split(' ').map((w, i) => (i === 0 && /[aeiou]$/i.test(w) ? w + 's' : w)).join(' ');
  return [modelo, acabado].filter(Boolean).join(' ');
}

function textoPuertas(f: Frente): string {
  const puertas = f.piezas.filter((p) => p.tipo === 'puerta');
  const fijos = f.piezas.filter((p) => p.tipo === 'fijo');
  const iguales = puertas.length > 0 && puertas.every((p) => p.ancho === puertas[0].ancho);
  let t = `${plural(puertas.length, 'puerta', 'puertas')} ${f.apertura === 'abatible' ? (puertas.length === 1 ? 'abatible' : 'abatibles') : (puertas.length === 1 ? 'corredera' : 'correderas')} ${adjetivos(f)}`;
  if (iguales) t += ` de ${mm(puertas[0].ancho)} mm`;
  if (fijos.length) t += ` + ${plural(fijos.length, 'frente fijo liso', 'frentes fijos lisos')}`;
  return t;
}

export function textoModulo(zonas: Zona[]): string {
  const partes: string[] = [];
  const percheros = zonas.filter((z) => z.tipo === 'perchero');
  const cajonera = zonas.find((z) => z.tipo === 'cajonera');
  if (cajonera && cajonera.tipo === 'cajonera') partes.push(`cajonera de ${plural(cajonera.cajones, 'cajón', 'cajones')}`);
  const largas = percheros.filter((z) => z.tipo === 'perchero' && z.prendas === 'largas').length;
  const cortas = percheros.length - largas;
  if (cortas >= 2) partes.push(cortas === 2 ? 'doble perchero' : `${cortas} percheros`);
  else if (cortas === 1) partes.push('barra de colgar');
  if (largas) partes.push('zona de prendas largas');
  // Huecos con la misma etiqueta se agrupan («2 estantes»)
  const huecos = new Map<string, number>();
  for (const z of zonas) if (z.tipo === 'hueco' && z.etiqueta) huecos.set(z.etiqueta.toLowerCase(), (huecos.get(z.etiqueta.toLowerCase()) ?? 0) + 1);
  for (const [et, n] of huecos) partes.push(n === 1 ? et : `${n} ${et}${/[aeiou]$/.test(et) ? 's' : 'es'}`);
  for (const z of zonas) {
    if (z.tipo === 'estantes') partes.push(plural(z.estantes, 'estante', 'estantes'));
    if (z.tipo === 'perchero_extraible') partes.push('perchero extraíble');
    if (z.tipo === 'balda_inferior') partes.push('balda inferior');
  }
  const alt = zonas.find((z) => z.tipo === 'altillo');
  if (alt && alt.tipo === 'altillo') partes.push(`altillo ${cmTxt(alt.alto)} cm`);
  return partes.join(' + ') + '.';
}

function lineasCuerpo(c: Cuerpo, varios: boolean): string[] {
  const out: string[] = [];
  const dims = `${mm(c.ancho)} x ${mm(c.alto)} x ${mm(c.fondo)} mm`;
  if (varios) {
    const nombre = capital((c.nombre || 'Cuerpo').split('·')[0].trim());
    out.push(`${nombre}: ${dims} · ${grupos(c.modulos.map((m) => m.ancho))}`);
  } else {
    out.push(`Medidas: ${dims}`);
    out.push(`Distribución: ${grupos(c.modulos.map((m) => m.ancho))}`);
  }
  out.push(`Puertas: ${textoPuertas(c.frente)}`);
  c.modulos.forEach((m, i) => out.push(`Módulo ${i + 1} – ${cmTxt(m.ancho)} cm: ${textoModulo(m.interior)}`));
  return out;
}

export function textosArmario(a: Armario, materiales: string): Pick<Partida, 'titulo' | 'subtitulo' | 'intro' | 'tecnico' | 'materiales'> {
  const c0 = a.cuerpos[0];
  const varios = a.cuerpos.length > 1;
  const ancho = a.cuerpos.reduce((s, c) => s + c.ancho, 0);
  const subtitulo = varios
    ? `Armario en ${a.cuerpos.length === 2 ? 'L' : 'U'} a medida con puertas ${adjetivos(c0.frente)}`
    : `Armario a medida de ${cmTxt(ancho)} cm con puertas ${adjetivos(c0.frente)}`;
  const tecnico = a.cuerpos.map((c) => lineasCuerpo(c, varios).join('\n')).join('\n\n');
  const sep = c0.frente.separacion_suelo ?? 2;
  const extra = [
    `Acabado exterior: puertas ${adjetivos(c0.frente)}`,
    `Puertas hasta suelo con ${cmTxt(sep)} cm de separación${c0.frente.tirador === 'ninguno' ? '' : ' · tiradores en latón'}`
  ];
  return {
    titulo: `${a.codigo} ${a.titulo.replace(/\s+\d+([.,]\d+)?\s*cm$/i, '')}`.toUpperCase(),
    subtitulo,
    intro: '',
    tecnico,
    materiales: [materiales.trim(), ...extra].filter(Boolean).join('\n')
  };
}

// ── Totales ─────────────────────────────────────────────────────────
export interface Totales { pvp: number; descuento: number; importe: number; iva: number; total: number; pendientes: number }
export function totales(p: DocPresupuesto, ivaPct: number): Totales {
  let pvp = 0, importe = 0, pendientes = 0;
  for (const x of p.partidas) {
    const l = importeLinea(x.precio, x.cantidad, x.dto_pct);
    if (l.pvp === null || l.importe === null) { pendientes++; continue; }
    pvp += l.pvp; importe += l.importe;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  const iva = r((importe * ivaPct) / 100);
  return { pvp: r(pvp), descuento: r(importe - pvp), importe: r(importe), iva, total: r(importe + iva), pendientes };
}

export function fechaLarga(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(d);
}
export function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}/${m}/${y}`;
}
export const precioTxt = (n: number | null) => (n === null ? 'PENDIENTE' : eur(n));

// ── Generar desde una versión del proyecto ─────────────────────────
/**
 * Presupuesto nuevo (o regenerado) desde una versión. Con «previo», por
 * partida (mismo código) se conservan cantidad, descuento, precio manual,
 * subtítulo, introducción y materiales editados; el texto técnico y el precio
 * de tarifa se recalculan siempre desde el JSON.
 */
export function generarPresupuesto(o: {
  proyecto: Proyecto; version: number; tarifa: Tarifa; plantilla: Plantilla;
  nombre: string; referencia?: string | null; hoy: string; previo?: DocPresupuesto | null;
  armarios?: string[];     // códigos que entran (por defecto, todos)
}): DocPresupuesto {
  const prev = o.previo;
  const elegidos = o.armarios?.length ? o.proyecto.armarios.filter((a) => o.armarios!.includes(a.codigo)) : o.proyecto.armarios;
  const partidas = elegidos.map((a): Partida => {
    const t = textosArmario(a, o.plantilla.materiales);
    const precio = precioArmario(a, o.tarifa);
    const clave = `v${o.version}:${a.codigo}`;
    const ant = prev?.partidas.find((x) => x.clave === clave) ?? prev?.partidas.find((x) => !x.libre && x.codigo === a.codigo);
    return {
      codigo: a.codigo, version: o.version, clave,
      cantidad: ant?.cantidad ?? 1,
      titulo: t.titulo,
      subtitulo: ant?.subtitulo || t.subtitulo,
      intro: ant?.intro ?? '',
      tecnico: t.tecnico,
      materiales: ant?.materiales || t.materiales,
      precio: ant?.precio_manual ? ant.precio : precio.pvp,
      precio_manual: !!ant?.precio_manual,
      dto_pct: ant?.dto_pct ?? (o.tarifa.descuento_pct ?? 0),
      desglose: precio.desglose,
      pendientes: precio.pendientes
    };
  });
  return {
    numero: prev?.numero || (o.referencia ?? ''),
    fecha: prev?.fecha || o.hoy,
    atencion: prev?.atencion || o.nombre,
    proyecto: prev?.proyecto || 'MOBILIARIO A MEDIDA',
    proyecto_2: prev?.proyecto_2 ?? '',
    validez: prev?.validez || '30 DÍAS',
    seccion: prev?.seccion || 'MOBILIARIO A MEDIDA',
    version: o.version,
    partidas
  };
}
