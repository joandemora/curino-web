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
  // Con tirador: 15 pt el estándar, 45 el premium (como en armarios)
  const t = puntosCocina(cocina({ grupo: 6 }), P).tramos[0].lineas.find((l) => l.clave === 'tirador')!;
  assert.deepEqual([t.cantidad, t.puntos, t.aviso], [6, 15, undefined]);
  const tp = puntosCocina(cocina({ grupo: 6, agarre: 'tirador_premium' }), P).tramos[0].lineas.find((l) => l.clave === 'tirador_premium')!;
  assert.deepEqual([tp.cantidad, tp.puntos], [6, 45]);
  // Zócalo 15 pt/m
  const z = puntosCocina(cocina(), P).tramos[0].lineas.find((l) => l.clave === 'zocalo_ml')!;
  assert.deepEqual([z.cantidad, z.puntos], [1.5, 15]);
});

test('acabado sin precio: el más caro con precio, con aviso; nada a 0', () => {
  // Columna H+M: solo Blanco Plus → se usa con aviso
  const hm = buscarModulo(P, 'columna_hm', 220, 60, 'blanco16');
  assert.ok(hm.clave === 'mod_columna_hm_blanco_plus18' && hm.puntos === 141);
  assert.match(hm.aviso!, /sin precio en Blanco 16: se usa Blanco Plus 18 hidrófugo/);
  // Bajo 80 × 45 en Gris plomo («*»): el más caro de esa medida (Blanco 16 37,73 / Plus 37,71 → 38 / 38)
  const g = buscarModulo(P, 'bajo', 80, 45, 'gris_plomo16');
  assert.ok(g.clave !== null && /revisar/.test(g.aviso!) && g.medida === '80 × 45');
  // Alto 70 en Gris plomo: en 70 de alto solo hay Blanco 16
  assert.ok(buscarModulo(P, 'alto', 70, 60, 'gris_plomo16').clave === 'mod_alto_70x60_blanco16');
  // Nada a 0 en una cocina normal
  const r = puntosCocina(cocina({ tramos: [{ bajos: [{ tipo: 'columna_hm', ancho: 60 }, { tipo: 'bajo', ancho: 60 }] }] }), P);
  assert.ok(r.tramos[0].lineas.every((l) => l.puntos > 0));
});

test('encimera por defecto: la más barata del núcleo, como supuesto', () => {
  const c = completarCocina(cocina());
  assert.equal(c.encimera!.ref, 'MARQUINA 0599 FH');
  assert.ok(c.supuestos!.includes('encimera MARQUINA 0599 FH (la más barata de su núcleo)'));
});

test('precio: puntos × precio del punto cocina; PENDIENTE sin precio', () => {
  assert.equal(precioCocina(1000, null), null);
  assert.equal(precioCocina(1000, 2), 2000);
});

test('dibujo: alzado por tramo; sección y planta en hoja 2 si no caben', () => {
  const textos = (l: { prims: { k: string }[] }) => l.prims.filter((x) => x.k === 'text').map((x) => (x as unknown as { t: string }).t);
  const ls = laminasProyecto({ version: 1, armarios: [], cocinas: [cocina()] });
  assert.equal(ls.length, 1);
  assert.equal(ls[0].codigo, 'C.01');
  const t = textos(ls[0]);
  assert.ok(t.includes('ALZADO DE COCINA') && t.some((x) => /· ALZADO$/.test(x)) && t.some((x) => /^Supuestos:/.test(x)));
  assert.ok(t.includes('PLACA') === false && t.includes('VENTANA') === false);
  // Cocina en L con sección y planta: hoja 2
  const l: Cocina = cocina({ vistas: ['lateral', 'planta'], tramos: [
    { nombre: 'PARED 1', bajos: [{ tipo: 'columna_hm', ancho: 60 }, { tipo: 'bajo', ancho: 80, electro: ['placa'] }, { tipo: 'fregadero', ancho: 90 }, { tipo: 'esquinero', ancho: 93 }], altos: [{ tipo: 'hueco', ancho: 60 }, { tipo: 'hueco', ancho: 80, electro: ['campana'] }, { tipo: 'hueco', ancho: 90, etiqueta: 'VENTANA' }, { tipo: 'esquinero_alto', ancho: 63 }] },
    { nombre: 'PARED 2', colocacion: 'esquina_der', bajos: [{ tipo: 'bajo', ancho: 90 }, { tipo: 'bajo', ancho: 60 }] }] });
  const ls2 = laminasProyecto({ version: 1, armarios: [], cocinas: [l] });
  assert.deepEqual(ls2.map((x) => x.pagina), [1, 2]);
  const t1 = textos(ls2[0]), t2 = textos(ls2[1]);
  for (const k of ['PLACA', 'CAMPANA', 'VENTANA', 'HORNO', 'MICRO', 'RINCÓN']) assert.ok(t1.includes(k), k);
  for (const k of ['SECCIÓN TIPO', 'PLANTA', 'cocina en L', 'SECCIÓN + PLANTA']) assert.ok(t2.includes(k), k);
});

test('largo de pared: suma exacta, regletas de ≤ 5 cm en los extremos', () => {
  const p = (bajos: unknown[], o: Record<string, unknown> = {}) => validarProyecto({ version: 1, armarios: [], cocinas: [cocina({ tramos: [{ largo: 160, bajos, ...o } as never] })] });
  assert.equal(p([{ tipo: 'bajo', ancho: 80 }, { tipo: 'bajo', ancho: 80 }]).ok, true);
  const sobra = p([{ tipo: 'bajo', ancho: 90 }, { tipo: 'bajo', ancho: 80 }]);
  assert.match(JSON.stringify(!sobra.ok && sobra.errores), /sobran 10 cm/);
  const falta = p([{ tipo: 'bajo', ancho: 80 }, { tipo: 'bajo', ancho: 74 }]);
  assert.match(JSON.stringify(!falta.ok && falta.errores), /faltan 6 cm → pon regletas/);
  assert.equal(p([{ tipo: 'regleta', ancho: 3 }, { tipo: 'bajo', ancho: 80 }, { tipo: 'bajo', ancho: 74 }, { tipo: 'regleta', ancho: 3 }]).ok, true);
  assert.equal(p([{ tipo: 'regleta', ancho: 6 }, { tipo: 'bajo', ancho: 80 }, { tipo: 'bajo', ancho: 74 }]).ok, false);
  assert.equal(p([{ tipo: 'bajo', ancho: 80 }, { tipo: 'regleta', ancho: 3 }, { tipo: 'bajo', ancho: 77 }]).ok, false);
  // Más de 10 cm: válido (se avisa en el chat, no se rellena)
  assert.equal(p([{ tipo: 'bajo', ancho: 80 }, { tipo: 'bajo', ancho: 60 }]).ok, true);
  // Esquina: largo − 60
  const esq = validarProyecto({ version: 1, armarios: [], cocinas: [cocina({ tramos: [{ bajos: [{ tipo: 'bajo', ancho: 60 }] }, { colocacion: 'esquina_der', largo: 210, bajos: [{ tipo: 'bajo', ancho: 90 }, { tipo: 'bajo', ancho: 60 }] }] })] });
  assert.equal(esq.ok, true);
  // Regleta en el desglose: 10 pt
  const r = puntosCocina(cocina({ tramos: [{ largo: 160, bajos: [{ tipo: 'regleta', ancho: 3 }, { tipo: 'bajo', ancho: 80 }, { tipo: 'bajo', ancho: 77 }] }] }), P);
  const rg = r.tramos[0].lineas.find((l) => l.clave === 'regleta')!;
  assert.deepEqual([rg.cantidad, rg.puntos], [1, 10]);
});
