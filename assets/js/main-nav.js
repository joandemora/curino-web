/* ============================================================
 * main-nav.js — Menú principal de la web pública de Curino
 *
 * Componente compartido (siguiendo el patrón de admin-shell.js)
 * que inyecta el <nav> desktop + el menú mobile en un punto de
 * montaje fijo: <div id="main-nav-mount"></div>. Hoy lo cargan:
 *   - /                                  (index.html)
 *   - /proyecto-a-medida/
 *   - /mi-cuenta/
 *   - /estudio/
 *   - /configurador-armarios-vestidores/
 *   - /login/
 *
 * No toca admin/* (admin-shell.js), revista/* (revista-shell.js)
 * ni checkout/* (nav reducido propio).
 *
 * Funcionalidad incluida:
 *   - Mega-menú desktop con hover (CSS puro, .mega-trigger:hover).
 *   - Hamburger mobile que abre/cierra .mobile-menu.
 *   - Acordeón mobile (.mobile-accordion-title abre body).
 *   - Cierra el menú mobile al clickar cualquier enlace.
 *
 * El CSS de las clases (.mega-trigger, .megamenu, .mega-col,
 * .mobile-menu, .mobile-accordion, etc.) vive INLINE en cada uno
 * de los 6 HTML que cargan este componente. No se mueve aquí.
 *
 * El handler `toggleCart()` que llaman los iconos de cart se
 * invoca con guard `typeof toggleCart === 'function'` — si la
 * página no lo define (ej. /estudio/, /login/), no rompe nada.
 * ============================================================ */
(function () {
  'use strict';

  var LOGO_SRC = '/assets/imagenes/logo-curino.svg';
  var USER_HREF = '/mi-cuenta/';  // si no hay sesión, /mi-cuenta/ redirige a /login/

  // ── HTML desktop nav ────────────────────────────────────────
  function desktopNavHtml() {
    return ''
      + '<nav id="nav">'
      +   '<a href="/" class="nav-logo"><img src="' + LOGO_SRC + '" alt="Curino" height="28"></a>'
      +   '<div class="nav-right">'
      +     '<div class="nav-links">'
      +       '<a href="/armarios-vestidores/">Armarios y vestidores</a>'
      +       '<a href="/cocinas/">Cocinas</a>'
      +       '<a href="/banos/">Baños</a>'
      +       megaAltaCarpinteriaDesktop()
      +       '<a href="/estudio/">Estudio</a>'
      +       '<a href="/maestro/">Maestro</a>'
      +     '</div>'
      +     navIconsDesktop()
      +   '</div>'
      +   navMobileRight()
      + '</nav>';
  }

  function megaAltaCarpinteriaDesktop() {
    return ''
      + '<div class="mega-trigger">'
      +   '<a href="/sobre-nosotros/">Alta Carpintería</a>'
      +   '<div class="megamenu">'
      +     '<div class="mega-col">'
      +       '<div class="mega-col-title">Por producto</div>'
      +       '<a href="/puertas/">Puertas</a>'
      +       '<a href="/paneles/">Paneles</a>'
      +       '<a href="/escaleras/">Escaleras</a>'
      +       '<a href="/materiales/">Materiales</a>'
      +     '</div>'
      +     '<div class="mega-col">'
      +       '<div class="mega-col-title">Por estancia</div>'
      +       '<a href="/dormitorio/">Dormitorio</a>'
      +       '<a href="/cocinas/">Cocina</a>'
      +       '<a href="/salon/">Salón</a>'
      +       '<a href="/comedor/">Comedor</a>'
      +       '<a href="/banos/">Baño</a>'
      +     '</div>'
      +     '<div class="mega-col">'
      +       '<div class="mega-col-title">Proyectos integrales</div>'
      +       '<a href="/residencial/">Residencial</a>'
      +       '<a href="/contract/">Contract</a>'
      +       '<a href="/couture/">Couture</a>'
      +       '<a href="/nautica/">Náutica</a>'
      +     '</div>'
      +     '<div class="mega-imgs">'
      +       '<div class="mega-img">'
      +         '<a href="/configurador-armarios-vestidores/"><img src="/assets/imagenes/landing/fina-hero.webp" alt="Configura tu armario"></a>'
      +         '<a href="/configurador-armarios-vestidores/">Configura tu armario</a>'
      +       '</div>'
      +       '<div class="mega-img">'
      +         '<a href="/maestro/"><img src="/assets/imagenes/landing/hero mega config armarios.png" alt="Maestro"></a>'
      +         '<a href="/maestro/">Maestro</a>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function navIconsDesktop() {
    return ''
      + '<div class="nav-icons">'
      +   '<a href="#">ES</a>'
      +   '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      +   '<a href="' + USER_HREF + '" class="user-icon-link" id="userIconLink"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></a>'
      +   '<div class="cart-icon" onclick="if(typeof toggleCart===\'function\')toggleCart()"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg><div class="cart-badge" id="cartBadge">0</div></div>'
      + '</div>';
  }

  function navMobileRight() {
    return ''
      + '<div class="nav-mobile-right">'
      +   '<a href="' + USER_HREF + '" class="user-icon-link" id="userIconLinkMob"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></a>'
      +   '<div class="cart-icon" onclick="if(typeof toggleCart===\'function\')toggleCart()"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg><div class="cart-badge cart-badge-mob" id="cartBadgeMob">0</div></div>'
      +   '<div class="nav-hamburger" id="hamburger"><span></span><span></span><span></span></div>'
      + '</div>';
  }

  // ── HTML mobile menu (.mobile-menu + accordion) ─────────────
  function mobileMenuHtml() {
    return ''
      + '<div class="mobile-menu" id="mobileMenu">'
      +   '<a href="/armarios-vestidores/">Armarios y vestidores</a>'
      +   '<a href="/cocinas/">Cocinas</a>'
      +   '<a href="/banos/">Baños</a>'
      +   '<div class="mobile-accordion" id="mobileAccordion">'
      +     '<div class="mobile-accordion-title" data-mobile-accordion-toggle>Alta Carpintería</div>'
      +     '<div class="mobile-accordion-body">'
      +       '<a href="/sobre-nosotros/" style="font-weight:600">Sobre nosotros</a>'
      +       '<div class="mobile-sub-title">Por producto</div>'
      +       '<a href="/puertas/">Puertas</a>'
      +       '<a href="/paneles/">Paneles</a>'
      +       '<a href="/escaleras/">Escaleras</a>'
      +       '<a href="/materiales/">Materiales</a>'
      +       '<div class="mobile-sub-title">Por estancia</div>'
      +       '<a href="/dormitorio/">Dormitorio</a>'
      +       '<a href="/cocinas/">Cocina</a>'
      +       '<a href="/salon/">Salón</a>'
      +       '<a href="/comedor/">Comedor</a>'
      +       '<a href="/banos/">Baño</a>'
      +       '<div class="mobile-sub-title">Proyectos integrales</div>'
      +       '<a href="/residencial/">Residencial</a>'
      +       '<a href="/contract/">Contract</a>'
      +       '<a href="/couture/">Couture</a>'
      +       '<a href="/nautica/">Náutica</a>'
      +     '</div>'
      +   '</div>'
      +   '<a href="/estudio/">Estudio</a>'
      +   '<a href="/maestro/">Maestro</a>'
      +   '<div class="mobile-imgs">'
      +     '<div class="mega-img">'
      +       '<a href="/configurador-armarios-vestidores/"><img src="/assets/imagenes/landing/fina-hero.webp" alt="Configura tu armario" style="width:100%;height:auto;display:block;aspect-ratio:1/1;object-fit:cover"></a>'
      +       '<a href="/configurador-armarios-vestidores/">Configura tu armario</a>'
      +     '</div>'
      +     '<div class="mega-img">'
      +       '<a href="/maestro/"><img src="/assets/imagenes/landing/hero mega config armarios.png" alt="Maestro" style="width:100%;height:auto;display:block;aspect-ratio:1/1;object-fit:cover"></a>'
      +       '<a href="/maestro/">Maestro</a>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // ── Lógica ──────────────────────────────────────────────────
  function wireMobileMenu() {
    var ham = document.getElementById('hamburger');
    var menu = document.getElementById('mobileMenu');
    if (!ham || !menu) return;
    ham.addEventListener('click', function () {
      menu.classList.toggle('open');
      ham.classList.toggle('open');
    });
    // Cierra el menú al click en cualquier enlace mobile.
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('open');
        ham.classList.remove('open');
      });
    });
  }

  function wireMobileAccordion() {
    document.querySelectorAll('[data-mobile-accordion-toggle]').forEach(function (el) {
      el.addEventListener('click', function () {
        el.parentElement.classList.toggle('open');
      });
    });
  }

  // ── Cart loader ─────────────────────────────────────────────
  // Carga el carrito global (panel + JS + CSS) en las páginas
  // que cargan el nav. Idempotente: si ya están en el DOM no
  // duplica. Las áreas /admin/, /revista/ y /checkout/ no usan
  // este nav, así que tampoco cargan el cart (intencional —
  // /checkout/ tiene su propia UI del carrito).
  function ensureCartLoaded() {
    if (!document.querySelector('link[href="/assets/css/cart.css"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/assets/css/cart.css';
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[src="/assets/js/cart.js"]')) {
      var script = document.createElement('script');
      script.src = '/assets/js/cart.js';
      document.body.appendChild(script);
    }
  }

  // ── Mount ───────────────────────────────────────────────────
  function mount() {
    var slot = document.getElementById('main-nav-mount');
    if (!slot) {
      // Defensa: si la página no tiene el mount point, no
      // intentamos inyectar para no romper layouts existentes.
      return;
    }
    slot.outerHTML = desktopNavHtml() + mobileMenuHtml();
    wireMobileMenu();
    wireMobileAccordion();
    // Evento por si alguna página necesita engancharse al user-icon
    // o al cart-badge después del mount.
    document.dispatchEvent(new CustomEvent('curino:main-nav-mounted'));
    // Carga del componente del carrito global (cart.js + cart.css).
    // Tras cargarse, cart.js inyecta el panel y refresca el badge
    // recién montado por el nav.
    ensureCartLoaded();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
