// supabase/functions/_shared/invoices.ts
//
// Genera PDFs de factura simplificada (al comprador) y auto-factura
// (al seller) usando pdf-lib. Sube a Storage y envía emails con Resend.

import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

const ISSUER = {
  name: 'SISTEMA & CURINO SLU',
  taxId: 'ESB24788580',
  address: 'Carrer de Balmes 252, 5-2',
  city: '08006 Barcelona, España',
  email: 'noreply@casacurino.com'
};

export interface OrderData {
  id: string;
  amount_cents: number;
  base_cents: number;
  tax_amount_cents: number;
  tax_rate_pct: number;
  commission_cents: number;
  invoice_simplified_number: string;
  auto_invoice_number: string;
  invoice_year: number;
  buyer_email_snapshot: string;
  item_name_snapshot: string;
  item_description_snapshot: string | null;
  created_at: string;
  buyer_id: string;
  seller_id: string;
  library_item_id: string;
}

export interface SellerData {
  email: string;
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
}

// === GENERAR PDF FACTURA SIMPLIFICADA (al comprador) ===
export async function generateBuyerInvoicePdf(order: OrderData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  let y = 800;

  // Header con título
  page.drawText('FACTURA SIMPLIFICADA', { x: 50, y, font: fontBold, size: 18, color: black });
  y -= 30;
  page.drawText(`Nº ${order.invoice_simplified_number}`, { x: 50, y, font, size: 10, color: gray });
  page.drawText(`Fecha: ${new Date(order.created_at).toLocaleDateString('es-ES')}`, { x: 350, y, font, size: 10, color: gray });
  y -= 40;

  // Datos emisor
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

  // Tabla de conceptos
  page.drawText('CONCEPTO', { x: 50, y, font: fontBold, size: 10 });
  page.drawText('IMPORTE', { x: 480, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5 });
  y -= 15;
  page.drawText(order.item_name_snapshot, { x: 50, y, font, size: 10 });
  page.drawText(`${(order.base_cents / 100).toFixed(2)} €`, { x: 480, y, font, size: 10 });
  y -= 30;

  // Totales
  page.drawText(`Base imponible:`, { x: 350, y, font, size: 10 });
  page.drawText(`${(order.base_cents / 100).toFixed(2)} €`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${order.tax_rate_pct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(`${(order.tax_amount_cents / 100).toFixed(2)} €`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`TOTAL:`, { x: 350, y, font: fontBold, size: 12 });
  page.drawText(`${(order.amount_cents / 100).toFixed(2)} €`, { x: 490, y, font: fontBold, size: 12 });

  // Footer
  page.drawText(`Pieza: ${order.item_name_snapshot}`, { x: 50, y: 100, font, size: 9, color: gray });
  page.drawText(`ID compra: ${order.id}`, { x: 50, y: 85, font, size: 9, color: gray });
  page.drawText(`${ISSUER.name} — ${ISSUER.email}`, { x: 50, y: 60, font, size: 9, color: gray });

  return await doc.save();
}

// === GENERAR PDF AUTO-FACTURA (al seller) ===
export async function generateSellerInvoicePdf(order: OrderData, seller: SellerData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  // Para Curino vendiendo directo (seller=admin), el seller es el propio Curino → la auto-factura es trivial.
  // Para sellers externos: factura el seller a Curino la comisión.
  const sellerName = seller.legal_name || seller.email;
  const sellerTaxId = seller.tax_id || 'NIF pendiente';
  const sellerAddr = seller.address || 'Dirección pendiente';

  // El seller cobra: amount_total - commission_cents
  const sellerNetCents = order.amount_cents - order.commission_cents;
  const sellerBaseCents = Math.round(sellerNetCents / (1 + order.tax_rate_pct / 100));
  const sellerTaxCents = sellerNetCents - sellerBaseCents;

  let y = 800;

  page.drawText('AUTO-FACTURA', { x: 50, y, font: fontBold, size: 18, color: black });
  y -= 30;
  page.drawText(`Nº ${order.auto_invoice_number}`, { x: 50, y, font, size: 10, color: gray });
  page.drawText(`Fecha: ${new Date(order.created_at).toLocaleDateString('es-ES')}`, { x: 350, y, font, size: 10, color: gray });
  y -= 30;

  page.drawText('Auto-factura emitida por SISTEMA & CURINO SLU en nombre del proveedor.', { x: 50, y, font, size: 9, color: gray });
  y -= 30;

  // Emisor (Seller) y Receptor (Curino)
  page.drawText('PROVEEDOR (SELLER)', { x: 50, y, font: fontBold, size: 10 });
  page.drawText('RECEPTOR (CURINO)', { x: 320, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawText(sellerName.substring(0, 40), { x: 50, y, font, size: 10 });
  page.drawText(ISSUER.name, { x: 320, y, font, size: 10 });
  y -= 12;
  page.drawText(`NIF: ${sellerTaxId}`, { x: 50, y, font, size: 10 });
  page.drawText(`NIF: ${ISSUER.taxId}`, { x: 320, y, font, size: 10 });
  y -= 12;
  page.drawText(sellerAddr.substring(0, 40), { x: 50, y, font, size: 10 });
  page.drawText(ISSUER.address, { x: 320, y, font, size: 10 });
  y -= 30;

  // Tabla
  page.drawText('CONCEPTO', { x: 50, y, font: fontBold, size: 10 });
  page.drawText('IMPORTE', { x: 480, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5 });
  y -= 15;
  page.drawText(`Venta de ${order.item_name_snapshot}`, { x: 50, y, font, size: 10 });
  page.drawText(`${(sellerBaseCents / 100).toFixed(2)} €`, { x: 480, y, font, size: 10 });
  y -= 30;

  // Totales
  page.drawText(`Base imponible:`, { x: 350, y, font, size: 10 });
  page.drawText(`${(sellerBaseCents / 100).toFixed(2)} €`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${order.tax_rate_pct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(`${(sellerTaxCents / 100).toFixed(2)} €`, { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`TOTAL A PAGAR:`, { x: 350, y, font: fontBold, size: 12 });
  page.drawText(`${(sellerNetCents / 100).toFixed(2)} €`, { x: 490, y, font: fontBold, size: 12 });
  y -= 30;

  page.drawText(`Comisión Curino: ${(order.commission_cents / 100).toFixed(2)} €`, { x: 50, y, font, size: 9, color: gray });

  // Footer
  page.drawText(`ID compra: ${order.id}`, { x: 50, y: 85, font, size: 9, color: gray });
  page.drawText(`${ISSUER.name} — ${ISSUER.email}`, { x: 50, y: 60, font, size: 9, color: gray });

  return await doc.save();
}

// === SUBIR PDF A STORAGE ===
export async function uploadInvoicePdf(
  supabase: any,
  orderId: string,
  type: 'buyer' | 'seller',
  pdfBytes: Uint8Array
): Promise<string> {
  const path = `${orderId}/${type}.pdf`;
  const { error } = await supabase.storage
    .from('invoices')
    .upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true
    });
  if (error) throw error;
  return path;
}

// === ENVIAR EMAIL CON RESEND ===
export async function sendInvoiceEmail(
  to: string,
  subject: string,
  html: string,
  pdfBytes: Uint8Array,
  pdfFilename: string
): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return;
  }

  // Convert Uint8Array → base64
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
      subject,
      html,
      attachments: [{
        filename: pdfFilename,
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

// === HTML EMAIL TEMPLATES ===
export function buyerEmailHtml(order: OrderData, configuradorUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Tu compra en Curino</h2>
  <p>Hola,</p>
  <p>Gracias por tu compra de <strong>${order.item_name_snapshot}</strong> por ${(order.amount_cents / 100).toFixed(2)} €.</p>
  <p>La pieza ya está disponible en tu biblioteca del configurador. Puedes acceder aquí:</p>
  <p><a href="${configuradorUrl}" style="display: inline-block; background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Ir al configurador</a></p>
  <p>Adjuntamos la factura simplificada (Nº ${order.invoice_simplified_number}).</p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">SISTEMA & CURINO SLU — Este email es automático, no responder.</p>
</body>
</html>`;
}

export function sellerEmailHtml(order: OrderData): string {
  const sellerNetCents = order.amount_cents - order.commission_cents;
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #000;">Has vendido una pieza en Curino</h2>
  <p>Hola,</p>
  <p>Has vendido <strong>${order.item_name_snapshot}</strong>. Tu importe neto: ${(sellerNetCents / 100).toFixed(2)} € (comisión Curino: ${(order.commission_cents / 100).toFixed(2)} €).</p>
  <p>Stripe transferirá el importe a tu cuenta bancaria en los próximos 7 días.</p>
  <p>Adjuntamos la auto-factura (Nº ${order.auto_invoice_number}) emitida en tu nombre.</p>
  <p style="font-size: 12px; color: #888; margin-top: 30px;">SISTEMA & CURINO SLU — Este email es automático, no responder.</p>
</body>
</html>`;
}
