/* ============================================================
 * cookie-banner.js — Banner de consentimiento granular (v2).
 *
 * Modal centrado con dos vistas: (1) vista principal con
 * "Ajustes" + "Aceptar todo", y (2) vista de ajustes con 4
 * categorías y toggles individuales (Necesarias, Rendimiento,
 * Funcionales, Publicitarias).
 *
 * INTEGRACIÓN CON CONSENT MODE V2
 * ===============================
 * El snippet inline del <head> (presente en las 49 páginas con
 * tracking) declara los defaults denied y aplica auto-update a
 * granted SOLO si localStorage.curino_consent === 'granted'
 * (flag binario heredado).
 *
 * Persistencia dual-key:
 *   - curino_consent_v2 (JSON granular, autoritativo).
 *   - curino_consent ('granted' | 'denied') flag heredado que
 *     el snippet inline lee en frame 0:
 *       * 'granted' SOLO si TODAS las categorías no-necesarias
 *         están on (escenario "Aceptar todo").
 *       * 'denied' si CUALQUIERA está off (granular o rechazo).
 *
 * Esto significa:
 *   - Usuarios que aceptaron TODO: frame 0 aplica todo granted
 *     instantáneamente (sin delay).
 *   - Usuarios granulares: frame 0 aplica defaults (todo denied)
 *     y este componente, cargado con defer, hace un consent
 *     update con los granted que correspondan en ~100-200ms.
 *     El wait_for_update:500 del snippet inline asegura que
 *     GTM no dispara tags hasta tener el update final.
 *
 * MIGRACIÓN DESDE V1
 * ==================
 * Si solo existe curino_consent (sin _v2):
 *   - 'granted' → migrar a {performance:true, functional:true, advertising:true}
 *   - 'denied'  → migrar a {performance:false, functional:false, advertising:false}
 * Tras migrar, se escribe curino_consent_v2 y el banner NO se muestra.
 *
 * REAPERTURA
 * ==========
 * document.dispatchEvent(new CustomEvent('curino:open-cookie-banner',
 *   { detail: { view: 'main' | 'settings' } }))
 * Sin detail.view por defecto abre en 'main'. El enlace
 * "Configurar cookies" del main-footer.js pasa detail.view='settings'.
 *
 * UX
 * ==
 * - Modal centrado con backdrop rgba(0,0,0,.55), cubre toda la
 *   pantalla incluida cualquier sticky (mob-bar del checkout).
 * - z-index 99999.
 * - Fade-in del backdrop + slide-up del modal al aparecer.
 * - Slide horizontal entre vistas.
 * - ESC y click-fuera cierran SOLO si ya hay decisión previa
 *   (curino_consent_v2 existe). Primera visita: usuario debe
 *   pulsar uno de los botones.
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY_V2     = 'curino_consent_v2';
  var STORAGE_KEY_LEGACY = 'curino_consent';
  var BANNER_ID          = 'curino-cookie-banner';
  var SCHEMA_VERSION     = 2;

  // ── Helpers localStorage con try/catch defensivo
  function readV2() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_V2);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return {
        necessary:    true, // siempre true
        performance:  obj.performance === true,
        functional:   obj.functional === true,
        advertising:  obj.advertising === true
      };
    } catch (_e) { return null; }
  }
  function readLegacy() {
    try { return localStorage.getItem(STORAGE_KEY_LEGACY); }
    catch (_e) { return null; }
  }
  function writePrefs(prefs) {
    // Escribe v2 (autoritativo) + legacy (flag binario para snippet inline).
    var allOptionalsOn = prefs.performance && prefs.functional && prefs.advertising;
    try {
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify({
        version: SCHEMA_VERSION,
        timestamp: Date.now(),
        necessary: true,
        performance: !!prefs.performance,
        functional: !!prefs.functional,
        advertising: !!prefs.advertising
      }));
    } catch (_e) {}
    try {
      localStorage.setItem(STORAGE_KEY_LEGACY, allOptionalsOn ? 'granted' : 'denied');
    } catch (_e) {}
  }

  // ── Migración: si solo existe legacy, traducir a granular y guardar v2.
  // Devuelve los prefs resultantes o null si tampoco hay legacy.
  function migrateLegacyIfNeeded() {
    if (readV2()) return readV2(); // ya tenemos v2, nada que migrar
    var legacy = readLegacy();
    if (legacy !== 'granted' && legacy !== 'denied') return null;
    var migrated = {
      necessary: true,
      performance: legacy === 'granted',
      functional:  legacy === 'granted',
      advertising: legacy === 'granted'
    };
    writePrefs(migrated);
    return migrated;
  }

  // ── Consent Mode v2
  function ensureGtag() {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
  }
  function applyConsent(prefs) {
    ensureGtag();
    var updates = {};
    updates.analytics_storage  = prefs.performance ? 'granted' : 'denied';
    updates.ad_storage         = prefs.advertising ? 'granted' : 'denied';
    updates.ad_user_data       = prefs.advertising ? 'granted' : 'denied';
    updates.ad_personalization = prefs.advertising ? 'granted' : 'denied';
    // functional: sin mapping activo a Consent Mode v2 estándar.
    // No bajamos functionality_storage a denied — eso rompería sesión/
    // carrito/preferencias. Guardamos la elección por si en futuro queremos
    // cablearlo a algo concreto (ej. modules opcionales, embeds, etc.).
    window.gtag('consent', 'update', updates);
  }

  // ── CSS auto-contenido (no depende de site-shell.css)
  function injectStyles() {
    if (document.getElementById(BANNER_ID + '-styles')) return;
    var style = document.createElement('style');
    style.id = BANNER_ID + '-styles';
    style.textContent = [
      // Backdrop
      '#' + BANNER_ID + '-backdrop{',
      '  position:fixed;inset:0;z-index:99999;',
      '  background:rgba(0,0,0,.55);',
      '  display:none;opacity:0;transition:opacity .2s ease;',
      '  align-items:center;justify-content:center;',
      '  padding:24px;font-family:"Open Sans",system-ui,sans-serif;',
      '}',
      '#' + BANNER_ID + '-backdrop.visible{display:flex;opacity:1}',
      // Modal
      '#' + BANNER_ID + '{',
      '  background:#fff;color:#0a0a0a;',
      '  width:100%;max-width:560px;max-height:calc(100vh - 48px);',
      '  overflow:hidden;display:flex;flex-direction:column;',
      '  box-shadow:0 24px 60px rgba(0,0,0,.25);',
      '  transform:translateY(24px);opacity:0;',
      '  transition:transform .25s ease,opacity .2s ease;',
      '}',
      '#' + BANNER_ID + '-backdrop.visible #' + BANNER_ID + '{transform:translateY(0);opacity:1}',
      // Views
      '#' + BANNER_ID + ' .cb-view{padding:36px 40px;display:none}',
      '#' + BANNER_ID + ' .cb-view.active{display:block}',
      '#' + BANNER_ID + ' .cb-view.scrollable{max-height:calc(100vh - 48px);overflow-y:auto}',
      // Title
      '#' + BANNER_ID + ' .cb-title{',
      '  font-family:"Cormorant Garamond",Georgia,serif;',
      '  font-size:28px;font-weight:400;line-height:1.2;',
      '  letter-spacing:-.01em;margin:0 0 16px;color:#0a0a0a;',
      '}',
      // Text
      '#' + BANNER_ID + ' .cb-text{',
      '  font-size:14px;line-height:1.6;color:#1a1a1a;margin:0 0 24px;',
      '}',
      '#' + BANNER_ID + ' .cb-text a{color:#0a0a0a;text-decoration:underline}',
      // Action row
      '#' + BANNER_ID + ' .cb-actions{',
      '  display:flex;gap:12px;flex-wrap:wrap;',
      '}',
      '#' + BANNER_ID + ' .cb-btn{',
      '  display:inline-block;padding:.95rem 1.6rem;font-family:inherit;',
      '  font-size:12px;font-weight:500;letter-spacing:.12em;',
      '  text-transform:uppercase;border:1px solid #0a0a0a;',
      '  cursor:pointer;transition:background .2s,color .2s,border-color .2s;',
      '  border-radius:0;flex:1;min-width:120px;',
      '}',
      '#' + BANNER_ID + ' .cb-btn-primary{background:#0a0a0a;color:#fff}',
      '#' + BANNER_ID + ' .cb-btn-primary:hover{background:#333;border-color:#333}',
      '#' + BANNER_ID + ' .cb-btn-outline{background:#fff;color:#0a0a0a}',
      '#' + BANNER_ID + ' .cb-btn-outline:hover{background:#0a0a0a;color:#fff}',
      // Back link
      '#' + BANNER_ID + ' .cb-back{',
      '  font-size:12px;letter-spacing:.04em;text-transform:uppercase;',
      '  color:#888;cursor:pointer;background:none;border:0;padding:0;',
      '  margin-bottom:18px;font-family:inherit;',
      '}',
      '#' + BANNER_ID + ' .cb-back:hover{color:#0a0a0a}',
      // Categories
      '#' + BANNER_ID + ' .cb-cats{margin:0 0 24px;display:flex;flex-direction:column;gap:14px}',
      '#' + BANNER_ID + ' .cb-cat{',
      '  border:1px solid #e5e5e5;padding:16px 18px;',
      '  display:grid;grid-template-columns:1fr auto;gap:14px 18px;',
      '  align-items:center;',
      '}',
      '#' + BANNER_ID + ' .cb-cat-head{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#0a0a0a}',
      '#' + BANNER_ID + ' .cb-cat-desc{grid-column:1/-1;font-size:13px;line-height:1.5;color:#555;margin:0}',
      // Toggle (estilo iOS)
      '#' + BANNER_ID + ' .cb-toggle{',
      '  position:relative;width:36px;height:20px;background:#ccc;',
      '  border-radius:10px;transition:background .2s;cursor:pointer;flex-shrink:0;',
      '}',
      '#' + BANNER_ID + ' .cb-toggle::after{',
      '  content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;',
      '  background:#fff;border-radius:50%;transition:transform .2s;',
      '  box-shadow:0 1px 3px rgba(0,0,0,.2);',
      '}',
      '#' + BANNER_ID + ' .cb-toggle.on{background:#0a0a0a}',
      '#' + BANNER_ID + ' .cb-toggle.on::after{transform:translateX(16px)}',
      '#' + BANNER_ID + ' .cb-toggle.disabled{opacity:.55;cursor:not-allowed}',
      '#' + BANNER_ID + ' .cb-toggle input{position:absolute;opacity:0;width:100%;height:100%;cursor:inherit;margin:0}',
      // Mobile
      '@media (max-width:640px){',
      '  #' + BANNER_ID + '-backdrop{padding:8px}',
      '  #' + BANNER_ID + '{max-width:none;width:100%;max-height:calc(100vh - 16px)}',
      '  #' + BANNER_ID + ' .cb-view{padding:24px 20px}',
      '  #' + BANNER_ID + ' .cb-title{font-size:24px}',
      '  #' + BANNER_ID + ' .cb-actions{flex-direction:column}',
      '  #' + BANNER_ID + ' .cb-btn{flex:initial;width:100%}',
      '}'
    ].join('');
    document.head.appendChild(style);
  }

  // ── DOM
  var _backdrop = null;
  var _modal = null;
  var _currentView = 'main';
  var _toggleState = { performance:false, functional:false, advertising:false };

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function buildToggleHtml(name, checked, disabled) {
    var on = checked ? ' on' : '';
    var dis = disabled ? ' disabled' : '';
    var cb = checked ? 'checked' : '';
    var dca = disabled ? 'disabled' : '';
    return '<label class="cb-toggle' + on + dis + '" data-toggle="' + name + '">' +
             '<input type="checkbox" ' + cb + ' ' + dca + ' aria-label="' + escHtml(name) + '">' +
           '</label>';
  }

  function buildBanner() {
    if (document.getElementById(BANNER_ID + '-backdrop')) {
      _backdrop = document.getElementById(BANNER_ID + '-backdrop');
      _modal = document.getElementById(BANNER_ID);
      return;
    }
    _backdrop = document.createElement('div');
    _backdrop.id = BANNER_ID + '-backdrop';
    _backdrop.setAttribute('role', 'dialog');
    _backdrop.setAttribute('aria-modal', 'true');
    _backdrop.setAttribute('aria-label', 'Aviso de cookies');

    var mainHtml =
      '<div class="cb-view active" data-view="main">' +
        '<h2 class="cb-title">Tu experiencia es importante para nosotros</h2>' +
        '<p class="cb-text">Usamos cookies propias y de terceros para analizar el uso del sitio, ' +
          'personalizar contenido y mejorar tu experiencia. Puedes aceptarlas todas o configurarlas. ' +
          'Más información en nuestra <a href="/cookies/">Política de cookies</a> y ' +
          '<a href="/privacidad/">Privacidad</a>.</p>' +
        '<div class="cb-actions">' +
          '<button type="button" class="cb-btn cb-btn-outline" data-cb-open-settings>Ajustes</button>' +
          '<button type="button" class="cb-btn cb-btn-primary" data-cb-accept-all>Aceptar todo</button>' +
        '</div>' +
      '</div>';

    var settingsHtml =
      '<div class="cb-view scrollable" data-view="settings">' +
        '<button type="button" class="cb-back" data-cb-back>← Volver</button>' +
        '<h2 class="cb-title">Configura tus preferencias</h2>' +
        '<div class="cb-cats">' +
          // Necesarias (bloqueado ON)
          '<div class="cb-cat">' +
            '<div class="cb-cat-head">Necesarias</div>' +
            buildToggleHtml('necessary', true, true) +
            '<p class="cb-cat-desc">Imprescindibles para que la web funcione: sesión, carrito y tus preferencias de privacidad. No se pueden desactivar.</p>' +
          '</div>' +
          // Rendimiento
          '<div class="cb-cat">' +
            '<div class="cb-cat-head">Rendimiento</div>' +
            buildToggleHtml('performance', false, false) +
            '<p class="cb-cat-desc">Nos permiten medir las visitas y entender cómo se usa la web para mejorarla. La información es agregada y anónima.</p>' +
          '</div>' +
          // Funcionales
          '<div class="cb-cat">' +
            '<div class="cb-cat-head">Funcionales</div>' +
            buildToggleHtml('functional', false, false) +
            '<p class="cb-cat-desc">Permiten recordar tus preferencias y ofrecerte una experiencia más personalizada.</p>' +
          '</div>' +
          // Publicitarias
          '<div class="cb-cat">' +
            '<div class="cb-cat-head">Publicitarias</div>' +
            buildToggleHtml('advertising', false, false) +
            '<p class="cb-cat-desc">Permiten mostrarte anuncios relevantes según tus intereses. Podemos compartir datos con socios publicitarios.</p>' +
          '</div>' +
        '</div>' +
        '<div class="cb-actions">' +
          '<button type="button" class="cb-btn cb-btn-outline" data-cb-save>Guardar ajustes</button>' +
          '<button type="button" class="cb-btn cb-btn-primary" data-cb-accept-all>Aceptar todo</button>' +
        '</div>' +
      '</div>';

    _backdrop.innerHTML =
      '<div id="' + BANNER_ID + '">' +
        mainHtml + settingsHtml +
      '</div>';
    document.body.appendChild(_backdrop);
    _modal = document.getElementById(BANNER_ID);

    wireEvents();
  }

  function wireEvents() {
    // Botones
    _modal.querySelector('[data-cb-open-settings]').addEventListener('click', function () {
      showView('settings');
    });
    _modal.querySelectorAll('[data-cb-accept-all]').forEach(function (btn) {
      btn.addEventListener('click', function () { acceptAll(); });
    });
    _modal.querySelector('[data-cb-save]').addEventListener('click', function () {
      saveCurrentToggles();
    });
    _modal.querySelector('[data-cb-back]').addEventListener('click', function () {
      showView('main');
    });

    // Toggles (delegado en el modal, ignora el necessary disabled)
    _modal.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.cb-toggle');
      if (!t) return;
      if (t.classList.contains('disabled')) {
        e.preventDefault();
        return;
      }
      var name = t.getAttribute('data-toggle');
      if (name !== 'performance' && name !== 'functional' && name !== 'advertising') return;
      var willBeOn = !t.classList.contains('on');
      t.classList.toggle('on', willBeOn);
      var input = t.querySelector('input');
      if (input) input.checked = willBeOn;
      _toggleState[name] = willBeOn;
    });

    // Backdrop click-fuera y ESC: solo cierran si hay decisión previa
    _backdrop.addEventListener('click', function (e) {
      if (e.target !== _backdrop) return; // click en el modal interno: no cerrar
      if (readV2()) hide();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!_backdrop.classList.contains('visible')) return;
      if (readV2()) hide();
    });
  }

  function setToggleVisualState(name, on) {
    var t = _modal.querySelector('.cb-toggle[data-toggle="' + name + '"]');
    if (!t) return;
    t.classList.toggle('on', !!on);
    var input = t.querySelector('input');
    if (input) input.checked = !!on;
  }

  function syncTogglesFromState() {
    setToggleVisualState('performance', _toggleState.performance);
    setToggleVisualState('functional',  _toggleState.functional);
    setToggleVisualState('advertising', _toggleState.advertising);
  }

  function showView(view) {
    _currentView = view;
    _modal.querySelectorAll('.cb-view').forEach(function (v) {
      v.classList.toggle('active', v.getAttribute('data-view') === view);
    });
  }

  function show(initialView) {
    injectStyles();
    buildBanner();
    // Si hay prefs guardadas (reapertura desde footer), reflejarlas en los toggles.
    var existing = readV2();
    if (existing) {
      _toggleState.performance = !!existing.performance;
      _toggleState.functional  = !!existing.functional;
      _toggleState.advertising = !!existing.advertising;
    } else {
      _toggleState.performance = false;
      _toggleState.functional  = false;
      _toggleState.advertising = false;
    }
    syncTogglesFromState();
    showView(initialView === 'settings' ? 'settings' : 'main');
    // Forzar reflow antes de añadir la clase visible (para que las transiciones disparen)
    void _backdrop.offsetHeight;
    _backdrop.classList.add('visible');
  }

  function hide() {
    if (!_backdrop) return;
    _backdrop.classList.remove('visible');
  }

  function acceptAll() {
    var prefs = { necessary:true, performance:true, functional:true, advertising:true };
    writePrefs(prefs);
    applyConsent(prefs);
    hide();
  }

  function saveCurrentToggles() {
    var prefs = {
      necessary:   true,
      performance: !!_toggleState.performance,
      functional:  !!_toggleState.functional,
      advertising: !!_toggleState.advertising
    };
    writePrefs(prefs);
    applyConsent(prefs);
    hide();
  }

  // ── Init
  function init() {
    // 1. Migrar usuarios de v1 si toca (sin pedir reconsentimiento).
    //    Al migrar también aplicamos el consent runtime para que GTM se entere.
    var migrated = migrateLegacyIfNeeded();
    if (migrated) {
      applyConsent(migrated);
      // No mostramos el banner — el usuario ya decidió en V1.
    } else {
      var existing = readV2();
      if (existing) {
        // Usuario ya en V2: aplicar consent en runtime (frame 0 del snippet
        // inline no lo hace para granulares). Si ya está todo on, el snippet
        // inline ya aplicó granted, este update es idempotente.
        applyConsent(existing);
      } else {
        // Primera visita: mostrar banner en vista principal.
        show('main');
      }
    }

    // Listener para reapertura desde el footer.
    document.addEventListener('curino:open-cookie-banner', function (ev) {
      var view = (ev && ev.detail && ev.detail.view === 'settings') ? 'settings' : 'main';
      show(view);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
