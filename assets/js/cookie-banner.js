/* ============================================================
 * cookie-banner.js — Banner de consentimiento de cookies global.
 *
 * Trabaja en tándem con el snippet de Consent Mode v2 + GTM que
 * vive inline en el <head> de cada página con tracking. El
 * snippet inline declara los defaults (todo denied) y, si la
 * decisión cacheada en localStorage ya es 'granted', actualiza
 * a granted ANTES de que GTM cargue.
 *
 * Este componente cubre el caso opuesto: el usuario aún NO
 * decidió. Muestra el banner; al pulsar Aceptar/Rechazar guarda
 * la decisión en localStorage y, si acepta, dispara
 * gtag('consent','update',{...granted}) para que GTM reactive
 * las tags.
 *
 * Persistencia:
 *   localStorage.curino_consent ∈ {'granted','denied'} | absent
 *   Try/catch en todos los accesos por si el navegador no
 *   permite localStorage (Safari ITP, modo privado estricto).
 *
 * Reapertura:
 *   document.dispatchEvent(new CustomEvent('curino:open-cookie-banner'))
 *   El enlace "Configurar cookies" del main-footer.js dispara
 *   este evento.
 *
 * Posicionamiento bottom-bar fijo con z-index 9999 para quedar
 * por encima de cualquier sticky de la página (mob-bar del
 * checkout tiene z-index:300; .megamenu z-index:199; etc.). En
 * /checkout/ mobile, el banner aparece encima del mob-bar
 * durante los segundos previos a la decisión del usuario, sin
 * romper la mob-bar — solo se solapa visualmente y queda libre
 * en cuanto el usuario pulsa un botón.
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'curino_consent';
  var BANNER_ID = 'curino-cookie-banner';

  // ── Helpers localStorage con try/catch defensivo
  function getDecision() {
    try { return localStorage.getItem(STORAGE_KEY); }
    catch (_e) { return null; }
  }
  function setDecision(value) {
    try { localStorage.setItem(STORAGE_KEY, value); }
    catch (_e) { /* navegador bloquea localStorage; no se persiste, pero no rompe */ }
  }

  // ── Helpers Consent Mode (gtag)
  // El snippet inline del <head> ya definió window.gtag/dataLayer.
  // Si por algún motivo no estuvieran, los definimos defensivamente.
  function ensureGtag() {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
  }
  function updateConsent(granted) {
    ensureGtag();
    if (granted) {
      window.gtag('consent', 'update', {
        ad_storage: 'granted',
        analytics_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted'
      });
    }
    // Si rechaza, no llamamos update — el default declarado en el
    // snippet inline ya es 'denied' para todo.
  }

  // ── CSS inline (auto-contenido, sin dependencia de site-shell.css)
  function injectStyles() {
    if (document.getElementById(BANNER_ID + '-styles')) return;
    var style = document.createElement('style');
    style.id = BANNER_ID + '-styles';
    style.textContent = [
      '#' + BANNER_ID + '{',
      '  position:fixed;left:0;right:0;bottom:0;z-index:9999;',
      '  background:#fff;border-top:1px solid #e5e5e5;',
      '  box-shadow:0 -4px 16px rgba(0,0,0,.08);',
      '  font-family:"Open Sans",system-ui,sans-serif;',
      '  font-size:13px;line-height:1.55;color:#0a0a0a;',
      '  padding:16px 24px;display:none;',
      '}',
      '#' + BANNER_ID + '.visible{display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:space-between}',
      '#' + BANNER_ID + ' .cb-text{flex:1;min-width:280px;max-width:780px}',
      '#' + BANNER_ID + ' .cb-text a{color:#0a0a0a;text-decoration:underline}',
      '#' + BANNER_ID + ' .cb-actions{display:flex;gap:8px;flex-shrink:0}',
      '#' + BANNER_ID + ' .cb-btn{',
      '  display:inline-block;padding:.65rem 1.5rem;font-family:inherit;',
      '  font-size:12px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;',
      '  border:1px solid #0a0a0a;cursor:pointer;transition:background .2s,color .2s;',
      '  border-radius:0;',
      '}',
      '#' + BANNER_ID + ' .cb-btn-accept{background:#0a0a0a;color:#fff}',
      '#' + BANNER_ID + ' .cb-btn-accept:hover{background:#333;border-color:#333}',
      '#' + BANNER_ID + ' .cb-btn-reject{background:#fff;color:#0a0a0a}',
      '#' + BANNER_ID + ' .cb-btn-reject:hover{background:#0a0a0a;color:#fff}',
      '@media(max-width:640px){',
      '  #' + BANNER_ID + '{padding:14px 16px}',
      '  #' + BANNER_ID + ' .cb-text{font-size:12px;min-width:0;width:100%}',
      '  #' + BANNER_ID + ' .cb-actions{width:100%}',
      '  #' + BANNER_ID + ' .cb-btn{flex:1;padding:.65rem .5rem;font-size:11px;letter-spacing:.1em}',
      '}'
    ].join('');
    document.head.appendChild(style);
  }

  // ── Construir DOM del banner (idempotente)
  function buildBanner() {
    if (document.getElementById(BANNER_ID)) return document.getElementById(BANNER_ID);
    var el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Aviso de cookies');
    el.innerHTML =
      '<div class="cb-text">' +
        'Usamos cookies propias y de terceros para analizar el uso del sitio y mejorar tu experiencia. ' +
        'Puedes aceptarlas o rechazarlas. Más información en nuestra ' +
        '<a href="/cookies/">Política de cookies</a> y ' +
        '<a href="/privacidad/">Privacidad</a>.' +
      '</div>' +
      '<div class="cb-actions">' +
        '<button type="button" class="cb-btn cb-btn-reject" data-cb-reject>Rechazar</button>' +
        '<button type="button" class="cb-btn cb-btn-accept" data-cb-accept>Aceptar</button>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('[data-cb-accept]').addEventListener('click', function () {
      setDecision('granted');
      updateConsent(true);
      hide();
    });
    el.querySelector('[data-cb-reject]').addEventListener('click', function () {
      setDecision('denied');
      // No llamamos updateConsent — el default ya es denied (declarado en el snippet inline).
      hide();
    });
    return el;
  }

  function show() {
    injectStyles();
    var el = buildBanner();
    el.classList.add('visible');
  }
  function hide() {
    var el = document.getElementById(BANNER_ID);
    if (el) el.classList.remove('visible');
  }

  // ── Inicialización
  function init() {
    var decision = getDecision();
    // Solo mostrar si NO hay decisión previa. Aceptado y rechazado no
    // vuelven a ver el banner salvo que pulsen "Configurar cookies".
    if (decision !== 'granted' && decision !== 'denied') {
      show();
    }
    // Listener para reapertura desde el enlace del footer.
    document.addEventListener('curino:open-cookie-banner', show);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
