/* ============================================================
 * cp-budget.js — motor de presupuesto
 *
 * Capa sobre cp-bom.js:
 *   1. Aplica margen y override de PVP a cada línea del BOM
 *      para obtener `sale_eur`.
 *   2. Suma `extra_costs` del proyecto (jsonb).
 *   3. Aplica IVA del proyecto al PVP base.
 *   4. Calcula totales y produce un objeto formateado para
 *      mostrar en UI o exportar a PDF.
 *
 * REGLA DE OVERRIDE DE PVP (lectura cuidadosa):
 *   Cada material puede tener `sale_per_m2_eur` o `sale_per_ml_eur`
 *   (panel y edge_band respectivamente). Cada hardware puede
 *   tener `sale_eur`. Si esos overrides están definidos (no null),
 *   se usan TAL CUAL como PVP por unidad — IGNORANDO el margen
 *   del proyecto para esa línea.
 *
 *   En cambio, las líneas de mano de obra (`cut`, `edge_band_labor`)
 *   no admiten override por material — su PVP siempre se calcula
 *   aplicando el margen del proyecto sobre la tarifa.
 *
 *   Si un override está definido pero es 0, se interpreta como
 *   "PVP cero" (regalo), no como "sin override".
 *
 * NO habla con Supabase. Pure JS.
 * ============================================================ */
(function (global) {
  'use strict';

  function build(bom, ctx) {
    // ctx = { project, materialsById, hardwareById }
    var project = ctx.project || {};
    var matById = ctx.materialsById || {};
    var hwById  = ctx.hardwareById  || {};
    var margin = toNum(project.margin_percent);      // ej 30.00 → factor 1.30
    var vat    = toNum(project.vat_percent);         // ej 21.00

    var furnitures = (bom.furnitures || []).map(function (f) {
      var lines = f.lines.map(function (l) {
        var sale_per_unit, sale_total;
        var hasOverride = false;
        var overrideSource = null;

        if (l.kind === 'panel_material' && l.material_id && matById[l.material_id]) {
          var mat = matById[l.material_id];
          if (mat.sale_per_m2_eur != null) {
            hasOverride = true; overrideSource = 'material.sale_per_m2_eur';
            sale_per_unit = toNum(mat.sale_per_m2_eur);
          }
        }
        if (l.kind === 'edge_material' && l.material_id && matById[l.material_id]) {
          var em = matById[l.material_id];
          if (em.sale_per_ml_eur != null) {
            hasOverride = true; overrideSource = 'material.sale_per_ml_eur';
            sale_per_unit = toNum(em.sale_per_ml_eur);
          }
        }
        if (l.kind === 'hardware' && l.hardware_id && hwById[l.hardware_id]) {
          var hw = hwById[l.hardware_id];
          if (hw.sale_eur != null) {
            hasOverride = true; overrideSource = 'hardware.sale_eur';
            sale_per_unit = toNum(hw.sale_eur);
          }
        }

        if (hasOverride) {
          // Override: PVP unitario fijado; ignora margen del proyecto.
          sale_total = round4(sale_per_unit * l.total_units);
        } else {
          // Sin override: aplica margen.
          var factor = 1 + (margin / 100);
          sale_per_unit = round4(toNum(l.cost_per_unit_eur) * factor);
          sale_total = round4(toNum(l.cost_eur) * factor);
        }

        return Object.assign({}, l, {
          sale_per_unit_eur: sale_per_unit,
          sale_eur: sale_total,
          has_sale_override: hasOverride,
          sale_override_source: overrideSource
        });
      });

      var cost_eur = lines.reduce(function (a, l) { return a + l.cost_eur; }, 0);
      var sale_eur = lines.reduce(function (a, l) { return a + l.sale_eur; }, 0);

      return {
        id: f.id, code: f.code, name: f.name,
        lines: lines,
        cost_eur: round4(cost_eur),
        sale_eur: round4(sale_eur)
      };
    });

    // Costes extra del proyecto (jsonb): cada {label, amount_eur}.
    // Convención: amount_eur ya es PVP (no margen aplicado).
    var extras = Array.isArray(project.extra_costs) ? project.extra_costs : [];
    var extraSale = extras.reduce(function (a, e) { return a + toNum(e && e.amount_eur); }, 0);

    var subtotalCost = furnitures.reduce(function (a, f) { return a + f.cost_eur; }, 0);
    var subtotalSale = furnitures.reduce(function (a, f) { return a + f.sale_eur; }, 0) + extraSale;

    var vat_eur   = round4(subtotalSale * (vat / 100));
    var total_eur = round4(subtotalSale + vat_eur);

    return {
      furnitures: furnitures,
      extras: extras.map(function (e) {
        return { label: String(e && e.label || ''), amount_eur: round4(toNum(e && e.amount_eur)) };
      }),
      totals: {
        cost_eur:           round4(subtotalCost),
        sale_subtotal_eur:  round4(subtotalSale),
        vat_percent:        vat,
        vat_eur:            vat_eur,
        total_with_vat_eur: total_eur,
        margin_percent:     margin
      },
      formatted: {
        cost_eur:           eur(subtotalCost),
        sale_subtotal_eur:  eur(subtotalSale),
        vat_eur:            eur(vat_eur),
        total_with_vat_eur: eur(total_eur)
      }
    };
  }

  // ── Helpers ───────────────────────────────────────────────────
  function toNum(v) {
    if (v == null) return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function eur(v) {
    return round2(v).toFixed(2).replace('.', ',') + ' €';
  }

  global.CpBudget = {
    build: build,
    _format: eur,
    _round2: round2,
    _round4: round4
  };
})(typeof window !== 'undefined' ? window : globalThis);
