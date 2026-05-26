// supabase/functions/_shared/armario-invoices.ts
//
// Factura simplificada para pedidos del configurador de armarios
// (Fase H4). Reutiliza el ISSUER y el patrón de _shared/invoices.ts
// (Fase E) y _shared/magazine-invoices.ts (Fase G2).
//
// Diferencias con magazine:
//   - El concepto es un armario configurado (no un paquete de créditos).
//   - Los datos del cliente sí aparecen en el PDF (billing fallback a
//     shipping), porque el armario es venta directa al consumidor con
//     dirección/NIF capturados en /checkout/.
//   - Formato monetario español (1.943,80 €) en vez de US (1943.80).
//   - Bucket: 'invoices' (compartido), prefijo 'armario/'.

import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'
import { fmtEur } from './money.ts'

const ISSUER = {
  name: 'SISTEMA & CURINO SLU',
  taxId: 'ESB24788580',
  address: 'Carrer de Balmes 252, 5-2',
  city: '08006 Barcelona, España',
  email: 'noreply@casacurino.com'
};

export interface ArmarioOrderData {
  id: string;
  invoice_number: string;
  paid_at: string;                 // ISO timestamp del pago
  amount_total_cents: number;      // importe real cobrado (post-descuento)
  amount_discount_cents: number;   // 0 si no hubo cupón
  base_cents: number;
  tax_amount_cents: number;
  tax_rate_pct: number;            // 21
  configuracion: {
    ancho?: string;
    alto?: string;
    fondo?: string;
    material?: string;
    interior?: string;
    puertas?: string;
  };
  // Dirección de envío (siempre completa)
  shipping_name: string;
  shipping_line: string;
  shipping_city: string;
  shipping_postal: string;
  shipping_nif: string;
  // Dirección de facturación (puede venir vacía si igual a envío)
  billing_name: string;
  billing_line: string;
  billing_city: string;
  billing_postal: string;
  billing_nif: string;
  buyer_email: string;
}

// === Generar PDF de factura para pedido de armario ===
export async function generateArmarioInvoicePdf(order: ArmarioOrderData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  // Datos de facturación: billing si está, si no fallback a shipping
  const billName = order.billing_name && order.billing_name.length > 0 ? order.billing_name : order.shipping_name;
  const billLine = order.billing_line && order.billing_line.length > 0 ? order.billing_line : order.shipping_line;
  const billCity = order.billing_city && order.billing_city.length > 0 ? order.billing_city : order.shipping_city;
  const billPostal = order.billing_postal && order.billing_postal.length > 0 ? order.billing_postal : order.shipping_postal;
  const billNif = order.billing_nif && order.billing_nif.length > 0 ? order.billing_nif : order.shipping_nif;

  let y = 800;

  // ── Cabecera ──
  page.drawText('FACTURA', { x: 50, y, font: fontBold, size: 18, color: black });
  y -= 30;
  page.drawText(`Nº ${order.invoice_number}`, { x: 50, y, font, size: 10, color: gray });
  page.drawText(`Fecha: ${new Date(order.paid_at).toLocaleDateString('es-ES')}`, { x: 350, y, font, size: 10, color: gray });
  y -= 40;

  // ── EMISOR ──
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

  // ── CLIENTE (datos fiscales) ──
  page.drawText('CLIENTE', { x: 50, y, font: fontBold, size: 10 });
  y -= 15;
  if (billName) {
    page.drawText(billName, { x: 50, y, font, size: 10 });
    y -= 12;
  }
  if (billNif) {
    page.drawText(`NIF: ${billNif}`, { x: 50, y, font, size: 10 });
    y -= 12;
  }
  if (billLine) {
    page.drawText(billLine, { x: 50, y, font, size: 10 });
    y -= 12;
  }
  if (billPostal || billCity) {
    page.drawText(`${billPostal} ${billCity}`.trim(), { x: 50, y, font, size: 10 });
    y -= 12;
  }
  y -= 18;

  // ── CONCEPTO ──
  page.drawText('CONCEPTO', { x: 50, y, font: fontBold, size: 10 });
  page.drawText('IMPORTE', { x: 480, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5 });
  y -= 15;

  // Línea principal de concepto: armario a medida + dimensiones + material
  const c = order.configuracion || {};
  const dimensiones = (c.ancho && c.alto && c.fondo)
    ? `${c.ancho}×${c.alto}×${c.fondo} cm`  // × en unicode
    : '';
  const conceptMain = dimensiones
    ? `Armario a medida ${dimensiones}${c.material ? ' — ' + c.material : ''}`
    : 'Armario a medida Curino';
  page.drawText(conceptMain, { x: 50, y, font, size: 10 });
  page.drawText(fmtEur(order.base_cents), { x: 480, y, font, size: 10 });
  y -= 14;

  // Detalle del armario (puertas, interior) en líneas adicionales en gris
  if (c.puertas) {
    page.drawText(`Puertas: ${c.puertas}`, { x: 50, y, font, size: 9, color: gray });
    y -= 11;
  }
  if (c.interior) {
    page.drawText(`Interior: ${c.interior}`, { x: 50, y, font, size: 9, color: gray });
    y -= 11;
  }

  // Si hubo descuento aplicado (cupón), línea informativa en gris
  if (order.amount_discount_cents > 0) {
    y -= 4;
    page.drawText(
      `Descuento aplicado (cupón): −${fmtEur(order.amount_discount_cents)}`,
      { x: 50, y, font, size: 9, color: gray }
    );
    y -= 11;
  }

  y -= 24;

  // ── DESGLOSE FISCAL ──
  // El desglose se hace sobre el importe REAL cobrado (post-descuento):
  // amount_total = base + IVA, ambos en céntimos.
  page.drawText('Base imponible:', { x: 350, y, font, size: 10 });
  page.drawText(fmtEur(order.base_cents), { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${order.tax_rate_pct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(fmtEur(order.tax_amount_cents), { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText('TOTAL:', { x: 350, y, font: fontBold, size: 12 });
  page.drawText(fmtEur(order.amount_total_cents), { x: 490, y, font: fontBold, size: 12 });

  // ── Pie ──
  page.drawText(`Comprador: ${order.buyer_email}`, { x: 50, y: 100, font, size: 9, color: gray });
  page.drawText(`ID pedido: ${order.id}`, { x: 50, y: 85, font, size: 9, color: gray });
  page.drawText(`${ISSUER.name} — ${ISSUER.email}`, { x: 50, y: 60, font, size: 9, color: gray });

  return await doc.save();
}

// === Subir PDF al bucket 'invoices' con prefijo 'armario/' ===
export async function uploadArmarioInvoicePdf(
  supabase: any,
  orderId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const path = `armario/${orderId}.pdf`;
  const { error } = await supabase.storage
    .from('invoices')
    .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}
