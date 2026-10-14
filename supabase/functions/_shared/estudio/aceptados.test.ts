// supabase/functions/_shared/estudio/aceptados.test.ts
//   node --test supabase/functions/_shared/estudio/aceptados.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevantes, agregado, partirNumero, siguienteLetra, numeroEnProyecto, incrementarSerie } from './aceptados.ts';

test('numeración: letras A…Z, AA, AB…; formatos del histórico', () => {
  assert.equal(siguienteLetra([]), 'A');
  assert.equal(siguienteLetra(['A', 'C']), 'D');
  assert.equal(siguienteLetra(['Z']), 'AA');
  assert.equal(siguienteLetra(['AA']), 'AB');
  assert.equal(siguienteLetra(['AZ']), 'BA');
  assert.deepEqual(partirNumero('Z2606941-B'), { base: 'Z2606941', letra: 'B' });
  assert.deepEqual(partirNumero('Z2606941'), { base: 'Z2606941', letra: 'A' });
  assert.deepEqual(partirNumero('Z2606922D'), { base: 'Z2606922', letra: 'D' });
  assert.deepEqual(partirNumero('Z2506954 PAGO A CUENTA'), { base: 'Z2506954', letra: 'A' });
  assert.deepEqual(partirNumero('Z2506953-1'), { base: 'Z2506953', letra: 'A' });
  assert.deepEqual(partirNumero('PRUEBA-V2-B'), { base: 'PRUEBA-V2', letra: 'B' });
  assert.equal(numeroEnProyecto([], 'Z2606964').numero, 'Z2606964-A');
  assert.equal(numeroEnProyecto(['Z2606941'], 'Z2606964').numero, 'Z2606941-B');
  assert.equal(numeroEnProyecto(['Z2606939-F'], 'X').numero, 'Z2606939-G');
  assert.equal(numeroEnProyecto(['Z2606962', 'Z2606963'], 'X').numero, 'Z2606962-B');
  assert.equal(numeroEnProyecto(['Z2606922D'], 'X').numero, 'Z2606922-E');
  assert.equal(incrementarSerie('Z2606964'), 'Z2606965');
  assert.equal(incrementarSerie('Z0099'), 'Z0100');
});

test('varios aceptados: se suman; sin aceptados, el último (como la vista de antes)', () => {
  const ps = [
    { proyecto_id: 'p1', estado: 'aceptado', importe: 1000, comision_importe: 100, aceptado_at: '2026-02-01', updated_at: '2026-02-01' },
    { proyecto_id: 'p1', estado: 'aceptado', importe: 500, comision_importe: null, aceptado_at: '2026-01-15', updated_at: '2026-03-01' },
    { proyecto_id: 'p1', estado: 'enviado', importe: 900, updated_at: '2026-04-01' },
    { proyecto_id: 'p2', estado: 'rechazado', importe: 300, updated_at: '2026-01-01' },
    { proyecto_id: 'p2', estado: 'enviado', importe: 400, updated_at: '2026-02-01' }
  ];
  const r = relevantes(ps);
  assert.deepEqual(r.map((x) => [x.proyecto_id, x.importe]), [['p1', 1000], ['p1', 500], ['p2', 400]]);
  const a = agregado(ps.filter((x) => x.proyecto_id === 'p1'));
  assert.deepEqual([a.estado, a.importe, a.comision_importe, a.aceptado_at, a.aceptados], ['aceptado', 1500, 100, '2026-01-15', 2]);
  assert.equal(agregado(ps.filter((x) => x.proyecto_id === 'p2')).importe, 400);
  // Un solo aceptado: el mismo objeto (métricas idénticas a las de antes)
  const uno = [ps[0], ps[2]];
  assert.equal(agregado(uno), ps[0]);
});
