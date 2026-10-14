// supabase/functions/_shared/estudio/cocina-tarifa.test.ts
//   node --test supabase/functions/_shared/estudio/cocina-tarifa.test.ts
// Transcripción de la tarifa de cocinas (fase 1): recuentos y valores de control.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  puntosDeEur, MODULOS_COCINA, ENCIMERAS_COCINA, HERRAJES_COCINA, CAJON_ADVANCED, CAJON_LEGRABOX,
  TABLEROS_COCINA, SERVICIO_COCINA, PUERTAS_COCINA, ALTOS_PUERTA, ANCHOS_PUERTA, GRUPOS_PUERTA
} from './cocina-tarifa.ts';

const puerta = (g: number, alto: number, ancho: number) => PUERTAS_COCINA[g][ALTOS_PUERTA.indexOf(alto)][ANCHOS_PUERTA.indexOf(ancho)];

test('€ → puntos: al alza y sin decimales', () => {
  assert.equal(puntosDeEur(39.64), 40);
  assert.equal(puntosDeEur(106.34), 107);
  assert.equal(puntosDeEur(29.00), 29);
  assert.equal(puntosDeEur(10), 10);
  assert.equal(puntosDeEur(15), 15);
  assert.equal(puntosDeEur(0.01), 1);
});

test('recuentos: lo mismo que el PDF', () => {
  assert.equal(MODULOS_COCINA.length, 48);
  const precios = MODULOS_COCINA.flatMap((r) => [r.blanco16_a, r.blanco16_b, r.gris_plomo16, r.blanco_plus18]).filter((v) => v !== null);
  assert.equal(precios.length, 148);
  assert.equal(ENCIMERAS_COCINA.length, 20);
  assert.equal(HERRAJES_COCINA.length, 16);
  assert.equal(CAJON_ADVANCED.kits.length, 15);
  assert.equal(CAJON_LEGRABOX.kits.length, 3);
  assert.equal(TABLEROS_COCINA.length, 43);
  assert.equal(SERVICIO_COCINA.length, 9);
  for (const g of GRUPOS_PUERTA) {
    assert.equal(PUERTAS_COCINA[g].length, ALTOS_PUERTA.length);
    PUERTAS_COCINA[g].forEach((fila) => assert.equal(fila.length, ANCHOS_PUERTA.length));
  }
  const celdas = GRUPOS_PUERTA.flatMap((g) => PUERTAS_COCINA[g].flat()).filter((v) => v !== null);
  assert.equal(celdas.length, 968);
});

test('valores de control', () => {
  const bajo = MODULOS_COCINA.find((r) => r.descripcion === 'MÓDULO BAJO' && r.medida_b === '80x60')!;
  assert.deepEqual([bajo.blanco16_a, bajo.blanco16_b, bajo.gris_plomo16, bajo.blanco_plus18], [39.64, 43.29, 47.63, 42.82]);
  const esq = MODULOS_COCINA.find((r) => r.descripcion === 'ESQUINERO BAJO')!;
  assert.deepEqual([esq.blanco16_a, esq.blanco16_b, esq.gris_plomo16, esq.blanco_plus18], [110.87, 124.14, 133.82, 118.6]);
  assert.deepEqual([puerta(1, 70, 60), puerta(6, 70, 60), puerta(14, 70, 60), puerta(1, 200, 60)], [29.72, 61.43, 79.24, 79.35]);
  assert.equal(puerta(12, 270, 60), null);
  assert.equal(puerta(1, 10, 30), null);
  assert.equal(CAJON_LEGRABOX.kits.find((k) => k.altura === 'F')!.eur, 92.17);
  assert.equal(CAJON_ADVANCED.montaje, 10);
  assert.equal(CAJON_LEGRABOX.montaje, 15);
});
