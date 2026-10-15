// supabase/functions/estudio-ia/index.ts
//
// Estudio Curino · API del estudio (F2, 2026-10). La clave ANTHROPIC_API_KEY
// solo vive aquí; el navegador nunca ve la clave ni el prompt de sistema.
//
// Acceso (F4): admin y alumnos activos (acceso.ts: compra sin reembolso del
// Intensivo u One-to-one, curso + 6 meses, ampliable o cortable desde el
// admin; mientras el Estudio no esté abierto, solo accesos concedidos).
// Cada proyecto es de quien lo crea; admin ve todos. Los alumnos tienen
// crédito mensual de IA (402 al agotarlo). Acciones de acceso y admin en
// acceso.ts.
//
// Acciones (body.action):
//   'ping'      → llamada mínima al modelo (estado y tokens; nunca la clave).
//   'crear'     { nombre, referencia? } → proyecto nuevo.
//   'subida'    { proyecto_id, nombre, tipo, bytes } → URL firmada para subir
//               un plano/croquis al bucket privado «estudio».
//   'mensaje'   { proyecto_id, texto, archivo_ids? } → Claude propone el
//               proyecto (sin versión aún: con todos los archivos) o aplica
//               el cambio pedido. Versión nueva o preguntas. Devuelve SVG.
//   'restaurar' { proyecto_id, numero } → versión nueva copia de vN.
//   'vistas'    { proyecto_id, diseno_id?, numero, codigo, vistas: ['lateral'|'planta'] } → versión nueva con esas vistas en el armario o la cocina.
//   'importar'  { proyecto_id, datos, nota? } → JSON pegado a mano (validado) → versión nueva.
//   'render'    { proyecto_id, numero? } → SVG de cada armario.
//   'pdf'       { proyecto_id, numero? } → PDF de alzados (base64).
//   'borrar'    { proyecto_id } → borra proyecto, historial y archivos.
//   Tarifa, plantilla y presupuesto (F3): ver presupuesto.ts.
// Límites (estudio_config): llamadas/hora por usuario, MB y páginas por
// archivo. Cada llamada a la API queda en estudio_uso con su coste (USD).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { construirMensajes, costeUsd, pedirAClaude, type Adjunto, type MensajeChat } from '../_shared/estudio/ia.ts'
import { validarProyecto, type Proyecto } from '../_shared/estudio/esquema.ts'
import { pdfProyecto, svgsProyecto } from './render.ts'
import { accionPresupuesto, esAccionPresupuesto } from './presupuesto.ts'
import { accionAdminAcceso, accionEnlace, accionYo, descontarSaldo, esAccionAdminAcceso, estadoAlumno, puedeEntrar, sinCredito } from './acceso.ts'
import { accionTienda, accionSinAcceso, esAccionTienda } from './tienda.ts'
import { accionNegocio, esAccionNegocio } from './negocio.ts'
import { accionProyecto, esAccionProyecto, guardarDocumento, miniaturaSvg } from './proyecto.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function paginasPdf(bytes: Uint8Array): number {
  const txt = new TextDecoder('latin1').decode(bytes);
  return (txt.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');
  // Configuración y sesión en paralelo (cada consulta en serie sumaba ~0,1–0,2 s)
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [{ data: cfg }, sesion] = await Promise.all([
    supa.from('estudio_config').select('*').eq('id', 1).maybeSingle(),
    action === 'acceso_enlace' ? Promise.resolve({ data: { user: null } }) : supa.auth.getUser(jwt)
  ]);

  // Sin sesión: pedir el enlace mágico de acceso
  if (action === 'acceso_enlace') {
    try { return await accionEnlace(supa, cfg, body, json); }
    catch (e) { console.error('estudio-ia acceso_enlace:', e); return json({ error: 'Error interno. Inténtalo de nuevo.' }, 500); }
  }

  const u = sesion.data;
  if (!u?.user) return json({ error: 'unauthorized' }, 401);
  const userId = u.user.id;
  const email = String(u.user.email || '').toLowerCase();
  // Rol y estado del alumno a la vez (el estado solo se usa si no es admin)
  const [{ data: rol }, estadoPrevio] = await Promise.all([
    supa.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle(),
    estadoAlumno(supa, email).catch(() => null)
  ]);
  const esAdmin = !!rol;
  const modelo: string = cfg?.modelo || 'claude-sonnet-5-5';
  const clave = Deno.env.get('ANTHROPIC_API_KEY') || '';

  try {
    // Alumnos: activos (compra sin reembolso, curso + meses_tras_fin) y Estudio abierto (o acceso concedido).
    const alumno = esAdmin ? null : estadoPrevio;
    if (action === 'yo') return await accionYo(supa, email, userId, esAdmin, cfg, json, alumno);
    if (!esAdmin) {
      const p = puedeEntrar(alumno, cfg);
      // Sin acceso activo, un antiguo alumno solo puede suscribirse (Créditos y plan)
      const exAlumno = !!alumno?.puede_suscribirse && (!!cfg?.abierto_alumnos || !!alumno?.concedido);
      if (!p.ok && !(exAlumno && accionSinAcceso(action))) return json({ error: p.motivo, sin_acceso: true }, 403);
    }
    if (esAccionTienda(action)) return await accionTienda(action, { supa, userId, email, esAdmin, cfg, alumno, body, json });
    if (esAccionNegocio(action)) return await accionNegocio(action, { supa, userId, esAdmin, body, json });
    if (esAccionProyecto(action)) return await accionProyecto(action, { supa, userId, esAdmin, cfg, clave, modelo, body, alumno, json });
    if (esAccionAdminAcceso(action)) {
      if (!esAdmin) return json({ error: 'forbidden' }, 403);
      return await accionAdminAcceso(action, supa, userId, body, json);
    }
    // Crédito mensual de IA (solo alumnos)
    if (!esAdmin && (action === 'mensaje' || action === 'presupuesto_textos')) {
      const sin = sinCredito(alumno);
      if (sin) return json({ error: sin, sin_credito: true }, 402);
    }

    if (action === 'ping') {
      if (!esAdmin) return json({ error: 'forbidden' }, 403);
      if (!clave) return json({ ok: false, error: 'ANTHROPIC_API_KEY sin configurar' });
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelo, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
      });
      const d = await r.json().catch(() => ({}));
      return json({
        ok: r.ok, status: r.status, modelo: d?.model ?? modelo,
        // Solo datos públicos de la clave: tipo (prefijo) y si lleva espacios.
        prefijo: (clave.trim().match(/^sk-ant-[a-z]+\d*-/) || ['desconocido'])[0],
        espacios_alrededor: clave !== clave.trim(),
        usage: d?.usage ?? null,
        error: r.ok ? null : { tipo: d?.error?.type ?? null, mensaje: d?.error?.message ?? null }
      });
    }

    if (action === 'crear') {
      const nombre = String(body?.nombre || '').trim().slice(0, 80);
      const referencia = String(body?.referencia || '').trim().slice(0, 40) || null;
      if (!nombre) return json({ error: 'Pon el nombre del cliente o del proyecto.' }, 400);
      // N.º correlativo por usuario (01, 02…): el nombre se guarda como «NN - Nombre»
      const limpio = nombre.replace(/^\d{1,4}\s*-\s*/, '');
      for (let intento = 0; intento < 3; intento++) {
        const { data: ult } = await supa.from('estudio_proyectos').select('numero').eq('user_id', userId).not('numero', 'is', null).order('numero', { ascending: false }).limit(1).maybeSingle();
        const n = Number(ult?.numero ?? 0) + 1;
        const { data, error } = await supa.from('estudio_proyectos').insert({ user_id: userId, numero: n, nombre: `${String(n).padStart(2, '0')} - ${limpio}`.slice(0, 90), referencia }).select('*').single();
        if (!error) return json({ proyecto: data });
        if (error.code !== '23505') throw error;   // n.º ocupado a la vez: reintenta
      }
      return json({ error: 'No he podido numerar el proyecto. Inténtalo de nuevo.' }, 409);
    }

    // Tarifa, plantilla y presupuesto (F3)
    if (esAccionPresupuesto(action)) return await accionPresupuesto(action, { supa, userId, esAdmin, cfg, clave, modelo, body, json, base64, alumno });

    // El resto de acciones trabajan sobre un proyecto propio (o cualquiera si admin).
    const proyectoId = String(body?.proyecto_id || '');
    if (!UUID.test(proyectoId)) return json({ error: 'proyecto_id no válido' }, 400);
    const { data: proyecto } = await supa.from('estudio_proyectos').select('*').eq('id', proyectoId).maybeSingle();
    if (!proyecto || (proyecto.user_id !== userId && !esAdmin)) return json({ error: 'Proyecto no encontrado' }, 404);

    // Diseño (varios por proyecto): el chat y las versiones van con su diseño
    const disenoId = String(body?.diseno_id || '');
    // deno-lint-ignore no-explicit-any
    let diseno: any = null;
    if (UUID.test(disenoId)) {
      diseno = (await supa.from('estudio_disenos').select('*').eq('id', disenoId).eq('proyecto_id', proyectoId).maybeSingle()).data;
      if (!diseno) return json({ error: 'Diseño no encontrado' }, 404);
    }
    const nuevoDiseno = async (nombre = 'Diseño sin guardar', guardado = false) => {
      const { data, error } = await supa.from('estudio_disenos').insert({ proyecto_id: proyectoId, nombre, guardado }).select('*').single();
      if (error) throw error;
      return data;
    };
    const version = async (numero?: number) => {
      const n = Number.isInteger(numero) && numero! > 0 ? numero! : (diseno ? diseno.version_actual : proyecto.version_actual);
      if (!n) return null;
      const { data } = await supa.from('estudio_versiones').select('numero, datos').eq('proyecto_id', proyectoId).eq('numero', n).maybeSingle();
      return data as { numero: number; datos: Proyecto } | null;
    };
    const nuevaVersion = async (datos: Proyecto, origen: 'ia' | 'restaurada' | 'manual', nota: string | null) => {
      datos.referencia = proyecto.referencia || undefined;
      datos.cliente = proyecto.nombre;
      if (!datos.referencia) delete datos.referencia;
      // N.º de versión por proyecto (único), aunque haya varios diseños
      const { data: ult } = await supa.from('estudio_versiones').select('numero').eq('proyecto_id', proyectoId).order('numero', { ascending: false }).limit(1).maybeSingle();
      const numero = Number(ult?.numero ?? 0) + 1;
      const { error } = await supa.from('estudio_versiones').insert({ proyecto_id: proyectoId, numero, datos, origen, nota, diseno_id: diseno?.id ?? null });
      if (error) throw error;
      const ahora = new Date().toISOString(), mini = miniaturaSvg(datos);
      if (diseno) {
        await supa.from('estudio_disenos').update({ version_actual: numero, miniatura: mini, updated_at: ahora }).eq('id', diseno.id);
        diseno.version_actual = numero; diseno.miniatura = mini;
      }
      await supa.from('estudio_proyectos').update({ version_actual: numero, updated_at: ahora, miniatura: mini }).eq('id', proyectoId);
      proyecto.version_actual = numero;
      return numero;
    };

    if (action === 'subida') {
      const tipo = String(body?.tipo || '');
      const bytes = Number(body?.bytes || 0);
      const nombre = String(body?.nombre || 'archivo').slice(0, 120);
      if (!TIPOS[tipo]) return json({ error: 'Formato no admitido: sube PDF, JPG, PNG o WEBP.' }, 400);
      const maxMb = cfg?.max_mb ?? 20;
      if (!(bytes > 0) || bytes > maxMb * 1024 * 1024) return json({ error: `El archivo supera ${maxMb} MB.` }, 400);
      const path = `${proyecto.user_id}/${proyectoId}/${crypto.randomUUID()}.${TIPOS[tipo]}`;
      const { data: firmada, error } = await supa.storage.from('estudio').createSignedUploadUrl(path);
      if (error) throw error;
      const { data: archivo, error: e2 } = await supa.from('estudio_archivos')
        .insert({ proyecto_id: proyectoId, user_id: proyecto.user_id, path, nombre, tipo, bytes, diseno_id: diseno?.id ?? null }).select('id').single();
      if (e2) throw e2;
      return json({ archivo_id: archivo.id, path, token: firmada.token });
    }

    if (action === 'mensaje') {
      if (!clave) return json({ error: 'La IA no está configurada.' }, 500);
      const texto = String(body?.texto || '').trim().slice(0, 4000);
      const pedidos: string[] = Array.isArray(body?.archivo_ids) ? body.archivo_ids.filter((x: unknown) => typeof x === 'string' && UUID.test(x)).slice(0, 5) : [];
      if (!texto && !pedidos.length) return json({ error: 'Escribe un mensaje o adjunta un plano.' }, 400);

      // Límite de llamadas por hora
      const desde = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await supa.from('estudio_uso').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', desde);
      if ((count ?? 0) >= (cfg?.max_llamadas_hora ?? 30)) return json({ error: 'Has llegado al límite de peticiones por hora. Prueba un poco más tarde.' }, 429);

      if (!diseno) diseno = await nuevoDiseno();
      // Archivos: sin versión aún van todos los del diseño; luego, solo los nuevos.
      const actual = await version();
      const vacio = '00000000-0000-0000-0000-000000000000';
      let q = supa.from('estudio_archivos').select('*').eq('proyecto_id', proyectoId).order('created_at');
      q = actual ? q.in('id', pedidos.length ? pedidos : [vacio]) : q.or(`diseno_id.eq.${diseno.id},id.in.(${(pedidos.length ? pedidos : [vacio]).join(',')})`);
      const { data: archivos } = await q;
      const adjuntos: Adjunto[] = [];
      for (const a of archivos ?? []) {
        const { data: blob, error } = await supa.storage.from('estudio').download(a.path);
        if (error || !blob) return json({ error: `No encuentro el archivo «${a.nombre}». Vuelve a subirlo.` }, 400);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length > (cfg?.max_mb ?? 20) * 1024 * 1024) return json({ error: `«${a.nombre}» supera ${cfg?.max_mb ?? 20} MB.` }, 400);
        if (a.tipo === 'application/pdf') {
          const paginas = paginasPdf(bytes);
          if (a.paginas !== paginas) await supa.from('estudio_archivos').update({ paginas }).eq('id', a.id);
          if (paginas > (cfg?.max_paginas ?? 10)) return json({ error: `«${a.nombre}» tiene ${paginas} páginas; el máximo es ${cfg?.max_paginas ?? 10}.` }, 400);
        }
        adjuntos.push({ tipo: a.tipo, base64: base64(bytes), nombre: a.nombre });
      }

      if (pedidos.length) await supa.from('estudio_archivos').update({ diseno_id: diseno.id }).in('id', pedidos).is('diseno_id', null);
      const { data: hist } = await supa.from('estudio_mensajes').select('rol, texto').eq('diseno_id', diseno.id).order('created_at');
      const nombresNuevos = (archivos ?? []).filter((a) => pedidos.includes(a.id)).map((a) => a.nombre);
      const textoGuardado = [texto, nombresNuevos.length ? `📎 ${nombresNuevos.join(', ')}` : ''].filter(Boolean).join('\n');
      const { data: msgUsuario } = await supa.from('estudio_mensajes').insert({ proyecto_id: proyectoId, diseno_id: diseno.id, rol: 'usuario', texto: textoGuardado }).select('id').single();
      await supa.from('estudio_disenos').update({ updated_at: new Date().toISOString() }).eq('id', diseno.id);

      const mensajes = construirMensajes({ historial: (hist ?? []) as MensajeChat[], adjuntos, actual, peticion: texto });
      const { resultado, llamadas } = await pedirAClaude({ clave, modelo, mensajes });

      const precios = {
        entrada: Number(cfg?.precio_entrada ?? 2), salida: Number(cfg?.precio_salida ?? 10),
        cache_escritura: Number(cfg?.precio_cache_escritura ?? 2.5), cache_lectura: Number(cfg?.precio_cache_lectura ?? 0.1)
      };
      let coste = 0;
      const alFinal = () => descontarSaldo(supa, alumno, userId, coste);
      for (const l of llamadas) {
        const c = costeUsd(l.uso, precios);
        coste += c;
        await supa.from('estudio_uso').insert({
          user_id: userId, proyecto_id: proyectoId, accion: actual ? 'cambio' : 'propuesta', modelo,
          input_tokens: l.uso.input_tokens, output_tokens: l.uso.output_tokens,
          cache_escritura_tokens: l.uso.cache_creation_input_tokens, cache_lectura_tokens: l.uso.cache_read_input_tokens,
          coste_usd: c, ok: l.ok
        });
      }
      const tokens = llamadas.reduce((s, l) => ({
        entrada: s.entrada + l.uso.input_tokens, salida: s.salida + l.uso.output_tokens,
        cache_escritura: s.cache_escritura + l.uso.cache_creation_input_tokens, cache_lectura: s.cache_lectura + l.uso.cache_read_input_tokens
      }), { entrada: 0, salida: 0, cache_escritura: 0, cache_lectura: 0 });
      const uso = { llamadas: llamadas.length, tokens, coste_usd: Math.round(coste * 10000) / 10000 };
      if (!esAdmin) await alFinal();

      if (resultado.tipo === 'proyecto') {
        const numero = await nuevaVersion(resultado.proyecto, 'ia', texto.slice(0, 200) || null);
        await supa.from('estudio_mensajes').insert({ proyecto_id: proyectoId, diseno_id: diseno.id, rol: 'asistente', texto: resultado.mensaje, version: numero });
        return json({ tipo: 'proyecto', mensaje: resultado.mensaje, version: numero, diseno_id: diseno.id, svgs: await svgsProyecto(resultado.proyecto), uso, revision: resultado.revision ?? null });
      }
      if (resultado.tipo === 'pregunta') {
        const t = [resultado.mensaje, ...resultado.preguntas.map((p) => `• ${p}`)].filter(Boolean).join('\n');
        await supa.from('estudio_mensajes').insert({ proyecto_id: proyectoId, diseno_id: diseno.id, rol: 'asistente', texto: t, pregunta: true });
        return json({ tipo: 'pregunta', mensaje: resultado.mensaje, preguntas: resultado.preguntas, diseno_id: diseno.id, uso });
      }
      // Sin respuesta útil: se quita el mensaje del alumno para que pueda reintentar sin duplicados.
      if (msgUsuario?.id) await supa.from('estudio_mensajes').delete().eq('id', msgUsuario.id);
      console.error('estudio-ia: sin proyecto válido', resultado.detalle ?? '', JSON.stringify(resultado.errores ?? []).slice(0, 2000));
      // El detalle técnico solo se devuelve a admin.
      return json({ tipo: 'error', mensaje: resultado.mensaje, detalle: esAdmin ? resultado.detalle ?? resultado.errores ?? null : null, uso }, 502);
    }

    if (action === 'importar') {
      // Solo admin: JSON del proyecto pegado a mano → versión nueva (validada).
      if (!esAdmin) return json({ error: 'forbidden' }, 403);
      const v = validarProyecto(body?.datos);
      if (!v.ok) return json({ error: 'El JSON no es válido.', errores: v.errores.slice(0, 30) }, 400);
      const numero = await nuevaVersion(v.proyecto, 'manual', String(body?.nota || 'Importado a mano').slice(0, 200));
      await supa.from('estudio_mensajes').insert({ proyecto_id: proyectoId, diseno_id: diseno?.id ?? null, rol: 'asistente', texto: `Proyecto importado a mano como v${numero}.`, version: numero });
      return json({ version: numero, svgs: await svgsProyecto(v.proyecto) });
    }

    if (action === 'vistas') {
      // Activar / quitar sección lateral y planta de un armario (un clic en Diseño): versión nueva, sin IA.
      const v = await version(Number(body?.numero));
      if (!v) return json({ error: 'Este diseño aún no tiene versiones.' }, 404);
      const pedidas = Array.isArray(body?.vistas) ? body.vistas.filter((x: unknown) => x === 'lateral' || x === 'planta') : [];
      const datos: Proyecto = JSON.parse(JSON.stringify(v.datos));
      // Armario (A.0N) o cocina (C.0N)
      const arm: { codigo: string; vistas?: ('lateral' | 'planta')[] } | undefined = [...datos.armarios, ...(datos.cocinas ?? [])].find((x) => x.codigo === String(body?.codigo || ''));
      if (!arm) return json({ error: 'Armario o cocina no encontrado' }, 404);
      const vistas = (['lateral', 'planta'] as const).filter((x) => pedidas.includes(x));
      if (vistas.length) arm.vistas = [...vistas]; else delete arm.vistas;
      const val = validarProyecto(datos);
      if (!val.ok) return json({ error: 'El diseño no es válido.', errores: val.errores.slice(0, 30) }, 400);
      const nombres: Record<string, string> = { lateral: 'sección lateral', planta: 'planta' };
      const nota = `${arm.codigo}: ${vistas.length ? vistas.map((x) => nombres[x]).join(' + ') : arm.codigo.startsWith('C.') ? 'solo alzado' : 'solo interior y cerrado'}`;
      const numero = await nuevaVersion(val.proyecto, 'manual', `Vistas ${nota}`);
      const mensaje = `Vistas de ${nota}. Guardado como versión nueva.`;
      await supa.from('estudio_mensajes').insert({ proyecto_id: proyectoId, diseno_id: diseno?.id ?? null, rol: 'asistente', texto: mensaje, version: numero });
      return json({ version: numero, nota: `Vistas ${nota}`, mensaje, svgs: await svgsProyecto(val.proyecto) });
    }

    if (action === 'restaurar') {
      const v = await version(Number(body?.numero));
      if (!v || v.numero === (diseno ? diseno.version_actual : proyecto.version_actual)) return json({ error: 'Versión no válida' }, 400);
      const numero = await nuevaVersion(v.datos, 'restaurada', `Vuelta a v${v.numero}`);
      await supa.from('estudio_mensajes').insert({ proyecto_id: proyectoId, diseno_id: diseno?.id ?? null, rol: 'asistente', texto: `He vuelto a la versión ${v.numero}. Queda guardada como v${numero}.`, version: numero });
      return json({ version: numero, svgs: await svgsProyecto(v.datos) });
    }

    if (action === 'render' || action === 'pdf') {
      const v = await version(Number(body?.numero));
      if (!v) return json({ error: 'Este proyecto aún no tiene versiones.' }, 404);
      if (action === 'render') return json({ version: v.numero, svgs: await svgsProyecto(v.datos) });
      const titulo = `Alzados ${proyecto.nombre}${proyecto.referencia ? ' ' + proyecto.referencia : ''} v${v.numero}`;
      const pdf = await pdfProyecto(v.datos, titulo);
      const nombre = `Alzados_${(proyecto.referencia || proyecto.nombre).replace(/[^\w-]+/g, '_')}_v${v.numero}.pdf`;
      await guardarDocumento(supa, { proyecto_id: proyectoId, user_id: proyecto.user_id, tipo: 'alzados_pdf', version: v.numero, nombre, bytes: pdf, diseno_id: diseno?.id ?? null });
      return json({ version: v.numero, nombre, base64: base64(pdf) });
    }

    // ── Diseños (varios por proyecto) ──
    if (action === 'documentos_ficha') {
      // Documentos de la ficha en una sola llamada: diseños + documentos + archivos
      const sub = (a: string) => accionProyecto(a, { supa, userId, esAdmin, cfg, clave, modelo, body: { ...body, action: a }, alumno, json }).then((r) => r.json());
      const [docs, fichs, pres] = await Promise.all([sub('documentos'), sub('ficheros'),
        supa.from('estudio_presupuestos').select('id, numero, estado, estado_nota, importe, pvp, created_at, updated_at, montaje_previsto, fecha:datos->>fecha, importado:datos->importado, archivo:datos->>archivo, comision:datos->comision, partidas:datos->partidas').eq('proyecto_id', proyectoId).order('created_at')]);
      // Una tarjeta por presupuesto (también los borradores sin PDF): sus PDF / Excel van dentro
      // deno-lint-ignore no-explicit-any
      const presupuestos = (pres.data ?? []).map((x: any) => ({ id: x.id, numero: x.numero || '', estado: x.estado, estado_nota: x.estado_nota, importe: x.importe, pvp: x.pvp,
        fecha: x.fecha || String(x.created_at).slice(0, 10), created_at: x.created_at, updated_at: x.updated_at, importado: !!x.importado, archivo: x.archivo || null,
        comision: x.comision?.activa ? x.comision : null, editable: !x.importado && Array.isArray(x.partidas) }));
      return json({ disenos: await listaDisenos(), documentos: docs.documentos ?? [], ficheros: fichs.ficheros ?? [], presupuestos, almacenamiento: fichs.almacenamiento, tipos_coste: fichs.tipos_coste, costes_v2: fichs.costes_v2 });
    }
    if (action === 'disenos') return json({ disenos: await listaDisenos() });
    async function listaDisenos() {
      const [ds, pdfs] = await Promise.all([
        supa.from('estudio_disenos').select('id, nombre, guardado, version_actual, miniatura, created_at, updated_at').eq('proyecto_id', proyectoId).order('updated_at', { ascending: false }),
        supa.from('estudio_documentos').select('id, diseno_id, version, nombre, path, created_at').eq('proyecto_id', proyectoId).eq('tipo', 'alzados_pdf').not('diseno_id', 'is', null).order('created_at', { ascending: false })
      ]);
      const ultimo = new Map<string, { id: string; nombre: string; path: string }>();
      for (const d of pdfs.data ?? []) if (!ultimo.has(d.diseno_id)) ultimo.set(d.diseno_id, d);
      const paths = [...ultimo.values()].map((d) => d.path);
      const firmadas = paths.length ? (await supa.storage.from('estudio').createSignedUrls(paths, 3600)).data ?? [] : [];
      const url = new Map(firmadas.map((f: { path: string | null; signedUrl: string }) => [f.path, f.signedUrl]));
      return (ds.data ?? []).filter((d) => d.version_actual > 0 || d.guardado).map((d) => {
        const pdf = ultimo.get(d.id);
        return { ...d, pdf: pdf ? { id: pdf.id, nombre: pdf.nombre, url: url.get(pdf.path) ?? null } : null };
      });
    }
    if (action === 'diseno_nuevo') return json({ diseno: await nuevoDiseno() });
    if (action === 'diseno' || action === 'diseno_json') {
      if (!diseno) return json({ error: 'Falta el diseño' }, 400);
      const v = diseno.version_actual ? await version(diseno.version_actual) : null;
      if (action === 'diseno_json') return json({ nombre: diseno.nombre, version: v?.numero ?? null, datos: v?.datos ?? null });
      const [vs, ms] = await Promise.all([
        supa.from('estudio_versiones').select('numero, origen, nota, created_at').eq('diseno_id', diseno.id).order('numero'),
        supa.from('estudio_mensajes').select('rol, texto, version, pregunta, created_at').eq('diseno_id', diseno.id).order('created_at')
      ]);
      return json({ diseno, versiones: vs.data ?? [], mensajes: ms.data ?? [], svgs: v ? await svgsProyecto(v.datos) : null });
    }
    if (action === 'diseno_guardar') {
      if (!diseno) return json({ error: 'Falta el diseño' }, 400);
      const nombre = String(body?.nombre || '').trim().slice(0, 80) || diseno.nombre || 'Diseño';
      const v = await version(diseno.version_actual);
      if (!v) return json({ error: 'El diseño aún no tiene alzados: pide a Claude la primera versión.' }, 400);
      const ahora = new Date().toISOString();
      let destino = diseno;
      if (body?.modo === 'nuevo' && diseno.guardado) {
        // «Guardar como nuevo diseño»: copia de la versión actual en un diseño nuevo; el original vuelve a la versión con la que se abrió
        destino = await nuevoDiseno(nombre, true);
        const original = diseno;
        diseno = destino;
        await nuevaVersion(v.datos, 'manual', `Copia de «${original.nombre}» v${v.numero}`);
        const inicio = Number(body?.version_inicio);
        if (Number.isInteger(inicio) && inicio > 0 && inicio !== original.version_actual) {
          const vi = (await supa.from('estudio_versiones').select('numero, datos').eq('diseno_id', original.id).eq('numero', inicio).maybeSingle()).data;
          if (vi) await supa.from('estudio_disenos').update({ version_actual: vi.numero, miniatura: miniaturaSvg(vi.datos as Proyecto) }).eq('id', original.id);
        }
      } else {
        await supa.from('estudio_disenos').update({ nombre, guardado: true, updated_at: ahora }).eq('id', diseno.id);
        diseno.nombre = nombre; diseno.guardado = true;
      }
      // PDF de alzados enlazado al diseño (lo que se ve en Documentos)
      const vd = await version(diseno.version_actual);
      if (vd) {
        const pdf = await pdfProyecto(vd.datos, `${nombre} · ${proyecto.nombre} v${vd.numero}`);
        await guardarDocumento(supa, { proyecto_id: proyectoId, user_id: proyecto.user_id, tipo: 'alzados_pdf', version: vd.numero, nombre: `${nombre.replace(/[^\wÀ-ÿ -]+/g, '').trim().replace(/\s+/g, '_') || 'Diseno'}_v${vd.numero}.pdf`, bytes: pdf, diseno_id: diseno.id });
      }
      return json({ diseno: { ...diseno, nombre, guardado: true } });
    }
    if (action === 'diseno_borrar') {
      if (!diseno) return json({ error: 'Falta el diseño' }, 400);
      const [{ data: docs }, { data: arch }] = await Promise.all([
        supa.from('estudio_documentos').select('path, miniatura_path').eq('diseno_id', diseno.id),
        supa.from('estudio_archivos').select('path').eq('diseno_id', diseno.id)
      ]);
      // deno-lint-ignore no-explicit-any
      const paths = [...(docs ?? []).flatMap((x: any) => [x.path, x.miniatura_path]), ...(arch ?? []).map((x) => x.path)].filter(Boolean);
      if (paths.length) await supa.storage.from('estudio').remove(paths);
      await supa.from('estudio_archivos').delete().eq('diseno_id', diseno.id);
      await supa.from('estudio_disenos').delete().eq('id', diseno.id);
      return json({ ok: true });
    }

    if (action === 'borrar') {
      // Todos sus archivos del almacenamiento: adjuntos del chat, documentos, archivos subidos y sus miniaturas
      const [ar, dc, fi] = await Promise.all([
        supa.from('estudio_archivos').select('path').eq('proyecto_id', proyectoId),
        supa.from('estudio_documentos').select('path, miniatura_path').eq('proyecto_id', proyectoId),
        supa.from('estudio_ficheros').select('path, miniatura_path').eq('proyecto_id', proyectoId)
      ]);
      // deno-lint-ignore no-explicit-any
      const paths = [...(ar.data ?? []), ...(dc.data ?? []), ...(fi.data ?? [])].flatMap((x: any) => [x.path, x.miniatura_path]).filter(Boolean);
      for (let i = 0; i < paths.length; i += 500) await supa.storage.from('estudio').remove(paths.slice(i, i + 500));
      await supa.from('estudio_proyectos').delete().eq('id', proyectoId);
      return json({ ok: true });
    }

    return json({ error: 'accion_desconocida' }, 400);
  } catch (e) {
    console.error('estudio-ia error:', e);
    return json({ error: 'Error interno. Inténtalo de nuevo.' }, 500);
  }
});
