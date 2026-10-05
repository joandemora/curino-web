/* ============================================================
 * /assets/js/partners-mes.js
 * Mes del Intensivo Curino Partners en las páginas públicas: el de la
 * fecha de la edición abierta (hora de Madrid); sin edición, el mes
 * siguiente al actual. Rellena los elementos marcados:
 *   [data-mes]      → «noviembre»
 *   [data-mes-cap]  → «Noviembre»
 *   [data-anio]     → «2026»
 *   PartnersMes.desdeFecha(fecha) → { mes, Mes, anio }
 *   PartnersMes.pintar(info)      → rellena la página
 *   PartnersMes.cargar()          → /api/clases-proxima + pintar (Promise)
 * El HTML lleva el mes actual como texto por defecto (sin JS o si falla).
 * ============================================================ */
(function (w) {
  'use strict';
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function desdeFecha(fecha) {
    var d = fecha ? new Date(fecha) : null;
    if (!d || isNaN(d)) { var h = new Date(); d = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() + 1, 15)); }
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: 'numeric' })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var mes = MESES[Number(p.month) - 1];
    return { mes: mes, Mes: mes.charAt(0).toUpperCase() + mes.slice(1), anio: String(p.year) };
  }
  function pintar(info) {
    var set = function (sel, v) { Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) { el.textContent = v; }); };
    set('[data-mes]', info.mes); set('[data-mes-cap]', info.Mes); set('[data-anio]', info.anio);
    return info;
  }
  function cargar() {
    return fetch('/api/clases-proxima', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) { return pintar(desdeFecha(d && d.clase ? d.clase.fecha : null)); })
      .catch(function () { return pintar(desdeFecha(null)); });
  }
  w.PartnersMes = { desdeFecha: desdeFecha, pintar: pintar, cargar: cargar };
})(window);
