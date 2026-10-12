// supabase/functions/_shared/estudio/ia.test.ts
//
// Pruebas de ia.ts con la API simulada (sin llamadas reales).
//   node --test supabase/functions/_shared/estudio/ia.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirMensajes, costeUsd, pedirAClaude, HERRAMIENTAS, REINTENTOS } from './ia.ts';
import type { Proyecto } from './esquema.ts';

const ejemplo = (): Proyecto => JSON.parse(readFileSync(new URL('./ejemplos/a01-a03.json', import.meta.url), 'utf8'));
const usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 3000, cache_read_input_tokens: 0 };

function apiFalsa(respuestas: unknown[]) {
  const cuerpos: any[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    cuerpos.push(JSON.parse(String(init.body)));
    const r = respuestas.shift();
    return new Response(JSON.stringify(r), { status: (r as any)?.error ? 529 : 200 });
  }) as unknown as typeof fetch;
  return { f, cuerpos };
}
const herramienta = (name: string, input: unknown) => ({
  stop_reason: 'tool_use', usage,
  content: [{ type: 'tool_use', id: 'toolu_' + name, name, input }]
});

test('mensajes: historial alterno, adjuntos y proyecto actual', () => {
  const m = construirMensajes({
    historial: [
      { rol: 'asistente', texto: 'hola' },          // se descarta: el primero debe ser del alumno
      { rol: 'usuario', texto: 'armario de 200' },
      { rol: 'asistente', texto: '¿qué alto?' },
      { rol: 'usuario', texto: '250' }               // quedó sin respuesta: se une al nuevo turno
    ],
    adjuntos: [{ tipo: 'application/pdf', base64: 'JVBERi0=', nombre: 'plano.pdf' }],
    actual: { numero: 2, datos: ejemplo() },
    peticion: 'altillo de 40'
  });
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'user']);
  const ultimo = m[2].content as any[];
  assert.equal(ultimo[0].text, '250');
  assert.equal(ultimo[1].type, 'document');
  assert.match(ultimo[2].text, /Proyecto actual \(v2\)/);
  assert.match(ultimo[2].text, /altillo de 40$/);
});

test('respuesta válida a la primera', async () => {
  const { f, cuerpos } = apiFalsa([herramienta('guardar_proyecto', { mensaje: 'Hecho', proyecto: ejemplo() })]);
  const r = await pedirAClaude({ clave: 'k', modelo: 'claude-sonnet-5-5', mensajes: [{ role: 'user', content: 'x' }], fetch: f });
  assert.equal(r.resultado.tipo, 'proyecto');
  assert.equal(r.llamadas.length, 1);
  // prompt caching en sistema y herramientas; siempre responde con herramienta
  assert.equal(cuerpos[0].system[0].cache_control.type, 'ephemeral');
  assert.equal(cuerpos[0].tools.at(-1).cache_control.type, 'ephemeral');
  assert.deepEqual(cuerpos[0].tool_choice, { type: 'any' });
});

test('JSON no válido → se devuelven los errores y lo corrige', async () => {
  const malo = ejemplo();
  malo.armarios[1].cuerpos[0].modulos[0].ancho = 90;
  const { f, cuerpos } = apiFalsa([
    herramienta('guardar_proyecto', { mensaje: 'v1', proyecto: malo }),
    herramienta('guardar_proyecto', { mensaje: 'Corregido', proyecto: ejemplo() })
  ]);
  const r = await pedirAClaude({ clave: 'k', modelo: 'm', mensajes: [{ role: 'user', content: 'x' }], fetch: f });
  assert.equal(r.resultado.tipo, 'proyecto');
  assert.equal(r.llamadas.length, 2);
  const tr = cuerpos[1].messages.at(-1).content[0];
  assert.equal(tr.type, 'tool_result');
  assert.equal(tr.is_error, true);
  assert.match(tr.content, /los módulos suman 190 cm y el cuerpo mide 200 cm/);
});

test('se rinde tras los reintentos', async () => {
  const malo = { version: 1, armarios: [] };
  const { f } = apiFalsa(Array.from({ length: REINTENTOS + 1 }, () => herramienta('guardar_proyecto', { mensaje: '', proyecto: malo })));
  const r = await pedirAClaude({ clave: 'k', modelo: 'm', mensajes: [{ role: 'user', content: 'x' }], fetch: f });
  assert.equal(r.resultado.tipo, 'error');
  assert.equal(r.llamadas.length, REINTENTOS + 1);
});

test('pregunta cuando falta una medida', async () => {
  const { f } = apiFalsa([herramienta('preguntar', { mensaje: 'Me falta el alto.', preguntas: ['¿Qué alto tiene el armario?'] })]);
  const r = await pedirAClaude({ clave: 'k', modelo: 'm', mensajes: [{ role: 'user', content: 'x' }], fetch: f });
  assert.deepEqual(r.resultado, { tipo: 'pregunta', mensaje: 'Me falta el alto.', preguntas: ['¿Qué alto tiene el armario?'] });
});

test('error de la API', async () => {
  const { f } = apiFalsa([{ error: { type: 'overloaded_error' } }]);
  const r = await pedirAClaude({ clave: 'k', modelo: 'm', mensajes: [{ role: 'user', content: 'x' }], fetch: f });
  assert.equal(r.resultado.tipo, 'error');
  assert.match((r.resultado as any).mensaje, /overloaded_error/);
});

test('coste con los precios de claude-sonnet-5-5', () => {
  // 1000×2 + 500×10 + 3000×2,5 + 0 → 0,0145 USD
  assert.equal(Math.round(costeUsd(usage, { entrada: 2, salida: 10, cache_escritura: 2.5, cache_lectura: 0.1 }) * 1e6) / 1e6, 0.0145);
});

test('herramientas: el esquema del proyecto va en guardar_proyecto', () => {
  assert.equal(HERRAMIENTAS[0].name, 'guardar_proyecto');
  assert.ok((HERRAMIENTAS[0].input_schema.properties.proyecto as any).properties.armarios);
});
