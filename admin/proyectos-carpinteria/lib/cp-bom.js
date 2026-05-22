/* ============================================================
 * cp-bom.js — motor de despiece (Bill of Materials)
 *
 * Pure JS sin dependencias. Recibe la estructura jerárquica
 * de un proyecto (project + furnitures + panels + edges +
 * operations + furniture_hardware) más diccionarios de
 * materials y hardware, y devuelve una lista plana de líneas
 * BOM por mueble.
 *
 * No habla con Supabase. No conoce IVA ni margen — eso vive
 * en cp-budget.js (que consume el BOM).
 *
 * Convenciones:
 *   - Todas las dimensiones de entrada en mm.
 *   - m² = (w_mm × h_mm) / 1_000_000.
 *   - ml = mm / 1_000.
 *   - Perímetro de corte = 2·(w + h) en mm → ml.
 *   - "Edge ml": top/bottom = width_mm; left/right = height_mm.
 *   - Las cantidades (qty) multiplican TODO (m², ml, coste).
 *   - Material panel: cost_per_m2_eur. Material edge_band:
 *     cost_per_ml_eur. Hardware: cost_eur por unidad.
 *
 * Estructura de salida:
 *   {
 *     furnitures: [{
 *       id, code, name,
 *       lines: [
 *         { kind: 'panel_material'|'cut'|'edge_material'|'edge_band_labor'|'hardware',
 *           panel_id?, edge?, hardware_id?, material_id?,
 *           qty, unit, units, // ej qty=2 unit='m²' units=1.20  → total = qty * units
 *           cost_per_unit_eur, cost_eur,
 *           // sale_per_unit_eur y sale_eur se calculan en cp-budget.js
 *           description }
 *       ],
 *       cost_eur            // suma de cost_eur de las líneas
 *     }],
 *     project_cost_eur      // suma de todos los muebles + extra_costs
 *   }
 *
 * `kind` describe el origen para que cp-budget.js sepa cómo aplicar
 * margen / override de PVP.
 * ============================================================ */
(function (global) {
  'use strict';

  // ── Constantes de unidades ────────────────────────────────────
  var MM2_TO_M2 = 1e-6;
  var MM_TO_M = 1e-3;

  // ── Construcción del BOM ──────────────────────────────────────
  function compute(input) {
    // input = { project, furnitures, materials, hardware, panelsByFurniture,
    //           edgesByPanel, opsByPanel, furnitureHardwareByFurniture }
    var p = input.project || {};
    var matIndex = indexById(input.materials || []);
    var hwIndex  = indexById(input.hardware  || []);

    var furnituresOut = (input.furnitures || []).map(function (f) {
      var lines = [];
      var panels = (input.panelsByFurniture && input.panelsByFurniture[f.id]) || [];

      panels.forEach(function (panel) {
        var material = matIndex[panel.material_id];
        var w = toNum(panel.width_mm);
        var h = toNum(panel.height_mm);
        var qty = Math.max(1, Math.round(toNum(panel.qty) || 1));

        // 1) Material del tablero
        if (material && material.type === 'panel') {
          var m2_per_unit = (w * h) * MM2_TO_M2;
          var cost_per_unit = toNum(material.cost_per_m2_eur);
          lines.push({
            kind: 'panel_material',
            panel_id: panel.id,
            panel_code: panel.code,
            material_id: material.id,
            material_name: material.name,
            description: 'Tablero ' + material.name + ' (' + format(w) + '×' + format(h) + ' mm)',
            qty: qty,
            unit: 'm²',
            units_per_qty: m2_per_unit,
            total_units: m2_per_unit * qty,
            cost_per_unit_eur: cost_per_unit,
            cost_eur: round4(m2_per_unit * cost_per_unit * qty)
          });
        }

        // 2) Corte MO (perímetro)
        var perimeter_mm = 2 * (w + h);
        var cut_ml_per_unit = perimeter_mm * MM_TO_M;
        var rate_cut = toNum(p.rate_cut_per_ml_eur);
        lines.push({
          kind: 'cut',
          panel_id: panel.id,
          panel_code: panel.code,
          description: 'Corte perímetro pieza ' + panel.code,
          qty: qty,
          unit: 'ml',
          units_per_qty: cut_ml_per_unit,
          total_units: cut_ml_per_unit * qty,
          cost_per_unit_eur: rate_cut,
          cost_eur: round4(cut_ml_per_unit * rate_cut * qty)
        });

        // 3) Cantos: 1 línea de material + 1 línea de MO por edge con canto.
        var edges = (input.edgesByPanel && input.edgesByPanel[panel.id]) || [];
        edges.forEach(function (edge) {
          var edgeMaterial = matIndex[edge.edge_material_id];
          if (!edgeMaterial || edgeMaterial.type !== 'edge_band') return;

          var edge_mm = (edge.edge === 'top' || edge.edge === 'bottom') ? w : h;
          var edge_ml_per_unit = edge_mm * MM_TO_M;

          // 3a) material del canto
          var cost_per_ml_mat = toNum(edgeMaterial.cost_per_ml_eur);
          lines.push({
            kind: 'edge_material',
            panel_id: panel.id,
            panel_code: panel.code,
            edge: edge.edge,
            material_id: edgeMaterial.id,
            material_name: edgeMaterial.name,
            description: 'Canto ' + edgeMaterial.name + ' (' + edgeLabel(edge.edge) + ' de ' + panel.code + ')',
            qty: qty,
            unit: 'ml',
            units_per_qty: edge_ml_per_unit,
            total_units: edge_ml_per_unit * qty,
            cost_per_unit_eur: cost_per_ml_mat,
            cost_eur: round4(edge_ml_per_unit * cost_per_ml_mat * qty)
          });

          // 3b) MO canteado
          var rate_eb = toNum(p.rate_edge_band_per_ml_eur);
          lines.push({
            kind: 'edge_band_labor',
            panel_id: panel.id,
            panel_code: panel.code,
            edge: edge.edge,
            description: 'Canteado MO (' + edgeLabel(edge.edge) + ' de ' + panel.code + ')',
            qty: qty,
            unit: 'ml',
            units_per_qty: edge_ml_per_unit,
            total_units: edge_ml_per_unit * qty,
            cost_per_unit_eur: rate_eb,
            cost_eur: round4(edge_ml_per_unit * rate_eb * qty)
          });
        });
      });

      // 4) Herrajes del mueble
      var hws = (input.furnitureHardwareByFurniture && input.furnitureHardwareByFurniture[f.id]) || [];
      hws.forEach(function (row) {
        var hw = hwIndex[row.hardware_id];
        if (!hw) return;
        var qty = Math.max(1, Math.round(toNum(row.qty) || 1));
        var cost_per_unit = toNum(hw.cost_eur);
        lines.push({
          kind: 'hardware',
          hardware_id: hw.id,
          hardware_name: hw.name,
          description: 'Herraje ' + hw.name + (hw.reference ? ' (' + hw.reference + ')' : ''),
          qty: qty,
          unit: 'ud',
          units_per_qty: 1,
          total_units: qty,
          cost_per_unit_eur: cost_per_unit,
          cost_eur: round4(cost_per_unit * qty)
        });
      });

      var subtotal_cost = lines.reduce(function (acc, l) { return acc + l.cost_eur; }, 0);

      return {
        id: f.id,
        code: f.code,
        name: f.name,
        lines: lines,
        cost_eur: round4(subtotal_cost)
      };
    });

    var project_cost = furnituresOut.reduce(function (acc, f) { return acc + f.cost_eur; }, 0);

    return {
      furnitures: furnituresOut,
      project_cost_eur: round4(project_cost)
    };
  }

  // ── Helpers ───────────────────────────────────────────────────
  function indexById(arr) {
    var out = {};
    (arr || []).forEach(function (x) { if (x && x.id) out[x.id] = x; });
    return out;
  }
  function toNum(v) {
    if (v == null) return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function round4(v) {
    // Redondeo a 4 decimales para evitar arrastres de coma flotante;
    // el formateo a 2 decimales para presentación lo hace cp-budget.js.
    return Math.round(v * 10000) / 10000;
  }
  function format(v) {
    return String(Math.round(v));
  }
  function edgeLabel(e) {
    switch (e) {
      case 'top':    return 'borde sup.';
      case 'bottom': return 'borde inf.';
      case 'left':   return 'borde izq.';
      case 'right':  return 'borde der.';
      default:       return e;
    }
  }

  global.CpBom = { compute: compute };
})(typeof window !== 'undefined' ? window : globalThis);
