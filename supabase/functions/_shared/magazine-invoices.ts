// supabase/functions/_shared/magazine-invoices.ts
//
// Factura simplificada + email para compras de paquetes de Revista Curino.
// Reutiliza el ISSUER y el patrón de _shared/invoices.ts (Fase E).
//
// Diferencias con marketplace:
//   - No hay seller: todo el importe va a SISTEMA & CURINO SLU.
//   - No hay auto-factura: solo factura simplificada al comprador.
//   - Concepto: "Paquete de N publicación(es) en Revista Curino".
//   - Bucket: 'invoices' (compartido con marketplace), prefijo 'magazine/'.

import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

const ISSUER = {
  name: 'SISTEMA & CURINO SLU',
  taxId: 'ESB24788580',
  address: 'Carrer de Balmes 252, 5-2',
  city: '08006 Barcelona, España',
  email: 'noreply@casacurino.com'
};

export interface MagazinePurchaseData {
  id: string;
  user_id: string;
  package_size: number;
  amount_paid_cents: number;
  invoice_number: string;
  buyer_email: string;
  created_at: string;
}

export interface MagazineBoostInvoiceData {
  boost_id: string;
  article_title: string;
  boost_type: 'section_cover' | 'main_page';
  amount_paid_cents: number;
  invoice_number: string;
  buyer_email: string;
  created_at: string;
}

// === Generar PDF de factura simplificada para compra de paquete ===
export async function generateMagazineInvoicePdf(purchase: MagazinePurchaseData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  const taxRatePct = 21;
  const baseCents = Math.round(purchase.amount_paid_cents / (1 + taxRatePct / 100));
  const taxCents = purchase.amount_paid_cents - baseCents;

  let y = 800;

  page.drawText('FACTURA SIMPLIFICADA', { x: 50, y, font: fontBold, size: 18, color: black });
  y -= 30;
  page.drawText(`Nº ${purchase.invoice_number}`, { x: 50, y, font, size: 10, color: gray });
  page.drawText(`Fecha: ${new Date(purchase.created_at).toLocaleDateString('es-ES')}`, { x: 350, y, font, size: 10, color: gray });
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

  const conceptLabel = purchase.package_size === 1
    ? 'Paquete de 1 publicación en Revista Curino'
    : `Paquete de ${purchase.package_size} publicaciones en Revista Curino`;
  page.drawText(conceptLabel, { x: 50, y, font, size: 10 });
  page.drawText(`${(baseCents / 100).toFixed(2)} €`, { x: 480, y, font, size: 10 });
  y -= 12;
  page.drawText('Créditos válidos durante 12 meses desde la compra.', { x: 50, y, font, size: 8, color: gray });
  y -= 30;

  page.drawText(`Base imponible:`, { x: 350, y, font, size: 10 });
  page.drawText(`${(baseCents / 100).toFixed(2)} €`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${taxRatePct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(`${(taxCents / 100).toFixed(2)} €`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`TOTAL:`, { x: 350, y, font: fontBold, size: 12 });
  page.drawText(`${(purchase.amount_paid_cents / 100).toFixed(2)} €`, { x: 490, y, font: fontBold, size: 12 });

  page.drawText(`Comprador: ${purchase.buyer_email}`, { x: 50, y: 100, font, size: 9, color: gray });
  page.drawText(`ID compra: ${purchase.id}`, { x: 50, y: 85, font, size: 9, color: gray });
  page.drawText(`${ISSUER.name} — ${ISSUER.email}`, { x: 50, y: 60, font, size: 9, color: gray });

  return await doc.save();
}

// === Subir PDF al bucket 'invoices' con prefijo 'magazine/' ===
export async function uploadMagazineInvoicePdf(
  supabase: any,
  purchaseId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const path = `magazine/${purchaseId}.pdf`;
  const { error } = await supabase.storage
    .from('invoices')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

// === Generar PDF de factura para un boost ===
export async function generateMagazineBoostInvoicePdf(boost: MagazineBoostInvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  const taxRatePct = 21;
  const baseCents = Math.round(boost.amount_paid_cents / (1 + taxRatePct / 100));
  const taxCents = boost.amount_paid_cents - baseCents;

  const typeLabel = boost.boost_type === 'main_page' ? 'Página principal' : 'Portada de sección';

  let y = 800;
  page.drawText('FACTURA SIMPLIFICADA', { x: 50, y, font: fontBold, size: 18, color: black });
  y -= 30;
  page.drawText(`Nº ${boost.invoice_number}`, { x: 50, y, font, size: 10, color: gray });
  page.drawText(`Fecha: ${new Date(boost.created_at).toLocaleDateString('es-ES')}`, { x: 350, y, font, size: 10, color: gray });
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
  const concept = `Boost ${typeLabel} en Revista Curino`;
  page.drawText(concept, { x: 50, y, font, size: 10 });
  page.drawText(`${(baseCents / 100).toFixed(2)} €`, { x: 480, y, font, size: 10 });
  y -= 12;
  const articleSnippet = boost.article_title.length > 80 ? boost.article_title.substring(0, 77) + '...' : boost.article_title;
  page.drawText(`Artículo: ${articleSnippet}`, { x: 50, y, font, size: 9, color: gray });
  y -= 12;
  page.drawText('Promoción durante 15 días desde la activación.', { x: 50, y, font, size: 8, color: gray });
  y -= 30;

  page.drawText('Base imponible:', { x: 350, y, font, size: 10 });
  page.drawText(`${(baseCents / 100).toFixed(2)} €`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${taxRatePct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(`${(taxCents / 100).toFixed(2)} €`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText('TOTAL:', { x: 350, y, font: fontBold, size: 12 });
  page.drawText(`${(boost.amount_paid_cents / 100).toFixed(2)} €`, { x: 490, y, font: fontBold, size: 12 });

  page.drawText(`Comprador: ${boost.buyer_email}`, { x: 50, y: 100, font, size: 9, color: gray });
  page.drawText(`ID boost: ${boost.boost_id}`, { x: 50, y: 85, font, size: 9, color: gray });
  page.drawText(`${ISSUER.name} — ${ISSUER.email}`, { x: 50, y: 60, font, size: 9, color: gray });

  return await doc.save();
}

// === Subir PDF de boost al bucket 'invoices' con prefijo 'magazine-boost/' ===
export async function uploadMagazineBoostInvoicePdf(
  supabase: any,
  boostId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const path = `magazine-boost/${boostId}.pdf`;
  const { error } = await supabase.storage
    .from('invoices')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

// === Email Resend de confirmación de compra de boost ===
export async function sendMagazineBoostEmail(
  to: string,
  boost: MagazineBoostInvoiceData,
  status: 'active' | 'queued',
  endsAt: string | null,
  zoneLabel: string,
  pdfBytes: Uint8Array,
  magazineUrl: string
): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return;
  }
  const typeLabel = boost.boost_type === 'main_page' ? 'Página principal' : 'Portada de sección';

  const statusBlock = status === 'active'
    ? `<p>Tu boost <strong>está activo desde hoy</strong>. Tu artículo aparece destacado en ${escapeHtmlSafe(zoneLabel)} hasta el ${endsAt ? new Date(endsAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}.</p>`
    : `<p>Tu boost está <strong>en cola</strong> porque los 3 slots de ${escapeHtmlSafe(zoneLabel)} están ocupados. Te avisaremos por email cuando se active (cuando se libere un slot).</p>`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Tu boost en Curino Revista</h2>
  <p>Hola,</p>
  <p>Gracias por tu compra del boost <strong>${escapeHtmlSafe(typeLabel)}</strong> para <strong>${escapeHtmlSafe(boost.article_title)}</strong> por ${(boost.amount_paid_cents / 100).toFixed(2)} €.</p>
  ${statusBlock}
  <p><a href="${magazineUrl}" style="display: inline-block; background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Ir a Mis publicaciones</a></p>
  <p>Adjuntamos la factura simplificada (Nº ${boost.invoice_number}).</p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">SISTEMA &amp; CURINO SLU — Este email es automático, no responder.</p>
</body>
</html>`;

  const base64 = btoa(String.fromCharCode(...pdfBytes));

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Curino <noreply@casacurino.com>',
      to: [to],
      subject: `Tu boost en Curino Revista — ${boost.article_title}`,
      html,
      attachments: [{ filename: `factura-${boost.invoice_number}.pdf`, content: base64 }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Resend (boost) error:', response.status, text);
    throw new Error(`Resend failed: ${response.status}`);
  }
}

function escapeHtmlSafe(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// === Enviar email Resend con factura adjunta ===
export async function sendMagazinePurchaseEmail(
  to: string,
  purchase: MagazinePurchaseData,
  pdfBytes: Uint8Array,
  magazineUrl: string
): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return;
  }

  const packageLabel = purchase.package_size === 1
    ? '1 publicación'
    : `${purchase.package_size} publicaciones`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Tu compra en Curino Revista</h2>
  <p>Hola,</p>
  <p>Gracias por tu compra del <strong>Paquete ${packageLabel}</strong> por ${(purchase.amount_paid_cents / 100).toFixed(2)} €.</p>
  <p>Ya tienes <strong>${purchase.package_size} crédito(s)</strong> disponibles para publicar artículos en la Revista Curino. Caducan a los 12 meses desde hoy.</p>
  <p><a href="${magazineUrl}" style="display: inline-block; background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Ir a Mis publicaciones</a></p>
  <p>Adjuntamos la factura simplificada (Nº ${purchase.invoice_number}).</p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">SISTEMA &amp; CURINO SLU — Este email es automático, no responder.</p>
</body>
</html>`;

  const base64 = btoa(String.fromCharCode(...pdfBytes));

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Curino <noreply@casacurino.com>',
      to: [to],
      subject: `Tu compra en Curino Revista — Paquete ${packageLabel}`,
      html,
      attachments: [{
        filename: `factura-${purchase.invoice_number}.pdf`,
        content: base64
      }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Resend error:', response.status, text);
    throw new Error(`Resend failed: ${response.status}`);
  }
}
