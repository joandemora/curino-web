/* ============================================================
 * presupuestos-format.js — utilidades de formato ES.
 *
 * Funciones puras. Sin dependencias. Reutilizables en listado,
 * editor, preview y API.
 *
 * Exports en window:
 *   - formatEUR(n)     → "1.254,29 €" (punto miles, coma decimal)
 *   - formatEURSigned  → igual, pero con signo "-" para negativos visibles
 *   - parseEUR(str)    → number a partir de "1.254,29" o "1254.29"
 *   - formatDateShort(d) → "01/06/2026"  (entrada: Date | "2026-06-01" | "")
 *   - formatDateLong(d)  → "lunes, 1 de junio de 2026"
 *   - r2(n)            → Math.round a 2 decimales sin acumular error binario
 * ============================================================ */
(function () {
  'use strict';

  function r2(n) {
    if (!isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function formatEUR(n) {
    var v = isFinite(n) ? r2(n) : 0;
    // toLocaleString es-ES da "1.234,56" — perfecto.
    return v.toLocaleString('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' €';
  }

  // Igual que formatEUR pero con signo. Útil para "DTO. PROFESIONAL" (negativo).
  function formatEURSigned(n) {
    var v = isFinite(n) ? r2(n) : 0;
    var sign = v < 0 ? '-' : '';
    return sign + Math.abs(v).toLocaleString('es-ES', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' €';
  }

  // Acepta "1.254,29" (es-ES) o "1254.29" (raw) o number.
  function parseEUR(s) {
    if (typeof s === 'number') return isFinite(s) ? s : 0;
    if (s == null) return 0;
    var t = String(s).trim().replace(/\s|€/g, '');
    if (!t) return 0;
    // si tiene coma, asumimos es-ES → quita puntos miles, cambia coma por punto
    if (t.indexOf(',') !== -1) {
      t = t.replace(/\./g, '').replace(',', '.');
    }
    var v = parseFloat(t);
    return isFinite(v) ? v : 0;
  }

  function toDate(d) {
    if (d instanceof Date) return d;
    if (!d) return null;
    // soporta "YYYY-MM-DD" o ISO completo
    var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    var x = new Date(d);
    return isNaN(x.getTime()) ? null : x;
  }

  function formatDateShort(d) {
    var x = toDate(d);
    if (!x) return '';
    var dd = String(x.getDate()).padStart(2, '0');
    var mm = String(x.getMonth() + 1).padStart(2, '0');
    var yy = x.getFullYear();
    return dd + '/' + mm + '/' + yy;
  }

  function formatDateLong(d) {
    var x = toDate(d);
    if (!x) return '';
    return x.toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  window.PresupuestosFormat = {
    r2: r2,
    formatEUR: formatEUR,
    formatEURSigned: formatEURSigned,
    parseEUR: parseEUR,
    formatDateShort: formatDateShort,
    formatDateLong: formatDateLong
  };
})();
