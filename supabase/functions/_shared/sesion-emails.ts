// supabase/functions/_shared/sesion-emails.ts
//
// Email de compra de la "Sesión 1:1 con Juan · 30 min":
//   - factura SESION adjunta;
//   - recursos iniciales adjuntos: todos los archivos del bucket privado
//     partners-recursos/sesion/ (si esta vacio se avisa en el log);
//   - enlace para reservar la hora: secret SESION_RESERVA_URL (Cal.com).

import { resendSend, pdfBytesToBase64, escapeHtml } from './clase-invoices.ts'
import { SESION } from './sesion-config.ts'

const RECURSOS_BUCKET = 'partners-recursos';
const RECURSOS_PREFIX = 'sesion';

async function cargarRecursos(supabase: any): Promise<{ filename: string; content: string }[]> {
  const { data, error } = await supabase.storage.from(RECURSOS_BUCKET).list(RECURSOS_PREFIX, { limit: 20 });
  if (error) {
    console.error('sesion-emails: error listando recursos', error);
    return [];
  }
  const files = (data || []).filter((f: any) => f.name && !f.name.startsWith('.') && f.id);
  const out: { filename: string; content: string }[] = [];
  for (const f of files) {
    const { data: blob, error: dErr } = await supabase.storage.from(RECURSOS_BUCKET).download(`${RECURSOS_PREFIX}/${f.name}`);
    if (dErr || !blob) { console.error('sesion-emails: error descargando', f.name, dErr); continue; }
    out.push({ filename: f.name, content: pdfBytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  }
  return out;
}

export async function sendSesionConfirmationEmail(
  supabase: any,
  to: string,
  nombre: string,
  pdfBytes: Uint8Array,
  invoiceNumber: string
): Promise<void> {
  const reserva = Deno.env.get('SESION_RESERVA_URL');
  if (!reserva) console.warn('sesion-emails: SESION_RESERVA_URL sin configurar — el email sale sin enlace de reserva');
  const recursos = await cargarRecursos(supabase);
  if (!recursos.length) console.warn('sesion-emails: no hay recursos en partners-recursos/sesion/ — el email sale sin recursos adjuntos');

  const reservaHtml = reserva
    ? `<p><a href="${escapeHtml(reserva)}" style="display:inline-block;background:#12B76A;color:#161616;font-weight:bold;padding:12px 22px;text-decoration:none;border-radius:4px;">Reservar mi hora con Juan</a></p>`
    : `<p>En breve te escribo para fijar la hora de la sesión.</p>`;
  const recursosHtml = recursos.length
    ? `<p>Te adjunto los recursos iniciales para arrancar en el sector (${recursos.length} ${recursos.length === 1 ? 'archivo' : 'archivos'}).</p>`
    : `<p>Los recursos iniciales para arrancar en el sector te llegan por email.</p>`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Tu ${escapeHtml(SESION.nombre)} está confirmada</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Ya tienes tu sesión de 30 minutos conmigo por videollamada. Elige el día y la hora que mejor te vengan:</p>
  ${reservaHtml}
  ${recursosHtml}
  <p>Adjunto también la factura (N.º ${escapeHtml(invoiceNumber)}).</p>
  <p>Si quieres aprovecharla al máximo, apunta antes qué te gustaría montar y qué dudas tienes ahora mismo.</p>
  <p style="margin-top:24px;">Un abrazo,<br>Juan de Mora</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Puedes responder a este email si necesitas contactar.</p>
</body>
</html>`;

  await resendSend({
    from: 'Curino <noreply@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject: `Tu ${SESION.nombre} está confirmada`,
    html,
    attachments: [
      { filename: `factura-${invoiceNumber}.pdf`, content: pdfBytesToBase64(pdfBytes) },
      ...recursos
    ]
  });
}
