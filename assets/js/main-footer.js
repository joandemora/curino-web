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

  function footerBottomHtml() {
    return ''
      + '<div class="footer-bottom">'
      +   '<span>© 2026 Curino · Mueble a medida · España · Europa · EEUU</span>'
      +   '<div class="footer-legal">'
      +     '<span>Sistema &amp; Curino, S.L.U.</span>'
      +     '<span><a href="/aviso-legal/" style="color:inherit;text-decoration:none">Aviso legal</a> | <a href="/privacidad/" style="color:inherit;text-decoration:none">Privacidad</a> | <a href="/cookies/" style="color:inherit;text-decoration:none">Cookies</a></span>'
      +   '</div>'
      +   '<span>casacurino.com</span>'
      + '</div>';
  }

  function ensureCssLoaded() {
    if (!document.querySelector('link[href="/assets/css/main-footer.css"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/assets/css/main-footer.css';
      document.head.appendChild(link);
    }
  }

  function mount() {
    var slot = document.getElementById('main-footer-mount');
    if (!slot) {
      // Defensa: sin mount point no inyectamos (admin/revista
      // y cualquier página sin el div quedan a salvo).
      return;
    }
    ensureCssLoaded();
    if (isCheckout()) {
      slot.outerHTML = footerBottomHtml();
    } else {
      slot.outerHTML = footerColumnsHtml() + footerBottomHtml();
    }
    document.dispatchEvent(new CustomEvent('curino:main-footer-mounted'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
