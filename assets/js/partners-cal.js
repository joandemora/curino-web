/* ============================================================
 * /assets/js/partners-cal.js
 * Calendario de Cal.com embebido (llamada de admisión de Curino
 * Partners). Lo usan la pantalla final de /partners y /partners/llamada/.
 *
 *   PartnersCal.montar('#pt-cal', {
 *     name, email, attendeePhoneNumber, inversion, 'metadata[solicitud_id]'
 *   }, function onReserva() { ... });
 *
 * Los campos se prellenan por URL (Cal.com): name, email,
 * attendeePhoneNumber (+34600…), inversion (texto exacto de la opción) y
 * metadata[solicitud_id] (lo recibe el webhook cal-webhook para enlazar la
 * reserva con el contacto). onReserva se llama una vez al confirmarse.
 * ============================================================ */
(function (w) {
  'use strict';
  var CAL_LINK = 'curino/llamada-de-admision-curino-partners';

  // Snippet oficial de Cal.com (carga embed.js una sola vez)
  function cargar() {
    (function (C, A, L) {
      var p = function (a, ar) { a.q.push(ar); };
      var d = C.document;
      C.Cal = C.Cal || function () {
        var cal = C.Cal, ar = arguments;
        if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement('script')).src = A; cal.loaded = true; }
        if (ar[0] === L) {
          var api = function () { p(api, arguments); };
          var namespace = ar[1];
          api.q = api.q || [];
          if (typeof namespace === 'string') { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ['initNamespace', namespace]); }
          else p(cal, ar);
          return;
        }
        p(cal, ar);
      };
    })(w, 'https://app.cal.com/embed/embed.js', 'init');
  }

  w.PartnersCal = {
    link: 'https://cal.com/' + CAL_LINK,
    montar: function (selector, prefill, onReserva) {
      cargar();
      var config = { layout: 'month_view' };
      Object.keys(prefill || {}).forEach(function (k) { if (prefill[k]) config[k] = String(prefill[k]); });
      w.Cal('init', 'admision', { origin: 'https://cal.com' });
      w.Cal.ns.admision('inline', { elementOrSelector: selector, calLink: CAL_LINK, config: config });
      w.Cal.ns.admision('ui', { layout: 'month_view', hideEventTypeDetails: false });
      var hecho = false;
      var ok = function (e) { if (hecho) return; hecho = true; if (onReserva) onReserva(e && e.detail ? e.detail.data : null); };
      w.Cal.ns.admision('on', { action: 'bookingSuccessfulV2', callback: ok });
      w.Cal.ns.admision('on', { action: 'bookingSuccessful', callback: ok });
    }
  };
})(window);
