/* ============================================================
 * revista-shell.js — NAV + footer compartidos del frontend
 * público de Revista Curino. Cada página /revista/* lo importa
 * y llama mountShell() para inyectar NAV y footer.
 *
 * El contenido SEO (hero, grids, artículo) va inline en HTML,
 * el shell (chrome) se hidrata via JS.
 * ============================================================ */
(function(){
  'use strict';

  var NAV_HTML = ''+
'<nav id="nav">'+
'  <a href="/" class="nav-logo"><img src="/assets/imagenes/logo-curino.svg" alt="Curino" height="28"></a>'+
'  <div class="nav-right">'+
'    <div class="nav-links">'+
'      <div class="mega-trigger">'+
'        <a href="#">Alta Carpintería</a>'+
'        <div class="megamenu">'+
'          <div class="mega-col"><div class="mega-col-title">Sistemas</div><a href="#">Maestro</a><a href="#">Fina</a><a href="#">Autor</a></div>'+
'          <div class="mega-col"><div class="mega-col-title">Estancias</div><a href="#">Dormitorio</a><a href="#">Cocina</a><a href="#">Salón</a><a href="#">Comedor</a><a href="#">Baño</a></div>'+
'          <div class="mega-col"><div class="mega-col-title">Productos</div><a href="#">Armarios</a><a href="#">Vestidores</a><a href="#">Puertas</a><a href="#">Paneles</a><a href="#">Cocinas</a></div>'+
'          <div class="mega-col"><div class="mega-col-title">Proyectos Integrales</div><a href="#">Residencial</a><a href="#">Contract</a><a href="#">Couture</a></div>'+
'        </div>'+
'      </div>'+
'      <a href="#">Diseñadores</a>'+
'      <a href="#">Lab Work</a>'+
'      <a href="#">Materiales</a>'+
'      <a href="#">Estudio</a>'+
'      <div class="mega-trigger">'+
'        <a href="/revista/" style="font-weight:600">Revista</a>'+
'        <div class="megamenu">'+
'          <div class="mega-col">'+
'            <div class="mega-col-title">Secciones</div>'+
'            <a href="/revista/proyectos/">Proyectos</a>'+
'            <a href="/revista/materiales/">Materiales</a>'+
'            <a href="/revista/articulos/">Artículos</a>'+
'            <a href="/revista/noticias/">Noticias</a>'+
'            <a href="/revista/entrevistas/">Entrevistas</a>'+
'          </div>'+
'          <div class="mega-col">'+
'            <div class="mega-col-title">Publicar</div>'+
'            <a href="/mi-cuenta/revista/">Mis publicaciones</a>'+
'            <a href="/mi-cuenta/revista/perfil/">Perfil de revista</a>'+
'          </div>'+
'        </div>'+
'      </div>'+
'      <a href="#">Partners</a>'+
'      <a href="#">Contacto</a>'+
'    </div>'+
'    <div class="nav-icons">'+
'      <a href="#">ES</a>'+
'      <a href="/login/" class="user-icon-link"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></a>'+
'    </div>'+
'  </div>'+
'  <div class="nav-mobile-right">'+
'    <a href="/login/" class="user-icon-link"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></a>'+
'    <div class="nav-hamburger" onclick="window.__rvToggleMenu()" id="hamburger"><span></span><span></span><span></span></div>'+
'  </div>'+
'</nav>'+
'<div class="mobile-menu" id="mobileMenu">'+
'  <a href="#" onclick="window.__rvToggleMenu()">Alta Carpintería</a>'+
'  <a href="#" onclick="window.__rvToggleMenu()">Diseñadores</a>'+
'  <a href="#" onclick="window.__rvToggleMenu()">Lab Work</a>'+
'  <a href="#" onclick="window.__rvToggleMenu()">Materiales</a>'+
'  <a href="#" onclick="window.__rvToggleMenu()">Estudio</a>'+
'  <div class="mobile-accordion">'+
'    <div class="mobile-accordion-title" onclick="this.parentElement.classList.toggle(\'open\')">Revista</div>'+
'    <div class="mobile-accordion-body">'+
'      <a href="/revista/">Inicio Revista</a>'+
'      <a href="/revista/proyectos/">Proyectos</a>'+
'      <a href="/revista/materiales/">Materiales</a>'+
'      <a href="/revista/articulos/">Artículos</a>'+
'      <a href="/revista/noticias/">Noticias</a>'+
'      <a href="/revista/entrevistas/">Entrevistas</a>'+
'    </div>'+
'  </div>'+
'  <a href="#" onclick="window.__rvToggleMenu()">Partners</a>'+
'  <a href="#" onclick="window.__rvToggleMenu()">Contacto</a>'+
'</div>';

  var FOOTER_HTML = ''+
'<footer>'+
'  <div style="grid-area:logo">'+
'    <img src="/assets/imagenes/logo-curino-blanco.svg" alt="Curino" style="height:28px;width:auto;display:block;margin-bottom:1.5rem;filter:brightness(0) invert(1)">'+
'    <p class="footer-tagline">Crea tu espacio ideal. Mobiliario de alta carpintería a medida — armarios, vestidores, cocinas y puertas con garantía de 25 años.</p>'+
'  </div>'+
'  <div class="footer-col" style="grid-area:alta"><h4 onclick="this.parentElement.classList.toggle(\'open\')">Alta Carpintería</h4><div class="footer-links"><a href="/configurador-armarios-vestidores/">Configurador de armarios</a><a href="#">Proyecto a medida en Barcelona</a><a href="#">Proyecto a medida en Madrid</a></div></div>'+
'  <div class="footer-col" style="grid-area:corp"><h4 onclick="this.parentElement.classList.toggle(\'open\')">Corporativo</h4><div class="footer-links"><a href="#">Sobre nosotros</a><a href="#">I+D e Innovación</a><a href="#">Ética Corporativa</a></div></div>'+
'  <div class="footer-col" style="grid-area:empleo"><h4 onclick="this.parentElement.classList.toggle(\'open\')">Empleo</h4><div class="footer-links"><a href="#">Únete a Curino</a><a href="#">Curino Partners</a></div></div>'+
'  <div class="footer-col" style="grid-area:prensa"><h4 onclick="this.parentElement.classList.toggle(\'open\')">Sala de Prensa</h4><div class="footer-links"><a href="/revista/">Revista</a><a href="#">Contacto Prensa</a></div></div>'+
'  <div class="footer-col" style="grid-area:contacto"><h4 onclick="this.parentElement.classList.toggle(\'open\')">Contacto</h4><div class="footer-links"><a href="#">WhatsApp</a><a href="mailto:info@casacurino.com">info@casacurino.com</a></div></div>'+
'  <div class="footer-col footer-newsletter" style="grid-area:newsletter"><h4>Newsletter</h4><div class="footer-links"><input type="email" placeholder="Tu email"><button type="button">Suscribirse</button></div></div>'+
'</footer>'+
'<div class="footer-bottom">'+
'  <span>© 2026 Curino · Mueble a medida · España · Europa · EEUU</span>'+
'  <div class="footer-legal"><span>Sistema &amp; Curino, S.L.U.</span><span>Términos y Condiciones | Política de Privacidad | Política de Cookies</span></div>'+
'  <span>casacurino.com</span>'+
'</div>';

  function mountShell(){
    var navMount=document.getElementById('rv-nav-mount');
    var footMount=document.getElementById('rv-footer-mount');
    if(navMount) navMount.outerHTML=NAV_HTML;
    if(footMount) footMount.outerHTML=FOOTER_HTML;
  }

  window.__rvToggleMenu=function(){
    var m=document.getElementById('mobileMenu');
    var h=document.getElementById('hamburger');
    if(m) m.classList.toggle('open');
    if(h) h.classList.toggle('open');
  };

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',mountShell);
  }else{
    mountShell();
  }
  window.mountRevistaShell=mountShell;
})();
