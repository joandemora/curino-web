// /assets/js/partners-checkout-dialog.js
//
// Modulo compartido del dialogo de compra del curso Curino.
// Extraido de /partners/index.html en agosto 2026 para poder
// reutilizarse en /partners/clase/ (landing de la clase gratuita)
// sin duplicar la logica.
//
// Rompe la autocontencion de /partners/ (era 100% inline salvo
// cookie-banner.js). Segunda excepcion aceptada.
//
// Uso desde una pagina:
//   <script src="/assets/js/partners-checkout-dialog.js" defer></script>
//   <script>
//     PartnersCheckoutDialog.init({ origin: 'partners' });  // o 'partners-clase'
//   </script>
//   <button data-open-form>Comprar el curso</button>
//
// El botón con [data-open-form] abre el dialogo automaticamente
// (el modulo escucha estos clicks). Para abrirlo por codigo:
//   PartnersCheckoutDialog.open();
//
// Contrato con /api/curso-checkout: se envia `origin` en el body
// para que la Edge Function determine `cancel_url`:
//   'partners'        -> cancel_url = SITE_URL/partners/
//   'partners-clase'  -> cancel_url = SITE_URL/partners/clase/
// success_url siempre a /partners/gracias/.
//
// Comparte namespace sessionStorage con la landing:
//   curino_curso_utms      (UTMs capturadas al aterrizar)
//   curino_curso_event_id  (UUID del begin_checkout / dedup GA4)

(function () {
  'use strict';

  if (window.PartnersCheckoutDialog) return; // idempotente

  var CSS = ''
    + 'dialog.pcd-dialog{padding:0;border:1px solid var(--border);border-radius:var(--radius-lg);'
    + 'max-width:480px;width:calc(100% - 32px);background:var(--surface);color:var(--text);'
    + 'box-shadow:0 40px 80px rgba(0,0,0,0.5);}'
    + 'dialog.pcd-dialog::backdrop{background:rgba(14,11,50,0.85);backdrop-filter:blur(4px);}'
    + '.pcd-body{padding:32px 28px;position:relative;}'
    + '.pcd-body h2{margin:0 0 6px;font-size:clamp(22px,3vw,26px);font-family:var(--font-heading);'
    + 'font-weight:700;color:var(--text);line-height:1.1;}'
    + '.pcd-body .pcd-subtitle{font-size:13px;color:var(--text-muted);margin:0 0 24px;letter-spacing:0.01em;}'
    + '.pcd-close{position:absolute;top:16px;right:16px;background:transparent;border:1px solid transparent;'
    + 'font-size:22px;cursor:pointer;color:var(--text-muted);padding:4px 10px;line-height:1;border-radius:6px;'
    + 'font-family:inherit;}'
    + '.pcd-close:hover{color:var(--text);border-color:var(--border);}'
    + '.pcd-group{margin-bottom:16px;}'
    + '.pcd-group label{display:block;font-size:12px;font-weight:600;color:var(--text-muted);'
    + 'margin-bottom:8px;letter-spacing:0.08em;text-transform:uppercase;}'
    + '.pcd-group input[type="text"],.pcd-group input[type="email"],.pcd-group input[type="tel"]{'
    + 'width:100%;padding:12px 14px;background:var(--bg);border:1px solid var(--border);'
    + 'border-radius:var(--radius-md);font-size:15px;font-family:inherit;color:var(--text);box-sizing:border-box;}'
    + '.pcd-group input:focus{outline:none;border-color:var(--accent);}'
    + '.pcd-hint{font-size:12px;color:var(--text-dim);margin:6px 0 0;}'
    + '.pcd-checkbox{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;'
    + 'background:var(--accent-ghost);border:1px solid var(--accent-border);'
    + 'border-radius:var(--radius-md);margin:18px 0;}'
    + '.pcd-checkbox input{margin-top:3px;flex-shrink:0;accent-color:var(--accent);}'
    + '.pcd-checkbox label{font-size:13px;color:var(--text);line-height:1.5;font-weight:400;'
    + 'text-transform:none;letter-spacing:0;margin:0;}'
    + '.pcd-error{color:var(--danger);font-size:14px;margin:12px 0 0;min-height:20px;}'
    + '.pcd-submit{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;'
    + 'padding:14px 24px;border:1px solid transparent;border-radius:var(--radius-md);'
    + 'background:var(--accent);color:#fff;font-family:inherit;font-size:15px;font-weight:600;'
    + 'line-height:1;cursor:pointer;min-height:48px;box-shadow:0 10px 30px -12px var(--accent);'
    + 'transition:transform 120ms ease,background 120ms ease;}'
    + '.pcd-submit:hover:not(:disabled){background:var(--accent-strong);transform:translateY(-1px);}'
    + '.pcd-submit:disabled{background:var(--surface-2);color:var(--text-dim);'
    + 'box-shadow:none;cursor:not-allowed;transform:none;}'
    + '.pcd-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;'
    + 'opacity:0;pointer-events:none;}'
    + '@media (prefers-reduced-motion:reduce){.pcd-submit{transition:none;}}';

  var HTML = ''
    + '<div class="pcd-body">'
    +   '<button class="pcd-close" type="button" aria-label="Cerrar" data-pcd-close>&times;</button>'
    +   '<h2 id="pcd-title">Comprar el curso</h2>'
    +   '<p class="pcd-subtitle">4 clases · 2 h · 90 € IVA incluido</p>'
    +   '<form class="pcd-form" novalidate>'
    +     '<div class="pcd-group">'
    +       '<label for="pcd-nombre">Nombre y apellidos</label>'
    +       '<input type="text" id="pcd-nombre" name="nombre" required autocomplete="name" minlength="2" maxlength="120">'
    +     '</div>'
    +     '<div class="pcd-group">'
    +       '<label for="pcd-email">Email</label>'
    +       '<input type="email" id="pcd-email" name="email" required autocomplete="email" maxlength="200">'
    +       '<p class="pcd-hint">Te enviamos aquí el enlace de acceso al curso y la factura.</p>'
    +     '</div>'
    +     '<div class="pcd-group">'
    +       '<label for="pcd-telefono">Teléfono (opcional)</label>'
    +       '<input type="tel" id="pcd-telefono" name="telefono" autocomplete="tel" maxlength="40">'
    +     '</div>'
    +     '<div class="pcd-checkbox">'
    +       '<input type="checkbox" id="pcd-desist" name="desist" required>'
    +       '<label for="pcd-desist">Solicito acceder inmediatamente al contenido digital del curso y acepto expresamente que, una vez que se me dé acceso al contenido, pierdo el derecho de desistimiento (art. 103.m texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios).</label>'
    +     '</div>'
    +     '<button class="pcd-submit" type="submit">Pagar 90 € y empezar <span class="pcd-arrow">→</span></button>'
    +     '<p class="pcd-error" role="alert"></p>'
    +   '</form>'
    + '</div>';

  var PRICE_CENTS = 9000;
  var ITEM_ID = 'curso-carpinteria';
  var ITEM_NAME = 'Curso Curino: vender carpinteria a medida sin ser carpintero';

  var config = { origin: 'partners' };
  var dlgEl = null;
  var initialized = false;

  function $(sel, ctx) { return (ctx || dlgEl).querySelector(sel); }
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function getUtms() {
    try {
      var raw = sessionStorage.getItem('curino_curso_utms');
      return raw ? JSON.parse(raw) : {};
    } catch (_e) { return {}; }
  }

  function resetSubmit() {
    var s = $('.pcd-submit');
    if (s) {
      s.removeAttribute('disabled');
      s.innerHTML = 'Pagar 90 € y empezar <span class="pcd-arrow">→</span>';
    }
    var e = $('.pcd-error');
    if (e) e.textContent = '';
  }

  function open() {
    if (!initialized) { console.warn('PartnersCheckoutDialog.open() sin init()'); return; }
    resetSubmit();
    if (dlgEl.showModal) dlgEl.showModal(); else dlgEl.setAttribute('open', 'open');

    var eid = uuid();
    try { sessionStorage.setItem('curino_curso_event_id', eid); } catch (_e) {}
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'begin_checkout',
        event_id: eid,
        ecommerce: {
          currency: 'EUR',
          value: PRICE_CENTS / 100,
          items: [{
            item_id: ITEM_ID,
            item_name: ITEM_NAME,
            price: PRICE_CENTS / 100,
            quantity: 1
          }]
        }
      });
    } catch (_e) {}
  }

  function close() {
    if (!dlgEl) return;
    if (dlgEl.close) dlgEl.close(); else dlgEl.removeAttribute('open');
  }

  function handleSubmit(ev) {
    ev.preventDefault();

    var nombre = $('#pcd-nombre').value.trim();
    var email = $('#pcd-email').value.trim().toLowerCase();
    var telefono = $('#pcd-telefono').value.trim();
    var desist = $('#pcd-desist').checked;
    var event_id = sessionStorage.getItem('curino_curso_event_id') || uuid();
    var errEl = $('.pcd-error');
    var btn = $('.pcd-submit');

    errEl.textContent = '';

    if (nombre.length < 2) { errEl.textContent = 'Escribe tu nombre.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'Email no valido.'; return; }
    if (!desist) { errEl.textContent = 'Debes marcar la casilla para continuar.'; return; }

    var utms = getUtms();

    btn.setAttribute('disabled', 'disabled');
    btn.innerHTML = 'Redirigiendo a Stripe…';

    fetch('/api/curso-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        origin: config.origin,
        nombre: nombre, email: email, telefono: telefono,
        desistimiento_renunciado: true, event_id: event_id,
        utm_source: utms.utm_source || '',
        utm_medium: utms.utm_medium || '',
        utm_campaign: utms.utm_campaign || ''
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (resp) {
        if (!resp.ok || !resp.data || !resp.data.checkout_url) {
          var msg = 'No hemos podido iniciar el pago. ';
          if (resp.data && resp.data.error === 'invalid_email') msg = 'Email no valido.';
          else if (resp.data && resp.data.error === 'desistimiento_required') msg = 'Debes marcar la casilla para continuar.';
          else msg += 'Prueba en unos segundos o escribeme a info@casacurino.com.';
          errEl.textContent = msg;
          resetSubmit();
          return;
        }
        window.location.assign(resp.data.checkout_url);
      })
      .catch(function () {
        errEl.textContent = 'Error de red. Prueba en unos segundos.';
        resetSubmit();
      });
  }

  function init(opts) {
    if (initialized) return;
    if (opts && opts.origin === 'partners-clase') config.origin = 'partners-clase';

    // Inject CSS
    var style = document.createElement('style');
    style.setAttribute('data-partners-checkout-dialog', '');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Build dialog
    dlgEl = document.createElement('dialog');
    dlgEl.className = 'pcd-dialog';
    dlgEl.setAttribute('aria-labelledby', 'pcd-title');
    dlgEl.innerHTML = HTML;
    document.body.appendChild(dlgEl);

    // Wire events
    dlgEl.querySelector('[data-pcd-close]').addEventListener('click', close);
    dlgEl.querySelector('.pcd-form').addEventListener('submit', handleSubmit);
    dlgEl.addEventListener('click', function (e) {
      if (e.target !== dlgEl) return; // click en el backdrop, no en contenido
      close();
    });

    // Wire external open buttons: cualquier elemento con [data-open-form] abre.
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-open-form]') : null;
      if (t) { e.preventDefault(); open(); }
    });

    initialized = true;
  }

  window.PartnersCheckoutDialog = {
    init: init,
    open: open,
    close: close
  };
})();
