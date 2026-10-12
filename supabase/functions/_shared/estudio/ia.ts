// supabase/functions/_shared/estudio/ia.ts
//
// Estudio Curino · F2: Claude convierte plano/croquis/descripción en el JSON
// del proyecto (esquema.ts) y aplica los cambios que pide el alumno en el
// chat. Claude no dibuja ni calcula precios: solo rellena el esquema.
//
// Dos herramientas (tool_choice automático: claude-sonnet-5-5 no admite
// forzarlas; el prompt exige usar una y, si contesta solo con texto, se le
// recuerda y al final ese texto se trata como pregunta):
//   - guardar_proyecto { mensaje, proyecto } → proyecto completo validado.
//   - preguntar { mensaje, preguntas[] }     → falta una medida o hay dudas.
// Si el JSON no pasa validarProyecto(), se le devuelven los errores como
// tool_result y lo corrige (máx. REINTENTOS). Prompt de sistema y
// herramientas con prompt caching (cache_control en el último bloque).
//
// Sin dependencias de Deno: la Edge Function pasa la clave y fetch.

import { ESQUEMA_JSON, validarProyecto, type Proyecto, type ErrorValidacion } from './esquema.ts';

export const REINTENTOS = 2;
export const MAX_TOKENS = 12000;
export const HISTORIAL_MAX = 12;

export const SISTEMA = `Eres el asistente técnico del Estudio Curino. Ayudas a alumnos de Curino Partners (diseñadores y vendedores de armarios a medida) a convertir planos, croquis, fotos y descripciones en la ficha técnica de sus armarios. Con esa ficha un programa dibuja los alzados con el estilo Curino y otro calcula el presupuesto: tú no dibujas ni pones precios.

Responde SIEMPRE llamando a una herramienta:
- guardar_proyecto: cuando puedas dar el proyecto completo.
- preguntar: cuando falte una medida exterior, el plano sea ilegible o haya contradicciones. Haz preguntas concretas y cortas (máximo 6).

REGLAS DE MEDIDAS (cm)
- Nunca inventes medidas exteriores: ancho, alto y fondo de cada cuerpo tienen que salir del plano o del texto. Si falta alguna, pregunta. Si el plano da el hueco (p. ej. «hueco 241»), usa esa medida como ancho del armario salvo que digan otra cosa.
- Sí puedes proponer el diseño interior (módulos, zonas, cajones, altillo) y el reparto de puertas si no te lo dan: es diseño, no medida. Explica en el mensaje lo que has decidido tú.
- Constantes por defecto (no las preguntes): zócalo 10, tablero 1,9, puertas a 2 cm del suelo, cajón de 19,5 de alto, tirador de latón.
- Los módulos suman exactamente el ancho del cuerpo; las puertas y frentes fijos del frente, también. Puertas entre 40 y 60 cm (habitual: 2 puertas por módulo). Módulos de 40 a 120 cm.
- Un cuerpo por cada pieza con distinto fondo o en otra pared (armario en L = cuerpo principal + lateral). Nómbralos solo si hay más de uno: «CUERPO PRINCIPAL», «LATERAL · fondo 40».

INTERIOR DE CADA MÓDULO: zonas de arriba abajo; entre dos zonas hay siempre una balda.
- altillo: primera zona; «alto» es la cota desde arriba del cuerpo hasta debajo de su balda (40–50 habitual en armarios de más de 240 cm).
- perchero: barra de colgar. prendas «largas» para vestidos y abrigos. Dos percheros seguidos = colgar doble.
- perchero_extraible: barra extraíble frontal, para fondos menores de 50.
- cajonera: N cajones (alto por defecto 19,5 × N); suele ir abajo.
- estantes: N estantes repartidos en la zona.
- hueco: espacio libre (con «etiqueta» si hace falta, p. ej. «Estante»).
- balda_inferior: hueco abajo del todo (zapatos), última zona.
- «alto» de las demás zonas = alto libre del hueco. Deja SIN alto la zona que deba ocupar el resto (como mucho una o dos por módulo); pon alto solo cuando te lo indiquen o sea un estándar (p. ej. colgar doble: 95–100 arriba, el resto abajo).

FORMATO
- codigo A.01, A.02… en orden; titulo en mayúsculas tipo «ARMARIO A MEDIDA 200 cm» o «ARMARIO A MEDIDA EN L»; sin subtítulo ni formato (se generan solos).
- frente.acabado en singular y minúsculas («lacada», «roble natural»); modelo «moldurada» o «lisa»; apertura «abatible» o «corredera».
- notas solo si aportan algo técnico (máx. una frase).
- Solo existe lo que está en el esquema. Los tiradores los coloca el dibujo (por parejas, en las puertas que se juntan; «tirador» de una puerta solo para cambiar el lado). No prometas en el mensaje detalles que el esquema no recoge (colores, herrajes concretos, iluminación…): si el alumno los pide, dile que van en las notas o en el presupuesto.

CAMBIOS
- Cuando ya hay un proyecto y el alumno pide un cambio («el módulo 2 con 4 cajones», «altillo de 40»), devuelve el proyecto COMPLETO con solo ese cambio; todo lo demás igual. Si el cambio rompe una suma (p. ej. un módulo más ancho), reajusta lo mínimo y dilo.
- Los módulos se cuentan de izquierda a derecha empezando en 1, y los armarios por su código.

MENSAJE
- En español, tuteando, breve (2–5 líneas). Di qué has entendido y lista tus supuestos. Sin saludos largos ni emojis.`;

export const HERRAMIENTAS = [
  {
    name: 'guardar_proyecto',
    description: 'Guarda el proyecto completo (todos los armarios) como versión nueva.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mensaje', 'proyecto'],
      properties: {
        mensaje: { type: 'string', description: 'Respuesta al alumno: lo entendido y los supuestos.' },
        proyecto: ESQUEMA_JSON
      }
    }
  },
  {
    name: 'preguntar',
    description: 'Pregunta al alumno lo que falta antes de proponer o cambiar el proyecto.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mensaje', 'preguntas'],
      properties: {
        mensaje: { type: 'string', description: 'Breve contexto de por qué preguntas.' },
        preguntas: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } }
      }
    },
    cache_control: { type: 'ephemeral' }
  }
];

// ── Mensajes ────────────────────────────────────────────────────────
export interface Adjunto { tipo: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'; base64: string; nombre: string }
export interface MensajeChat { rol: 'usuario' | 'asistente'; texto: string }
type Bloque = Record<string, unknown>;
export interface MensajeApi { role: 'user' | 'assistant'; content: string | Bloque[] }

export function construirMensajes(o: {
  historial: MensajeChat[];
  adjuntos: Adjunto[];
  actual: { numero: number; datos: Proyecto } | null;
  peticion: string;
}): MensajeApi[] {
  const turnos: { role: 'user' | 'assistant'; texto: string }[] = [];
  for (const m of o.historial.slice(-HISTORIAL_MAX)) {
    const role = m.rol === 'usuario' ? 'user' : 'assistant';
    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.role === role) ultimo.texto += '\n\n' + m.texto;
    else turnos.push({ role, texto: m.texto });
  }
  while (turnos.length && turnos[0].role === 'assistant') turnos.shift();

  const contexto = o.actual
    ? `Proyecto actual (v${o.actual.numero}):\n\`\`\`json\n${JSON.stringify(o.actual.datos)}\n\`\`\``
    : 'Todavía no hay proyecto: propón el primero con lo que te paso (o pregunta lo que falte).';
  const bloques: Bloque[] = o.adjuntos.map((a) => a.tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: a.tipo, data: a.base64 }, title: a.nombre }
    : { type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.base64 } });
  bloques.push({ type: 'text', text: `${contexto}\n\nMensaje del alumno:\n${o.peticion.trim() || '(sin texto: usa los archivos adjuntos)'}` });

  const ultimo = turnos[turnos.length - 1];
  const previos: MensajeApi[] = turnos.map((t) => ({ role: t.role, content: t.texto }));
  if (ultimo && ultimo.role === 'user') {
    // El último turno del alumno quedó sin respuesta (p. ej. un error): se une al nuevo.
    previos.pop();
    bloques.unshift({ type: 'text', text: ultimo.texto });
  }
  return [...previos, { role: 'user', content: bloques }];
}

// ── Coste ───────────────────────────────────────────────────────────
export interface Uso { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }
export interface Precios { entrada: number; salida: number; cache_escritura: number; cache_lectura: number } // USD / millón

export function costeUsd(u: Uso, p: Precios): number {
  return (u.input_tokens * p.entrada + u.output_tokens * p.salida + u.cache_creation_input_tokens * p.cache_escritura + u.cache_read_input_tokens * p.cache_lectura) / 1e6;
}

// ── Llamada con validación ──────────────────────────────────────────
export type Resultado =
  | { tipo: 'proyecto'; mensaje: string; proyecto: Proyecto }
  | { tipo: 'pregunta'; mensaje: string; preguntas: string[] }
  | { tipo: 'error'; mensaje: string; errores?: ErrorValidacion[]; detalle?: string };

export interface Llamada { uso: Uso; ok: boolean }

export async function pedirAClaude(o: {
  clave: string;
  modelo: string;
  mensajes: MensajeApi[];
  fetch?: typeof fetch;
}): Promise<{ resultado: Resultado; llamadas: Llamada[] }> {
  const f = o.fetch ?? fetch;
  const mensajes = [...o.mensajes];
  const llamadas: Llamada[] = [];
  let ultimosErrores: ErrorValidacion[] | undefined;

  for (let intento = 0; intento <= REINTENTOS; intento++) {
    const r = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': o.clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: o.modelo,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
        tools: HERRAMIENTAS,
        messages: mensajes
      })
    });
    const d = await r.json().catch(() => ({}));
    const uso: Uso = {
      input_tokens: d?.usage?.input_tokens ?? 0,
      output_tokens: d?.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: d?.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: d?.usage?.cache_read_input_tokens ?? 0
    };
    llamadas.push({ uso, ok: r.ok });
    if (!r.ok) {
      const tipo = d?.error?.type ?? `http_${r.status}`;
      return { resultado: { tipo: 'error', mensaje: `La IA no ha podido responder (${tipo}). Inténtalo de nuevo en un momento.`, detalle: String(d?.error?.message ?? '').slice(0, 500) }, llamadas };
    }
    if (d.stop_reason === 'max_tokens') {
      return { resultado: { tipo: 'error', mensaje: 'El proyecto es demasiado grande para una sola respuesta. Divide la petición (por ejemplo, armario a armario).' }, llamadas };
    }
    const uso_herr = (d.content ?? []).find((b: Bloque) => b.type === 'tool_use') as { id: string; name: string; input: Record<string, unknown> } | undefined;
    if (!uso_herr) {
      const texto = (d.content ?? []).filter((b: Bloque) => b.type === 'text').map((b: Bloque) => String(b.text)).join('\n').trim();
      if (intento < REINTENTOS && d.content?.length) {
        mensajes.push({ role: 'assistant', content: d.content });
        mensajes.push({ role: 'user', content: 'Responde llamando a guardar_proyecto (proyecto completo) o a preguntar.' });
        continue;
      }
      if (texto) return { resultado: { tipo: 'pregunta', mensaje: texto, preguntas: [] }, llamadas };
      return { resultado: { tipo: 'error', mensaje: 'La IA no ha devuelto un proyecto. Vuelve a intentarlo.' }, llamadas };
    }

    if (uso_herr.name === 'preguntar') {
      const preguntas = Array.isArray(uso_herr.input.preguntas) ? (uso_herr.input.preguntas as unknown[]).map(String).slice(0, 6) : [];
      return { resultado: { tipo: 'pregunta', mensaje: String(uso_herr.input.mensaje ?? ''), preguntas }, llamadas };
    }
    const v = validarProyecto(uso_herr.input.proyecto);
    if (v.ok) return { resultado: { tipo: 'proyecto', mensaje: String(uso_herr.input.mensaje ?? ''), proyecto: v.proyecto }, llamadas };

    // JSON no válido: se le devuelven los errores para que lo corrija.
    ultimosErrores = v.errores;
    mensajes.push({ role: 'assistant', content: d.content });
    mensajes.push({
      role: 'user',
      content: [{
        type: 'tool_result', tool_use_id: uso_herr.id, is_error: true,
        content: 'El proyecto no es válido. Corrige estos puntos y vuelve a llamar a guardar_proyecto con el proyecto completo (o pregunta si te falta un dato):\n' +
          v.errores.slice(0, 30).map((e) => `- ${e.ruta}: ${e.mensaje}`).join('\n')
      }]
    });
  }
  return {
    resultado: { tipo: 'error', mensaje: 'La IA no ha conseguido un proyecto coherente. Revisa las medidas o dale más detalle.', errores: ultimosErrores },
    llamadas
  };
}
