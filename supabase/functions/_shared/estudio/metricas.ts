// supabase/functions/_shared/estudio/metricas.ts
//
// Estudio Curino · métricas de un proyecto (sin dependencias: se prueba en Node).
// Reglas acordadas con Juan (2026-10):
//   - Facturación (sin IVA) = presupuesto aceptado sin IVA. Las facturas a
//     cliente son cobros (no sustituyen la facturación); solo si su suma
//     (bases) supera el presupuesto aceptado se usan como facturación
//     (hubo ampliaciones). Regla de Juan, 2026-10-13.
//   - Costes (sin IVA) = facturas de proveedor (base) + costes manuales.
//   - Margen = facturación − costes; en % sobre la facturación. Sin costes el
//     margen es null (la tarjeta muestra «—», no un 100 % engañoso).
//   - Cobros: plazos de la forma de pago sobre el total CON IVA; fecha
//     prevista por defecto: 1.º al aceptar, cada siguiente +30 días.
//     Cobrado = el mayor entre los plazos marcados y el total (con IVA) de
//     las facturas a cliente; un plazo cubierto por las facturas no vence.
//   - Avisos: margen < 30 %, cobros vencidos (fecha prevista pasada sin cobrar).

export const CATEGORIAS: Record<string, string> = {
  proveedores: 'Facturas de proveedor', materiales: 'Materiales', mano_obra: 'Mano de obra',
  transporte: 'Transporte', montaje: 'Montaje', otros: 'Otros'
};
export const MARGEN_MINIMO = 30;

export interface Fichero { tipo: string; base: number | null; total: number | null; fecha: string | null; proveedor?: string | null }
export interface Coste { categoria: string; importe: number; fecha: string | null; concepto?: string | null }
export interface Cobro { id?: string; concepto: string; pct: number | null; importe: number; fecha_prevista: string | null; cobrado: boolean; fecha_cobro: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100;
const suma = (l: number[]) => r2(l.reduce((s, x) => s + (Number(x) || 0), 0));
const sumarDias = (iso: string, d: number) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

/** Plazos por defecto: forma de pago × total con IVA; el último absorbe el redondeo. */
export function cobrosPorDefecto(formaPago: { concepto: string; pct: number }[], totalConIva: number, aceptado: string): Cobro[] {
  const fp = formaPago.length ? formaPago : [{ concepto: 'PAGO ÚNICO', pct: 100 }];
  let acumulado = 0;
  return fp.map((p, i) => {
    const importe = i === fp.length - 1 ? r2(totalConIva - acumulado) : r2((totalConIva * Number(p.pct)) / 100);
    acumulado += importe;
    return { concepto: p.concepto, pct: Number(p.pct), importe, fecha_prevista: sumarDias(aceptado, 30 * i), cobrado: false, fecha_cobro: null };
  });
}

export function metricasProyecto(o: {
  presupuesto: { estado: string; importe: number | null; aceptado_at: string | null } | null;
  ficheros: Fichero[]; costes: Coste[]; cobros: Cobro[]; hoy: string;
}) {
  const facturasCliente = o.ficheros.filter((f) => f.tipo === 'factura_cliente');
  const facturasProv = o.ficheros.filter((f) => f.tipo === 'factura_proveedor');
  const aceptado = o.presupuesto?.estado === 'aceptado' ? Number(o.presupuesto.importe ?? 0) : 0;
  const baseFacturas = suma(facturasCliente.map((f) => Number(f.base ?? 0)));
  const porFacturas = baseFacturas > aceptado;
  const facturacion = porFacturas ? baseFacturas : aceptado;
  const origen = porFacturas ? 'facturas' : (aceptado ? 'presupuesto' : null);

  const porCategoria: Record<string, number> = {};
  const add = (k: string, v: number) => { porCategoria[k] = r2((porCategoria[k] ?? 0) + (Number(v) || 0)); };
  facturasProv.forEach((f) => add('proveedores', Number(f.base ?? 0)));
  o.costes.forEach((c) => add(CATEGORIAS[c.categoria] ? c.categoria : 'otros', c.importe));
  const costes = suma(Object.values(porCategoria));
  const hayCostes = facturasProv.length + o.costes.length > 0;
  const margen = hayCostes ? r2(facturacion - costes) : null;
  const margenPct = hayCostes && facturacion > 0 ? Math.round((1000 * (facturacion - costes)) / facturacion) / 10 : null;

  const totalCobros = suma(o.cobros.map((c) => c.importe));
  const totalFacturas = suma(facturasCliente.map((f) => Number(f.total ?? (Number(f.base ?? 0) * 1.21))));
  const cobrado = Math.max(suma(o.cobros.filter((c) => c.cobrado).map((c) => c.importe)), totalFacturas);
  // Plazos cubiertos por las facturas a cliente (en orden): cuentan como cobrados
  let acum = 0;
  const cubierto = o.cobros.map((c) => { acum += Number(c.importe) || 0; return acum <= totalFacturas + 0.5; });
  const vencidos = o.cobros.filter((c, i) => !c.cobrado && !cubierto[i] && c.fecha_prevista && c.fecha_prevista < o.hoy)
    .map((c) => ({ concepto: c.concepto, importe: c.importe, fecha_prevista: c.fecha_prevista!, dias: Math.round((Date.parse(o.hoy) - Date.parse(c.fecha_prevista!)) / 86_400_000) }));

  // Línea temporal: cobros (+, con IVA) y pagos a proveedores / costes (−, sin IVA) por fecha
  const eventos = [
    ...o.cobros.map((c, i) => ({ fecha: (c.cobrado ? c.fecha_cobro : c.fecha_prevista) || o.hoy, tipo: 'cobro', concepto: c.concepto, importe: c.importe, real: c.cobrado || cubierto[i] })),
    ...facturasProv.map((f) => ({ fecha: f.fecha || o.hoy, tipo: 'pago', concepto: f.proveedor || 'Proveedor', importe: Number(f.total ?? f.base ?? 0), real: true })),
    ...o.costes.map((c) => ({ fecha: c.fecha || o.hoy, tipo: 'pago', concepto: c.concepto || CATEGORIAS[c.categoria] || 'Coste', importe: c.importe, real: true }))
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const avisos: string[] = [];
  if (margenPct !== null && margenPct < MARGEN_MINIMO) avisos.push(`Margen del ${String(margenPct).replace('.', ',')} %: por debajo del ${MARGEN_MINIMO} %.`);
  if (vencidos.length) avisos.push(`${vencidos.length === 1 ? 'Hay 1 cobro vencido' : `Hay ${vencidos.length} cobros vencidos`} (${vencidos.map((v) => `${v.concepto}, hace ${v.dias} días`).join('; ')}).`);
  if (!facturacion && o.presupuesto?.estado !== 'aceptado') avisos.push('Aún no hay facturación: marca el presupuesto como aceptado o sube la factura al cliente.');

  return {
    facturacion, origen_facturacion: origen, costes, costes_por_categoria: Object.entries(porCategoria).map(([k, v]) => ({ categoria: k, nombre: CATEGORIAS[k], importe: v })),
    margen, margen_pct: margenPct,
    cobros: { total: totalCobros, cobrado, pendiente: Math.max(0, r2(totalCobros - cobrado)), facturado_cliente: totalFacturas, vencidos },
    eventos, avisos
  };
}
