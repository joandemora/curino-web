// Pruebas: presupuesto directo desde un plano. Ejecutar:
//   node --test supabase/functions/_shared/estudio/plano.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comprobarAncho, puntosMueble, puntosMuebleBase, partidaPlano, recorteGirado, colocarRecorte, cajaUnion, recalcularPlano, type MueblePlano } from './plano.ts';

const mueble = (): MueblePlano => ({
  nombre: 'Mueble comedor C', vistas: [{ nombre: 'Alzado', caja: { pagina: 1, x0: 0.06, y0: 0.02, x1: 0.64, y1: 0.5 } }],
  ancho: null, alto: 240, fondo: 40, medidas_seguras: true, cotas_ancho: [4, 100, 4, 150, 4, 100, 4],
  materiales: {}, revisar: [],
  cuerpos: [
    { nombre: 'Cuerpo izquierdo', ancho: 100, alto: 240, fondo: 40, seguro: true, elementos: [
      { tipo: 'puerta', cantidad: 2, apertura: 'abatible', arco: true, vitrina: true, seguro: true },
      { tipo: 'estante', cantidad: 3, grosor: 3, seguro: true },
      { tipo: 'puerta', cantidad: 2, apertura: 'abatible', push: true, seguro: true }
    ] }
  ]
});

test('ancho total: suma en cadena de las cotas del mueble; si no cuadra, «revisar»', () => {
  const m = mueble();
  assert.equal(comprobarAncho(m), null); assert.equal(m.ancho, 366);
  const m2 = { ...mueble(), ancho: 380 };
  assert.match(comprobarAncho(m2)!, /no coincide/);
});

test('estantes con cota de 3 cm = estante de 30 mm; puerta sin material = lisa lacada «supuesto»', () => {
  const pts = puntosMuebleBase();
  const c = puntosMueble(mueble(), pts).cuerpos[0];
  const est = c.lineas.find((l) => /Estante/.test(l.nombre))!;
  assert.match(est.nombre, /30 mm/); assert.equal(est.puntos, pts.estante30_1000);
  const puerta = c.lineas.find((l) => /Puerta lisa lacada/.test(l.nombre))!;
  assert.match(puerta.nombre, /\(supuesto\)/); assert.equal(puerta.puntos, pts.puerta_lisa_lacada); assert.match(puerta.aviso!, /supuesto/);
  // Vitrina en arco: concepto propio + suplemento de arco, «revisar»
  assert.ok(c.lineas.some((l) => /vitrina/.test(l.nombre) && l.puntos === 420 && /revisar/.test(l.aviso!)));
  assert.ok(c.lineas.some((l) => /arco/.test(l.nombre) && l.puntos === 150));
});

test('partida: total por cuerpo, avisos internos y recálculo con la tarifa', () => {
  const lectura = { aviso_plano: 'No se debe medir sobre plano.', escala: '1/20', muebles: [mueble()] };
  const p = partidaPlano({ mueble: mueble(), n: 1, lectura, puntos: puntosMuebleBase(), precioPunto: 2, dto: 0, plano: { fichero_id: '00000000-0000-0000-0000-000000000000', nombre: 'MC_C.pdf' } });
  assert.equal(p.tipo, 'plano');
  assert.match(p.tecnico, /^Medidas: 3660 x 2400 x 400 mm/);
  assert.ok(p.avisos!.some((a) => /^Medidas leídas del plano: 366 × 240 × 40 cm/.test(a)));
  assert.ok(p.avisos!.some((a) => /No se debe medir sobre plano/.test(a)));
  assert.match(p.materiales, /Exterior: puertas lisas lacadas \(supuesto\)/);
  assert.equal(p.puntos, p.cuerpos_puntos!.reduce((s, c) => s + c.puntos, 0));
  assert.equal(p.precio, p.puntos! * 2);
  // Recalcular con otra tarifa: mismo plano, otros puntos
  const r = recalcularPlano(p, { ...puntosMuebleBase(), mueble_puerta_vitrina: 500 }, 2, 1)!;
  assert.equal(r.puntos, p.puntos! + 2 * 80);
});

test('recorte: la caja vista se pasa a coordenadas sin girar y se dibuja derecha (0, 90, 180, 270)', () => {
  const c = { pagina: 1, x0: 0, y0: 0, x1: 0.5, y1: 0.3 };
  // Hoja de 842 × 1191 girada 270 (A3 apaisado guardado en vertical): la caja vista mide 0,5 × 1191 de ancho
  const r = recorteGirado(270, 842, 1191, c);
  assert.equal(Math.round(r.w), 596); assert.equal(Math.round(r.h), 253);
  assert.deepEqual(r.bb, { left: 842 * 0.7, right: 842, bottom: 1191 * 0.5, top: 1191 });
  const o = colocarRecorte(r, 10, 20, 1);
  assert.equal(o.angulo, -270); assert.equal(o.x, 10 + r.bh); assert.equal(o.y, 20);
  for (const rot of [0, 90, 180]) assert.ok(recorteGirado(rot, 600, 400, c).w > 0);
  assert.deepEqual(cajaUnion([c, { ...c, x0: 0.6, x1: 0.7 }], 0), { pagina: 1, x0: 0, y0: 0, x1: 0.7, y1: 0.3 });
});
