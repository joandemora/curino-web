// supabase/functions/_shared/estudio/presupuesto.test.ts
//
// Pruebas del motor de precios y del presupuesto (F3).
//   node --test supabase/functions/_shared/estudio/presupuesto.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Proyecto } from './esquema.ts';
import { contarArmario, precioArmario, claveCuerpo, TARIFA_PENDIENTE, CONCEPTOS, eur, type Tarifa } from './tarifa.ts';
import { generarPresupuesto, totales, validarPlantilla, faltanPlantilla, PLANTILLA_ADMIN, PLANTILLA_ALUMNO, textoModulo } from './presupuesto.ts';

const ejemplo = (): Proyecto => JSON.parse(readFileSync(new URL('./ejemplos/a01-a03.json', import.meta.url), 'utf8'));
const tarifaPrueba = (): Tarifa => ({ valores: Object.fromEntries(CONCEPTOS.map((c) => [c.clave, c.unidad === '%' ? 10 : 100])), descuento_pct: 30, iva_pct: 21 });

test('cantidades de A.02 (200 × 274 × 60, 4 puertas molduradas lacadas)', () => {
  const n = contarArmario(ejemplo().armarios[1]);
  assert.deepEqual(n, {
    [claveCuerpo({ fondo: 60, alto: 274 })]: 2, puerta_moldurada: 4, tirador: 4,
    altillo: 2, estante: 2, barra: 3, cajon: 4
  });
});

test('A.03: estantes y balda inferior cuentan como estantes; frente fijo por metro en A.01', () => {
  const p = ejemplo();
  const n3 = contarArmario(p.armarios[2]);
  assert.equal(n3.estante, 2 + 1 + 0 + 5);   // módulo 1: 2 baldas; módulo 2: 1; módulo 3: 0 + 5 estantes
  const n1 = contarArmario(p.armarios[0]);
  assert.equal(n1.frente_fijo, 0.48);       // 47,5 cm → 0,48 ml (redondeo a 2 decimales)
  assert.equal(n1.perchero_extraible, 1);
});

test('tarifa PENDIENTE → sin precio y con la lista de pendientes', () => {
  const r = precioArmario(ejemplo().armarios[1], TARIFA_PENDIENTE);
  assert.equal(r.pvp, null);
  assert.ok(r.pendientes.includes('Puerta moldurada'));
  assert.ok(r.pendientes.includes('Recargo acabado lacado'));
});

test('precio con tarifa completa: suma + recargo de acabado sobre puertas', () => {
  const r = precioArmario(ejemplo().armarios[1], tarifaPrueba());
  // 2 ml + 4 puertas + 4 tiradores + 2 altillos + 2 estantes + 3 barras + 4 cajones = 21 × 100; lacado 10% de 400
  assert.equal(r.pvp, 2100 + 40);
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
    'Puertas: 4 puertas abatibles molduradas lacadas de 500 mm',
    'Módulo 1 – 100 cm: doble perchero + altillo 50 cm.',
    'Módulo 2 – 100 cm: cajonera de 4 cajones + barra de colgar + altillo 50 cm.'
  ].join('\n'));
  assert.match(doc.partidas[0].tecnico, /^Cuerpo principal: 1900 x 2800 x 600 mm · 2 módulos de 950 mm/);
  assert.match(doc.partidas[0].tecnico, /Lateral: 1000 x 2800 x 400 mm/);
  assert.equal(textoModulo([{ tipo: 'hueco', alto: 36, etiqueta: 'Estante' }, { tipo: 'hueco', etiqueta: 'Estante' }, { tipo: 'perchero_extraible' }]), '2 estantes + perchero extraíble.');
  assert.equal(doc.partidas[2].subtitulo, 'Armario a medida de 260 cm con puertas molduradas lacadas');
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
