/* ============================================================
 * cart.js — Carrito global compartido de Curino
 *
 * Componente global que inyecta el panel del carrito + overlay
 * en el <body>, sincroniza estado con localStorage (key
 * "curino_cart") y expone API en window.curinoCart.
 *
 * Cargado automáticamente desde main-nav.js (ver ensureCartLoaded
 * allí). Las 28 páginas del sitio público que cargan el nav
 * heredan el carrito.
 *
 * API pública (window.curinoCart):
 *   - items       (getter): copia defensiva del array
 *   - toggle()    : abre/cierra panel
 *   - add(item)   : push + save + refresh + open (usado por
 *                   configurador al "Añadir al carrito")
 *   - update(idx, item) : reemplaza item por índice (modo edit)
 *   - remove(id)  : elimina por id
 *   - refresh()   : re-renderiza panel + badge
 *
 * Aliases legacy (compatibilidad con código existente):
 *   - window.toggleCart      : alias de toggle (usado por el
 *                              onclick del cart-icon en main-nav.js)
 *   - window.removeFromCart  : alias de remove
 *
 * Estado:
 *   - localStorage key "curino_cart" (mismo que usa /checkout/)
 *   - Sincronización entre pestañas vía storage event
 *
 * El item tiene shape:
 *   { id, ancho, alto, fondo, material, interior, puertas,
 *     doorDetail?, moduleDetail?, precio, thumb? }
 * El configurador construye esta shape en addToCart() (inline,
 * página específica); cart.js solo gestiona el array global.
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'curino_cart';
  var _items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

  var PANEL_HTML =
    '<div class="cart-overlay" id="cartOverlay" onclick="window.curinoCart.toggle()"></div>' +
    '<div class="cart-panel" id="cartPanel">' +
      '<div class="cart-header">' +
        '<div class="cart-title">Tu carrito</div>' +
        '<button class="cart-close" onclick="window.curinoCart.toggle()" aria-label="Cerrar carrito">&times;</button>' +
      '</div>' +
      '<div class="cart-items" id="cartItems">' +
        '<div class="cart-empty" id="cartEmpty">Tu carrito está vacío</div>' +
      '</div>' +
      '<div class="cart-footer" id="cartFooter" style="display:none">' +
        '<div class="cart-subtotal-row"><span>Subtotal</span><span id="cartSubtotal">0 €</span></div>' +
        '<a href="/checkout/" class="cart-checkout">Tramitar pedido</a>' +
      '</div>' +
    '</div>';

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_items));
  }

  function formatPrice(amount) {
    var parts = parseFloat(amount).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts.join(',') + ' €';
  }

  function buildItemDesc(item) {
    var d = '';
    if (item.material) d += 'Material: ' + item.material + '<br>';
    var dd = item.doorDetail;
    if (dd && dd.tipo) {
      var p = [dd.tipo];
      if (dd.marco) p.push(dd.marco);
      if (dd.textil) p.push(dd.textil);
      if (dd.colorRal) p.push(dd.colorRal);
      if (dd.travesano) p.push(dd.travesano);
      d += 'Puertas: ' + p.join(' · ') + '<br>';
    } else if (item.puertas && item.puertas !== 'Sin puertas') {
      d += 'Puertas: ' + item.puertas + '<br>';
    } else if (item.puertas === 'Sin puertas') {
      d += 'Sin puertas<br>';
    }
    if (item.moduleDetail && item.moduleDetail.length) {
      item.moduleDetail.forEach(function (md, i) {
        var line = 'Módulo ' + (i + 1) + ' (' + md.width + 'cm): ';
        if (md.puerta) {
          line += md.puerta;
        } else {
          line += md.hojas + ' hoja' + (md.hojas > 1 ? 's' : '');
          if (md.apertura) line += ' · Ap. ' + md.apertura;
        }
        if (md.interior) line += ' · ' + md.interior;
        d += line + '<br>';
      });
    } else if (item.interior) {
      d += 'Interior: ' + item.interior + '<br>';
    }
    return d;
  }

  function refreshBadges() {
    var badge = document.getElementById('cartBadge');
    var badgeMob = document.getElementById('cartBadgeMob');
    if (_items.length > 0) {
      if (badge)    { badge.textContent    = _items.length; badge.classList.add('visible'); }
      if (badgeMob) { badgeMob.textContent = _items.length; badgeMob.classList.add('visible'); }
    } else {
      if (badge)    badge.classList.remove('visible');
      if (badgeMob) badgeMob.classList.remove('visible');
    }
  }

  function refresh() {
    refreshBadges();
    var container = document.getElementById('cartItems');
    var empty     = document.getElementById('cartEmpty');
    var footer    = document.getElementById('cartFooter');
    if (!container || !empty || !footer) return; // panel aún no inyectado

    // Limpia items previos
    container.querySelectorAll('.cart-item').forEach(function (el) { el.remove(); });

    if (_items.length === 0) {
      empty.style.display  = 'block';
      footer.style.display = 'none';
      return;
    }
    empty.style.display  = 'none';
    footer.style.display = 'block';

    var subtotal = 0;
    _items.forEach(function (item, idx) {
      subtotal += item.precio;
      var div = document.createElement('div');
      div.className = 'cart-item';
      div.innerHTML =
        '<div class="cart-item-img">' +
          (item.thumb ? '<img src="' + item.thumb + '" alt="Armario">' : '') +
        '</div>' +
        '<div class="cart-item-info">' +
          '<div class="cart-item-name">Armario ' + item.ancho + '×' + item.alto + '×' + item.fondo + ' cm</div>' +
          '<div class="cart-item-desc">' + buildItemDesc(item) + '</div>' +
          '<div class="cart-item-price">' + formatPrice(item.precio) + '</div>' +
          '<div class="cart-item-actions">' +
            '<a href="/configurador-armarios-vestidores/?edit=' + idx + '">Editar</a>' +
            '<button onclick="window.curinoCart.remove(' + item.id + ')">Eliminar</button>' +
          '</div>' +
        '</div>';
      container.insertBefore(div, empty);
    });

    var subtotalEl = document.getElementById('cartSubtotal');
    if (subtotalEl) subtotalEl.textContent = formatPrice(subtotal);
  }

  function toggle() {
    var ov = document.getElementById('cartOverlay');
    var pn = document.getElementById('cartPanel');
    if (ov) ov.classList.toggle('open');
    if (pn) pn.classList.toggle('open');
  }

  function add(item) {
    _items.push(item);
    // Tracking: add_to_cart (GA4) / AddToCart (Pixel via GTM).
    // Solo cuando se AÑADE un item nuevo desde el configurador. NO en
    // update() (edición), NO en remove(), NO en refresh()/storage event
    // (sincronización entre pestañas). El push entra al dataLayer; GTM
    // enviará a GA4/Pixel solo si analytics_storage/ad_storage están
    // granted (Consent Mode v2). content_id genérico: los armarios son
    // a medida, no SKU.
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'add_to_cart',
        ecommerce: {
          value: Number(item && item.precio) || 0,
          currency: 'EUR',
          items: [{
            item_id: 'armario-medida',
            item_name: 'Armario ' + ((item && item.ancho) || '?') + '×' + ((item && item.alto) || '?') + '×' + ((item && item.fondo) || '?'),
            price: Number(item && item.precio) || 0
          }],
          content_id: 'armario-medida',
          content_type: 'product'
        }
      });
    } catch (_e) { /* silencioso: nunca romper el add por tracking */ }
    save();
    refresh();
    toggle();
  }

  function update(idx, item) {
    if (idx >= 0 && idx < _items.length) {
      _items[idx] = item;
      save();
      refresh();
    }
  }

  function remove(id) {
    _items = _items.filter(function (i) { return i.id !== id; });
    save();
    refresh();
  }

  function injectPanel() {
    if (document.getElementById('cartPanel')) return; // ya inyectado
    if (!document.body) return;                        // body aún no parseado
    document.body.insertAdjacentHTML('beforeend', PANEL_HTML);
  }

  // Espera a que cart.css esté aplicado antes de ejecutar callback.
  // main-nav.js dispara la descarga de cart.css en paralelo a cart.js sin
  // esperar; si cart.js termina antes que el CSS, injectPanel inyectaría
  // markup sin estilo (mismo FOUC que tenía main-footer.js).
  // onerror también dispara el callback para no dejar el cart invisible
  // si el CSS falla.
  function ensureCssLoaded(callback) {
    var existing = document.querySelector('link[href="/assets/css/cart.css"]');
    if (existing) {
      if (existing.sheet) { callback(); return; }
      existing.addEventListener('load', callback);
      existing.addEventListener('error', callback);
      return;
    }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/css/cart.css';
    link.onload = callback;
    link.onerror = callback;
    document.head.appendChild(link);
  }

  function init() {
    ensureCssLoaded(function () {
      injectPanel();
      refresh();
    });
    // Sincronización entre pestañas (independiente del CSS — se puede
    // registrar siempre, no afecta a la presentación).
    window.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY) {
        _items = JSON.parse(e.newValue || '[]');
        refresh();
      }
    });
  }

  // API pública
  Object.defineProperty(window, 'curinoCart', {
    value: {
      get items() { return _items.slice(); },
      toggle:  toggle,
      add:     add,
      update:  update,
      remove:  remove,
      refresh: refresh
    },
    writable: false,
    configurable: false
  });

  // Aliases legacy (compatibilidad)
  window.toggleCart     = toggle;
  window.removeFromCart = remove;

  // Bootstrapping
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Re-render del badge tras inyección del nav (puede ocurrir después de init)
  document.addEventListener('curino:main-nav-mounted', refresh);
})();
