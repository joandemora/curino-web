// supabase/functions/_shared/estudio/vistas.test.ts
//   node --test supabase/functions/_shared/estudio/vistas.test.ts
// Sección lateral, planta y grosor de estantes / baldas (F6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repartoZonas, validarProyecto, type Armario, type Proyecto, type Zona } from './esquema.ts';
import { laminasArmario, geometriaPlanta, gruposSeccion, fondosCuerpo } from './alzado.ts';
import { puntosArmario, puntosBase, conceptoGrosor } from './puntos.ts';
import { textoModulo } from './presupuesto.ts';

const zonas: Zona[] = [
  { tipo: 'altillo', alto: 45 },
  { tipo: 'estantes', estantes: 3, grosor_estantes: 3 },
  { tipo: 'cajonera', cajones: 3, grosor_balda_encima: 3 }
];
const frente = (n: number, ancho: number, apertura: Armario['cuerpos'][0]['frente']['apertura'] = 'coplanar') =>
  ({ apertura, modelo: 'lisa' as const, piezas: Array.from({ length: n }, () => ({ tipo: 'puerta' as const, ancho })) });
const armario = (vistas?: ('lateral' | 'planta')[]): Armario => ({
  codigo: 'A.01', titulo: 'ARMARIO PRUEBA', vistas, cuerpos: [{
    ancho: 240, alto: 255, fondo: 60, frente: frente(4, 60),
    modulos: [{ ancho: 80, interior: [{ tipo: 'altillo', alto: 45 }, { tipo: 'perchero' }] }, { ancho: 80, interior: zonas }, { ancho: 80, interior: [{ tipo: 'altillo', alto: 45 }, { tipo: 'perchero' }] }]
  }]
});

test('grosor: la balda gruesa resta alto libre y los estantes de 30 achican sus huecos', () => {
  const c = { alto: 255, zocalo: 10, grosor: 1.9 };
  const r = repartoZonas(zonas, c);
  assert.equal(r.error, undefined);
  const [alt, est, caj] = r.zonas;
  assert.equal(caj.balda_encima, 3);
  assert.equal(Math.round(alt.libre * 10) / 10, 41.2);                  // 45 − 1,9 (techo) − 1,9 (balda)
  assert.equal(est.grosor_estantes, 3);
  assert.equal(Math.round(est.hueco_estantes! * 100) / 100, Math.round(((est.libre - 9) / 4) * 100) / 100);
  // Mismo módulo con baldas de 19: la zona de estantes gana 1,1 cm
  const fino = repartoZonas([zonas[0], { tipo: 'estantes', estantes: 3 }, { tipo: 'cajonera', cajones: 3 }], c);
  assert.equal(Math.round((fino.zonas[1].libre - est.libre) * 10) / 10, 1.1);
});

test('validación: balda encima de la primera zona y estantes que no caben', () => {
  const p = (interior: Zona[]): unknown => ({ version: 1, armarios: [{ codigo: 'A.01', titulo: 'X', cuerpos: [{ ancho: 80, alto: 250, fondo: 60, modulos: [{ ancho: 80, interior }], frente: frente(2, 40, 'abatible') }] }] });
  const a = validarProyecto(p([{ tipo: 'altillo', alto: 45, grosor_balda_encima: 3 }, { tipo: 'perchero' }]));
  assert.equal(a.ok, false);
  assert.match(JSON.stringify(!a.ok && a.errores), /primera zona no tiene balda encima/);
  const b = validarProyecto(p([{ tipo: 'altillo', alto: 45 }, { tipo: 'estantes', estantes: 12, alto: 60, grosor_estantes: 3 }, { tipo: 'hueco' }]));
  assert.equal(b.ok, false);
  assert.match(JSON.stringify(!b.ok && b.errores), /no caben/);
  assert.equal(validarProyecto({ version: 1, armarios: [armario(['lateral', 'planta'])] }).ok, true);
  assert.equal(validarProyecto({ version: 1, armarios: [{ ...armario(), vistas: ['alzado'] }] }).ok, false);
});

test('vistas: sin vistas una hoja; con sección y planta, hoja extra si no caben', () => {
  const p: Pick<Proyecto, 'referencia' | 'cliente'> = { referencia: 'PRUEBA' };
  assert.equal(laminasArmario(armario(), p).length, 1);
  const ls = laminasArmario(armario(['lateral', 'planta']), p);
  assert.deepEqual(ls.map((l) => l.pagina), [1, 2]);
  const textos = ls[1].prims.filter((x) => x.k === 'text').map((x) => (x as { t: string }).t);
  assert.ok(textos.includes('SECCIÓN') && textos.includes('PLANTA') && textos.includes('SECCIÓN LATERAL + PLANTA'));
  assert.ok(textos.includes('módulo 2') && textos.includes('módulos 1 y 3'));   // módulos iguales comparten sección
  assert.ok(textos.includes('30 mm'));
  // Un armario estrecho con solo planta cabe en la misma hoja
  const estrecho: Armario = { codigo: 'A.02', titulo: 'X', vistas: ['planta'], cuerpos: [{ ancho: 80, alto: 250, fondo: 60, frente: frente(2, 40, 'abatible'), modulos: [{ ancho: 80, interior: [{ tipo: 'perchero' }] }] }] };
  const una = laminasArmario(estrecho, p);
  assert.equal(una.length, 1);
  assert.ok(una[0].prims.some((x) => x.k === 'text' && x.t === 'PLANTA'));
});

test('secciones: módulos con el mismo interior van juntos', () => {
  assert.deepEqual(gruposSeccion(armario().cuerpos[0]), [[0, 2], [1]]);
});

test('planta: fondo sin puertas, correderas en dos planos y lateral en L', () => {
  const c = armario().cuerpos[0];
  assert.equal(fondosCuerpo(c).D, 58.1);
  assert.equal(Math.round(fondosCuerpo({ ...c, frente: frente(4, 60, 'corredera') }).D * 10) / 10, 55.7);
  const l: Armario = { codigo: 'A.01', titulo: 'L', cuerpos: [
    { ancho: 200, alto: 250, fondo: 60, frente: frente(4, 50, 'abatible'), modulos: [{ ancho: 200, interior: [{ tipo: 'perchero' }] }] },
    { colocacion: 'esquina_der', ancho: 120, alto: 250, fondo: 40, frente: frente(2, 60, 'abatible'), modulos: [{ ancho: 120, interior: [{ tipo: 'perchero' }] }] },
    { colocacion: 'esquina_izq', ancho: 100, alto: 250, fondo: 40, frente: frente(2, 50, 'abatible'), modulos: [{ ancho: 100, interior: [{ tipo: 'perchero' }] }] }
  ] };
  const g = geometriaPlanta(l).cuerpos;
  // Derecha: trasera en x = 200, arranca en el frente del principal (y = 60), mira a la izquierda
  assert.deepEqual([g[1].o, g[1].u, g[1].v], [[200, 60], [0, 1], [-1, 0]]);
  // Izquierda: trasera en x = 0, de la habitación hacia el principal, mira a la derecha
  assert.deepEqual([g[2].o, g[2].u, g[2].v], [[0, 160], [0, -1], [1, 0]]);
});

test('tarifa: estantes de 25 y 30 = 19 × 1,25 / × 1,5 y diferencia en la partida', () => {
  const b = puntosBase();
  assert.equal(b.estante30_800, Math.round(b.estante_800 * 1.5));
  assert.equal(b.estante25_400, Math.round(b.estante_400 * 1.25));
  assert.equal(conceptoGrosor(1.9), null);
  assert.equal(conceptoGrosor(2.5)?.clave, 'estante25');
  assert.match(conceptoGrosor(4)?.aviso ?? '', /revisar/);
  const r = puntosArmario(armario(), b);
  const est = r.lineas.find((x) => x.clave.startsWith('grueso_estante30_c0m1'))!;
  const balda = r.lineas.find((x) => x.clave.startsWith('grueso_estante30_balda_c0m1'))!;
  assert.equal(est.cantidad, 3);
  assert.equal(est.puntos, b.estante30_800 - b.estante_800);
  assert.match(est.nombre, /Estantes 30 mm · módulo 2 · 800 mm/);
  assert.equal(balda.cantidad, 1);
  assert.match(balda.nombre, /^Balda 30 mm/);
  // Sobrescribir el de 30 en la tarifa del usuario cambia la diferencia
  const r2 = puntosArmario(armario(), { ...b, estante30_800: 40 });
  assert.equal(r2.lineas.find((x) => x.clave.startsWith('grueso_estante30_c0m1'))!.puntos, 40 - b.estante_800);
});

test('ficha técnica: «estantes de 30 mm» y balda gruesa', () => {
  assert.equal(textoModulo(zonas), 'cajonera de 3 cajones + 3 estantes de 30 mm + balda de 30 mm sobre la cajonera + altillo 45 cm.');
});
