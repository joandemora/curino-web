// supabase/functions/_shared/crm-render.ts
//
// Render y variables de los emails del CRM de Partners. Lo usan la pantalla
// Emails (crm-email), las secuencias (partners-seguimiento) y los envios
// programados, para que el mismo texto salga igual en todos.
//
// Formato del cuerpo (texto plano):
//   **negrita**, [texto](url), URLs sueltas, saltos de linea (linea en blanco
//   = parrafo nuevo).
//   Boton verde: una linea sola «[[Texto del botón]](url)» (la url puede ser
//   una variable, p. ej. [[Reservar mi plaza]]({enlace_plaza})). Tambien
//   {zoom} o {enlace_reserva} solos en una linea. Debajo va el enlace en
//   texto por si el boton no se ve.
// Variables: ver VARS. Firma «Juan de Mora · Curino» automatica (layout).

import { signLeadToken } from './lead-token.ts'
import { SESION } from './sesion-config.ts'

// deno-lint-ignore no-explicit-any
type Any = any;

export const SITE = 'https://www.casacurino.com';
const WA = '34611965612';

export const VARS = [
  'nombre', 'email', 'curso', 'fecha_inicio', 'hora', 'zoom', 'enlace_reserva', 'plazas_restantes',
  'enlace_plaza', 'enlace_formaciones', 'enlace_whatsapp', 'plazas_libres', 'plazas_totales',
  'precio_oferta_sesion', 'precio_sesion', 'horas_oferta', 'quedan_plazas'
];

export function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// marcar: en vista previa y prueba, una variable vacia se ve como
// «[{zoom} vacío]» en vez de desaparecer (el envio real esta bloqueado).
export function sustituir(texto: string, vars: Record<string, string>, html: boolean, marcar = false) {
  return texto.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in vars)) return m;
    if (!vars[k] && marcar) return html ? `<span style="background:#fde8e8;color:#912018">[{${k}} vacío]</span>` : `[{${k}} vacío]`;
    return html ? esc(vars[k]) : vars[k];
  });
}

const BOTONES: Record<string, string> = { zoom: 'Entrar a la clase en Zoom', enlace_reserva: 'Reservar mi sesión' };
function boton(url: string, texto: string) {
  const u = esc(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px"><tr><td style="background:#12B76A;border-radius:8px">`
    + `<a href="${u}" style="display:inline-block;padding:13px 24px;color:#ffffff;font-weight:bold;font-size:15px;text-decoration:none;border-radius:8px">${esc(texto)}</a></td></tr></table>`
    + `<p style="margin:0 0 14px;font-size:12px;color:#666">Si no ves el botón, copia este enlace: <a href="${u}" style="color:#666;word-break:break-all">${u}</a></p>`;
}

export function renderCuerpo(cuerpo: string, vars: Record<string, string>, marcar = false): string {
  // Lineas de boton → parrafo propio con un marcador que luego se cambia por
  // el boton (solo si la url resultante es http(s); si no, queda el texto y
  // en la vista previa se ve la variable vacia).
  const botones: { url: string; texto: string }[] = [];
  const marca = (url: string, texto: string) => { botones.push({ url, texto }); return `\n\n\u0000BTN${botones.length - 1}\u0000\n\n`; };
  let t = cuerpo.replace(/^[ \t]*\[\[([^\]\n]+)\]\]\(([^)\s]+)\)[ \t]*$/gm, (m, texto, url) => {
    const u = sustituir(url, vars, false);
    return /^https?:\/\//.test(u) ? marca(u, sustituir(texto, vars, false)) : m;
  });
  t = t.replace(/^[ \t]*\{(zoom|enlace_reserva)\}[ \t]*$/gm, (m, k) =>
    /^https?:\/\//.test(vars[k] || '') ? marca(vars[k], BOTONES[k]) : m);
  let h = sustituir(esc(t), vars, true, marcar);  // vars ya escapadas dentro del texto escapado
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  h = h.replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h.trim().split(/\n{2,}/).map((p) => {
    const b = p.trim().match(/^\u0000BTN(\d+)\u0000$/);
    return b ? boton(botones[Number(b[1])].url, botones[Number(b[1])].texto) : `<p style="margin:0 0 14px">${p.trim().replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

// tipo: 'servicio' (alumnos), 'comercial' (CRM) o 'secuencia'.
export function layout(cuerpoHtml: string, tipo: string, bajaUrl: string | null): string {
  const baja = `<a href="${esc(bajaUrl || SITE + '/partners/baja/')}" style="color:#999">date de baja aquí</a>`;
  const pie = tipo === 'comercial'
    ? `Recibes este email porque solicitaste información sobre Curino Partners en casacurino.com. Si no quieres recibir más, ${baja}.`
    : tipo === 'secuencia'
      ? `Recibes este email porque solicitaste información sobre el Intensivo Curino Partners en casacurino.com. Si no quieres recibir más, ${baja}.`
      : 'Recibes este email porque estás inscrito en una formación de Curino Partners.';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:560px;margin:0 auto;padding:16px">
${cuerpoHtml}
<p style="margin:0 0 14px">Juan de Mora · Curino</p>
<p style="font-size:11px;color:#999;margin-top:28px;border-top:1px solid #eee;padding-top:10px">${pie} SISTEMA &amp; CURINO SLU · <a href="${SITE}/aviso-legal/" style="color:#999">Aviso legal</a></p>
</body></html>`;
}

export function variablesUsadas(asunto: string, cuerpo: string): string[] {
  const s = new Set<string>();
  for (const m of (asunto + ' ' + cuerpo).matchAll(/\{(\w+)\}/g)) if (VARS.includes(m[1])) s.add(m[1]);
  return [...s];
}

// ── Datos ────────────────────────────────────────────────────────
// Proxima edicion visible del Intensivo (abierta o agotada).
export async function edicionAbierta(supa: Any): Promise<Any> {
  const { data } = await supa.from('clases').select('*').eq('tipo', 'directo').eq('oculta', false)
    .in('estado', ['abierta', 'agotada']).gt('fecha', new Date().toISOString()).order('fecha').limit(1);
  return data?.[0] || null;
}
export function plazasLibres(c: Any): number | null {
  return c ? Math.max(0, Number(c.plazas_totales) - Number(c.plazas_ocupadas)) : null;
}

function fechaHora(c: Any) {
  // Fecha no confirmada = variable vacia (bloquea el envio real).
  if (!c?.fecha || c.fecha_confirmada === false) return { fecha_inicio: '', hora: '' };
  const d = new Date(c.fecha);
  return {
    fecha_inicio: new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(d),
    hora: new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }).format(d)
  };
}
const eur = (cents: number) => (cents / 100).toLocaleString('es-ES');

// Variables de un destinatario. clase: la edicion del alumno (o la abierta);
// abierta: la proxima edicion (plazas). Con solicitud_id los enlaces llevan
// el token del lead (reconoce su oferta y prellena el email en Stripe).
export async function construirVars(
  d: { nombre: string; email: string; solicitud_id: string | null },
  clase: Any, curso: string, abierta: Any
): Promise<Record<string, string>> {
  const nombre = String(d.nombre || '').trim().split(' ')[0] || '';
  const token = d.solicitud_id ? await signLeadToken(d.solicitud_id) : null;
  const q = token ? `?t=${encodeURIComponent(token)}` : '';
  const libres = plazasLibres(abierta);
  return {
    nombre,
    email: d.email,
    curso,
    ...fechaHora(clase),
    zoom: clase?.meet_url || '',
    enlace_reserva: Deno.env.get('SESION_RESERVA_URL') || '',
    plazas_restantes: libres === null ? '' : String(libres),
    enlace_plaza: `${SITE}/partners/formaciones/${q}${q ? '&' : '?'}ir=intensivo`,
    enlace_formaciones: `${SITE}/partners/formaciones/${q}`,
    enlace_whatsapp: `https://wa.me/${WA}?text=${encodeURIComponent(`Hola Juan, soy ${nombre || 'yo'}. Tengo una duda sobre el intensivo Curino Partners.`)}`,
    plazas_libres: libres === null ? '' : String(libres),
    plazas_totales: abierta ? String(abierta.plazas_totales) : '',
    precio_oferta_sesion: eur(SESION.precioOfertaCents),
    precio_sesion: eur(SESION.precioNormalCents),
    horas_oferta: String(SESION.ofertaHoras),
    // «Quedan 3 plazas» / «Queda 1 plaza» (vacía sin plazas o sin edición)
    quedan_plazas: !libres ? '' : libres === 1 ? 'Queda 1 plaza' : `Quedan ${libres} plazas`
  };
}
