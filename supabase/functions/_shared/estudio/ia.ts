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
import { avisosLargo, largoUtil, completarCocina, type ModuloCocina } from './cocina.ts';

export const REINTENTOS = 2;
export const MAX_TOKENS = 12000;
export const HISTORIAL_MAX = 12;

export const SISTEMA = `Eres el asistente técnico del Estudio Curino. Ayudas a alumnos de Curino Partners (diseñadores y vendedores de armarios a medida) a convertir planos, croquis, fotos y descripciones en la ficha técnica de sus armarios y cocinas. Con esa ficha un programa dibuja los alzados con el estilo Curino y otro calcula el presupuesto: tú no dibujas ni pones precios.

Responde SIEMPRE llamando a una herramienta:
- guardar_proyecto: cuando puedas dar el proyecto completo.
- preguntar: cuando falte una medida exterior, el plano sea ilegible o haya contradicciones. Haz preguntas concretas y cortas (máximo 6).

REGLAS DE MEDIDAS (cm)
- Nunca inventes medidas exteriores: ancho, alto y fondo de cada cuerpo tienen que salir del plano o del texto. Si falta alguna, pregunta. Si el plano da el hueco (p. ej. «hueco 241»), usa esa medida como ancho del armario salvo que digan otra cosa.
- Sí puedes proponer el diseño interior (módulos, zonas, cajones, altillo) y el reparto de puertas si no te lo dan: es diseño, no medida. Explica en el mensaje lo que has decidido tú.
- Constantes por defecto (no las preguntes): zócalo 10, tablero 1,9, puertas a 2 cm del suelo, cajón de 19,5 de alto, agarre «tirador».
- Los módulos suman exactamente el ancho del cuerpo; las puertas y frentes fijos del frente, también. Puertas entre 40 y 60 cm (habitual: 2 puertas por módulo). Módulos de 40 a 120 cm.
- Un cuerpo por cada pieza con distinto fondo o en otra pared (armario en L = cuerpo principal + lateral). Nómbralos solo si hay más de uno: «CUERPO PRINCIPAL», «LATERAL · fondo 40».
- colocacion de cada cuerpo (no en el primero, que es el principal): «linea» (por defecto: al lado del anterior, alineado por detrás, p. ej. 60 + 40 de fondo en la misma pared) o «esquina_izq» / «esquina_der» (lateral de un armario en L o U, en la pared de la izquierda / derecha del principal: arranca en su frente y va hacia la habitación). Dedúcela del plano o de «en L», «lateral a la derecha»…

INTERIOR DE CADA MÓDULO: zonas de arriba abajo; entre dos zonas hay siempre una balda.
- altillo: primera zona; «alto» es la cota desde arriba del cuerpo hasta debajo de su balda (40–50 habitual en armarios de más de 240 cm).
- perchero: barra de colgar. prendas «largas» para vestidos y abrigos. Dos percheros seguidos = colgar doble.
- perchero_extraible: barra extraíble frontal, para fondos menores de 50.
- cajonera: N cajones (alto por defecto 19,5 × N); suele ir abajo. «zapatero abierto» / «cajones abiertos» / «cajón interior» / «frente rebajado» → frente «abierto» (abierto «frente_bajo» = zapatero abierto, por defecto); «con escote» → frente «abierto» y abierto «escote». «Cajón sin tirador con hueco para la mano», «separación de 3 cm para abrir» o parecido → frente «hueco_mano» (hueco 3 por defecto; otra medida en «hueco»; sin agarre: va siempre sin tirador). Agarre de los cajones, independiente de las puertas: «sin tirador» / «push» → agarre «ninguno»; «uñero» → «unero». Tapetas laterales: detrás de puertas abatibles la cajonera lleva 3 cm a cada lado sin ponerlo; solo pon «tapetas» si piden otra medida o «sin tapetas» (0). Ponlo en el esquema (el dibujo lo muestra), no solo en las notas.
- estantes: N estantes repartidos en la zona. «grosor_estantes» en cm solo si no son de 1,9: «estantes de 30» / «balda gruesa de 3 cm» → 3; «de 25» → 2,5.
- grosor_balda_encima (cm): solo si la balda que separa esta zona de la de arriba es gruesa («balda de 30 sobre la cajonera» → en la cajonera, 3). Nunca en la primera zona.
- hueco: espacio libre (con «etiqueta» si hace falta, p. ej. «Estante»).
- balda_inferior: hueco abajo del todo (zapatos), última zona.
- «alto» de las demás zonas = alto libre del hueco. Deja SIN alto la zona que deba ocupar el resto (como mucho una o dos por módulo); pon alto solo cuando te lo indiquen o sea un estándar (p. ej. colgar doble: 95–100 arriba, el resto abajo).

FORMATO
- codigo A.01, A.02… en orden; titulo en mayúsculas tipo «ARMARIO A MEDIDA 200 cm» o «ARMARIO A MEDIDA EN L»; sin subtítulo ni formato (se generan solos).
- frente.acabado en singular, tal como lo escribe el alumno, con sus mayúsculas («lacada», «roble natural», «Blanco Soft III»); modelo «moldurada» o «lisa» (el de la mayoría de puertas).
- frente.apertura: «abatible» (bisagras), «corredera», «coplanar» (correderas enrasadas, «coplanares», «puertas coplanares») o «escamoteable» (puertas que se esconden en el lateral, «escamoteables»).
- frente.material (el de la mayoría de puertas): «lisa_melamina», «lisa_lacada», «moldurada_lacada», «chapa_madera» (madera natural barnizada: roble, nogal…), «textil» (bastidor tapizado, tela) o «ratan» (bastidor de madera con rejilla, «ratán», «rejilla»). Si una puerta es distinta, ponle «material» solo a esa.
- frente.agarre: «tirador» (por defecto), «tirador_premium» (latón u otro premium), «unero_dm» («uñero», «uñero fresado», «uñero lacado»), «unero_madera» («uñero de madera maciza») o «ninguno» (push o sin tirador). El uñero sustituye al tirador. Si una puerta es distinta, ponle «agarre» solo a esa.
- Si en un mismo frente hay puertas lisas y molduradas, pon el modelo general en el frente y «modelo» solo en las puertas que sean distintas.
- notas solo si aportan algo técnico (máx. una frase).
- vistas del armario: siempre salen «Interior» y «Cerrado». Añade «lateral» (sección) y/o «planta» en «vistas» solo cuando el alumno las pida («añade vista en planta», «quiero la sección»); quítalas si lo pide. Al hacer otros cambios, conserva las vistas que ya tenga.
- Solo existe lo que está en el esquema. Los tiradores los coloca el dibujo (por parejas, en las puertas que se juntan; «tirador» de una puerta solo para cambiar el lado). No prometas en el mensaje detalles que el esquema no recoge (colores, herrajes concretos, iluminación…): si el alumno los pide, dile que van en las notas o en el presupuesto.

COCINAS (proyecto.cocinas; si el proyecto es solo una cocina, armarios = [])
- Una cocina C.01 con tramos: uno por pared (el primero, la pared principal; «esquina_izq» / «esquina_der» para la otra pared de una cocina en L o U, como en armarios) y «isla» si hay isla. «Cocina en L, 3,20 + 2,10» = dos tramos.
- Medidas de módulos que da el alumno («bajos de 60, 80 y 90», «fregadero de 90»): se respetan EXACTAMENTE, una por una; no cambies un 80 por un 70 para cuadrar.
- «largo» de cada tramo = largo de su pared cuando lo dan («L 3,20 + 2,10» → 320 y 210). Los bajos de cada tramo suman EXACTAMENTE su largo útil: el largo en la pared principal; largo − 60 en un tramo en esquina (arranca delante de la principal, que llega hasta el rincón). Ej.: L 3,20 + 2,10 → bajos de la principal = 320 (el esquinero de 93 o el último bajo en el rincón) y bajos del tramo en esquina = 150.
- Si los módulos pedidos NO caben en las paredes (suman más que los largos útiles), no quites ninguno ni lo cambies por otros: usa «preguntar» y di cuánto sobra y qué opciones hay. Si el alumno da la lista de módulos, no añadas módulos que no ha pedido para rellenar: lo que falte de más de 10 cm se queda sin rellenar y se avisa.
- Si con los módulos pedidos sobra hueco: hasta 10 cm, regletas de ajuste (tipo «regleta», ancho ≤ 5) al principio y/o al final de la fila de bajos (y de altos si hace falta); más de 10 cm, NO lo rellenes con módulos inventados: deja la fila más corta y dilo en el mensaje. Los altos nunca suman más que su pared.
- En cada tramo, «bajos» de izquierda a derecha (bajo, fregadero, horno, esquinero —93 de ancho, en el rincón—, columna, columna_hm = horno + micro, hueco = sin mueble: nevera, lavavajillas, lavadora) y «altos» de izquierda a derecha alineados con los bajos (alto, esquinero_alto —63—, sobrenevera, transversal, hueco = campana, ventana o encima de una columna o de la nevera).
- Anchos de la tarifa: bajos y altos de 30 a 100 (30, 35, 40, 45, 50, 60, 70, 80, 90, 100), fregadero 60/80/90/100/120, horno y columnas 60. Los módulos que el alumno no ha medido los eliges tú con esos anchos para completar la pared.
- Medidas que no te den: NO preguntes; deja el campo sin poner y el programa usa los valores por defecto, marcados «supuesto» en la ficha: bajos de 70 de alto, altos de 70, columnas de 220, cuerpo Blanco 16, puerta grupo 1, encimera compacto núcleo negro, zócalo 10, cajones Advänced. Sí pregunta si no sabes el largo de las paredes.
- «altos de 90» → alto 90 en los altos; «bajos de 80» → alto 80.
- Cuerpo («acabado»): blanco16 (Blanco 16, por defecto), gris_plomo16 (Gris plomo), blanco_plus18 (Blanco Plus hidrófugo).
- Puertas: «grupo» de la tarifa del proveedor (1, 3, 6, 7, 13, 10 = 4 cantos, 12 y 14 = uñero). Uñero / fingerpull → agarre «unero» (con 12 o 14 ya es uñero) y no lleva tirador. Si los bajos llevan otro grupo que los altos («puertas grupo 6 con uñero grupo 12 en los bajos»), pon el grupo de la cocina y «grupo» en cada bajo.
- Frente de cada módulo: puertas (n), cajones (número y, si los dan, «alturas» de cada frente; sistema advanced o legrabox; «2 cajoneras Legrabox» = dos bajos con frente de cajones legrabox), aventos_hf (plegable) o aventos_hk (abatible) en altos, abierto.
- electro: placa (en el bajo de debajo), horno, microondas, fregadero, campana (en el hueco de los altos), nevera / lavavajillas / lavadora (en un hueco de bajos). «Fregadero bajo la ventana» = módulo fregadero con un hueco «VENTANA» encima en los altos.
- encimera: núcleo (negro, al_tono, blanco) y «ref» solo si dicen la referencia exacta. «laterales» del tramo: laterales vistos bajo / alto (piezas). Herrajes por código de la tarifa (porta-botellas 00817, cesto fregadero 00803–00805, cubos reciclaje 00800–00802…).
- vistas de la cocina: como en armarios («lateral», «planta») solo si las piden.

CAMBIOS
- Cuando ya hay un proyecto y el alumno pide un cambio («el módulo 2 con 4 cajones», «altillo de 40»), devuelve el proyecto COMPLETO con solo ese cambio; todo lo demás igual. Si el cambio rompe una suma (p. ej. un módulo más ancho), reajusta lo mínimo y dilo.
- Los módulos se cuentan de izquierda a derecha empezando en 1, y los armarios por su código.

MENSAJE
- En español, tuteando, breve (2–5 líneas). Di qué has entendido y lista tus supuestos. Sin saludos largos ni emojis.`;

export const HERRAMIENTAS = [
  {
    name: 'guardar_proyecto',
    description: 'Guarda el proyecto completo (todos los armarios y cocinas) como versión nueva.',
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
    name: 'confirmar',
    description: 'Solo en la revisión de una cocina: el proyecto que acabas de guardar cuadra con lo que pidió el alumno.',
    input_schema: { type: 'object', additionalProperties: false, properties: { nota: { type: 'string', description: 'Opcional: algo que añadir al mensaje.' } } }
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
  | { tipo: 'proyecto'; mensaje: string; proyecto: Proyecto; revision?: 'confirmado' | 'corregido' | 'sin_respuesta' }
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
  // Cocinas: una revisión del resultado frente a la descripción (y como mucho una corrección)
  let provisional: { mensaje: string; proyecto: Proyecto } | null = null;
  let maxIntentos = REINTENTOS;
  const final = (r: Resultado): Resultado => {
    if (r.tipo !== 'proyecto') return r;
    const avisos = avisosLargo(r.proyecto.cocinas);
    return avisos.length ? { ...r, mensaje: [r.mensaje, ...avisos.map((a) => `⚠ ${a}`)].join('\n') } : r;
  };

  for (let intento = 0; intento <= maxIntentos; intento++) {
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
    if (provisional && (!uso_herr || uso_herr.name !== 'guardar_proyecto')) {
      // Revisión: confirma (o no contesta con una corrección) → vale el guardado
      const nota = uso_herr?.name === 'confirmar' ? String(uso_herr.input.nota ?? '').trim() : '';
      return { resultado: final({ tipo: 'proyecto', mensaje: [provisional.mensaje, nota].filter(Boolean).join('\n'), proyecto: provisional.proyecto, revision: uso_herr?.name === 'confirmar' ? 'confirmado' : 'sin_respuesta' }), llamadas };
    }
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
    if (v.ok && provisional) return { resultado: final({ tipo: 'proyecto', mensaje: String(uso_herr.input.mensaje ?? ''), proyecto: v.proyecto, revision: 'corregido' }), llamadas };
    if (v.ok && v.proyecto.cocinas?.length) {
      // Cocina válida: antes de darla por buena, Claude la compara con lo que pidió el alumno
      provisional = { mensaje: String(uso_herr.input.mensaje ?? ''), proyecto: v.proyecto };
      maxIntentos = intento + 1;
      mensajes.push({ role: 'assistant', content: d.content });
      mensajes.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: uso_herr.id, content: textoRevision(v.proyecto) }] });
      continue;
    }
    if (v.ok) return { resultado: { tipo: 'proyecto', mensaje: String(uso_herr.input.mensaje ?? ''), proyecto: v.proyecto }, llamadas };
    if (provisional) return { resultado: final({ tipo: 'proyecto', mensaje: provisional.mensaje, proyecto: provisional.proyecto, revision: 'sin_respuesta' }), llamadas };

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
  if (provisional) return { resultado: final({ tipo: 'proyecto', mensaje: provisional.mensaje, proyecto: provisional.proyecto, revision: 'sin_respuesta' }), llamadas };
  return {
    resultado: { tipo: 'error', mensaje: 'La IA no ha conseguido un proyecto coherente. Revisa las medidas o dale más detalle.', errores: ultimosErrores },
    llamadas
  };
}

/** Resumen calculado de las cocinas para la revisión de Claude. */
export function textoRevision(p: Proyecto): string {
  const mod = (m: ModuloCocina) => `${m.tipo} ${m.ancho}${m.frente?.tipo === 'cajones' ? ` (${m.frente.cajones ?? m.frente.alturas?.length ?? 3} cajones ${m.frente.sistema ?? 'advanced'})` : ''}${m.electro?.length ? ` [${m.electro.join(', ')}]` : ''}${m.etiqueta ? ` «${m.etiqueta}»` : ''}${m.grupo ? ` G${m.grupo}` : ''}`;
  const lineas: string[] = [];
  for (const c0 of p.cocinas ?? []) {
    const c = completarCocina(c0);
    lineas.push(`${c.codigo} «${c.titulo}» · cuerpo ${c.acabado} · grupo ${c.grupo} · agarre ${c.agarre} · encimera ${c.encimera?.nucleo ?? '—'} (${c.encimera?.ref ?? '—'})`);
    c.tramos.forEach((t, i) => {
      const util = largoUtil(t), sb = t.bajos.reduce((s, m) => s + m.ancho, 0), sa = (t.altos ?? []).reduce((s, m) => s + m.ancho, 0);
      lineas.push(`- ${t.nombre ?? `tramo ${i + 1}`} (${t.colocacion ?? 'linea'}${t.largo ? `, pared ${t.largo} → bajos deben sumar ${util}` : ', sin largo de pared'}):`);
      lineas.push(`  bajos: ${t.bajos.map(mod).join(' · ')} = ${sb}`);
      if (t.altos?.length) lineas.push(`  altos: ${t.altos.map(mod).join(' · ')} = ${sa}`);
    });
  }
  return 'Guardado provisional. Antes de darlo por bueno, compáralo punto por punto con el mensaje del alumno: medidas de módulos que dio (exactas), número de módulos, cajoneras y su sistema, largo de cada pared, grupos y uñero, electrodomésticos y encimera. Resumen calculado:\n' +
    lineas.join('\n') +
    '\n\nSi algo no cuadra, llama UNA vez a guardar_proyecto con el proyecto completo corregido. Si está todo bien, llama a confirmar.';
}

// ── Textos del presupuesto (F3) ─────────────────────────────────────
// Claude solo redacta subtítulo e introducción de cada partida; las líneas
// técnicas (medidas, módulos) salen del JSON y no se tocan.
export const SISTEMA_TEXTOS = `Redactas los textos comerciales de las partidas de un presupuesto de armarios a medida (Curino Partners). Para cada partida devuelves:
- subtitulo: una frase de máximo 90 caracteres del estilo «Armario a medida de 200 cm con puertas molduradas lacadas» o «Armario en L a medida con puertas molduradas lacadas».
- intro: 1 o 2 frases (máximo 300 caracteres) que describan el conjunto para el cliente final, con tono sobrio y profesional. Puede quedar vacía si no aporta.
Reglas: español de España; no inventes medidas, materiales, marcas ni prestaciones que no estén en la ficha; las medidas, si las citas, en cm y exactamente como en la ficha. Responde SIEMPRE con la herramienta redactar_textos.`;

const HERRAMIENTA_TEXTOS = {
  name: 'redactar_textos',
  description: 'Devuelve subtítulo e introducción de cada partida.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['partidas'],
    properties: {
      partidas: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['codigo', 'subtitulo', 'intro'],
          properties: { codigo: { type: 'string' }, subtitulo: { type: 'string', maxLength: 120 }, intro: { type: 'string', maxLength: 400 } }
        }
      }
    }
  },
  cache_control: { type: 'ephemeral' }
};

export async function redactarTextos(o: {
  clave: string; modelo: string; proyecto: Proyecto;
  partidas: { codigo: string; titulo: string; tecnico: string; materiales: string }[];
  fetch?: typeof fetch;
}): Promise<{ textos: { codigo: string; subtitulo: string; intro: string }[] | null; llamadas: Llamada[]; error?: string }> {
  const f = o.fetch ?? fetch;
  const ficha = o.partidas.map((p) => `### ${p.codigo} · ${p.titulo}\n${p.tecnico}\n${p.materiales}`).join('\n\n');
  const r = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': o.clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: o.modelo, max_tokens: 4000,
      system: [{ type: 'text', text: SISTEMA_TEXTOS, cache_control: { type: 'ephemeral' } }],
      tools: [HERRAMIENTA_TEXTOS],
      messages: [{ role: 'user', content: `Ficha técnica de las partidas:\n\n${ficha}\n\nProyecto (JSON):\n${JSON.stringify(o.proyecto)}` }]
    })
  });
  const d = await r.json().catch(() => ({}));
  const uso: Uso = {
    input_tokens: d?.usage?.input_tokens ?? 0, output_tokens: d?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: d?.usage?.cache_creation_input_tokens ?? 0, cache_read_input_tokens: d?.usage?.cache_read_input_tokens ?? 0
  };
  const llamadas = [{ uso, ok: r.ok }];
  if (!r.ok) return { textos: null, llamadas, error: d?.error?.type ?? `http_${r.status}` };
  const b = (d.content ?? []).find((x: Bloque) => x.type === 'tool_use') as { input?: { partidas?: unknown } } | undefined;
  const lista = Array.isArray(b?.input?.partidas) ? b!.input!.partidas as Record<string, unknown>[] : null;
  if (!lista) return { textos: null, llamadas, error: 'sin_textos' };
  const codigos = new Set(o.partidas.map((p) => p.codigo));
  return {
    llamadas,
    textos: lista
      .filter((x) => codigos.has(String(x.codigo)))
      .map((x) => ({ codigo: String(x.codigo), subtitulo: String(x.subtitulo ?? '').slice(0, 120), intro: String(x.intro ?? '').slice(0, 400) }))
  };
}

// ── Leer una factura o presupuesto de proveedor (ficha del proyecto) ─
const HERRAMIENTA_FACTURA = {
  name: 'datos_factura',
  description: 'Devuelve los datos leídos del documento. Usa null en lo que no se vea con claridad; no inventes.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['tipo', 'proveedor', 'fecha', 'base', 'iva', 'total'],
    properties: {
      tipo: { enum: ['factura_proveedor', 'presupuesto_proveedor', 'factura_cliente', 'foto_obra', 'otro'] },
      proveedor: { type: ['string', 'null'], description: 'Emisor del documento (empresa o persona).' },
      fecha: { type: ['string', 'null'], description: 'Fecha del documento en formato AAAA-MM-DD.' },
      base: { type: ['number', 'null'], description: 'Base imponible en euros.' },
      iva: { type: ['number', 'null'], description: 'Cuota de IVA en euros.' },
      total: { type: ['number', 'null'], description: 'Total en euros, IVA incluido.' }
    }
  }
};

export async function leerFactura(o: { clave: string; modelo: string; adjunto: Adjunto; paginas?: Adjunto[]; fetch?: typeof fetch }):
  Promise<{ datos: Record<string, unknown> | null; llamadas: Llamada[]; error?: string }> {
  const f = o.fetch ?? fetch;
  const aBloque = (a: Adjunto) => a.tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: a.tipo, data: a.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.base64 } };
  // Varias páginas (imágenes) de un mismo documento: todas en un único mensaje
  const bloques = (o.paginas?.length ? o.paginas : [o.adjunto]).map(aBloque);
  const pista = o.paginas?.length ? ` Son las ${o.paginas.length} páginas de un mismo documento. Si es una hoja de costes de un proveedor, el importe es el total del coste (base sin IVA).` : '';
  const r = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': o.clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: o.modelo, max_tokens: 600,
      system: 'Lees facturas, presupuestos y tickets de un taller de carpintería en España. Extrae emisor, fecha e importes en euros. Responde siempre con la herramienta datos_factura.',
      tools: [HERRAMIENTA_FACTURA],
      messages: [{ role: 'user', content: [...bloques, { type: 'text', text: `Archivo: ${o.adjunto.nombre}. Extrae los datos.${pista}` }] }]
    })
  });
  const d = await r.json().catch(() => ({}));
  const uso: Uso = {
    input_tokens: d?.usage?.input_tokens ?? 0, output_tokens: d?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: d?.usage?.cache_creation_input_tokens ?? 0, cache_read_input_tokens: d?.usage?.cache_read_input_tokens ?? 0
  };
  const llamadas = [{ uso, ok: r.ok }];
  if (!r.ok) return { datos: null, llamadas, error: d?.error?.type ?? `http_${r.status}` };
  const b = (d.content ?? []).find((x: Bloque) => x.type === 'tool_use') as { input?: Record<string, unknown> } | undefined;
  return { datos: b?.input ?? null, llamadas, error: b ? undefined : 'sin_datos' };
}

// ── Proponer partidas de presupuesto desde documentos (plano, croquis, presupuesto de proveedor…) ──
const HERRAMIENTA_PARTIDAS = {
  name: 'proponer_partidas',
  description: 'Partidas del presupuesto de carpintería a medida que se deducen de los documentos.',
  input_schema: {
    type: 'object',
    properties: {
      partidas: {
        type: 'array', maxItems: 30,
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'Nombre corto en mayúsculas: «ARMARIO DORMITORIO PRINCIPAL», «MUEBLE TV»…' },
            descripcion: { type: 'string', description: 'Medidas (mm), distribución, puertas, acabados y materiales que se ven en los documentos. Sin inventar.' },
            cantidad: { type: 'integer', minimum: 1 },
            precio_unitario: { type: ['number', 'null'], description: 'PVP sin IVA si aparece en los documentos; si no, null.' }
          },
          required: ['titulo', 'descripcion', 'cantidad', 'precio_unitario']
        }
      },
      nota: { type: 'string', description: 'Dudas o datos que faltan (opcional).' }
    },
    required: ['partidas']
  }
};

export async function proponerPartidas(o: { clave: string; modelo: string; adjuntos: Adjunto[]; fetch?: typeof fetch }):
  Promise<{ partidas: { titulo: string; descripcion: string; cantidad: number; precio_unitario: number | null }[] | null; nota?: string; llamadas: Llamada[]; error?: string }> {
  const f = o.fetch ?? fetch;
  const bloques = o.adjuntos.map((a) => a.tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: a.tipo, data: a.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.base64 } });
  const r = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': o.clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: o.modelo, max_tokens: 4000,
      system: 'Eres técnico de presupuestos de un taller de carpintería a medida en España (armarios, vestidores, cocinas, muebles). A partir de los documentos (planos, croquis, presupuestos de proveedor u otros presupuestos) propones las partidas del presupuesto: una por mueble o trabajo. Usa solo lo que se ve; si un precio no aparece, precio_unitario = null. Responde siempre con la herramienta proponer_partidas.',
      tools: [HERRAMIENTA_PARTIDAS], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [...bloques, { type: 'text', text: `Documentos: ${o.adjuntos.map((a) => a.nombre).join(', ')}. Propón las partidas del presupuesto.` }] }]
    })
  });
  const d = await r.json().catch(() => ({}));
  const uso: Uso = {
    input_tokens: d?.usage?.input_tokens ?? 0, output_tokens: d?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: d?.usage?.cache_creation_input_tokens ?? 0, cache_read_input_tokens: d?.usage?.cache_read_input_tokens ?? 0
  };
  const llamadas = [{ uso, ok: r.ok }];
  if (!r.ok) return { partidas: null, llamadas, error: d?.error?.type ?? `http_${r.status}` };
  const b = (d.content ?? []).find((x: Bloque) => x.type === 'tool_use') as { input?: { partidas?: unknown[]; nota?: string } } | undefined;
  const lista = Array.isArray(b?.input?.partidas) ? b!.input!.partidas as { titulo: string; descripcion: string; cantidad: number; precio_unitario: number | null }[] : null;
  return { partidas: lista, nota: b?.input?.nota, llamadas, error: lista ? undefined : 'sin_datos' };
}
