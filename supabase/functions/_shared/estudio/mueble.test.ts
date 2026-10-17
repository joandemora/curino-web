// Pruebas: mueble a medida (aparadores, vitrinas…). Ejecutar:
//   node --test supabase/functions/_shared/estudio/mueble.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarProyecto } from './esquema.ts';
import { partidaMueble, anchoMueble, altoMueble, elementosMueble } from './mueble.ts';
import { puntosMuebleBase, puntosMueble } from './plano.ts';
import { laminasProyecto, laminasPresupuesto, dibujoLamina, escalasPorGrupo } from './alzado.ts';

// El MC_C de la prueba: tres cuerpos, montantes de 4, zona baja 74 y alta 166
const mcC = () => ({ version: 1, armarios: [], muebles: [{ codigo: 'M.01', titulo: 'MUEBLE COMEDOR C', fondo: 40, montante: 4, vistas: ['lateral'], cuerpos: [
  { ancho: 100, zonas: [{ alto: 74, tipo: 'puertas', puertas: { n: 2, agarre: 'push' }, interior: { cajones: 1, baldas_extraibles: 2, etiquetas: ['Cajón servilletas', 'Balda extraíble manteles'] } }, { alto: 166, tipo: 'puertas', puertas: { n: 2, arco: true, radio: 50, vitrina: true, agarre: 'tirador' }, interior: { estantes: 3, grosor_estantes: 3 } }] },
  // Estantes por cotas: 32 · 2 · 32 = 1 estante entre dos huecos
  { ancho: 150, zonas: [{ alto: 74, tipo: 'puertas', puertas: { n: 3, agarre: 'push' }, interior: { estantes: 1, etiquetas: ['Estantes para vajilla'] } }, { alto: 166, tipo: 'abierta', fondo: 'espejo' }] },
  { ancho: 100, zonas: [{ alto: 74, tipo: 'puertas', puertas: { n: 2, agarre: 'push' }, interior: { cuberteros: 2, estantes: 2, etiquetas: ['Cubertero'] } }, { alto: 166, tipo: 'puertas', puertas: { n: 2, arco: true, radio: 50, vitrina: true, agarre: 'tirador' }, interior: { estantes: 3, grosor_estantes: 3 } }] }
] }] });

test('mueble: valida, ancho = cuerpos + montantes, alto = zonas', () => {
  const v = validarProyecto(mcC());
  assert.equal(v.ok, true, JSON.stringify(!v.ok && v.errores));
  const m = v.ok ? v.proyecto.muebles![0] : null!;
  assert.equal(anchoMueble(m), 366); assert.equal(altoMueble(m), 240);
  // Cuerpos de distinto alto o cajones que no suman la zona: error con ruta
  const mal = mcC(); (mal.muebles[0].cuerpos[1].zonas[1] as { alto: number }).alto = 160;
  assert.equal(validarProyecto(mal).ok, false);
  const otro = mcC(); otro.muebles[0].cuerpos[0].zonas[0] = { alto: 74, tipo: 'cajones', cajones: { alturas: [20, 20] } } as never;
  assert.equal(validarProyecto(otro).ok, false);
});

test('mueble: mismo cálculo que el presupuesto desde plano; MC_C con estantes por cotas y cubertero = cajón + inserto (6.984 pt)', () => {
  const v = validarProyecto(mcC()); const m = v.ok ? v.proyecto.muebles![0] : null!;
  const p = partidaMueble(m, { version: 1, puntos: puntosMuebleBase(), precioPunto: 2, dto: 0 });
  assert.equal(p.puntos, 6984);
  assert.deepEqual(p.cuerpos_puntos, [{ nombre: 'Cuerpo izquierdo', puntos: 2492 }, { nombre: 'Cuerpo central', puntos: 1924 }, { nombre: 'Cuerpo derecho', puntos: 2568 }]);
  // Cada cubertero: un cajón (42) + su inserto (35)
  assert.ok(p.desglose.some((l) => /Cajón con cubertero/.test(l.nombre) && l.cantidad === 2 && l.puntos === 42));
  // Por construcción: el mismo cálculo que el plano
  assert.equal(puntosMueble(elementosMueble(m), puntosMuebleBase()).cuerpos.reduce((s, c) => s + c.puntos, 0), 6984);
  assert.equal(p.tipo, 'mueble'); assert.equal(p.dibujo, 'M.01'); assert.equal(p.subtitulo, 'Mueble comedor C a medida de 366 cm');
  assert.match(p.tecnico, /^Medidas: 3660 x 2400 x 400 mm/); assert.match(p.tecnico, /1 cajón interior/);
  assert.match(p.materiales, /Exterior: puertas lisas lacadas \(supuesto\)/);
});

test('mueble: interior + exterior, sección; en el presupuesto, misma escala', () => {
  const v = validarProyecto(mcC()); const p = v.ok ? v.proyecto : null!;
  const textos = laminasProyecto(p).flatMap((l) => l.prims).filter((x) => x.k === 'text').map((x) => (x as { t: string }).t);
  for (const t of ['INTERIOR', 'EXTERIOR', 'SECCIÓN', 'Cajón servilletas', 'Fondo de espejo', 'push', '366 cm']) assert.ok(textos.includes(t), t);
  const ls = laminasPresupuesto(p).filter((l) => l.codigo === 'M.01');
  assert.equal(ls.length, 2);
  const filas = ls.map((l) => ({ ...dibujoLamina(l), codigo: 'v1:M.01' }));
  const ks = escalasPorGrupo(filas);
  assert.equal(ks.get(filas[0]), ks.get(filas[1]));
});

test('zona de cajones con cubertero: el cajón con cubertero no se cuenta dos veces', () => {
  const m = { codigo: 'M.01', titulo: 'APARADOR', fondo: 45, cuerpos: [{ ancho: 60, zonas: [{ alto: 60, tipo: 'cajones', cajones: { alturas: [15, 20, 25], cubertero: 1, agarre: 'tirador' } }] }] };
  const el = elementosMueble(m as never).cuerpos[0].elementos;
  assert.deepEqual(el.map((e) => [e.tipo, e.cantidad]), [['cajon', 2], ['cubertero', 1]]);
  const l = puntosMueble(elementosMueble(m as never), puntosMuebleBase()).cuerpos[0].lineas;
  assert.equal(l.filter((x) => /^Cajón/.test(x.nombre)).reduce((s, x) => s + x.cantidad, 0), 3);   // 2 cajones + 1 cajón con cubertero
  assert.equal(l.filter((x) => /Tirador/.test(x.nombre)).reduce((s, x) => s + x.cantidad, 0), 3);   // un tirador por cajón, también el del cubertero
});

test('compartimentos: estantes de cada uno con su ancho y la división entre ellos', () => {
  const p = mcC();
  // Central: dos compartimentos «Estantes para vajilla» (50 y 100), 1 estante cada uno por las cotas 32 · 2 · 32
  p.muebles[0].cuerpos[1].zonas[0] = { alto: 74, tipo: 'puertas', puertas: { n: 3, agarre: 'push' }, interior: { compartimentos: [{ ancho: 50, estantes: 1, etiqueta: 'Estantes para vajilla' }, { ancho: 100, estantes: 1, etiqueta: 'Estantes para vajilla' }] } } as never;
  const v = validarProyecto(p); assert.equal(v.ok, true, JSON.stringify(!v.ok && v.errores));
  const part = partidaMueble(v.ok ? v.proyecto.muebles![0] : null!, { version: 1, puntos: puntosMuebleBase(), precioPunto: null, dto: 0 });
  const central = part.desglose.filter((l) => l.nombre.startsWith('Cuerpo central'));
  const est = central.filter((l) => /Estante/.test(l.nombre));
  assert.deepEqual(est.map((l) => l.puntos), [puntosMuebleBase().estante_500, puntosMuebleBase().estante_1000]);   // por el ancho de cada compartimento
  assert.ok(central.some((l) => /División/.test(l.nombre) && l.cantidad === 1));
  const textos = laminasProyecto(v.ok ? v.proyecto : null!).flatMap((l) => l.prims).filter((x) => x.k === 'text').map((x) => (x as { t: string }).t);
  assert.equal(textos.filter((t) => t === 'Estantes para vajilla').length, 2);
  // Con compartimentos, los estantes no van también en la zona
  const mal = mcC(); (mal.muebles[0].cuerpos[1].zonas[0] as { interior: unknown }).interior = { estantes: 1, compartimentos: [{ ancho: 50 }, { ancho: 100 }] };
  assert.equal(validarProyecto(mal).ok, false);
});
