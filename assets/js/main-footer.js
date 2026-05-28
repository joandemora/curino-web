/* ============================================================
 * main-footer.js — Footer global de la web pública de Curino
 *
 * Componente compartido (siguiendo el patrón de main-nav.js)
 * que inyecta el <footer> + franja legal en un punto de montaje
 * fijo: <div id="main-footer-mount"></div>.
 *
 * Cargado por las páginas públicas vía:
 *   <div id="main-footer-mount"></div>
 *   <script src="/assets/js/main-footer.js"></script>
 *
 * No se carga en /admin/* ni /revista/* (que tienen shells
 * propios — admin-shell.js, revista-shell.js).
 *
 * Comportamiento en /checkout/*:
 *   Se renderiza SOLO la franja legal (footer-bottom), sin las
 *   columnas, para mantener el flujo de pago limpio. Detección
 *   por location.pathname.startsWith('/checkout/').
 *
 * CSS asociado: /assets/css/main-footer.css se carga
 * dinámicamente vía ensureCssLoaded() para que el footer sea
 * autosuficiente en páginas que no cargan site-shell.css.
 * ============================================================ */
(function () {
  'use strict';

  function isCheckout() {
    return window.location.pathname.indexOf('/checkout/') === 0
        || window.location.pathname === '/checkout';
  }

  function footerColumnsHtml() {
    return ''
      + '<footer>'
      +   '<div style="grid-area:logo">'
      +     '<img src="/assets/imagenes/logo-curino-blanco.svg" alt="Curino" style="height:28px;width:auto;display:block;margin-bottom:1.5rem;filter:brightness(0) invert(1)">'
      +     '<p class="footer-tagline">Crea tu espacio ideal. Mobiliario de alta carpintería a medida — armarios, vestidores, cocinas y puertas con garantía de 25 años.</p>'
      +   '</div>'

      +   '<div class="footer-col" style="grid-area:alta">'
      +     '<h4 onclick="this.parentElement.classList.toggle(\'open\')">Alta Carpintería</h4>'
      +     '<div class="footer-links">'
      +       '<a href="/configurador-armarios-vestidores/">Configurador de armarios</a>'
      +       '<a href="mailto:info@casacurino.com?subject=Proyecto%20a%20medida%20en%20Barcelona">Proyecto a medida en Barcelona</a>'
      +       '<a href="mailto:info@casacurino.com?subject=Proyecto%20a%20medida%20en%20Madrid">Proyecto a medida en Madrid</a>'
      +       '<a href="mailto:info@casacurino.com?subject=Proyecto%20a%20medida%20en%20Valencia">Proyecto a medida en Valencia</a>'
      +       '<a href="mailto:info@casacurino.com?subject=Proyecto%20a%20medida%20en%20Marbella">Proyecto a medida en Marbella</a>'
      +       '<a href="mailto:info@casacurino.com?subject=Proyecto%20a%20medida%20en%20Bilbao">Proyecto a medida en Bilbao</a>'
      +       '<a href="/maestro/">Maestro</a>'
      +     '</div>'
      +   '</div>'

      +   '<div class="footer-col" style="grid-area:corp">'
      +     '<h4 onclick="this.parentElement.classList.toggle(\'open\')">Corporativo</h4>'
      +     '<div class="footer-links">'
      +       '<a href="/sobre-nosotros/">Sobre nosotros</a>'
      +       '<a href="/sobre-nosotros/">I+D e Innovación</a>'
      +       '<a href="/sobre-nosotros/">Ética Corporativa</a>'
      +       '<a href="/sobre-nosotros/">Seguridad en Curino</a>'
      +       '<a href="mailto:info@casacurino.com?subject=Proveedores">Proveedores</a>'
      +     '</div>'
      +   '</div>'

      +   '<div class="footer-col" style="grid-area:empleo">'
      +     '<h4 onclick="this.parentElement.classList.toggle(\'open\')">Empleo</h4>'
      +     '<div class="footer-links">'
      +       '<a href="https://wa.me/34677528574" target="_blank" rel="noopener">Únete a Curino</a>'
      +       '<a href="https://wa.me/34677528574" target="_blank" rel="noopener">Curino Partners</a>'
      +     '</div>'
      +   '</div>'

      +   '<div class="footer-col" style="grid-area:prensa">'
      +     '<h4 onclick="this.parentElement.classList.toggle(\'open\')">Sala de Prensa</h4>'
      +     '<div class="footer-links">'
      +       '<a href="/revista/">Revista</a>'
      +       '<a href="mailto:info@casacurino.com?subject=Contacto%20Prensa">Contacto Prensa</a>'
      +     '</div>'
      +   '</div>'

      +   '<div class="footer-col" style="grid-area:contacto">'
      +     '<h4 onclick="this.parentElement.classList.toggle(\'open\')">Contacto</h4>'
      +     '<div class="footer-links">'
      +       '<a href="https://wa.me/34677528574" target="_blank" rel="noopener">WhatsApp</a>'
      +       '<a href="mailto:info@casacurino.com">info@casacurino.com</a>'
      +     '</div>'
      +   '</div>'

      +   '<div class="footer-col footer-newsletter" style="grid-area:newsletter">'
      +     '<h4>Newsletter</h4>'
      +     '<div class="footer-links">'
      +       '<input type="email" placeholder="Tu email">'
      +       '<button type="button">Suscribirse</button>'
      +     '</div>'
      +   '</div>'
      + '</footer>';
  }

  function footerBottomHtml(withCheckoutLinks) {
    // Solo en /checkout/*: 3 enlaces extra que abren modales (Envíos,
    // Devoluciones, Montaje). El parámetro lo pasa mount() leyendo isCheckout().
    var extraLinks = withCheckoutLinks
      ? '<a href="#" data-modal="modalEnvios" style="color:inherit;text-decoration:none">Envíos</a> · '
      + '<a href="#" data-modal="modalDevoluciones" style="color:inherit;text-decoration:none">Devoluciones</a> · '
      + '<a href="#" data-modal="modalMontaje" style="color:inherit;text-decoration:none">Montaje</a> · '
      : '';
    return ''
      + '<div class="footer-bottom">'
      +   '<span>© 2026 Curino · Mueble a medida · España · Europa · EEUU</span>'
      +   '<div class="footer-legal">'
      +     '<span>Sistema &amp; Curino, S.L.U.</span>'
      +     '<span>' + extraLinks + '<a href="/aviso-legal/" style="color:inherit;text-decoration:none">Aviso legal</a> | <a href="/privacidad/" style="color:inherit;text-decoration:none">Privacidad</a> | <a href="/cookies/" style="color:inherit;text-decoration:none">Cookies</a> | <a href="#" data-cookie-prefs style="color:inherit;text-decoration:none">Configurar cookies</a></span>'
      +   '</div>'
      +   '<span>casacurino.com</span>'
      + '</div>';
  }

  // Modales de información rápida visibles solo en /checkout/*. Texto cerrado
  // (fabricación a medida, plazos, devoluciones, montaje). NO interfiere con
  // Stripe Elements (que viven en iframes aislados).
  function checkoutModalsHtml() {
    return ''
      + '<div class="checkout-modal" id="modalEnvios" hidden>'
      +   '<div class="checkout-modal-overlay" data-close></div>'
      +   '<div class="checkout-modal-card" role="dialog" aria-modal="true" aria-labelledby="modalEnviosTitle">'
      +     '<button class="checkout-modal-close" data-close aria-label="Cerrar">&times;</button>'
      +     '<h3 class="checkout-modal-title" id="modalEnviosTitle">Envíos</h3>'
      +     '<p class="checkout-modal-text">Cada pieza se fabrica a medida en nuestro taller. El plazo de salida de fábrica es de 4–5 semanas desde la confirmación del pedido; a este plazo se le suma el tiempo de transporte hasta tu destino. Te avisaremos para coordinar la entrega una vez tu pedido esté listo. También puedes optar por la recogida en nuestras instalaciones de Barcelona (España) sin coste de envío.</p>'
      +   '</div>'
      + '</div>'
      + '<div class="checkout-modal" id="modalDevoluciones" hidden>'
      +   '<div class="checkout-modal-overlay" data-close></div>'
      +   '<div class="checkout-modal-card" role="dialog" aria-modal="true" aria-labelledby="modalDevolucionesTitle">'
      +     '<button class="checkout-modal-close" data-close aria-label="Cerrar">&times;</button>'
      +     '<h3 class="checkout-modal-title" id="modalDevolucionesTitle">Devoluciones</h3>'
      +     '<p class="checkout-modal-text">Nuestros productos se fabrican a medida según tu configuración. Por este motivo, y dado que la compra de los materiales se realiza de forma inmediata para cumplir con los plazos de entrega, no se admiten devoluciones ni cancelaciones una vez confirmado el pedido. Para asegurarnos de que todo es perfecto, nos pondremos en contacto contigo antes de comenzar la fabricación y revisaremos juntos cada detalle de tu pedido.</p>'
      +   '</div>'
      + '</div>'
      + '<div class="checkout-modal" id="modalMontaje" hidden>'
      +   '<div class="checkout-modal-overlay" data-close></div>'
      +   '<div class="checkout-modal-card" role="dialog" aria-modal="true" aria-labelledby="modalMontajeTitle">'
      +     '<button class="checkout-modal-close" data-close aria-label="Cerrar">&times;</button>'
      +     '<h3 class="checkout-modal-title" id="modalMontajeTitle">Montaje</h3>'
      +     '<p class="checkout-modal-text">El montaje no está incluido en el precio del pedido. Tienes dos opciones: puedes montarlo tú mismo (cada pedido incluye instrucciones detalladas y cuentas con el soporte de nuestro equipo de atención al cliente para resolver cualquier duda), o recurrir a un profesional a través de TaskRabbit, que te pone en contacto con instaladores cualificados de tu zona, con un coste estimado de aproximadamente el 5% del valor del pedido.</p>'
      +   '</div>'
      + '</div>';
  }

  // Wire de los modales: abrir con clic en [data-modal], cerrar con X / overlay
  // (cualquier [data-close]) y con tecla Escape. Bloquea scroll del body
  // mientras hay un modal abierto y lo restaura al cerrar.
  function wireCheckoutModals() {
    document.querySelectorAll('[data-modal]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var id = a.getAttribute('data-modal');
        var modal = document.getElementById(id);
        if (modal) {
          modal.hidden = false;
          document.body.style.overflow = 'hidden';
        }
      });
    });
    document.querySelectorAll('.checkout-modal [data-close]').forEach(function (el) {
      el.addEventListener('click', function () {
        var modal = el.closest('.checkout-modal');
        if (modal) {
          modal.hidden = true;
          document.body.style.overflow = '';
        }
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.checkout-modal:not([hidden])').forEach(function (m) {
        m.hidden = true;
        document.body.style.overflow = '';
      });
    });
  }

  // Carga el CSS y espera a que esté aplicado antes de ejecutar callback.
  // Evita FOUC (los enlaces del footer aparecían azul-default unos ms hasta
  // que el CSS dinámico llegaba). Si el CSS falla en cargar, onerror también
  // dispara el callback para no dejar el footer invisible.
  function ensureCssLoaded(callback) {
    var existing = document.querySelector('link[href="/assets/css/main-footer.css"]');
    if (existing) {
      if (existing.sheet) { callback(); return; }
      existing.addEventListener('load', callback);
      existing.addEventListener('error', callback);
      return;
    }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/css/main-footer.css';
    link.onload = callback;
    link.onerror = callback;
    document.head.appendChild(link);
  }

  function mount() {
    var slot = document.getElementById('main-footer-mount');
    if (!slot) {
      // Defensa: sin mount point no inyectamos (admin/revista
      // y cualquier página sin el div quedan a salvo).
      return;
    }
    ensureCssLoaded(function () {
      if (isCheckout()) {
        slot.outerHTML = footerBottomHtml(true);
        // Inyectar modales al final del body y registrar listeners.
        if (document.body) {
          document.body.insertAdjacentHTML('beforeend', checkoutModalsHtml());
          wireCheckoutModals();
        }
      } else {
        slot.outerHTML = footerColumnsHtml() + footerBottomHtml(false);
      }
      // Enlace "Configurar cookies" → reabre el banner de cookies global.
      // Delegado en document para sobrevivir cualquier re-render del footer.
      document.dispatchEvent(new CustomEvent('curino:main-footer-mounted'));
    });
  }

  // ── Wire del enlace "Configurar cookies" (delegado a document)
  // Reapertura del banner desde el footer. El componente cookie-banner.js
  // escucha el evento 'curino:open-cookie-banner' y vuelve a mostrarse
  // aunque ya haya decisión guardada en localStorage.
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-cookie-prefs]');
    if (!t) return;
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('curino:open-cookie-banner'));
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
