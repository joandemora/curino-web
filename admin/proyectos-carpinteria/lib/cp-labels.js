/* ============================================================
 * cp-labels.js — etiquetado canónico de piezas y muebles
 *
 * Fuente única de verdad para construir los identificadores
 * legibles `<PROJ>-<FURN>-<PANEL>` (ej "JOA01-M02-P05") que se
 * propagan a despiece, nesting, DXF y PDF.
 *
 * Se cuelga de window.CpLabels para que cualquier inline script
 * pueda usarlo sin imports ES6 (patrón del repo).
 * ============================================================ */
(function (global) {
  'use strict';

  // ── Construcción ─────────────────────────────────────────────
  function panel(project, furniture, p) {
    if (!project || !furniture || !p) return '';
    return [project.code, furniture.code, p.code].filter(Boolean).join('-');
  }
  function furniture(project, f) {
    if (!project || !f) return '';
    return [project.code, f.code].filter(Boolean).join('-');
  }

  // ── Parse inverso ────────────────────────────────────────────
  function parse(label) {
    if (typeof label !== 'string') return null;
    var parts = label.split('-');
    if (parts.length < 3) return null;
    // Si el código de proyecto contiene guiones (no recomendado),
    // tomamos los 2 últimos como furniture y panel.
    var panelCode = parts.pop();
    var furnitureCode = parts.pop();
    var projectCode = parts.join('-');
    return { projectCode: projectCode, furnitureCode: furnitureCode, panelCode: panelCode };
  }

  // ── Auto-sugerencia de códigos ───────────────────────────────
  // Detecta el patrón "PREFIX + número" (M01, P03, MARM12, …) en
  // los códigos existentes y sugiere el siguiente correlativo.
  //
  // - Si no hay ningún código previo o ninguno casa el patrón,
  //   devuelve `<prefix>01`.
  // - Si los códigos tienen padding (M01, M02 → M03 con padding 2),
  //   conserva el padding mayor encontrado.
  // - El admin puede sobreescribir libremente; esto solo sugiere.
  function suggestNext(existingCodes, prefix) {
    prefix = prefix || '';
    var maxNum = 0;
    var maxPad = 2;
    var re = new RegExp('^' + escapeRe(prefix) + '0*(\\d+)$', 'i');
    (existingCodes || []).forEach(function (c) {
      var m = re.exec(String(c || '').trim());
      if (!m) return;
      var n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
      // detectar padding total del bloque numérico
      var numericPart = String(c).slice(prefix.length);
      if (numericPart.length > maxPad) maxPad = numericPart.length;
    });
    var next = maxNum + 1;
    return prefix + pad(next, maxPad);
  }

  function suggestNextFurnitureCode(existingCodes) {
    return suggestNext(existingCodes, 'M');
  }
  function suggestNextPanelCode(existingCodes) {
    return suggestNext(existingCodes, 'P');
  }

  // Sugerencia para project.code: a partir del nombre del cliente,
  // toma 3-4 letras iniciales + 2 dígitos correlativos contra los
  // códigos de proyecto existentes del mismo carpintero.
  function suggestNextProjectCode(clientName, existingProjectCodes) {
    var slug = String(clientName || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3);
    if (!slug) slug = 'PROJ';
    return suggestNext(existingProjectCodes, slug);
  }

  // ── Validación ───────────────────────────────────────────────
  // Comprueba unicidad en cliente antes de guardar; el constraint
  // SQL `unique(...)` es la garantía final.
  function isCodeUnique(newCode, existingCodes, currentId) {
    if (!newCode) return false;
    return !(existingCodes || []).some(function (entry) {
      // entry puede ser string (legacy) o {id, code}.
      if (typeof entry === 'string') return entry === newCode;
      if (currentId && entry.id === currentId) return false;
      return entry.code === newCode;
    });
  }

  // ── Helpers internos ─────────────────────────────────────────
  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  }
  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  global.CpLabels = {
    panel: panel,
    furniture: furniture,
    parse: parse,
    suggestNext: suggestNext,
    suggestNextFurnitureCode: suggestNextFurnitureCode,
    suggestNextPanelCode: suggestNextPanelCode,
    suggestNextProjectCode: suggestNextProjectCode,
    isCodeUnique: isCodeUnique
  };
})(typeof window !== 'undefined' ? window : globalThis);
