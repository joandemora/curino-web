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
  { ancho: 150, zonas: [{ alto: 74, tipo: 'puertas', puertas: { n: 3, agarre: 'push' }, interior: { estantes: 2, etiquetas: ['Estantes para vajilla'] } }, { alto: 166, tipo: 'abierta', fondo: 'espejo' }] },
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

test('mueble: mismo desglose que el presupuesto directo desde plano (MC_C = 6.939 pt)', () => {
  const v = validarProyecto(mcC()); const m = v.ok ? v.proyecto.muebles![0] : null!;
  const p = partidaMueble(m, { version: 1, puntos: puntosMuebleBase(), precioPunto: 2, dto: 0 });
  assert.equal(p.puntos, 6939);
  assert.deepEqual(p.cuerpos_puntos, [{ nombre: 'Cuerpo izquierdo', puntos: 2492 }, { nombre: 'Cuerpo central', puntos: 1963 }, { nombre: 'Cuerpo derecho', puntos: 2484 }]);
  // Por construcción: el mismo cálculo que el plano
  assert.equal(puntosMueble(elementosMueble(m), puntosMuebleBase()).cuerpos.reduce((s, c) => s + c.puntos, 0), 6939);
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
