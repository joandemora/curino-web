/* ============================================================
 * presupuestos-calc.js — Lógica de cálculo del presupuesto.
 *
 * Función PURA. Sin redondeo intermedio: se suma con precisión
 * full-double y solo se redondea a 2 dec al exponer cada total.
 *
 * Por línea:
 *   pvp_linea     = precio_unitario × cantidad
 *   importe_linea = pvp_linea × (1 − dto_pct/100)
 *
 * Totales:
 *   PVP SIN IVA      = Σ pvp_linea
 *   IMPORTE TOTAL    = Σ importe_linea
 *   DTO PROFESIONAL  = IMPORTE TOTAL − PVP SIN IVA  (queda en negativo)
 *
 * Hitos de pago:
 *   euros = IMPORTE TOTAL × pct / 100
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

    var pvpLinea     = precio * cant;
    var importeLinea = pvpLinea * (1 - dto / 100);
    var dtoLinea     = pvpLinea - importeLinea;

    return {
      pvpLinea:     pvpLinea,
      importeLinea: importeLinea,
      dtoLinea:     dtoLinea
    };
  }

  function quoteTotals(lines) {
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
    return {
      pvpSinIva:      r2(pvpSum),
      importeTotal:   r2(impSum),
      dtoProfesional: r2(impSum - pvpSum),   // negativo (importe < pvp)
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
