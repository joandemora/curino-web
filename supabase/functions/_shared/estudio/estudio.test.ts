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
  assert.equal(descripcionFrente(p.armarios[0].cuerpos[0].frente), 'Puertas abatibles molduradas · lacada');
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

test('puertas lisas y molduradas en el mismo frente', () => {
  const p = ejemplo();
  const f = p.armarios[1].cuerpos[0].frente;
  (f.piezas[0] as any).modelo = 'lisa';
  (f.piezas[1] as any).modelo = 'lisa';
  assert.deepEqual(errores(p), []);
  assert.equal(descripcionFrente(f), 'Puertas abatibles molduradas y lisas · lacada');
  // 2 puertas molduradas × 2 paneles × 2 líneas de moldura = 8 rectángulos sin relleno
  const molduras = laminasProyecto(p)[1].prims.filter((x) => x.k === 'rect' && !x.fill && x.stroke === '#1d1d1b').length;
  assert.equal(molduras, 8);
  (f.piezas[2] as any).modelo = 'cristal';
  assert.match(errores(p).join('\n'), /piezas\[2\]\.modelo: valor no válido/);
});

test('SVG bien formado', () => {
  const svg = laminaSvg(laminasProyecto(ejemplo())[1]);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('ARMARIO A MEDIDA 200 cm'));
});

test('cabecera: el acabado tal cual (sin plurales ni minúsculas); cotas con dos decimales', async () => {
  const { descripcionFrente: df, fmtCm: f } = await import('./alzado.ts');
  assert.equal(df({ apertura: 'abatible', modelo: 'lisa', acabado: 'Blanco Soft III', piezas: [{ tipo: 'puerta', ancho: 50 }] }), 'Puertas abatibles lisas · Blanco Soft III');
  assert.equal(f(54.75), '54,75');
  assert.equal(f(112.5), '112,5');
  assert.equal(f(3), '3');
});

test('cajones abiertos (frente bajo / escote) y sin tirador: se dibujan y se validan', async () => {
  const { laminasProyecto: lp } = await import('./alzado.ts');
  const { validarProyecto: v } = await import('./esquema.ts');
  const p = (cajonera: Record<string, unknown>) => ({ version: 1, armarios: [{ codigo: 'A.01', titulo: 'X', vistas: ['lateral'], cuerpos: [{ ancho: 80, alto: 250, fondo: 60, frente: { apertura: 'abatible', modelo: 'lisa', piezas: [{ tipo: 'puerta', ancho: 40 }, { tipo: 'puerta', ancho: 40 }] },
    modulos: [{ ancho: 80, interior: [{ tipo: 'altillo', alto: 45 }, { tipo: 'hueco' }, { tipo: 'cajonera', cajones: 3, ...cajonera }] }] }] }] });
  for (const c of [{}, { frente: 'abierto' }, { frente: 'abierto', abierto: 'escote', agarre: 'ninguno' }, { agarre: 'unero' }]) assert.equal(v(p(c)).ok, true, JSON.stringify(c));
  assert.equal(v(p({ abierto: 'escote' })).ok, false);           // escote sin frente abierto
  const textos = (c: Record<string, unknown>) => lp(p(c) as never).flatMap((l) => l.prims).filter((x) => x.k === 'text').map((x) => (x as { t: string }).t);
  assert.ok(textos({ frente: 'abierto', agarre: 'ninguno' }).includes('Cajonera 3 cajones (zapatero abierto) sin tirador'));
  assert.ok(textos({ frente: 'abierto', abierto: 'escote' }).includes('Cajonera 3 cajones abiertos con escote'));
  // Sin tirador: no se dibuja la raya (líneas gruesas de 1.2 pt dentro de los cajones)
  const rayas = (c: Record<string, unknown>) => lp(p(c) as never)[0].prims.filter((x) => x.k === 'line' && (x as { sw: number }).sw === 1.2).length;
  assert.ok(rayas({}) - rayas({ agarre: 'ninguno' }) === 3);
});

test('cajón con hueco de mano y tapetas laterales: validación, dibujo, ficha y puntos', async () => {
  const { laminasProyecto: lp } = await import('./alzado.ts');
  const { validarProyecto: v, tapetasCajonera, huecoMano } = await import('./esquema.ts');
  const { puntosArmario, puntosBase } = await import('./puntos.ts');
  const { textoModulo } = await import('./presupuesto.ts');
  const p = (cajonera: Record<string, unknown>, apertura = 'abatible') => ({ version: 1, armarios: [{ codigo: 'A.01', titulo: 'X', vistas: ['lateral', 'planta'], cuerpos: [{ ancho: 80, alto: 250, fondo: 60, frente: { apertura, modelo: 'lisa', piezas: [{ tipo: 'puerta', ancho: 40 }, { tipo: 'puerta', ancho: 40 }] },
    modulos: [{ ancho: 80, interior: [{ tipo: 'altillo', alto: 45 }, { tipo: 'hueco' }, { tipo: 'cajonera', cajones: 3, alto: 75, ...cajonera }] }] }] }] });
  for (const c of [{ frente: 'hueco_mano' }, { frente: 'hueco_mano', hueco: 4, agarre: 'ninguno' }, { tapetas: 0 }, { tapetas: 2.5 }]) assert.equal(v(p(c)).ok, true, JSON.stringify(c));
  assert.equal(v(p({ hueco: 3 })).ok, false);                                   // hueco sin hueco_mano
  assert.equal(v(p({ frente: 'hueco_mano', agarre: 'tirador' })).ok, false);    // siempre sin tirador
  assert.equal(v(p({ tapetas: 25 })).ok, false);                                // fuera de rango
  // Valores por defecto: 3 cm detrás de abatibles, 0 con correderas; hueco 3 → frente de 22 en un cajón de 25
  const z = { tipo: 'cajonera' as const, cajones: 3 };
  assert.equal(tapetasCajonera(z, 'abatible'), 3); assert.equal(tapetasCajonera(z, 'corredera'), 0); assert.equal(tapetasCajonera({ ...z, tapetas: 0 }, 'abatible'), 0);
  assert.equal(huecoMano({ ...z, frente: 'hueco_mano' }), 3); assert.equal(huecoMano(z), 0);
  const textos = (c: Record<string, unknown>) => lp(p(c) as never).flatMap((l) => l.prims).filter((x) => x.k === 'text').map((x) => (x as { t: string }).t);
  assert.ok(textos({ frente: 'hueco_mano' }).includes('Cajonera 3 cajones con hueco de mano'));
  assert.equal(textos({ frente: 'hueco_mano' }).filter((t) => t === '3').length >= 3, true);   // hueco (alzado + sección) y tapeta
  assert.equal(textoModulo([{ tipo: 'cajonera', cajones: 3, frente: 'hueco_mano' }], 'abatible'), 'cajonera de 3 cajones con hueco de mano de 3 cm y tapetas laterales 3 cm para bisagras.');
  assert.equal(textoModulo([{ tipo: 'cajonera', cajones: 3, frente: 'abierto' }], 'corredera'), 'cajonera de 3 cajones (zapatero abierto).');
  // Puntos: las de por defecto solo con opciones.tapetas; las explícitas, siempre; 30 pt «revisar»
  const arm = (c: Record<string, unknown>) => (p(c) as never as { armarios: never[] }).armarios[0];
  const tap = (c: Record<string, unknown>, op = {}) => puntosArmario(arm(c), puntosBase(), op).lineas.filter((l) => l.clave.startsWith('tapeta_cajonera'));
  assert.equal(tap({}).length, 0);
  const l = tap({}, { tapetas: true });
  assert.equal(l.length, 1); assert.equal(l[0].cantidad, 2); assert.equal(l[0].puntos, 30); assert.match(l[0].aviso!, /revisar/);
  assert.equal(tap({ tapetas: 3 }).length, 1);
  assert.equal(tap({ tapetas: 0 }, { tapetas: true }).length, 0);
});
