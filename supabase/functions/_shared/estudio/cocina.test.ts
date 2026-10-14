// supabase/functions/_shared/estudio/cocina.test.ts
//   node --test supabase/functions/_shared/estudio/cocina.test.ts
// Cocinas (fase 2): esquema, supuestos y cálculo en puntos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarProyecto } from './esquema.ts';
import { completarCocina, type Cocina } from './cocina.ts';
import { puntosBaseCocina, puntosCocina, buscarPuerta, buscarModulo, precioCocina, ENTRADAS_MODULO } from './cocina-puntos.ts';
import { laminasProyecto } from './alzado.ts';

const P = puntosBaseCocina();
const cocina = (o: Partial<Cocina> = {}): Cocina => ({
  codigo: 'C.01', titulo: 'COCINA PRUEBA', tramos: [{ bajos: [{ tipo: 'bajo', ancho: 60 }, { tipo: 'fregadero', ancho: 90 }], altos: [{ tipo: 'alto', ancho: 60 }, { tipo: 'hueco', ancho: 90 }] }], ...o
});

test('esquema: proyecto solo con cocina y errores legibles', () => {
  assert.equal(validarProyecto({ version: 1, armarios: [], cocinas: [cocina()] }).ok, true);
  assert.equal(validarProyecto({ version: 1, armarios: [] }).ok, false);
  const r = validarProyecto({ version: 1, armarios: [], cocinas: [cocina({ codigo: 'A.01', tramos: [{ bajos: [{ tipo: 'alto', ancho: 60 } as never] }] })] });
  assert.equal(r.ok, false);
  const t = JSON.stringify(!r.ok && r.errores);
  assert.match(t, /formato C\.01/);
  assert.match(t, /en bajos: bajo/);
});

test('supuestos: lo que falta se rellena y se anota', () => {
  const c = completarCocina(cocina());
  assert.equal(c.acabado, 'blanco16');
  assert.equal(c.grupo, 1);
  assert.equal(c.tramos[0].bajos[0].alto, 70);
  assert.equal(c.tramos[0].altos![0].alto, 70);
  assert.equal(c.encimera?.nucleo, 'negro');
  for (const s of ['cuerpo Blanco 16', 'puerta grupo 1', 'bajos de 70 de alto', 'encimera compacto núcleo negro']) assert.ok(c.supuestos!.includes(s), s);
  // Lo que viene no se toca ni se marca
  const d = completarCocina(cocina({ acabado: 'gris_plomo16', grupo: 12 }));
  assert.equal(d.acabado, 'gris_plomo16');
  assert.equal(d.agarre, 'unero');
  assert.ok(!d.supuestos!.some((s) => /cuerpo|grupo|tirador/.test(s)));
});

test('tarifa en puntos: € al alza', () => {
  assert.equal(P.mod_bajo_70x60_blanco16, 40);        // 39,64 €
  assert.equal(P.mod_columna_220x60_blanco16, 107);   // 106,34 €
  assert.equal(P.advanced_montaje, 10);
  assert.equal(P.legrabox_montaje, 15);
  assert.equal(P.puerta_g1_70x60, 30);                // 29,72 €
  assert.equal(P['puerta_g1_17_5x30'], 14);           // 13,48 €
  assert.equal(new Set(ENTRADAS_MODULO.map((e) => e.clave)).size, ENTRADAS_MODULO.length);
});

test('escalones: siguiente hacia arriba; fuera de tarifa sin extrapolar', () => {
  const a = buscarPuerta(P, 1, 70, 80);
  assert.ok(a.clave === 'puerta_g1_70x90');           // no hay ancho 80
  const b = buscarPuerta(P, 1, 10, 30);
  assert.ok(b.clave === 'puerta_g1_10x60');           // alto 10: siguiente ancho disponible
  const c = buscarPuerta(P, 12, 260, 60);
  assert.equal(c.clave, null);
  assert.equal((c as { aviso: string }).aviso, 'fuera de tarifa – revisar');
  assert.equal(buscarPuerta(P, 1, 280, 60).clave, null);
  assert.equal(buscarPuerta(P, 1, 70, 95).clave, null);
  const m = buscarModulo(P, 'bajo', 72, 65, 'blanco16');
  assert.ok(m.clave === 'mod_bajo_80x70_blanco16');
  assert.equal(buscarModulo(P, 'bajo', 70, 110, 'blanco16').clave, null);
  const r = buscarPuerta(P, 7, 70, 60);
  assert.ok(r.clave !== null && r.aviso === 'precio dudoso en la tarifa');
});

test('cálculo: uñero sin tirador, cajones con kit + base + montaje, encimera en placas', () => {
  const c = cocina({ grupo: 12, tramos: [{ bajos: [
    { tipo: 'bajo', ancho: 60, frente: { tipo: 'cajones', cajones: 3, sistema: 'legrabox' } },
    { tipo: 'fregadero', ancho: 90 }, { tipo: 'bajo', ancho: 300 }
  ] }] });
  const r = puntosCocina(c, P);
  const L = r.tramos[0].lineas;
  assert.ok(!L.some((l) => l.clave === 'tirador'));
  assert.equal(L.find((l) => l.clave === 'legrabox_montaje')!.cantidad, 3);
  assert.equal(L.find((l) => l.clave === 'legrabox_base_antracita')!.cantidad, 3);
  assert.ok(L.some((l) => l.clave.startsWith('legrabox_C')));
  // 60 + 90 + 300 = 4,5 m en placas de 4,2 m → 2 placas
  assert.equal(L.find((l) => l.clave.startsWith('encimera_'))!.cantidad, 2);
  // El bajo de 300 no está en la tarifa: «fuera de tarifa – revisar», 0 puntos
  const fuera = L.find((l) => l.nombre.startsWith('Cuerpo Bajo 70 × 300'))!;
  assert.equal(fuera.puntos, 0);
  assert.match(fuera.aviso!, /fuera de tarifa/);
  // Con tirador: una línea «Tiradores» sin precio (no está en la tarifa del proveedor)
  const t = puntosCocina(cocina({ grupo: 6 }), P).tramos[0].lineas.find((l) => l.clave === 'tirador')!;
  assert.equal(t.cantidad, 6);
  assert.match(t.aviso!, /sin precio/);
  assert.equal(puntosCocina(cocina({ grupo: 6 }), { ...P, tirador: 3 }).tramos[0].lineas.find((l) => l.clave === 'tirador')!.aviso, undefined);
});

test('precio: puntos × precio del punto cocina; PENDIENTE sin precio', () => {
  assert.equal(precioCocina(1000, null), null);
  assert.equal(precioCocina(1000, 2), 2000);
});

test('ficha de cocina en las láminas del proyecto', () => {
  const ls = laminasProyecto({ version: 1, armarios: [], cocinas: [cocina()] });
  assert.equal(ls.length, 1);
  assert.equal(ls[0].codigo, 'C.01');
  assert.ok(ls[0].prims.some((x) => x.k === 'text' && /Supuestos/.test(x.t)));
});
