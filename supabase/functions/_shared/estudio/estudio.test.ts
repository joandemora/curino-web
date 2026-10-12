// supabase/functions/_shared/estudio/estudio.test.ts
//
// Pruebas del esquema y del renderizador de alzados (Estudio Curino, F1).
//   node --test supabase/functions/_shared/estudio/estudio.test.ts   (Node 24)
//   deno test supabase/functions/_shared/estudio/                  (Deno)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validarProyecto, repartoZonas, type Proyecto, type Zona } from './esquema.ts';
import { laminasProyecto, ladosTirador, subtituloAuto, descripcionFrente, fmtCm } from './alzado.ts';
import { laminaSvg } from './svg.ts';

const ejemplo = (): Proyecto => JSON.parse(readFileSync(new URL('./ejemplos/a01-a03.json', import.meta.url), 'utf8'));
const errores = (p: unknown) => {
  const r = validarProyecto(p);
  return r.ok ? [] : r.errores.map((e) => `${e.ruta}: ${e.mensaje}`);
};

test('el ejemplo A.01–A.03 es válido', () => {
  assert.deepEqual(errores(ejemplo()), []);
});

test('módulos que no suman el ancho del cuerpo', () => {
  const p = ejemplo();
  p.armarios[1].cuerpos[0].modulos[0].ancho = 90;
  assert.match(errores(p).join('\n'), /modulos: los módulos suman 190 cm y el cuerpo mide 200 cm/);
});

test('frente que no cubre el ancho', () => {
  const p = ejemplo();
  p.armarios[1].cuerpos[0].frente.piezas.pop();
  assert.match(errores(p).join('\n'), /frente\.piezas: las puertas y frentes fijos suman 150 cm/);
});

test('zonas que no caben en el alto', () => {
  const p = ejemplo();
  const z = p.armarios[1].cuerpos[0].modulos[0].interior;
  z[2] = { tipo: 'perchero', alto: 150 };
  assert.match(errores(p).join('\n'), /interior: las zonas suman .* y el cuerpo mide 274 cm de alto/);
});

test('campos desconocidos, tipos y orden de zonas', () => {
  const p = ejemplo() as unknown as Record<string, any>;
  p.armarios[0].color = 'rojo';
  p.armarios[1].cuerpos[0].modulos[1].interior.push({ tipo: 'altillo', alto: 40 });
  p.armarios[2].cuerpos[0].modulos[2].interior[1] = { tipo: 'zapatero' };
  const e = errores(p).join('\n');
  assert.match(e, /armarios\[0\]\.color: campo desconocido/);
  assert.match(e, /el altillo debe ser la primera zona/);
  assert.match(e, /tipo desconocido/);
});

test('falta una medida obligatoria', () => {
  const p = ejemplo() as unknown as Record<string, any>;
  delete p.armarios[0].cuerpos[1].fondo;
  assert.match(errores(p).join('\n'), /cuerpos\[1\]\.fondo: falta la medida/);
});

test('reparto: altillo como cota y la zona sin alto ocupa el resto', () => {
  const zonas: Zona[] = [{ tipo: 'altillo', alto: 50 }, { tipo: 'perchero' }, { tipo: 'cajonera', cajones: 4 }];
  const r = repartoZonas(zonas, { alto: 274, zocalo: 10, grosor: 1.9 });
  assert.equal(r.error, undefined);
  assert.equal(Math.round(r.zonas[0].libre * 10) / 10, 46.2);
  assert.equal(r.zonas[2].libre, 78);
  assert.equal(Math.round(r.zonas[1].libre * 10) / 10, 274 - 10 - 3.8 - 46.2 - 78 - 3.8);
});

test('tiradores por parejas, la puerta suelta hacia su vecina', () => {
  const p = (n: number) => Array.from({ length: n }, () => ({ tipo: 'puerta' as const, ancho: 50 }));
  assert.deepEqual(ladosTirador(p(4)), ['der', 'izq', 'der', 'izq']);
  assert.deepEqual(ladosTirador(p(5)), ['der', 'izq', 'der', 'izq', 'izq']);
  assert.deepEqual(ladosTirador([{ tipo: 'fijo', ancho: 47.5 }, ...p(3)]), [null, 'der', 'izq', 'izq']);
});

test('textos automáticos', () => {
  const p = ejemplo();
  assert.equal(subtituloAuto(p.armarios[2]), '2 módulos de 104 cm + 1 módulo de 52 cm · 260 × 248 × 60 cm · 5 puertas de 52 cm');
  assert.equal(descripcionFrente(p.armarios[0].cuerpos[0].frente), 'Puertas abatibles molduradas lacadas');
  assert.equal(fmtCm(47.5), '47,5');
  assert.equal(fmtCm(95), '95');
});

test('láminas: formato, cotas y pies como en la referencia', () => {
  const laminas = laminasProyecto(ejemplo());
  assert.deepEqual(laminas.map((l) => l.formato), ['A3', 'A4', 'A3']);
  const textos = (i: number) => laminas[i].prims.filter((x) => x.k === 'text').map((x) => (x as { t: string }).t);
  const t1 = textos(0);
  for (const t of ['A.01  ARMARIO A MEDIDA EN L', '190 cm', '280 cm', 'altillo 50', '47,5', '2 cm a suelo',
    'CUERPO PRINCIPAL · INTERIOR', 'CUERPO PRINCIPAL · CERRADO · 3 puertas + 1 frente fijo',
    'LATERAL · fondo 40 · CERRADO · 2 puertas', 'Cajonera 4 cajones', 'Perchero superior', 'Barra de colgar',
    'Presupuesto PRUEBA · Cliente PRUEBA']) {
    assert.ok(t1.includes(t), `falta «${t}» en A.01`);
  }
  assert.ok(textos(2).includes('Estantes') && textos(2).includes('Balda inferior') && textos(2).includes('altillo 40'));
  // 5 + 4 + 2 puertas con tirador (cada tirador = 2 rectángulos de latón)
  const laton = laminas.map((l) => l.prims.filter((x) => x.k === 'rect' && x.fill === '#b8864b').length / 2);
  assert.deepEqual(laton, [5, 4, 5]);
});

test('SVG bien formado', () => {
  const svg = laminaSvg(laminasProyecto(ejemplo())[1]);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('ARMARIO A MEDIDA 200 cm'));
});
