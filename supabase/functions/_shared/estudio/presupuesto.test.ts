// supabase/functions/_shared/estudio/presupuesto.test.ts
//
// Pruebas del motor de precios y del presupuesto (F3).
//   node --test supabase/functions/_shared/estudio/presupuesto.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Proyecto } from './esquema.ts';
import { contarArmario, precioArmario, TARIFA_PENDIENTE, CONCEPTOS, eur, type Tarifa } from './tarifa.ts';
import { porAncho, asignarModelo, puntosBase, MODELOS } from './puntos.ts';
import { generarPresupuesto, totales, validarPlantilla, faltanPlantilla, PLANTILLA_ADMIN, PLANTILLA_ALUMNO, textoModulo, docVariante, importesNegocio, partidaLibre, type DocPresupuesto } from './presupuesto.ts';

const ejemplo = (): Proyecto => JSON.parse(readFileSync(new URL('./ejemplos/a01-a03.json', import.meta.url), 'utf8'));
const tarifaPrueba = (): Tarifa => ({ valores: Object.fromEntries(CONCEPTOS.map((c) => [c.clave, c.unidad === '%' ? 10 : 100])), descuento_pct: 30, iva_pct: 21, precio_punto: 1, puntos: {} });

test('A.02: puertas y herrajes por puntos (4 molduradas lacadas abatibles, tirador)', () => {
  assert.deepEqual(contarArmario(ejemplo().armarios[1]), {});   // ya no hay conceptos en €
  const r = precioArmario(ejemplo().armarios[1], tarifaPrueba());
  const linea = (re: RegExp) => r.desglose.find((d) => re.test(d.nombre));
  assert.equal(linea(/^Puerta moldurada lacada/)?.cantidad, 4);
  assert.equal(linea(/^Puerta moldurada lacada/)?.puntos, 475);
  assert.equal(linea(/^Bisagras/)?.cantidad, 4);
});

test('A.01: frente fijo con los puntos de su material y perchero extraíble', () => {
  const r = precioArmario(ejemplo().armarios[0], tarifaPrueba());
  assert.ok(r.desglose.some((d) => /^Frente fijo/.test(d.nombre)));
  assert.ok(r.desglose.some((d) => /^Perchero extraíble/.test(d.nombre) && d.puntos === 45));
});

test('tarifa PENDIENTE → sin precio; solo falta el precio del punto', () => {
  const r = precioArmario(ejemplo().armarios[1], TARIFA_PENDIENTE);
  assert.equal(r.pvp, null);
  assert.deepEqual(r.pendientes, ['Precio del punto']);
  assert.ok(r.puntos_total > 0);
});

test('precio = puntos × precio del punto', () => {
  const r = precioArmario(ejemplo().armarios[1], { ...tarifaPrueba(), precio_punto: 2 });
  assert.equal(r.pvp, Math.round(r.puntos_total * 2 * 100) / 100);
  assert.equal(r.modulos.length, 2);
});

test('puertas: coplanar por juego (impares al juego superior), uñero sin tirador, fuera de medida proporcional', () => {
  const a = ejemplo().armarios[1];
  const c = a.cuerpos[0];
  c.frente = { ...c.frente, apertura: 'coplanar', material: 'lisa_lacada', agarre: 'unero_dm', piezas: [{ tipo: 'puerta', ancho: 70 }, { tipo: 'puerta', ancho: 65 }, { tipo: 'puerta', ancho: 65 }] };
  const r = precioArmario(a, tarifaPrueba());
  const linea = (re: RegExp) => r.desglose.find((d) => re.test(d.nombre));
  assert.equal(linea(/coplanar/)?.cantidad, 2);          // 3 puertas → 2 juegos
  assert.equal(linea(/coplanar/)?.puntos, 700);
  assert.equal(linea(/^Uñero fresado/)?.cantidad, 3);
  assert.equal(linea(/^Tirador/), undefined);             // el uñero sustituye al tirador
  const fuera = r.desglose.find((d) => /^Puerta lisa lacada · /.test(d.nombre));   // 70 cm > 650 mm
  assert.ok(fuera && fuera.puntos > 330 && /fuera de medida/.test(fuera.aviso || ''));
});

test('diseños anteriores: material y agarre deducidos de modelo, acabado y tirador', () => {
  const a = ejemplo().armarios[1];                                    // molduradas lacadas, tirador «laton»
  assert.ok(precioArmario(a, tarifaPrueba()).desglose.some((d) => /^Tirador latón/.test(d.nombre)));   // latón → premium
  delete (a.cuerpos[0].frente as { tirador?: string }).tirador;
  assert.ok(precioArmario(a, tarifaPrueba()).desglose.some((d) => /^Tirador estándar/.test(d.nombre)));   // sin tirador → estándar
});

test('presupuesto: importe = PVP × (1 − dto) y totales', () => {
  const doc = generarPresupuesto({ proyecto: ejemplo(), version: 1, tarifa: tarifaPrueba(), plantilla: PLANTILLA_ADMIN, nombre: 'Cliente PRUEBA', hoy: '2026-10-12' });
  doc.partidas[0].precio = 5819.5; doc.partidas[0].precio_manual = true;
  const t = totales(doc, 21);
  assert.equal(doc.partidas.length, 3);
  assert.equal(doc.partidas[0].dto_pct, 30);
  assert.equal(eur(5819.5 * 0.7), '4.073,65 €');
  assert.equal(t.pendientes, 0);
  assert.equal(t.importe, Math.round((t.pvp * 0.7) * 100) / 100);
});

test('regenerar conserva lo editado a mano y recalcula lo técnico', () => {
  const base = { proyecto: ejemplo(), version: 1, tarifa: TARIFA_PENDIENTE, plantilla: PLANTILLA_ADMIN, nombre: 'X', hoy: '2026-10-12' };
  const v1 = generarPresupuesto(base);
  v1.partidas[1].precio = 999; v1.partidas[1].precio_manual = true; v1.partidas[1].intro = 'Texto mío'; v1.numero = 'Z1';
  const p2 = ejemplo(); p2.armarios[1].cuerpos[0].modulos[1].interior[2] = { tipo: 'cajonera', cajones: 3 };
  const v2 = generarPresupuesto({ ...base, proyecto: p2, version: 2, previo: v1 });
  assert.equal(v2.partidas[1].precio, 999);
  assert.equal(v2.partidas[1].intro, 'Texto mío');
  assert.equal(v2.numero, 'Z1');
  assert.match(v2.partidas[1].tecnico, /cajonera de 3 cajones/);
});

test('textos técnicos como en el presupuesto de referencia', () => {
  const doc = generarPresupuesto({ proyecto: ejemplo(), version: 1, tarifa: TARIFA_PENDIENTE, plantilla: PLANTILLA_ADMIN, nombre: 'X', hoy: '2026-10-12' });
  assert.equal(doc.partidas[1].tecnico, [
    'Medidas: 2000 x 2740 x 600 mm',
    'Distribución: 2 módulos de 1000 mm',
    'Puertas: 4 puertas abatibles molduradas de 500 mm · acabado lacada',
    'Módulo 1 – 100 cm: doble perchero + altillo 50 cm.',
    'Módulo 2 – 100 cm: cajonera de 4 cajones y tapetas laterales 3 cm para bisagras + barra de colgar + altillo 50 cm.'
  ].join('\n'));
  assert.match(doc.partidas[0].tecnico, /^Cuerpo principal: 1900 x 2800 x 600 mm · 2 módulos de 950 mm/);
  assert.match(doc.partidas[0].tecnico, /Lateral: 1000 x 2800 x 400 mm/);
  assert.equal(textoModulo([{ tipo: 'hueco', alto: 36, etiqueta: 'Estante' }, { tipo: 'hueco', etiqueta: 'Estante' }, { tipo: 'perchero_extraible' }]), '2 estantes + perchero extraíble.');
  assert.equal(doc.partidas[2].subtitulo, 'Armario a medida de 260 cm con puertas molduradas, acabado lacada');
});

test('materiales siempre del diseño: tal cual, «a definir» si falta, nada de ejemplo; mm con decimales', async () => {
  const { MATERIALES_EJEMPLO, contarSupuestos, paraCliente } = await import('./presupuesto.ts');
  const p = ejemplo();
  const a = p.armarios[1];
  a.cuerpos[0].frente.acabado = 'Blanco Soft III';
  a.cuerpos[0].frente.piezas.forEach((x) => { if (x.tipo === 'puerta') x.ancho = 54.75; });
  a.notas = 'Interior textil Lino Sand, exterior Blanco Soft III Finsa.';
  a.materiales = { interior: 'textil Lino Sand' };
  const d = generarPresupuesto({ proyecto: p, version: 1, tarifa: TARIFA_PENDIENTE, plantilla: { ...PLANTILLA_ADMIN, materiales: MATERIALES_EJEMPLO }, nombre: 'X', hoy: '2026-10-15', armarios: [a.codigo] });
  const m = d.partidas[0].materiales;
  assert.doesNotMatch(m, /Egger|Roble Vicenza|Blum|ABS/);
  assert.match(m, /^Interior: textil Lino Sand$/m);
  assert.match(m, /^Exterior: puertas molduradas · acabado Blanco Soft III$/m);
  assert.match(m, /^Cantos: a definir$/m);
  assert.match(m, /^Herrajes: a definir$/m);
  assert.match(m, /^Notas del diseño: Interior textil Lino Sand, exterior Blanco Soft III Finsa\.$/m);
  assert.match(d.partidas[0].tecnico, /de 547,5 mm/);
  // Recalcular: el texto de ejemplo antiguo se rehace; lo editado a mano se conserva
  const viejo = { ...d, partidas: d.partidas.map((x) => ({ ...x, materiales: MATERIALES_EJEMPLO + '\nAcabado exterior: puertas lisas' })) };
  const r1 = generarPresupuesto({ proyecto: p, version: 1, tarifa: TARIFA_PENDIENTE, plantilla: PLANTILLA_ADMIN, nombre: 'X', hoy: '2026-10-15', previo: viejo, armarios: [a.codigo] });
  assert.equal(r1.partidas[0].materiales, m);
  const editado = { ...d, partidas: d.partidas.map((x) => ({ ...x, materiales: 'Interior: lo que diga el cliente' })) };
  const r2 = generarPresupuesto({ proyecto: p, version: 1, tarifa: TARIFA_PENDIENTE, plantilla: PLANTILLA_ADMIN, nombre: 'X', hoy: '2026-10-15', previo: editado, armarios: [a.codigo] });
  assert.equal(r2.partidas[0].materiales, 'Interior: lo que diga el cliente');
  // Supuestos (cocina): se cuentan; al cliente, sin la palabra
  const s = { ...d, partidas: [{ ...d.partidas[0], materiales: 'Cuerpo: Blanco 16 (supuesto)\nSupuestos: bajos de 70 de alto · cajones Advänced' }] };
  assert.equal(contarSupuestos(s), 3);
  assert.equal(paraCliente(s).partidas[0].materiales, 'Cuerpo: Blanco 16\nOtros datos: bajos de 70 de alto · cajones Advänced');
});

test('un alumno no puede emitir con los datos de SISTEMA & CURINO', () => {
  assert.equal(validarPlantilla(PLANTILLA_ADMIN, true), null);
  assert.match(validarPlantilla({ ...PLANTILLA_ALUMNO, empresa: 'SISTEMA & CURINO SLU' }, false)!, /tus datos/);
  assert.match(validarPlantilla({ ...PLANTILLA_ALUMNO, nif: 'B-24788580' }, false)!, /tus datos/);
  assert.match(validarPlantilla({ ...PLANTILLA_ALUMNO, iban: 'ES12 3456 7890 1234' }, false, 'ES1234567890 1234')!, /IBAN es de Curino/);
  assert.equal(validarPlantilla({ ...PLANTILLA_ALUMNO, empresa: 'Armarios Pérez', nif: '12345678Z' }, false), null);
});

test('qué le falta a un alumno para descargar', () => {
  assert.deepEqual(faltanPlantilla(PLANTILLA_ALUMNO), ['Empresa', 'NIF / CIF', 'Dirección completa', 'Email', 'Teléfono', 'IBAN', 'Firmante', 'Firma']);
  const completa = { ...PLANTILLA_ALUMNO, empresa: 'Armarios Pérez', nif: '12345678Z', direccion_1: 'C/ Mayor 1', direccion_2: '28001 Madrid', email: 'a@b.es', telefono: '600', iban: 'ES00 1234', firmante: 'Ana', firma_path: 'u/plantilla/firma.png' };
  assert.deepEqual(faltanPlantilla(completa), []);
  assert.deepEqual(faltanPlantilla({ ...completa, tipo: 'propia' }), ['Logo (plantilla propia)']);
  assert.equal(PLANTILLA_ADMIN.direccion_1, 'Carrer de Balmes 252, 5-2');
});

// ── Comisión del interiorista y partidas libres ──
const docLibre = (): DocPresupuesto => ({
  numero: 'Z1', fecha: '2026-10-14', atencion: '', proyecto: '', proyecto_2: '', validez: '', seccion: '', version: 1,
  partidas: [partidaLibre({ n: 1, titulo: 'Armario', precio: 1000, dto: 30 }), partidaLibre({ n: 2, titulo: 'Montaje', precio: 500, cantidad: 2 })]
});

test('sin comisión: importe = PVP − descuento de cada partida', () => {
  assert.deepEqual(importesNegocio(docLibre(), 21), { importe: 1700, pvp: 2000, comision: 0 });
});

test('comisión que paga el cliente: facturación = PVP y comisión como coste; variantes', () => {
  const d = { ...docLibre(), comision: { activa: true, pct: 15, paga: 'cliente' as const } };
  assert.deepEqual(importesNegocio(d, 21), { importe: 2000, pvp: 2000, comision: 300 });
  assert.ok(docVariante(d, 'cliente').partidas.every((p) => p.dto_pct === 0));
  assert.ok(docVariante(d, 'interiorista').partidas.every((p) => p.dto_pct === 15));
});

test('comisión con el interiorista comprando a neto: facturación = neto, sin coste', () => {
  const d = { ...docLibre(), comision: { activa: true, pct: 15, paga: 'interiorista' as const } };
  assert.deepEqual(importesNegocio(d, 21), { importe: 1700, pvp: 2000, comision: 0 });
});

test('partida sin precio: importes pendientes', () => {
  const d = docLibre(); d.partidas[1].precio = null;
  assert.deepEqual(importesNegocio(d, 21), { importe: null, pvp: null, comision: null });
});

test('elegir armarios de una versión y clave por partida', () => {
  const d = generarPresupuesto({ proyecto: ejemplo(), version: 3, tarifa: TARIFA_PENDIENTE, plantilla: PLANTILLA_ADMIN, nombre: 'X', hoy: '2026-10-14', armarios: ['A.02'] });
  assert.equal(d.partidas.length, 1);
  assert.equal(d.partidas[0].clave, 'v3:A.02');
  assert.equal(d.partidas[0].version, 3);
});

test('comisión: mismo redondeo que el PDF (neto por línea; comisión = PVP − neto)', () => {
  const d: DocPresupuesto = { ...docLibre(), comision: { activa: true, pct: 15, paga: 'cliente' as const },
    partidas: [partidaLibre({ n: 1, precio: 5819.5 }), partidaLibre({ n: 2, precio: 5594.5 }), partidaLibre({ n: 3, precio: 6373.52 })] };
  const neto = totales(docVariante(d, 'interiorista'), 21).importe;
  const r = importesNegocio(d, 21);
  assert.equal(r.pvp, 17787.52);
  assert.equal(neto, 15119.4);
  assert.equal(r.comision, 2668.12);
});

// ── Tarifa por puntos (OTG 2026) ──
test('puntos: tramo inmediatamente superior y extrapolación por encima de 1000 mm', () => {
  const m3 = MODELOS.m3.puntos;
  assert.deepEqual(porAncho(m3, 400), { puntos: 259, tramo: 400, fuera: false });
  assert.deepEqual(porAncho(m3, 450), { puntos: 275, tramo: 500, fuera: false });   // 450 → tramo 500
  assert.deepEqual(porAncho(m3, 350), { puntos: 259, tramo: 400, fuera: false });
  // 1150 mm → 1200: 395 + 2 × subida media de los 3 últimos escalones ((395 − 319) / 3 = 25,33) = 445,67
  assert.deepEqual(porAncho(m3, 1150), { puntos: 445.67, tramo: 1200, fuera: true });
  assert.deepEqual(porAncho(MODELOS.m1.puntos, 1125), { puntos: 578, tramo: 1200, fuera: true });   // 512 + 2 × 33
});

test('puntos: modelo de interior por las zonas del módulo y extras', () => {
  const alt = { tipo: 'altillo', alto: 40 } as const;
  assert.deepEqual(asignarModelo([alt, { tipo: 'cajonera', cajones: 4 }, { tipo: 'perchero' }] as never).extras, { cajon: 1, barra: 1 });
  assert.equal(asignarModelo([alt, { tipo: 'cajonera', cajones: 3 }] as never).modelo, 'm1');
  assert.equal(asignarModelo([alt, { tipo: 'perchero' }, { tipo: 'perchero' }] as never).modelo, 'm4');
  assert.equal(asignarModelo([alt, { tipo: 'perchero', prendas: 'largas' }] as never).modelo, 'm5');
  assert.equal(asignarModelo([alt, { tipo: 'perchero' }] as never).modelo, 'm2');
  assert.equal(asignarModelo([alt, { tipo: 'estantes', estantes: 4 }] as never).modelo, 'm3');
  assert.equal(asignarModelo([alt] as never).modelo, 'm6');
  assert.equal(asignarModelo([{ tipo: 'perchero' }] as never).altillo, false);
});

test('puntos: los cambios del usuario sustituyen a la tabla; sin ellos, la tabla original', () => {
  const base = puntosBase();
  assert.equal(base.m1_600, 381); assert.equal(base.rinconero, 830); assert.equal(base.costado_espejo, 292); assert.equal(base.remate_260_lacado, 178);
  const a = ejemplo().armarios[1];
  const original = precioArmario(a, tarifaPrueba()).puntos_total;
  const cambiada = precioArmario(a, { ...tarifaPrueba(), puntos: { m1_1000: base.m1_1000 + 100 } }).puntos_total;
  assert.ok(cambiada > original || cambiada === original);
});

test('puntos: opciones de la partida (costados, remate, cajeado) suman puntos', () => {
  const a = ejemplo().armarios[1];
  const sin = precioArmario(a, tarifaPrueba()).puntos_total;
  const con = precioArmario(a, tarifaPrueba(), { costados: [{ tipo: 'melamina', n: 2 }], remate: 'lacado', cajeado: true }).puntos_total;
  // 2 costados de melamina (2 × 89) + remate hasta 260 cm lacado (178) + 10 % del interior
  assert.ok(con > sin + 2 * 89 + 178);
});

// ── Cocinas en el presupuesto (fase 4) y bloqueo del PDF / Excel del cliente ──
import { lineasBloqueantes } from './presupuesto.ts';
const conCocina = (): Proyecto => ({ ...ejemplo(), cocinas: [{ codigo: 'C.01', titulo: 'COCINA EN L', grupo: 6, tramos: [
  { nombre: 'PARED 1', largo: 230, bajos: [{ tipo: 'bajo', ancho: 60 }, { tipo: 'bajo', ancho: 80, frente: { tipo: 'cajones', cajones: 3, sistema: 'legrabox' } }, { tipo: 'fregadero', ancho: 90 }] },
  { nombre: 'PARED 2', colocacion: 'esquina_der', largo: 210, bajos: [{ tipo: 'bajo', ancho: 90 }, { tipo: 'bajo', ancho: 60 }] }] }] });

test('cocina: una partida por tramo, dibujo en la primera, precio con el punto de cocina', () => {
  const t = { ...tarifaPrueba(), precio_punto_cocina: 2 };
  const d = generarPresupuesto({ proyecto: conCocina(), version: 3, tarifa: t, plantilla: PLANTILLA_ADMIN, nombre: 'Cliente PRUEBA', hoy: '2026-10-14' });
  const cs = d.partidas.filter((p) => p.tipo === 'cocina');
  assert.deepEqual(cs.map((p) => [p.codigo, p.clave]), [['C.01.1', 'v3:C.01.1'], ['C.01.2', 'v3:C.01.2']]);
  // Cada línea al alza y sin decimales; la partida suma sus líneas
  assert.ok(cs.every((p) => p.desglose.every((l) => Number.isInteger(l.puntos_linea)) && p.puntos === p.desglose.reduce((s, l) => s + l.puntos_linea!, 0)));
  const zocalo = cs[1].desglose.find((l) => l.clave === 'zocalo_ml')!;
  assert.deepEqual([zocalo.cantidad, zocalo.puntos, zocalo.puntos_linea], [1.5, 15, 23]);
  // Descuento por defecto 0 %
  assert.equal(TARIFA_PENDIENTE.descuento_pct, 0);
  assert.ok(cs[0].titulo.startsWith('C.01 COCINA EN L · PARED 1'));
  assert.equal(cs[0].precio, Math.round(cs[0].puntos! * 2 * 100) / 100);
  assert.ok(cs[0].desglose.some((l) => /Legrabox/.test(l.nombre)));
  assert.match(cs[0].materiales, /Cuerpo: Blanco 16 \(supuesto\)/);
  // Armarios y cocina en el mismo presupuesto: cada uno con su punto, y se suman
  assert.ok(d.partidas.some((p) => p.codigo === 'A.01') && totales(d, 21).pvp > cs[0].precio! + cs[1].precio!);
  // Sin precio del punto cocina: PENDIENTE (con sus puntos)
  const sin = generarPresupuesto({ proyecto: conCocina(), version: 3, tarifa: tarifaPrueba(), plantilla: PLANTILLA_ADMIN, nombre: 'X', hoy: '2026-10-14', armarios: ['C.01'] });
  assert.equal(sin.partidas.length, 2);
  assert.equal(sin.partidas[0].precio, null);
  assert.deepEqual(sin.partidas[0].pendientes, ['Precio del punto cocina']);
  assert.ok(sin.partidas[0].puntos! > 0);
});

test('bloqueo: solo líneas a 0 puntos (cocina fuera de tarifa); extrapoladas no; el precio a mano manda', () => {
  const p = conCocina();
  p.cocinas![0].tramos[1].bajos[0].ancho = 120;   // bajo de 120: fuera de tarifa
  const d = generarPresupuesto({ proyecto: p, version: 1, tarifa: { ...tarifaPrueba(), precio_punto_cocina: 2 }, plantilla: PLANTILLA_ADMIN, nombre: 'X', hoy: '2026-10-14' });
  const soloCocina = (x: DocPresupuesto): DocPresupuesto => ({ ...x, partidas: x.partidas.filter((q) => q.tipo === 'cocina') });
  const b = lineasBloqueantes(soloCocina(d));
  assert.equal(b.length, 1);
  assert.match(b[0], /PARED 2 · Cuerpo Bajo 70 × 120 .*: 0 puntos \(fuera de tarifa\)/);
  const manual = { ...d, partidas: d.partidas.map((x) => x.codigo === 'C.01.2' ? { ...x, precio_manual: true, precio: 500 } : x) };
  assert.deepEqual(lineasBloqueantes(soloCocina(manual)), []);
  // Armario con un módulo de más de 1000 mm: valor extrapolado con aviso, no bloquea
  const a = ejemplo(); a.armarios[0].cuerpos[0].modulos[0].ancho = 110;
  const da = generarPresupuesto({ proyecto: a, version: 1, tarifa: tarifaPrueba(), plantilla: PLANTILLA_ADMIN, nombre: 'X', hoy: '2026-10-14', armarios: ['A.01'] });
  assert.ok(da.partidas[0].desglose!.some((l) => l.aviso === 'fuera de tabla, valor extrapolado: revisar'));
  assert.deepEqual(lineasBloqueantes(da), []);
});

test('dibujos del presupuesto: un alzado por tramo y sección + planta bajo el último', async () => {
  const { laminasPresupuesto } = await import('./alzado.ts');
  const p = conCocina();
  assert.deepEqual(laminasPresupuesto({ ...p, armarios: [] }).map((l) => l.codigo), ['C.01.1', 'C.01.2']);
  p.cocinas![0].vistas = ['lateral', 'planta'];
  const ls = laminasPresupuesto({ ...p, armarios: [] });
  assert.deepEqual(ls.map((l) => [l.codigo, l.pagina]), [['C.01.1', 1], ['C.01.2', 1], ['C.01.2', 2]]);
  const textos = (i: number) => ls[i].prims.filter((x) => x.k === 'text').map((x) => (x as { t: string }).t);
  assert.ok(textos(0).includes('PARED 1 · ALZADO') && !textos(0).includes('PARED 2 · ALZADO'));
  assert.ok(textos(2).includes('PLANTA') && textos(2).includes('SECCIÓN TIPO'));
});
