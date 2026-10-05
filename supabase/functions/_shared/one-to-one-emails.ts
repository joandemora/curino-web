// supabase/functions/_shared/one-to-one-emails.ts
//
// Emails de compra del One-to-one Curino Partners · 3 meses:
//   - bienvenida al cliente con la factura ONE adjunta, el enlace para
//     agendar la primera sesión (secret SESION_RESERVA_URL de momento; habrá
//     un enlace propio) y el WhatsApp directo con Juan;
//   - aviso a info@casacurino.com con los datos de la compra.

import { resendSend, pdfBytesToBase64, escapeHtml } from './clase-invoices.ts'
import { ONE_TO_ONE } from './one-to-one-config.ts'

const WA = '34611965612';
const PIE = '<p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU · <a href="https://www.casacurino.com/aviso-legal/" style="color:#888">Aviso legal</a></p>';

export async function sendOneToOneWelcomeEmail(to: string, nombre: string, pdfBytes: Uint8Array, invoiceNumber: string): Promise<void> {
  const reserva = Deno.env.get('SESION_RESERVA_URL');
  if (!reserva) console.warn('one-to-one-emails: SESION_RESERVA_URL sin configurar — el email sale sin enlace para agendar');
  const nombreCorto = String(nombre || '').trim().split(' ')[0] || 'hola';
  const wa = `https://wa.me/${WA}?text=${encodeURIComponent(`Hola Juan, soy ${nombreCorto}. Acabo de empezar el one-to-one.`)}`;
  const boton = (url: string, txt: string) =>
    `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#12B76A;color:#ffffff;font-weight:bold;padding:12px 22px;text-decoration:none;border-radius:8px;">${escapeHtml(txt)}</a></p>`;
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Bienvenido al One-to-one Curino Partners</h2>
  <p>Hola ${escapeHtml(nombreCorto)},</p>
  <p>Ya estás dentro: 3 meses trabajando tu negocio conmigo, con 12 sesiones individuales por Zoom y WhatsApp directo.</p>
  <p><strong>Primer paso:</strong> elige el día y la hora de nuestra primera sesión.</p>
  ${reserva ? boton(reserva, 'Agendar mi primera sesión') : '<p>En breve te escribo para fijar la primera sesión.</p>'}
  <p>Y guarda mi WhatsApp para todo lo que necesites entre sesiones:</p>
  ${boton(wa, 'Escribirme por WhatsApp')}
  <p>Adjunto la factura (N.º ${escapeHtml(invoiceNumber)}).</p>
  <p style="margin-top:24px;">Un abrazo,<br>Juan de Mora</p>
  ${PIE}
</body>
</html>`;
  await resendSend({
    from: 'Juan de Mora <info@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject: 'Bienvenido al One-to-one Curino Partners',
    html,
    attachments: [{ filename: `factura-${invoiceNumber}.pdf`, content: pdfBytesToBase64(pdfBytes) }]
  });
}

export async function sendOneToOneAvisoEmail(d: { nombre: string; email: string; telefono: string | null; importe_cents: number; invoice_number: string; id: string }): Promise<void> {
  const tel = String(d.telefono || '').replace(/\D/g, '');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#1a1a1a">
<h2 style="margin:0 0 12px">Nueva compra: ${escapeHtml(ONE_TO_ONE.nombre)}</h2>
<p><b>${escapeHtml(d.nombre)}</b> · ${escapeHtml(d.email)} · ${escapeHtml(d.telefono || '—')}</p>
<p>Importe: ${(d.importe_cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2 })} € · Factura ${escapeHtml(d.invoice_number)}</p>
${tel ? `<p><a href="https://wa.me/${tel}" style="display:inline-block;background:#12B76A;color:#161616;font-weight:bold;padding:10px 18px;text-decoration:none;border-radius:4px">Escribirle por WhatsApp</a></p>` : ''}
<p style="font-size:12px;color:#888">ID ${escapeHtml(d.id)} · Ventas y Alumnos en el panel de Partners.</p></body></html>`;
  await resendSend({
    from: 'Curino Partners — Ventas <noreply@casacurino.com>',
    to: ['info@casacurino.com'],
    reply_to: d.email,
    subject: `Nueva compra One-to-one: ${d.nombre}`,
    html
  });
}
