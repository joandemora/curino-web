// supabase/functions/_shared/clase-invoices.ts
//
// Factura simplificada + emails para venta de plazas en clases en directo.
// Desde 2026-10 el producto vendido es el Intensivo Curino Partners
// (4 semanas, 8 clases por Zoom): la fila de `clases` representa la
// promocion y `fecha` es la PRIMERA sesion. `meet_url` guarda el enlace
// de Zoom (nombre de columna historico).
// Reutiliza pdf-lib y el patrón de _shared/magazine-invoices.ts.
//
// - Factura al comprador (SISTEMA & CURINO SLU es el único cobrador).
// - Bucket 'invoices' (compartido), prefijo 'clases/'.
// - Emails: confirmación (con Zoom + factura adjunta), recordatorio T-24h,
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
  // Datos de facturacion de Stripe Checkout (billing_address_collection +
  // tax_id_collection). Con NIF → factura completa; sin NIF → simplificada
  // con nombre y direccion del comprador.
  buyer_nombre_fiscal?: string | null;
  buyer_nif?: string | null;
  buyer_direccion?: string[] | null;   // lineas ya formateadas
}

// Formatea la direccion de Stripe (customer_details.address) en lineas.
// Provincias de España: Stripe devuelve address.state con el codigo
// ISO 3166-2:ES sin prefijo ("B", "M", "GC"…). En factura va el nombre.
const PROVINCIAS_ES: Record<string, string> = {
  A: 'Alicante', AB: 'Albacete', AL: 'Almería', AV: 'Ávila', B: 'Barcelona',
  BA: 'Badajoz', BI: 'Bizkaia', BU: 'Burgos', C: 'A Coruña', CA: 'Cádiz',
  CC: 'Cáceres', CE: 'Ceuta', CO: 'Córdoba', CR: 'Ciudad Real', CS: 'Castellón',
  CU: 'Cuenca', GC: 'Las Palmas', GI: 'Girona', GR: 'Granada', GU: 'Guadalajara',
  H: 'Huelva', HU: 'Huesca', J: 'Jaén', L: 'Lleida', LE: 'León', LO: 'La Rioja',
  LU: 'Lugo', M: 'Madrid', MA: 'Málaga', ML: 'Melilla', MU: 'Murcia',
  NA: 'Navarra', O: 'Asturias', OR: 'Ourense', P: 'Palencia', PM: 'Illes Balears',
  PO: 'Pontevedra', S: 'Cantabria', SA: 'Salamanca', SE: 'Sevilla', SG: 'Segovia',
  SO: 'Soria', SS: 'Gipuzkoa', T: 'Tarragona', TE: 'Teruel',
  TF: 'Santa Cruz de Tenerife', TO: 'Toledo', V: 'Valencia', VA: 'Valladolid',
  VI: 'Araba/Álava', Z: 'Zaragoza', ZA: 'Zamora'
};

function nombrePais(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return '';
  if (c === 'ES') return 'España';
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' }).of(c) || c;
  } catch { return c; }
}

function nombreProvincia(state: string | null | undefined, country: string | null | undefined): string {
  const st = String(state || '').trim();
  if (!st) return '';
  if (String(country || '').toUpperCase() === 'ES') return PROVINCIAS_ES[st.toUpperCase()] || st;
  return st;
}

// Formatea la direccion de Stripe (customer_details.address) en lineas:
//   1. "Calle 1, piso"
//   2. "CP Ciudad, Provincia, País"  (provincia omitida si no hay)
// Nunca codigos sueltos tipo "B, ES".
export function formatStripeAddress(addr: any): string[] {
  if (!addr) return [];
  const l1 = [addr.line1, addr.line2].filter(Boolean).join(', ');
  const ciudad = [addr.postal_code, addr.city].filter(Boolean).join(' ');
  const l2 = [ciudad, nombreProvincia(addr.state, addr.country), nombrePais(addr.country)]
    .map((x: string) => String(x || '').trim()).filter(Boolean).join(', ');
  return [l1, l2].map((x: string) => String(x || '').trim()).filter(Boolean);
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

  const completa = !!(inv.buyer_nif && inv.buyer_nif.trim());
  const direccion = (inv.buyer_direccion || []).filter(Boolean);

  let y = 800;
  page.drawText(completa ? 'FACTURA' : 'FACTURA SIMPLIFICADA', { x: 50, y, font: fontBold, size: 18, color: black });
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

  // Destinatario: completa → razon social + NIF + direccion (obligatorios);
  // simplificada → nombre y direccion si los hay.
  let yb = 800 - 70;
  page.drawText(completa ? 'CLIENTE' : 'COMPRADOR', { x: 320, y: yb, font: fontBold, size: 10 });
  yb -= 15;
  const nombreDest = inv.buyer_nombre_fiscal || inv.nombre || '';
  page.drawText(sanitizePdfText(nombreDest).slice(0, 60), { x: 320, y: yb, font, size: 10 });
  if (completa) {
    yb -= 12;
    page.drawText(sanitizePdfText(`NIF: ${inv.buyer_nif}`), { x: 320, y: yb, font, size: 10 });
  }
  for (const line of direccion.slice(0, 3)) {
    yb -= 12;
    page.drawText(sanitizePdfText(line).slice(0, 60), { x: 320, y: yb, font, size: 10 });
  }
  y = Math.min(y, yb) - 30;

  page.drawText('CONCEPTO', { x: 50, y, font: fontBold, size: 10 });
  page.drawText('IMPORTE', { x: 480, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5 });
  y -= 15;

  page.drawText(sanitizePdfText('Intensivo Curino Partners: 4 semanas, 8 clases en directo por Zoom'), { x: 50, y, font, size: 10 });
  page.drawText(`${fmtEur(baseCents)}`, { x: 480, y, font, size: 10 });
  y -= 12;
  page.drawText(sanitizePdfText(`Inicio: ${fmtFechaClase(inv.clase_fecha)}`), { x: 50, y, font, size: 8, color: gray });
  y -= 30;

  page.drawText('Base imponible:', { x: 350, y, font, size: 10 });
  page.drawText(`${fmtEur(baseCents)}`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${taxRatePct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(`${fmtEur(taxCents)}`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText('TOTAL:', { x: 350, y, font: fontBold, size: 12 });
  page.drawText(`${fmtEur(inv.amount_paid_cents)}`, { x: 490, y, font: fontBold, size: 12 });

  page.drawText(sanitizePdfText(`Email del comprador: ${inv.email}`), { x: 50, y: 100, font, size: 9, color: gray });
  page.drawText(`ID inscripcion: ${inv.id}`, { x: 50, y: 85, font, size: 9, color: gray });
  page.drawText(`${ISSUER.name} — ${ISSUER.email}`, { x: 50, y: 60, font, size: 9, color: gray });

  return await doc.save();
}

// =============================================================
// Factura rectificativa (serie R-CLASE) — reembolsos
// =============================================================
export interface ClaseRectificativaData {
  invoice_number: string;            // R-CLASE-AAAA-NNNNNN
  fecha: string;                     // ISO de emision
  factura_original: string;          // CLASE-AAAA-NNNNNN
  factura_original_fecha: string;    // ISO
  motivo: string;
  importe_cents: number;             // importe reembolsado, en positivo
  comprador_nombre: string;
  comprador_email?: string | null;
  comprador_nif?: string | null;
  comprador_direccion?: string[] | null;
}

export async function generateClaseRectificativaPdf(
  r: ClaseRectificativaData
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  // Mismo desglose que la factura original, en negativo.
  const taxRatePct = 21;
  const baseCents = Math.round(r.importe_cents / (1 + taxRatePct / 100));
  const taxCents = r.importe_cents - baseCents;
  const neg = (c: number) => `-${fmtEur(c)}`;
  const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });

  let y = 800;
  page.drawText('FACTURA RECTIFICATIVA', { x: 50, y, font: fontBold, size: 18, color: black });
  y -= 30;
  page.drawText(`N.o ${sanitizePdfText(r.invoice_number)}`, { x: 50, y, font, size: 10, color: gray });
  page.drawText(`Fecha: ${fecha(r.fecha)}`, { x: 350, y, font, size: 10, color: gray });
  y -= 14;
  page.drawText(sanitizePdfText(`Rectifica a la factura N.o ${r.factura_original} de fecha ${fecha(r.factura_original_fecha)}`), { x: 50, y, font, size: 10, color: black });
  y -= 14;
  page.drawText(sanitizePdfText(`Motivo: ${r.motivo}`), { x: 50, y, font, size: 10, color: black });
  y -= 30;

  const yTop = y;
  page.drawText('EMISOR', { x: 50, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawText(ISSUER.name, { x: 50, y, font, size: 10 });
  y -= 12;
  page.drawText(`NIF: ${ISSUER.taxId}`, { x: 50, y, font, size: 10 });
  y -= 12;
  page.drawText(ISSUER.address, { x: 50, y, font, size: 10 });
  y -= 12;
  page.drawText(ISSUER.city, { x: 50, y, font, size: 10 });

  let yb = yTop;
  page.drawText(r.comprador_nif ? 'CLIENTE' : 'COMPRADOR', { x: 320, y: yb, font: fontBold, size: 10 });
  yb -= 15;
  page.drawText(sanitizePdfText(r.comprador_nombre).slice(0, 60), { x: 320, y: yb, font, size: 10 });
  if (r.comprador_nif) {
    yb -= 12;
    page.drawText(sanitizePdfText(`NIF: ${r.comprador_nif}`), { x: 320, y: yb, font, size: 10 });
  }
  for (const line of (r.comprador_direccion || []).filter(Boolean).slice(0, 3)) {
    yb -= 12;
    page.drawText(sanitizePdfText(line).slice(0, 60), { x: 320, y: yb, font, size: 10 });
  }
  y = Math.min(y, yb) - 30;

  page.drawText('CONCEPTO', { x: 50, y, font: fontBold, size: 10 });
  page.drawText('IMPORTE', { x: 480, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5 });
  y -= 15;
  page.drawText(sanitizePdfText('Devolución: Intensivo Curino Partners (4 semanas, 8 clases en directo por Zoom)'), { x: 50, y, font, size: 10 });
  page.drawText(neg(baseCents), { x: 475, y, font, size: 10 });
  y -= 30;

  page.drawText('Base imponible:', { x: 350, y, font, size: 10 });
  page.drawText(neg(baseCents), { x: 485, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${taxRatePct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(neg(taxCents), { x: 485, y, font, size: 10 });
  y -= 15;
  page.drawText('TOTAL:', { x: 350, y, font: fontBold, size: 12 });
  page.drawText(neg(r.importe_cents), { x: 485, y, font: fontBold, size: 12 });

  if (r.comprador_email) {
    page.drawText(sanitizePdfText(`Email del comprador: ${r.comprador_email}`), { x: 50, y: 100, font, size: 9, color: gray });
  }
  page.drawText(`${ISSUER.name} — ${ISSUER.email}`, { x: 50, y: 60, font, size: 9, color: gray });

  return await doc.save();
}

export async function uploadClaseRectificativaPdf(
  supabase: any,
  inscripcionId: string,
  refundId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  // Junto a la original: invoices/clases/<inscripcion>.pdf
  const path = `clases/${inscripcionId}-rect-${refundId}.pdf`;
  const { error } = await supabase.storage
    .from('invoices')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
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

// Enlace al grupo de WhatsApp de la promocion. Secret de Edge Functions
// (PARTNERS_WHATSAPP_GROUP_URL); si no esta definido el email lo omite.
function whatsappGroupHtml(): string {
  const url = Deno.env.get('PARTNERS_WHATSAPP_GROUP_URL');
  if (!url) return '';
  return `<p>Únete al grupo de WhatsApp de tu promoción:</p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 22px;text-decoration:none;border-radius:4px;">Entrar al grupo de WhatsApp</a></p>`;
}

function zoomButtonHtml(url: string, label: string): string {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 22px;text-decoration:none;border-radius:4px;">${label}</a></p>
       <p style="font-size:13px;color:#555;">Enlace directo: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`;
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

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Tu plaza en el Intensivo Curino Partners está confirmada</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Ya tienes tu plaza. Empezamos el ${escapeHtml(fechaSolo)} a las ${escapeHtml(horaSolo)} (hora peninsular).</p>
  <p>Son 4 semanas y 8 clases en directo por Zoom, con tiempo para tus preguntas en cada una.</p>
  <p><strong>El enlace de Zoom te llega por email el día antes de la primera clase.</strong></p>
  ${whatsappGroupHtml()}
  <p>Adjunto la factura (N.º ${escapeHtml(invoiceNumber)}).</p>
  <h3 style="color:#000;margin-top:30px;">Antes de empezar</h3>
  <p>No necesitas saber de carpintería. Si ya tienes algún caso en mente —una cocina, un armario, un cliente potencial—, apúntalo y lo trabajamos en clase.</p>
  <p>Si cancelas antes de la primera clase te devolvemos el 100 %. Solo tienes que responder a este email.</p>
  <p style="margin-top:24px;">Un abrazo,<br>Juan de Mora</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Este email es automático. Puedes responder si necesitas contactar.</p>
</body>
</html>`;

  await resendSend({
    from: 'Curino <noreply@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject: 'Tu plaza en el Intensivo Curino Partners está confirmada',
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
  const zoomBlock = clase.meet_url
    ? zoomButtonHtml(clase.meet_url, 'Entrar a la clase (Zoom)')
    : `<p>Te compartimos el enlace de Zoom en breve.</p>`;

  let subject: string;
  let html: string;

  if (tipo === '24h') {
    const horaSolo = fmtHoraSolo(clase.fecha);
    subject = 'Mañana empieza el Intensivo — tu enlace de Zoom';
    html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Mañana empezamos</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Mañana a las ${escapeHtml(horaSolo)} (hora peninsular) es la primera clase del Intensivo Curino Partners.</p>
  <p>Este es tu enlace de Zoom. Guárdalo: es el mismo para las 8 clases.</p>
  ${zoomBlock}
  ${whatsappGroupHtml()}
  <p>No hace falta que prepares nada. Papel, boli y ganas de preguntar.</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Este email es automático.</p>
</body>
</html>`;
  } else {
    const fechaLegible = fmtFechaClase(clase.fecha);
    subject = 'En 1 hora empezamos — Intensivo Curino Partners';
    html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">En 1 hora empezamos</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>La primera clase del Intensivo empieza en aproximadamente 1 hora.</p>
  <p><strong>Cuando:</strong> ${escapeHtml(fechaLegible)}<br>
     <strong>Duracion:</strong> ${clase.duracion_min} minutos</p>
  ${zoomBlock}
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

// Confirmacion de reembolso total solicitado por el alumno (charge.refunded).
export async function sendClaseRefundConfirmationEmail(
  to: string,
  nombre: string,
  importeCents: number,
  rectificativas: { invoice_number: string; pdfBytes: Uint8Array }[] = []
): Promise<void> {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color:#000;margin-top:0;">Reembolso confirmado</h2>
  <p>Hola ${escapeHtml(nombre)},</p>
  <p>Hemos procesado el reembolso de tu plaza en el Intensivo Curino Partners por un importe de <strong>${escapeHtml(fmtEur(importeCents))}</strong>.</p>
  <p>Lo verás en tu cuenta en 5-10 días hábiles, según tu banco, en el mismo método de pago que usaste.</p>
  <p>Tu plaza queda liberada. Si más adelante quieres apuntarte a otra edición, escríbenos y te avisamos.</p>
  ${rectificativas.length ? `<p>Adjunto la factura rectificativa (N.º ${rectificativas.map((r) => escapeHtml(r.invoice_number)).join(', ')}).</p>` : ''}
  <p style="margin-top:24px;">Un abrazo,<br>Juan de Mora</p>
  <p style="font-size:12px;color:#888;margin-top:30px;">SISTEMA &amp; CURINO SLU — Este email es automático. Puedes responder si necesitas contactar.</p>
</body>
</html>`;

  await resendSend({
    from: 'Curino <noreply@casacurino.com>',
    to: [to],
    reply_to: 'info@casacurino.com',
    subject: 'Reembolso confirmado — Intensivo Curino Partners',
    html,
    ...(rectificativas.length ? {
      attachments: rectificativas.map((r) => ({
        filename: `factura-rectificativa-${r.invoice_number}.pdf`,
        content: pdfBytesToBase64(r.pdfBytes)
      }))
    } : {})
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
  <p>Vamos a abrir una nueva promocion del Intensivo pronto. Si quieres que te avisemos, responde a este email o apuntate en la lista de espera desde casacurino.com/partners.</p>
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
