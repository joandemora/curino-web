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

// Sanea strings que se pasan a page.drawText(): pdf-lib usa StandardFonts
// (Helvetica) con WinAnsiEncoding, que no incluye U+2212 (−), comillas
// tipográficas, ellipsis, etc. Si llega cualquiera de esos chars, drawText
// lanza excepción y rompe la generación del PDF (y por cascada el email).
// Sustituimos por equivalentes ASCII/WinAnsi seguros.
function sanitizeForWinAnsi(text: string): string {
  if (text == null) return '';
  return String(text)
    .replace(/−/g, '-')           // MINUS SIGN → '-'
    .replace(/[“”]/g, '"')   // " " → '"'
    .replace(/[‘’]/g, "'")   // ' ' → "'"
    .replace(/…/g, '...')         // … → '...'
    .replace(/ /g, ' ');          // NBSP → ' '
}

// Normaliza un item de configuracion.items[] (shape frontend cart) o un
// objeto plano legacy (configuracion root, shape H8 o pre-H8) a una shape
// canónica para iterar en el render. Cubre 3 casos:
//   - cart H10: { doorDetail:{tipo,colorRal,marco,textil,travesano}, moduleDetail, precio }
//   - root H8 plano: { door_tipo, door_color, door_marco, door_textil, door_travesano, modules }
//   - root pre-H8: solo `puertas` string resumido
function normalizeItem(raw: any) {
  const dd = (raw && raw.doorDetail) || null;
  const doorTipo = (dd && dd.tipo) || raw.door_tipo || '';
  const doorColor = (dd && dd.colorRal) || raw.door_color || '';
  const doorMarco = (dd && dd.marco) || raw.door_marco || '';
  const doorTextil = (dd && dd.textil) || raw.door_textil || '';
  const doorTravesano = (dd && dd.travesano) || raw.door_travesano || '';
  // precio del item del cart viene en euros con IVA incluido (item.precio).
  // base por línea = round(precio / 1.21 * 100) céntimos. Si no hay precio
  // individual (legacy root sin items[]) → baseCents=null y el render
  // muestra el importe del pedido entero para esa fila.
  const precioEuros = typeof raw.precio === 'number' && raw.precio > 0 ? raw.precio : null;
  const baseCents = precioEuros != null ? Math.round((precioEuros * 100) / 1.21) : null;
  return {
    ancho: raw.ancho ?? '',
    alto: raw.alto ?? '',
    fondo: raw.fondo ?? '',
    material: raw.material || '',
    doorTipo,
    doorColor,
    doorMarco,
    doorTextil,
    doorTravesano,
    interior: raw.interior || '',
    puertasResumen: raw.puertas || '',
    modules: Array.isArray(raw.moduleDetail) ? raw.moduleDetail
           : Array.isArray(raw.modules) ? raw.modules : [],
    baseCents
  };
}

// Render del texto descriptivo de puertas para una línea del PDF / email.
// Priorita el detalle canónico (doorTipo + doorColor/marco/textil/travesano);
// si no existe (pre-H8), cae al string resumido `puertas`.
function renderPuertasText(it: ReturnType<typeof normalizeItem>): string {
  if (it.doorTipo) {
    if (it.doorTipo === 'Textiles') {
      const parts: string[] = [];
      if (it.doorMarco) parts.push('Marco ' + it.doorMarco);
      if (it.doorTextil) parts.push('Textil ' + it.doorTextil);
      if (it.doorTravesano) parts.push(it.doorTravesano);
      return 'Textiles' + (parts.length ? ' — ' + parts.join(', ') : '');
    }
    return it.doorTipo + (it.doorColor ? ' — Color: ' + it.doorColor : '');
  }
  return it.puertasResumen || '';
}

// === Generar PDF de factura para pedido de armario ===
export async function generateArmarioInvoicePdf(order: ArmarioOrderData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([595, 842]); // A4. let porque añadimos páginas si hay muchos items.
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
    page.drawText(sanitizeForWinAnsi(billName), { x: 50, y, font, size: 10 });
    y -= 12;
  }
  if (billNif) {
    page.drawText(sanitizeForWinAnsi(`NIF: ${billNif}`), { x: 50, y, font, size: 10 });
    y -= 12;
  }
  if (billLine) {
    page.drawText(sanitizeForWinAnsi(billLine), { x: 50, y, font, size: 10 });
    y -= 12;
  }
  if (billPostal || billCity) {
    page.drawText(sanitizeForWinAnsi(`${billPostal} ${billCity}`.trim()), { x: 50, y, font, size: 10 });
    y -= 12;
  }
  y -= 18;

  // ── CONCEPTO ──
  // Helper: añade nueva página si y queda demasiado bajo. Mantiene una sola
  // cabecera (en la primera página) y dibuja "(continúa)" como marca al
  // inicio de cada página posterior. No repite EMISOR/CLIENTE.
  const newPageIfNeeded = (threshold: number) => {
    if (y < threshold) {
      page = doc.addPage([595, 842]);
      y = 800;
      page.drawText('(continúa)', { x: 50, y, font, size: 9, color: gray });
      y -= 24;
    }
  };

  page.drawText('CONCEPTO', { x: 50, y, font: fontBold, size: 10 });
  page.drawText('IMPORTE', { x: 480, y, font: fontBold, size: 10 });
  y -= 15;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5 });
  y -= 15;

  // Detectar shape: si configuracion.items es array no vacío → multi-armario.
  // Si no → wrap del objeto root como item único (retrocompat pre-H10).
  const c = (order.configuracion || {}) as any;
  const items = (Array.isArray(c.items) && c.items.length > 0
    ? c.items
    : [c]).map(normalizeItem);
  const multi = items.length > 1;
  // Si es 1 item legacy sin baseCents (no hay precio individual), mostramos
  // el importe del pedido entero en esa fila (mismo comportamiento que antes).
  const singleLegacyNoBase = items.length === 1 && items[0].baseCents == null;

  items.forEach((it, i) => {
    // Auto-paginación antes de empezar el bloque (cabeza + ~3 líneas detalle)
    newPageIfNeeded(220);

    const dims = (it.ancho && it.alto && it.fondo) ? `${it.ancho}×${it.alto}×${it.fondo} cm` : '';
    const concept = multi
      ? `Armario ${i + 1} — ${dims}${it.material ? ' — ' + it.material : ''}`
      : (dims ? `Armario a medida ${dims}${it.material ? ' — ' + it.material : ''}` : 'Armario a medida Curino');

    page.drawText(sanitizeForWinAnsi(concept), { x: 50, y, font, size: 10 });
    // Importe de la línea: base individual del item; fallback al base total
    // del pedido si es legacy single sin precio individual.
    if (it.baseCents != null) {
      page.drawText(fmtEur(it.baseCents), { x: 480, y, font, size: 10 });
    } else if (singleLegacyNoBase) {
      page.drawText(fmtEur(order.base_cents), { x: 480, y, font, size: 10 });
    }
    y -= 14;

    const puertasText = renderPuertasText(it);
    if (puertasText) {
      page.drawText(sanitizeForWinAnsi('Puertas: ' + puertasText), { x: 50, y, font, size: 9, color: gray });
      y -= 11;
    }
    if (it.interior) {
      page.drawText(sanitizeForWinAnsi('Interior: ' + it.interior), { x: 50, y, font, size: 9, color: gray });
      y -= 11;
    }

    // Separador visual fino entre items (no en el último)
    if (multi && i < items.length - 1) {
      y -= 4;
      page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.3, color: gray });
      y -= 10;
    }
  });

  // Si hubo descuento aplicado (cupón), línea informativa en gris bajo
  // la última línea de concepto. El descuento es del pedido entero, no
  // por línea.
  if (order.amount_discount_cents > 0) {
    newPageIfNeeded(180);
    y -= 4;
    page.drawText(
      `Descuento aplicado (cupón): -${fmtEur(order.amount_discount_cents)}`,
      { x: 50, y, font, size: 9, color: gray }
    );
    y -= 11;
  }

  y -= 24;

  // ── DESGLOSE FISCAL ──
  // Validez fiscal: SIEMPRE order.base_cents / tax_amount_cents / amount_total_cents
  // (lo que Stripe cobró realmente). Si suma de bases por línea difiere por
  // redondeo, manda el desglose del pedido entero — no se reparte el residual.
  newPageIfNeeded(150);
  page.drawText('Base imponible:', { x: 350, y, font, size: 10 });
  page.drawText(fmtEur(order.base_cents), { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText(`IVA (${order.tax_rate_pct}%):`, { x: 350, y, font, size: 10 });
  page.drawText(fmtEur(order.tax_amount_cents), { x: 490, y, font, size: 10 });
  y -= 15;
  page.drawText('TOTAL:', { x: 350, y, font: fontBold, size: 12 });
  page.drawText(fmtEur(order.amount_total_cents), { x: 490, y, font: fontBold, size: 12 });

  // ── Pie ──
  // Posiciones absolutas en la página ACTUAL (la última si hubo paginación).
  page.drawText(sanitizeForWinAnsi(`Comprador: ${order.buyer_email}`), { x: 50, y: 100, font, size: 9, color: gray });
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

// === Helper interno: escape HTML para inyección segura en email ===
function escapeHtmlSafe(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// === Enviar email Resend de confirmación con factura adjunta ===
//
// Best-effort: si Resend falla, se loguea y se devuelve sin lanzar.
// El pedido y el PDF ya están guardados; el email es la última capa.
//
// Patrón de Resend igual al de _shared/magazine-invoices.ts +
// reply_to: 'info@casacurino.com' del patrón de presupuesto-form-relay
// para que el cliente pueda responder y le llegue a info@.
export async function sendArmarioPurchaseEmail(
  order: ArmarioOrderData,
  pdfBytes: Uint8Array
): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('armario: RESEND_API_KEY not configured, skipping email');
    return;
  }
  if (!order.buyer_email) {
    console.error('armario: no buyer_email on order', order.id, '— skipping email');
    return;
  }

  // Saludo: nombre del comprador (billing fallback a shipping, primer nombre)
  const fullName = (order.billing_name && order.billing_name.length > 0
    ? order.billing_name
    : order.shipping_name) || '';
  const firstName = fullName.split(' ')[0] || '';
  const greeting = firstName ? `Hola ${escapeHtmlSafe(firstName)},` : 'Hola,';

  // Resumen del armario desde configuracion. Detección de shape (multi-armario
  // H10 vs root legacy) idéntica a la del PDF para coherencia.
  const c = (order.configuracion || {}) as any;
  const items = (Array.isArray(c.items) && c.items.length > 0
    ? c.items
    : [c]).map(normalizeItem);
  const multi = items.length > 1;

  // Cada armario en un bloque, separados por línea fina entre ellos.
  const summaryHtml = items.map((it, i) => {
    const dimensiones = (it.ancho && it.alto && it.fondo)
      ? `${it.ancho}×${it.alto}×${it.fondo} cm`
      : '';
    const rows: Array<[string, string]> = [];
    if (dimensiones) rows.push(['Medidas', dimensiones]);
    if (it.material) rows.push(['Material', it.material]);
    const puertasText = renderPuertasText(it);
    if (puertasText) rows.push(['Puertas', puertasText]);
    if (it.interior) rows.push(['Interior', it.interior]);
    const rowsHtml = rows.map(([k, v]) =>
      `<tr><td style="padding:6px 14px 6px 0;color:#666;font-size:13px;vertical-align:top">${escapeHtmlSafe(k)}</td>` +
      `<td style="padding:6px 0;font-size:13px;color:#000">${escapeHtmlSafe(v)}</td></tr>`
    ).join('');
    const label = multi ? `Armario ${i + 1} de ${items.length}` : 'Tu armario';
    const sep = i > 0 ? 'border-top:1px solid #e5e5e5;margin-top:14px;padding-top:14px;' : '';
    return `<div style="${sep}">` +
      `<div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#666;margin-bottom:8px">${escapeHtmlSafe(label)}</div>` +
      (rows.length ? `<table cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>` : '') +
      `</div>`;
  }).join('');

  // Dirección de envío
  const shipParts = [
    order.shipping_line,
    order.shipping_postal && order.shipping_city
      ? `${order.shipping_postal} ${order.shipping_city}`
      : (order.shipping_postal || order.shipping_city)
  ].filter(p => p && p.length > 0);
  const shippingHtml = shipParts.length > 0
    ? shipParts.map(p => escapeHtmlSafe(p)).join('<br>')
    : '—';

  const totalFmt = fmtEur(order.amount_total_cents);

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;padding:32px 20px;color:#1a1a1a;background:#fff;line-height:1.5">

  <h1 style="font-size:22px;font-weight:400;letter-spacing:0.02em;margin:0 0 24px;color:#000">Hemos recibido tu pedido</h1>

  <p style="font-size:14px;margin:0 0 16px">${greeting}</p>
  <p style="font-size:14px;margin:0 0 24px">
    Gracias por tu compra en Curino. Hemos recibido tu pedido y el pago se ha procesado correctamente.
    A continuación tienes el resumen.
  </p>

  <div style="border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;margin:0 0 28px;padding:18px 0">
    ${summaryHtml}
  </div>

  <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 28px">
    <tr>
      <td style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#666;padding-bottom:8px">Importe pagado</td>
      <td style="text-align:right;font-size:18px;color:#000;padding-bottom:8px">${totalFmt}</td>
    </tr>
    <tr>
      <td style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#666">Factura</td>
      <td style="text-align:right;font-size:13px;color:#000">Nº ${escapeHtmlSafe(order.invoice_number)}</td>
    </tr>
  </table>

  <p style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#666;margin:0 0 8px">Dirección de envío</p>
  <p style="font-size:13px;color:#000;margin:0 0 28px">${shippingHtml}</p>

  <p style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#666;margin:0 0 8px">Plazo de entrega</p>
  <p style="font-size:13px;color:#000;margin:0 0 28px">Fabricación a medida en taller — 4 a 5 semanas desde hoy.</p>

  <p style="font-size:13px;color:#444;margin:0 0 16px">
    Adjuntamos la factura en PDF (Nº ${escapeHtmlSafe(order.invoice_number)}).
    Cualquier consulta, puedes responder a este correo y te atenderemos desde
    <a href="mailto:info@casacurino.com" style="color:#000">info@casacurino.com</a>.
  </p>

  <p style="font-size:11px;color:#999;margin:28px 0 0;padding-top:18px;border-top:1px solid #e5e5e5;letter-spacing:0.05em">
    SISTEMA &amp; CURINO SLU — Carrer de Balmes 252, 5-2, 08006 Barcelona<br>
    NIF ESB24788580
  </p>

</body>
</html>`;

  const base64 = btoa(String.fromCharCode(...pdfBytes));

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Curino <noreply@casacurino.com>',
        to: [order.buyer_email],
        reply_to: 'info@casacurino.com',
        subject: `Confirmación de tu pedido — Curino (${order.invoice_number})`,
        html,
        attachments: [{
          filename: `Factura-${order.invoice_number}.pdf`,
          content: base64
        }]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('armario: Resend error', response.status, text);
      return;
    }

    console.log(`armario: confirmation email sent to ${order.buyer_email} for order ${order.id}`);
  } catch (err) {
    console.error('armario: Resend fetch failed', err);
  }
}
