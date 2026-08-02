// supabase/functions/_shared/clase-invoices.ts
//
// Factura simplificada + emails para venta de plazas en clases en directo.
// Reutiliza pdf-lib y el patrón de _shared/magazine-invoices.ts.
//
// - Factura al comprador (SISTEMA & CURINO SLU es el único cobrador).
// - Bucket 'invoices' (compartido), prefijo 'clases/'.
// - Emails: confirmación (con Meet + factura adjunta), recordatorio T-24h,
//   recordatorio T-1h, reembolso automático (si se agota entre checkout
//   y webhook).

import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'
import { fmtEur } from './money.ts'
import { ISSUER } from './issuer.ts'

export interface ClaseInvoiceData {
  id: string;              // inscripcion_id
  clase_id: string;
  clase_fecha: string;     // ISO 8601
  nombre: string;
  email: string;
  amount_paid_cents: number;
  invoice_number: string;
  created_at: string;
}

export interface ClaseInfo {
  id: string;
  fecha: string;           // ISO 8601
  duracion_min: number;
  meet_url: string | null;
}

// pdf-lib usa StandardFonts.Helvetica con WinAnsiEncoding — sanea
// caracteres Unicode fuera del set. Copia el helper de armario-invoices.
function sanitizePdfText(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/−/g, '-')       // − → -
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/ /g, ' ');       // NBSP → espacio
}

// Formato de fecha/hora en Europe/Madrid, en castellano.
// Ej: "jueves 15 de octubre de 2026, 19:00 (hora peninsular)"
function fmtFechaClase(iso: string): string {
  try {
    return `${fmtFechaSolo(iso)}, ${fmtHoraSolo(iso)} (hora peninsular)`;
  } catch {
    return iso;
  }
}

// Ej: "jueves 15 de octubre de 2026"
function fmtFechaSolo(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'Europe/Madrid'
    }).format(new Date(iso));
  } catch { return iso; }
}

// Ej: "19:00"
function fmtHoraSolo(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-ES', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Europe/Madrid'
    }).format(new Date(iso));
  } catch { return ''; }
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
export async function generateClaseInvoicePdf(
  inv: ClaseInvoiceData
): Promise<Uint8Array> {
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

  page.drawText(sanitizePdfText('Clase en directo (2 h): vender carpintería a medida sin ser carpintero'), { x: 50, y, font, size: 10 });
  page.drawText(`${fmtEur(baseCents)}`, { x: 480, y, font, size: 10 });
  y -= 12;
  page.drawText(sanitizePdfText(`Fecha de la clase: ${fmtFechaClase(inv.clase_fecha)}`), { x: 50, y, font, size: 8, color: gray });
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

export async function uploadClaseInvoicePdf(
  supabase: any,
  inscripcionId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const path = `clases/${inscripcionId}.pdf`;
  const { error } = await supabase.storage
    .from('invoices')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

// =============================================================
// Emails
// =============================================================
function pdfBytesToBase64(bytes: Uint8Array): string {
  // Chunked para evitar stack overflow con adjuntos grandes.
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

export async function sendClaseConfirmationEmail(
  to: string,
  nombre: string,
  clase: ClaseInfo,
  pdfBytes: Uint8Array,
  invoiceNumber: string
): Promise<void> {
  const fechaSolo = fmtFechaSolo(clase.fecha);
  const horaSolo = fmtHoraSolo(clase.fecha);
  const meetHtml = clase.meet_url
    ? `<p><a href="${escapeHtml(clase.meet_url)}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 22px;text-decoration:none;border-radius:4px;">Unirse a la clase por Google Meet</a></p>
       <p style="font-size:13px;color:#555;">Enlace directo: <a href="${escapeHtml(clase.meet_url)}">${escapeHtml(clase.meet_url)}</a></p>`
    : `<p style="color:#a00;">El enlace de Google Meet se te enviara antes de la clase.</p>`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Tu plaza en la clase está confirmada</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Tienes tu plaza reservada.</p>
  <p>Nos vemos el ${escapeHtml(fechaSolo)} a las ${escapeHtml(horaSolo)} (hora peninsular). Son 2 horas en directo y puedes preguntar lo que quieras durante la clase.</p>
  <p>Enlace de acceso:</p>
  ${meetHtml}
  <p>Adjunto la factura (N.º ${escapeHtml(invoiceNumber)}).</p>
  <h3 style="color:#000;margin-top:30px;">Antes de la clase</h3>
  <p>No necesitas preparar nada ni saber de carpintería. Solo conéctate con papel y boli, y con ganas de preguntar.</p>
  <p>Si ya tienes algún caso en mente —una cocina, un armario, un cliente potencial—, tráelo y lo vemos.</p>
  <p style="margin-top:24px;">Recibirás un recordatorio 24 horas antes y otro 1 hora antes con el enlace.</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Este email es automático. Puedes responder si necesitas contactar.</p>
</body>
</html>`;

  await resendSend({
    from: 'Curino <noreply@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject: 'Tu plaza en la clase esta confirmada — Curino',
    html,
    attachments: [{
      filename: `factura-${invoiceNumber}.pdf`,
      content: pdfBytesToBase64(pdfBytes)
    }]
  });
}

export async function sendClaseReminderEmail(
  to: string,
  nombre: string,
  clase: ClaseInfo,
  tipo: '24h' | '1h'
): Promise<void> {
  const meetBlock = clase.meet_url
    ? `<p><a href="${escapeHtml(clase.meet_url)}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 22px;text-decoration:none;border-radius:4px;">Entrar a la clase (Google Meet)</a></p>
       <p style="font-size:13px;color:#555;">Enlace directo: <a href="${escapeHtml(clase.meet_url)}">${escapeHtml(clase.meet_url)}</a></p>`
    : `<p>Te compartimos el enlace de Meet en breve.</p>`;

  let subject: string;
  let html: string;

  if (tipo === '24h') {
    const horaSolo = fmtHoraSolo(clase.fecha);
    subject = 'Mañana tenemos clase — Curino';
    html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Mañana tenemos clase</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Mañana a las ${escapeHtml(horaSolo)} tenemos la clase. 2 horas en directo.</p>
  <p>Enlace de acceso:</p>
  ${meetBlock}
  <p>No hace falta que prepares nada.</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Este email es automático.</p>
</body>
</html>`;
  } else {
    const fechaLegible = fmtFechaClase(clase.fecha);
    subject = 'En 1 hora empezamos — Curino';
    html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">En 1 hora empezamos</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Empezamos en aproximadamente 1 hora.</p>
  <p><strong>Cuando:</strong> ${escapeHtml(fechaLegible)}<br>
     <strong>Duracion:</strong> ${clase.duracion_min} minutos</p>
  ${meetBlock}
  <p>Con la camara y el microfono a punto ya estamos.</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Este email es automatico.</p>
</body>
</html>`;
  }

  await resendSend({
    from: 'Curino <noreply@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject,
    html
  });
}

export async function sendClaseRefundEmail(
  to: string,
  nombre: string
): Promise<void> {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Se agoto la plaza — te reembolsamos</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>La ultima plaza se ocupo justo mientras completabas el pago. Ya hemos iniciado el reembolso automatico en Stripe: veras el dinero de vuelta en 5-10 dias habiles, segun tu banco.</p>
  <p>Vamos a abrir una nueva fecha pronto. Si quieres que te avisemos, responde a este email o apuntate en la lista de espera desde la pagina.</p>
  <p>Perdona las molestias.</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Este email es automatico. Puedes responder.</p>
</body>
</html>`;

  await resendSend({
    from: 'Curino <noreply@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject: 'Se agoto la plaza — te reembolsamos — Curino',
    html
  });
}
