// supabase/functions/_shared/curso-invoices.ts
//
// Factura simplificada + email para venta del curso pregrabado.
// Reutiliza pdf-lib, _shared/money.ts y _shared/issuer.ts.
//
// A diferencia de _shared/clase-invoices.ts:
//   - No hay meet_url, ni fechas, ni recordatorios.
//   - El email de confirmacion lleva un enlace de acceso al curso
//     (/partners/acceso/?t=<token>) que abre la pagina con los 4
//     videos. El token lo genera el webhook, aqui solo se recibe
//     el accessUrl completo.
//   - Solo hay 2 emails: confirmacion (con factura adjunta) y
//     refund manual (por si acaso). Sin recordatorios.

import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'
import { fmtEur } from './money.ts'
import { ISSUER } from './issuer.ts'

export interface CursoInvoiceData {
  id: string;                    // inscripcion_curso.id
  nombre: string;
  email: string;
  amount_paid_cents: number;
  invoice_number: string;
  created_at: string;
}

function sanitizePdfText(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/−/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/ /g, ' ');
}

function escapeHtml(s: string | null | undefined): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================================
// PDF
// =============================================================
export async function generateCursoInvoicePdf(inv: CursoInvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  const taxRatePct = 21;
  const baseCents = Math.round(inv.amount_paid_cents / (1 + taxRatePct / 100));
  const taxCents = inv.amount_paid_cents - baseCents;

  let y = 800;
  page.drawText('FACTURA SIMPLIFICADA', { x: 50, y, font: fontBold, size: 18, color: black });
  y -= 30;
  page.drawText(`N.o ${sanitizePdfText(inv.invoice_number)}`, { x: 50, y, font, size: 10, color: gray });
  page.drawText(`Fecha: ${new Date(inv.created_at).toLocaleDateString('es-ES')}`, { x: 350, y, font, size: 10, color: gray });
  y -= 40;

  page.drawText('EMISOR', { x: 50, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawText(ISSUER.name, { x: 50, y, font, size: 10 });
  y -= 12;
  page.drawText(`NIF: ${ISSUER.taxId}`, { x: 50, y, font, size: 10 });
  y -= 12;
  page.drawText(ISSUER.address, { x: 50, y, font, size: 10 });
  y -= 12;
  page.drawText(ISSUER.city, { x: 50, y, font, size: 10 });
  y -= 30;

  page.drawText('CONCEPTO', { x: 50, y, font: fontBold, size: 10 });
  page.drawText('IMPORTE', { x: 480, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5 });
  y -= 15;

  page.drawText(sanitizePdfText('Curso online: vender carpintería a medida sin ser carpintero'), { x: 50, y, font, size: 10 });
  page.drawText(`${fmtEur(baseCents)}`, { x: 480, y, font, size: 10 });
  y -= 12;
  page.drawText('4 clases pregrabadas. Acceso sin caducidad.', { x: 50, y, font, size: 8, color: gray });
  y -= 30;

  page.drawText('Base imponible:', { x: 350, y, font, size: 10 });
  page.drawText(`${fmtEur(baseCents)}`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${taxRatePct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(`${fmtEur(taxCents)}`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText('TOTAL:', { x: 350, y, font: fontBold, size: 12 });
  page.drawText(`${fmtEur(inv.amount_paid_cents)}`, { x: 490, y, font: fontBold, size: 12 });

  page.drawText(sanitizePdfText(`Comprador: ${inv.nombre} — ${inv.email}`), { x: 50, y: 100, font, size: 9, color: gray });
  page.drawText(`ID inscripcion: ${inv.id}`, { x: 50, y: 85, font, size: 9, color: gray });
  page.drawText(`${ISSUER.name} — ${ISSUER.email}`, { x: 50, y: 60, font, size: 9, color: gray });

  return await doc.save();
}

export async function uploadCursoInvoicePdf(
  supabase: any,
  inscripcionId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const path = `cursos/${inscripcionId}.pdf`;
  const { error } = await supabase.storage
    .from('invoices')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

// =============================================================
// Email
// =============================================================
function pdfBytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(bin);
}

async function resendSend(payload: Record<string, unknown>): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('Resend error:', response.status, text);
    throw new Error(`Resend failed: ${response.status}`);
  }
}

export async function sendCursoConfirmationEmail(
  to: string,
  nombre: string,
  accessUrl: string,
  pdfBytes: Uint8Array,
  invoiceNumber: string
): Promise<void> {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Tu curso Curino está listo</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Tu compra está confirmada. Ya puedes acceder al curso completo desde este enlace:</p>
  <p><a href="${escapeHtml(accessUrl)}" style="display:inline-block;background:#0E0B32;color:#fff;padding:14px 26px;text-decoration:none;border-radius:6px;font-weight:600;">Ver el curso</a></p>
  <p style="font-size:13px;color:#555;">Enlace directo: <a href="${escapeHtml(accessUrl)}">${escapeHtml(accessUrl)}</a></p>
  <p>Son 4 clases pregrabadas con acceso sin caducidad: puedes verlas cuando y donde quieras. Guarda este email — el enlace es tu acceso.</p>
  <p>Adjunto la factura (N.º ${escapeHtml(invoiceNumber)}).</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Este email es automático. Puedes responder si necesitas contactar.</p>
</body>
</html>`;

  await resendSend({
    from: 'Curino <noreply@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject: 'Tu curso Curino — acceso inmediato',
    html,
    attachments: [{
      filename: `factura-${invoiceNumber}.pdf`,
      content: pdfBytesToBase64(pdfBytes)
    }]
  });
}

export async function sendCursoRefundEmail(to: string, nombre: string): Promise<void> {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Reembolso procesado</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Hemos procesado el reembolso de tu compra del curso. Verás el importe de vuelta en tu cuenta en 5-10 días hábiles según tu banco.</p>
  <p>Si necesitas cualquier aclaración, escríbeme y hablamos.</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Puedes responder este email.</p>
</body>
</html>`;

  await resendSend({
    from: 'Curino <noreply@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject: 'Reembolso procesado — Curino',
    html
  });
}
