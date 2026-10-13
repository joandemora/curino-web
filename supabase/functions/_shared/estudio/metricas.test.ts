// supabase/functions/_shared/estudio/metricas.test.ts
//   node --test supabase/functions/_shared/estudio/metricas.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cobrosPorDefecto, metricasProyecto } from './metricas.ts';

const fp = [{ concepto: 'CONFIRMACIÓN PRESUPUESTO', pct: 50 }, { concepto: 'ENTREGA MATERIALES', pct: 40 }, { concepto: 'FINAL DE OBRA', pct: 10 }];

test('cobros por defecto: 50/40/10 sobre el total con IVA, al aceptar, +30 y +60 días', () => {
  const c = cobrosPorDefecto(fp, 1210, '2026-10-13');
  assert.deepEqual(c.map((x) => [x.importe, x.fecha_prevista]), [[605, '2026-10-13'], [484, '2026-11-12'], [121, '2026-12-12']]);
  // el último absorbe el redondeo
  const d = cobrosPorDefecto([{ concepto: 'A', pct: 33.33 }, { concepto: 'B', pct: 33.33 }, { concepto: 'C', pct: 33.34 }], 100, '2026-10-13');
  assert.equal(d.reduce((s, x) => s + x.importe, 0), 100);
});

test('facturación: presupuesto aceptado; las facturas a cliente solo si lo superan (ampliaciones)', () => {
  const base = { presupuesto: { estado: 'aceptado', importe: 10000, aceptado_at: '2026-10-01' }, costes: [], cobros: [], hoy: '2026-10-13' };
  assert.equal(metricasProyecto({ ...base, ficheros: [] }).facturacion, 10000);
  // Facturas por debajo del presupuesto (pagos a cuenta): manda el presupuesto
  const parcial = metricasProyecto({ ...base, ficheros: [{ tipo: 'factura_cliente', base: 3000, total: 3630, fecha: '2026-10-10' }] });
  assert.equal(parcial.facturacion, 10000);
  assert.equal(parcial.origen_facturacion, 'presupuesto');
  assert.equal(parcial.cobros.cobrado, 3630);
  const m = metricasProyecto({ ...base, ficheros: [{ tipo: 'factura_cliente', base: 6000, total: 7260, fecha: '2026-10-10' }, { tipo: 'factura_cliente', base: 4500, total: 5445, fecha: '2026-10-12' }] });
  assert.equal(m.facturacion, 10500);
  assert.equal(m.origen_facturacion, 'facturas');
});

test('costes, margen y aviso por debajo del 30 %', () => {
  const m = metricasProyecto({
    presupuesto: { estado: 'aceptado', importe: 10000, aceptado_at: '2026-10-01' },
    ficheros: [{ tipo: 'factura_proveedor', base: 5000, total: 6050, fecha: '2026-10-05', proveedor: 'Tableros SL' }],
    costes: [{ categoria: 'mano_obra', importe: 2500, fecha: '2026-10-08' }, { categoria: 'transporte', importe: 300, fecha: null }],
    cobros: [], hoy: '2026-10-13'
  });
  assert.equal(m.costes, 7800);
  assert.equal(m.margen, 2200);
  assert.equal(m.margen_pct, 22);
  assert.match(m.avisos.join(' '), /por debajo del 30 %/);
  assert.deepEqual(m.costes_por_categoria.map((c) => c.categoria), ['proveedores', 'mano_obra', 'transporte']);
});

test('sin costes el margen es null (no 100 %)', () => {
  const m = metricasProyecto({ presupuesto: { estado: 'aceptado', importe: 5000, aceptado_at: '2026-10-01' }, ficheros: [], costes: [], cobros: [], hoy: '2026-10-13' });
  assert.equal(m.margen, null);
  assert.equal(m.margen_pct, null);
});

test('cobros: cobrado, pendiente y vencidos', () => {
  const cobros = cobrosPorDefecto(fp, 1210, '2026-09-01');
  cobros[0].cobrado = true; cobros[0].fecha_cobro = '2026-09-02';
  const m = metricasProyecto({ presupuesto: { estado: 'aceptado', importe: 1000, aceptado_at: '2026-09-01' }, ficheros: [], costes: [], cobros, hoy: '2026-10-13' });
  assert.equal(m.cobros.cobrado, 605);
  assert.equal(m.cobros.pendiente, 605);
  assert.equal(m.cobros.vencidos.length, 1);           // el 40 % (1 oct) vencido; el 10 % (31 oct) no
  assert.match(m.avisos.join(' '), /1 cobro vencido/);
});

test('las facturas a cliente cubren plazos: no vencen y cuentan como cobrado', () => {
  const cobros = cobrosPorDefecto(fp, 1210, '2026-08-01');   // 605 / 484 / 121
  const m = metricasProyecto({
    presupuesto: { estado: 'aceptado', importe: 1000, aceptado_at: '2026-08-01' }, costes: [], cobros, hoy: '2026-10-13',
    ficheros: [{ tipo: 'factura_cliente', base: 900, total: 1089, fecha: '2026-09-01' }]
  });
  assert.equal(m.cobros.cobrado, 1089);
  assert.equal(m.cobros.pendiente, 121);
  assert.equal(m.cobros.vencidos.length, 1);           // solo el 10 % no está cubierto
  assert.equal(m.facturacion, 1000);
});
