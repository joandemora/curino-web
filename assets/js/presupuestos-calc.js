/* ============================================================
 * presupuestos-calc.js — Lógica de cálculo del presupuesto.
 *
 * Política de redondeo: REDONDEO POR LÍNEA. Cada columna mostrada
 * (PVP, IMPORTE) es ya un valor a 2 decimales. Los totales son la
 * suma de esos valores YA REDONDEADOS — NO se recalcula a precisión
 * completa al sumar.
 *
 * Por línea (todo a 2 decimales):
 *   pvp_linea     = r2(precio_unitario × cantidad)
 *   importe_linea = r2(pvp_linea × (1 − dto_pct/100))
 *   dto_linea     = pvp_linea − importe_linea      (resta exacta entre 2-dec)
 *
 * Totales:
 *   PVP SIN IVA      = Σ pvp_linea     (suma de 2-dec; r2 final
 *                                       neutraliza drift binario)
 *   IMPORTE TOTAL    = Σ importe_linea
 *   DTO PROFESIONAL  = IMPORTE TOTAL − PVP SIN IVA  (negativo; exacto
 *                                                   por construcción)
 *
 * Invariantes garantizadas:
 *   (I1) Σ formatEUR(pvp_linea_i)     == formatEUR(pvpSinIva)
 *   (I2) Σ formatEUR(importe_linea_i) == formatEUR(importeTotal)
 *   (I3) dtoProfesional == importeTotal − pvpSinIva
 *
 * Hitos de pago:
 *   euros = r2(IMPORTE TOTAL × pct / 100)
 *
 * Exports en window:
 *   - PresupuestosCalc.lineTotals(line) → { pvpLinea, importeLinea, dtoLinea }
 *   - PresupuestosCalc.quoteTotals(lines) → { pvpSinIva, dtoProfesional, importeTotal, lineas:[...] }
 *   - PresupuestosCalc.paymentMilestones(formaPago, importeTotal) → [{concepto, pct, eur}]
 * ============================================================ */
(function () {
  'use strict';

  function r2(n) {
    return Math.round((n || 0) * 100) / 100;
  }

  function lineTotals(line) {
    var precio = Number(line.precio_unitario) || 0;
    var cant   = Number(line.cantidad) || 0;
    var dto    = Number(line.dto_pct);
    if (!isFinite(dto)) dto = 0;

    // Redondeo por línea: cada cifra que se mostrará en una columna
    // es independientemente r2. El importe se calcula sobre el PVP
    // YA redondeado (cascade), de modo que dtoLinea = PVP - IMP es
    // exacta a 2 decimales (resta de dos 2-dec).
    var pvpLinea     = r2(precio * cant);
    var importeLinea = r2(pvpLinea * (1 - dto / 100));
    var dtoLinea     = r2(pvpLinea - importeLinea);

    return {
      pvpLinea:     pvpLinea,
      importeLinea: importeLinea,
      dtoLinea:     dtoLinea
    };
  }

  function quoteTotals(lines) {
    // total = Σ de líneas YA redondeadas (no recálculo full-precision).
    // r2 final sobre la suma neutraliza drift binario residual.
    var pvpSum = 0;
    var impSum = 0;
    var enriched = [];
    (lines || []).forEach(function (l) {
      var t = lineTotals(l);
      pvpSum += t.pvpLinea;
      impSum += t.importeLinea;
      enriched.push({
        id: l.id,
        pvpLinea:     t.pvpLinea,
        importeLinea: t.importeLinea,
        dtoLinea:     t.dtoLinea
      });
    });
    var pvpSinIva    = r2(pvpSum);
    var importeTotal = r2(impSum);
    return {
      pvpSinIva:      pvpSinIva,
      importeTotal:   importeTotal,
      // Construcción que satisface (I3) exactamente:
      dtoProfesional: r2(importeTotal - pvpSinIva),
      lineas:         enriched
    };
  }

  function paymentMilestones(formaPago, importeTotal) {
    if (!Array.isArray(formaPago)) return [];
    return formaPago.map(function (m) {
      var pct = Number(m.pct) || 0;
      return {
        concepto: String(m.concepto || ''),
        pct:      pct,
        eur:      r2(importeTotal * pct / 100)
      };
    });
  }

  window.PresupuestosCalc = {
    lineTotals: lineTotals,
    quoteTotals: quoteTotals,
    paymentMilestones: paymentMilestones,
    r2: r2
  };
})();
