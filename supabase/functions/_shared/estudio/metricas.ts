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
  transporte: 'Transporte', montaje: 'Montaje', otros: 'Otros', comision: 'Comisión interiorista'
};
export const MARGEN_MINIMO = 30;
/** Tipos de coste iniciales (cada usuario edita su lista en Tarifa). */
export const TIPOS_COSTE_DEF = ['Tablero/material', 'Herrajes', 'Fabricación/taller', 'Lacado/barniz', 'Montaje', 'Transporte', 'Subcontrata', 'Otros'];
export const COMISION_TIPO = 'Comisión interiorista';

export interface Fichero {
  id?: string; tipo: string; base: number | null; total: number | null; fecha: string | null; proveedor?: string | null;
  tipo_coste?: string | null; sustituido_por?: string | null; concepto?: string | null; nombre?: string | null;
}

/**
 * Documentos que cuentan como coste (reglas nuevas, costes_v2): facturas de
 * proveedor y presupuestos de proveedor que ninguna factura sustituye. Los
 * presupuestos de proveedor solo cuentan si el proyecto tiene algún
 * presupuesto aceptado; si no, su suma es «coste previsto» (no cuenta).
 */
export const documentosCoste = (fs: Fichero[], aceptado = true) => fs.filter((f) => f.tipo === 'factura_proveedor' || (aceptado && f.tipo === 'presupuesto_proveedor' && !f.sustituido_por));
/** Sin importe: vacío o 0 € (reglas nuevas); vacío (reglas de antes). */
const sinImporte = (f: Fichero, v2: boolean) => f.base === null || f.base === undefined || (v2 && Number(f.base) === 0);
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

/**
 * v2 (costes desde documentos): costes = documentos de coste con importe, por
 * tipo de coste; los costes manuales ya no cuentan (se migraron a documentos).
 * Sin v2: reglas de antes (facturas de proveedor + costes manuales).
 */
/**
 * Cajas de la ficha del proyecto (solo la ficha; «Mi negocio» sigue con
 * metricasProyecto):
 * - importe presupuestado = suma de los aceptados; sin aceptados, el último
 *   enviado (o el último borrador), marcado «previsto», con su n.º;
 * - coste = real (facturas de proveedor, costes manuales en proyectos sin v2 y
 *   comisión de los aceptados) + previsto (presupuestos de proveedor sin factura
 *   que los sustituya), con su desglose;
 * - margen = importe − coste; no fiable si falta importe, no hay costes o hay
 *   alguno sin importe;
 * - cerrado = hay aceptados, todos «Montado» y ningún presupuesto de proveedor
 *   pendiente de factura. Mientras no lo esté, las cifras son «previstas».
 */
export interface PresupuestoFicha {
  numero?: string | null; estado: string; importe?: number | string | null; comision_importe?: number | string | null; montado?: boolean | null;
  enviado_at?: string | null; estado_at?: string | null; updated_at?: string | null; datos?: { numero?: string } | null;
}
export function resumenFicha(o: { presupuestos: PresupuestoFicha[]; ficheros: Fichero[]; costes: Coste[]; v2: boolean }) {
  const aceptados = o.presupuestos.filter((p) => p.estado === 'aceptado');
  const numeroDe = (p: PresupuestoFicha) => p.numero || p.datos?.numero || null;
  let importe: number | null = null, numero: string | null = null, origen: 'aceptados' | 'enviado' | 'borrador' | null = null;
  if (aceptados.length) { importe = suma(aceptados.map((p) => Number(p.importe ?? 0))); origen = 'aceptados'; numero = aceptados.length === 1 ? numeroDe(aceptados[0]) : null; }
  else {
    const ultimo = (estado: string, fecha: (p: PresupuestoFicha) => string) =>
      o.presupuestos.filter((p) => p.estado === estado && p.importe != null && Number(p.importe) > 0).sort((a, b) => fecha(b).localeCompare(fecha(a)))[0];
    const env = ultimo('enviado', (x) => String(x.enviado_at ?? x.estado_at ?? x.updated_at ?? ''));
    const p = env ?? ultimo('borrador', (x) => String(x.updated_at ?? ''));
    if (p) { importe = r2(Number(p.importe)); numero = numeroDe(p); origen = env ? 'enviado' : 'borrador'; }
  }
  const facturado = suma(o.ficheros.filter((f) => f.tipo === 'factura_cliente').map((f) => Number(f.base ?? 0)));
  const facturas = o.ficheros.filter((f) => f.tipo === 'factura_proveedor');
  const pendientes = o.ficheros.filter((f) => f.tipo === 'presupuesto_proveedor' && !f.sustituido_por);
  const comision = suma(aceptados.map((p) => Number(p.comision_importe ?? 0)));
  const real = r2(suma(facturas.filter((f) => !sinImporte(f, o.v2)).map((f) => Number(f.base))) + (o.v2 ? 0 : suma(o.costes.map((c) => c.importe))) + comision);
  const previsto = suma(pendientes.filter((f) => !sinImporte(f, o.v2)).map((f) => Number(f.base)));
  const coste = r2(real + previsto);
  const nSinImporte = [...facturas, ...pendientes].filter((f) => sinImporte(f, o.v2)).length;
  const hayCostes = facturas.length + pendientes.length + (o.v2 ? 0 : o.costes.length) + (comision > 0 ? 1 : 0) > 0;
  const margen = importe === null ? null : r2(importe - coste);
  const margenPct = margen === null || !importe ? null : Math.round((margen / importe) * 1000) / 10;
  const motivo = !importe ? 'sin importe presupuestado' : !hayCostes ? 'sin costes' : nSinImporte ? (nSinImporte === 1 ? '1 coste sin importe' : `${nSinImporte} costes sin importe`) : null;
  const cerrado = aceptados.length > 0 && aceptados.every((p) => !!p.montado) && pendientes.length === 0;
  return {
    importe, importe_numero: numero, importe_origen: origen, aceptados: aceptados.length, facturado_cliente: facturado || null,
    coste, coste_real: real, coste_previsto: previsto, costes_sin_importe: nSinImporte,
    margen, margen_pct: margenPct, fiable: motivo === null, motivo, cerrado
  };
}

export function metricasProyecto(o: {
  presupuesto: { estado: string; importe: number | null; aceptado_at: string | null; comision_importe?: number | null } | null;
  ficheros: Fichero[]; costes: Coste[]; cobros: Cobro[]; hoy: string; v2?: boolean;
}) {
  const v2 = !!o.v2;
  const facturasCliente = o.ficheros.filter((f) => f.tipo === 'factura_cliente');
  const facturasProv = o.ficheros.filter((f) => f.tipo === 'factura_proveedor');
  const esAceptado = o.presupuesto?.estado === 'aceptado';
  const docsCoste = v2 ? documentosCoste(o.ficheros, esAceptado) : facturasProv;
  // Proyecto sin aceptar: presupuestos de proveedor no sustituidos = coste previsto (aparte, no cuenta)
  const costePrevisto = v2 && !esAceptado ? suma(o.ficheros.filter((f) => f.tipo === 'presupuesto_proveedor' && !f.sustituido_por && !sinImporte(f, true)).map((f) => Number(f.base))) : 0;
  const costesManuales = v2 ? [] : o.costes;
  const aceptado = o.presupuesto?.estado === 'aceptado' ? Number(o.presupuesto.importe ?? 0) : 0;
  const baseFacturas = suma(facturasCliente.map((f) => Number(f.base ?? 0)));
  const porFacturas = baseFacturas > aceptado;
  const facturacion = porFacturas ? baseFacturas : aceptado;
  const origen = porFacturas ? 'facturas' : (aceptado ? 'presupuesto' : null);

  const porCategoria: Record<string, number> = {};
  const add = (k: string, v: number) => { porCategoria[k] = r2((porCategoria[k] ?? 0) + (Number(v) || 0)); };
  const porTipo: Record<string, number> = {};
  const addTipo = (k: string, v: number) => { porTipo[k] = r2((porTipo[k] ?? 0) + (Number(v) || 0)); };
  docsCoste.forEach((f) => { if (!sinImporte(f, v2)) { add('proveedores', Number(f.base)); addTipo(f.tipo_coste || 'Otros', Number(f.base)); } });
  costesManuales.forEach((c) => { add(CATEGORIAS[c.categoria] ? c.categoria : 'otros', c.importe); addTipo(CATEGORIAS[c.categoria] ?? 'Otros', c.importe); });
  // Comisión del interiorista (cliente paga el PVP): coste automático del presupuesto aceptado
  const comision = o.presupuesto?.estado === 'aceptado' ? Number(o.presupuesto.comision_importe ?? 0) : 0;
  if (comision > 0) { add('comision', comision); addTipo(COMISION_TIPO, comision); }
  const costes = suma(Object.values(porCategoria));
  // v2: el margen solo se calcula si algún coste tiene importe (si todos están sin importe, «—», como sin costes)
  const hayCostes = v2 ? docsCoste.some((f) => !sinImporte(f, true)) || comision > 0 : docsCoste.length + costesManuales.length > 0 || comision > 0;
  // Margen fiable: con facturación, algún coste y ningún coste sin importe
  const nSinImporte = docsCoste.filter((f) => sinImporte(f, v2)).length;
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

  // (como el ranking de «Mi negocio»: la comisión sola no hace fiable un margen)
  const hayCostesDocs = docsCoste.length + costesManuales.length > 0;
  const motivo = !facturacion ? 'sin facturación' : !hayCostesDocs ? 'sin costes' : nSinImporte ? (nSinImporte === 1 ? '1 coste sin importe' : `${nSinImporte} costes sin importe`) : null;
  return {
    facturacion, origen_facturacion: origen, costes, costes_por_categoria: Object.entries(porCategoria).map(([k, v]) => ({ categoria: k, nombre: CATEGORIAS[k], importe: v })),
    costes_por_tipo: Object.entries(porTipo).map(([tipo, importe]) => ({ tipo, importe })).sort((a, b) => b.importe - a.importe),
    costes_sin_importe: nSinImporte, hay_costes: hayCostes, fiable: motivo === null, motivo, coste_previsto: costePrevisto,
    margen, margen_pct: margenPct,
    cobros: { total: totalCobros, cobrado, pendiente: Math.max(0, r2(totalCobros - cobrado)), facturado_cliente: totalFacturas, vencidos },
    eventos, avisos
  };
}
