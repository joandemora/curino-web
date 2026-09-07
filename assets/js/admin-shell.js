/* ============================================================
 * admin-shell.js — sidebar + header compartidos del panel
 * admin de Curino (Fase H).
 *
 * Cada página /admin/* importa este script + admin-shell.css y
 * llama initAdminShell({ activeSection, title }).
 *
 * Lo que hace:
 *   1. Inyecta sidebar + topbar en el DOM (mount points
 *      <div id="ash-sidebar-mount"></div> y <div id="ash-topbar-mount"></div>).
 *      Si no existen los mount points, los crea al inicio de <body>.
 *   2. Valida que el user está logueado y tiene rol admin.
 *      No admin → redirect a /mi-cuenta/. Sin sesión → /login/.
 *   3. Marca el link activo según activeSection.
 *   4. Expone window.__ashSupabase y window.__ashUser para que las
 *      páginas reutilicen el cliente Supabase ya inicializado.
 *
 * El llamador típico:
 *   <body class="hidden-until-auth">
 *     <main class="ash-content"> ... </main>
 *     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *     <script src="/assets/js/admin-shell.js"></script>
 *     <script>
 *       initAdminShell({ activeSection: 'marketplace-reports', title: 'Reports del marketplace' })
 *         .then(({ supabase, user }) => { ... usar supabase/user en la página ... });
 *     </script>
 * ============================================================ */
(function () {
  'use strict';

  var MENU = [
    { id: 'dashboard', label: 'Dashboard', href: '/admin/' },
    {
      group: 'Armarios',
      items: [
        { id: 'armarios',              label: 'Pedidos',      href: '/admin/armarios/' },
        { id: 'armarios-presupuestos', label: 'Presupuestos', href: '/admin/armarios/presupuestos/' },
        { id: 'armarios-precios',      label: 'Precios',      href: '/admin/armarios/precios/' }
      ]
    },
    {
      group: 'Marketplace',
      items: [
        { id: 'marketplace-catalog', label: 'Catálogo', href: '/admin/marketplace/' },
        { id: 'marketplace-reports', label: 'Reports', href: '/admin/marketplace/reports/' }
      ]
    },
    {
      group: 'Revista',
      items: [
        { id: 'revista-publicar', label: 'Publicar', href: '/admin/revista/publicar/' },
        { id: 'revista-moderacion', label: 'Moderación', href: '/admin/revista/moderacion/' },
        { id: 'revista-generador', label: 'Generador IA', href: '/admin/revista/generador/' }
      ]
    },
    {
      group: 'Carpintería',
      items: [
        { id: 'carpinteria-proyectos',  label: 'Proyectos',     href: '/admin/proyectos-carpinteria/' },
        { id: 'carpinteria-materiales', label: 'Materiales',    href: '/admin/proyectos-carpinteria/catalogo/materiales/' },
        { id: 'carpinteria-herrajes',   label: 'Herrajes',      href: '/admin/proyectos-carpinteria/catalogo/herrajes/' },
        { id: 'carpinteria-config',     label: 'Configuración', href: '/admin/proyectos-carpinteria/config/' }
      ]
    },
    {
      group: 'CRM',
      items: [
        { id: 'crm-cola',           label: 'Cola de llamadas', href: '/admin/crm/' },
        { id: 'crm-prescriptores',  label: 'Prescriptores',    href: '/admin/crm/prescriptores.html' },
        { id: 'crm-clientes',       label: 'Clientes',         href: '/admin/crm/clientes.html' },
        { id: 'crm-metricas',       label: 'Métricas',         href: '/admin/crm/metricas.html' }
      ]
    }
  ];

  function buildSidebarHtml(activeId) {
    var out = ''
      + '<aside class="ash-sidebar" id="ashSidebar">'
      + '  <div class="ash-brand">'
      + '    <div class="ash-brand-title">CURINO ADMIN</div>'
      + '    <div class="ash-brand-sub">Panel de gestión</div>'
      + '  </div>';

    MENU.forEach(function (entry) {
      if (entry.group) {
        out += '<div class="ash-group">';
        out += '  <div class="ash-group-title">' + escHtml(entry.group) + '</div>';
        entry.items.forEach(function (item) {
          var cls = 'ash-link' + (item.id === activeId ? ' active' : '');
          out += '<a class="' + cls + '" href="' + escHtml(item.href) + '">' + escHtml(item.label) + '</a>';
        });
        out += '</div>';
      } else {
        out += '<div class="ash-group">';
        var cls = 'ash-link' + (entry.id === activeId ? ' active' : '');
        out += '<a class="' + cls + '" href="' + escHtml(entry.href) + '">' + escHtml(entry.label) + '</a>';
        out += '</div>';
      }
    });

    out += '<div class="ash-sidebar-foot">'
      +   '<a href="/mi-cuenta/">← Volver a Mi cuenta</a>'
      +   '<button type="button" id="ashLogoutBtn">Cerrar sesión</button>'
      + '</div>'
      + '</aside>'
      + '<div class="ash-overlay" id="ashOverlay"></div>';

    return out;
  }

  function buildTopbarHtml(title, userEmail) {
    return ''
      + '<header class="ash-topbar">'
      + '  <div style="display:flex;align-items:center;gap:.6rem">'
      + '    <button class="ash-mobile-toggle" id="ashMobileToggle" aria-label="Abrir menú">☰</button>'
      + '    <div class="ash-topbar-title">' + escHtml(title || '') + '</div>'
      + '  </div>'
      + '  <div class="ash-topbar-actions">'
      + '    <span class="ash-topbar-user">' + escHtml(userEmail || '') + '</span>'
      + '  </div>'
      + '</header>';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function ensureMounts() {
    var sidebarMount = document.getElementById('ash-sidebar-mount');
    var topbarMount = document.getElementById('ash-topbar-mount');
    if (!sidebarMount) {
      sidebarMount = document.createElement('div');
      sidebarMount.id = 'ash-sidebar-mount';
      document.body.insertBefore(sidebarMount, document.body.firstChild);
    }
    if (!topbarMount) {
      topbarMount = document.createElement('div');
      topbarMount.id = 'ash-topbar-mount';
      sidebarMount.parentNode.insertBefore(topbarMount, sidebarMount.nextSibling);
    }
    return { sidebarMount: sidebarMount, topbarMount: topbarMount };
  }

  function wireMobile() {
    var toggle = document.getElementById('ashMobileToggle');
    var sidebar = document.getElementById('ashSidebar');
    var overlay = document.getElementById('ashOverlay');
    function open() { sidebar.classList.add('open'); overlay.classList.add('open'); }
    function close() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }
    if (toggle) toggle.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) close(); else open();
    });
    if (overlay) overlay.addEventListener('click', close);
  }

  function wireLogout(supabase) {
    var btn = document.getElementById('ashLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      try { await supabase.auth.signOut(); } catch (e) { /* noop */ }
      window.location.href = '/login/';
    });
  }

  async function initAdminShell(opts) {
    opts = opts || {};
    var activeSection = opts.activeSection || '';
    var title = opts.title || '';
    var pathname = window.location.pathname;

    var configRes;
    try {
      var r = await fetch('/api/config', { redirect: 'follow' });
      configRes = await r.json();
    } catch (_e) {
      window.location.href = '/login/?redirect=' + encodeURIComponent(pathname);
      throw _e;
    }

    if (!configRes.supabaseUrl || !configRes.supabaseAnonKey || !window.supabase) {
      window.location.href = '/login/?redirect=' + encodeURIComponent(pathname);
      throw new Error('config_missing');
    }

    var supa = window.supabase.createClient(configRes.supabaseUrl, configRes.supabaseAnonKey);
    window.SUPABASE_URL = configRes.supabaseUrl;
    window.__ashSupabase = supa;

    var session = await supa.auth.getSession();
    if (!session.data.session) {
      window.location.href = '/login/?redirect=' + encodeURIComponent(pathname);
      throw new Error('not_logged_in');
    }
    var user = session.data.session.user;
    window.__ashUser = user;

    // Validar rol admin
    var roleRes = await supa.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    var isAdmin = roleRes.data && roleRes.data.role === 'admin';
    if (!isAdmin) {
      alert('Solo administradores pueden acceder al panel.');
      window.location.href = '/mi-cuenta/';
      throw new Error('not_admin');
    }

    // Montar chrome
    var mounts = ensureMounts();
    mounts.sidebarMount.outerHTML = buildSidebarHtml(activeSection);
    mounts.topbarMount.outerHTML = buildTopbarHtml(title, user.email || '');

    wireMobile();
    wireLogout(supa);

    document.body.classList.remove('hidden-until-auth');
    return { supabase: supa, user: user };
  }

  window.initAdminShell = initAdminShell;
})();
