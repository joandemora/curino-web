/* /admin/partners — utilidades comunes del CRM de Partners.
   Las páginas cargan supabase-js + admin-shell.js y después este archivo.
   Lectura con RLS de admin (is_admin) y escrituras solo por RPCs
   (crm_partners_actualizar_contacto / _edicion). Nada se borra. */
window.PA = (function () {
  'use strict';
  var ESTADOS = { nuevo: 'Nuevo', contactado: 'Contactado', interesado: 'Interesado', compro: 'Compró', descartado: 'Descartado' };
  var R = {
    situacion_actual: { cuenta_ajena: 'Cuenta ajena', autonomo_negocio: 'Autónomo / negocio', cambio_profesional: 'Cambio profesional', estudiando: 'Estudiando' },
    experiencia: { reformas_carpinteria: 'Reformas / carpintería', interiorismo_arquitectura: 'Interiorismo / arquitectura', ventas_atencion: 'Ventas / atención', desde_cero: 'Desde cero' },
    dedicacion: { '1_2_horas': '1-2 h/día', media_jornada: 'Media jornada', tiempo_completo: 'Tiempo completo' },
    inicio: { ya: 'Ya (próxima edición)', octubre: 'Ya (octubre)', noviembre: 'Ya (noviembre)', proximos_meses: 'Próximos meses', informandome: 'Informándose' },
    // v1 (solicitudes antiguas)
    p1_dedicacion: { carpinteria_reformas: 'Carpintería / reformas', interiorismo_arquitectura: 'Interiorismo / arquitectura', comercial_ventas: 'Comercial / ventas', cuenta_ajena: 'Cuenta ajena', otro_negocio: 'Otro negocio' },
    p3_inicio: { noviembre: 'Ya (noviembre)', tres_meses: 'Próximos 3 meses', informandome: 'Informándose' },
    p4_inversion: { si_1000_4000: 'Puede invertir', semanas: 'Necesita semanas', no: 'Ahora no' }
  };
  var CTA = { checkout: 'Acceder ahora', whatsapp: 'WhatsApp dudas', whatsapp_one_to_one: 'WhatsApp one-to-one' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function eur(cents, dec) {
    if (cents == null) return '—';
    var neg = cents < 0; cents = Math.abs(Math.round(cents));
    var e = Math.floor(cents / 100), d = cents % 100;
    var t = String(e).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (dec !== false || d) t += ',' + (d < 10 ? '0' : '') + d;
    return (neg ? '-' : '') + t + ' €';
  }
  function fecha(iso, conHora) {
    if (!iso) return '—';
    var o = { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Europe/Madrid' };
    if (conHora) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Date(iso).toLocaleString('es-ES', o);
  }
  function telefono(s) { return ((s.telefono_prefijo || '') + ' ' + (s.telefono || '')).trim(); }
  function respuestas(s) {
    if (s.situacion_actual || s.inicio) {
      return [R.situacion_actual[s.situacion_actual], R.experiencia[s.experiencia], R.dedicacion[s.dedicacion], R.inicio[s.inicio]].filter(Boolean).join(' · ');
    }
    return [R.p1_dedicacion[s.p1_dedicacion], R.p3_inicio[s.p3_inicio], R.p4_inversion[s.p4_inversion]].filter(Boolean).join(' · ');
  }
  function compro(s) {
    var c = [];
    if (s.pagado_at) c.push('Intensivo');
    if (s.sesion_comprada_at) c.push('Sesión 1:1');
    return c;
  }
  function waUrl(s) {
    var tel = ((s.telefono_prefijo || '') + (s.telefono || '')).replace(/\D/g, '');
    var nombre = String(s.nombre || '').split(' ')[0];
    var txt = 'Hola ' + nombre + ', soy Juan de Mora, de Curino 👋 He visto tu solicitud para el intensivo Curino Partners. ¿Te surgió alguna duda al ver la información? Encantado de resolvértela.';
    return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(txt);
  }
  function mailUrl(s) {
    var nombre = String(s.nombre || '').split(' ')[0];
    return 'mailto:' + encodeURIComponent(s.email) + '?subject=' + encodeURIComponent('Tu solicitud de Curino Partners') + '&body=' + encodeURIComponent('Hola ' + nombre + ',\n\n');
  }
  function toast(msg) {
    var t = document.getElementById('paToast');
    if (!t) { t = document.createElement('div'); t.id = 'paToast'; t.className = 'pa-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function estadoSelect(s) {
    return '<select class="pa-estado" data-estado="' + esc(s.id) + '">' + Object.keys(ESTADOS).map(function (k) {
      return '<option value="' + k + '"' + (s.crm_estado === k ? ' selected' : '') + '>' + ESTADOS[k] + '</option>';
    }).join('') + '</select>';
  }
  // Guarda estado o notas (RPC admin). Devuelve la fila actualizada.
  function guardarContacto(supa, id, estado, notas) {
    return supa.rpc('crm_partners_actualizar_contacto', { p_id: id, p_estado: estado, p_notas: notas })
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  // URL firmada (60 s) de un PDF del bucket privado invoices.
  function abrirPdf(supa, path) {
    if (!path) return;
    var w = window.open('', '_blank');
    supa.storage.from('invoices').createSignedUrl(path, 60).then(function (r) {
      if (r.error || !r.data) { w && w.close(); toast('No se pudo abrir el PDF'); return; }
      if (w) w.location = r.data.signedUrl; else location.href = r.data.signedUrl;
    });
  }
  // Consentimiento único (solicitud + comercial) como check editable.
  // «Sí» = los dos; «solo solicitud» = solicitudes anteriores a la casilla
  // única (emails 1, 2 y 4, sin oferta 1:1 ni envíos comerciales).
  function consentChecks(s) {
    var si = s.consentimiento_solicitud && s.consentimiento_comercial;
    var solo = !si && s.consentimiento_solicitud;
    return '<label class="pa-consent" title="Secuencia completa y envíos comerciales del CRM"><input type="checkbox" data-consent="ambos" data-id="' + esc(s.id) + '"' + (si ? ' checked' : '') + '> ' + (si ? 'Sí' : 'No') + '</label>'
      + (solo ? '<div class="pa-small pa-muted">solo solicitud</div>' : '');
  }
  // Cambio manual (RPC solo admin); revierte el check si falla.
  function guardarConsent(supa, cb, s) {
    var campo = cb.dataset.consent, valor = cb.checked;
    return supa.rpc('crm_partners_consentimiento', { p_id: s.id, p_campo: campo, p_valor: valor }).then(function (r) {
      if (r.error) { cb.checked = !valor; toast('Error: ' + r.error.message); return null; }
      Object.assign(s, r.data);
      toast('Consentimiento ' + (valor ? 'activado' : 'quitado'));
      return r.data;
    });
  }

  // Borrado de contactos: confirmación escribiendo «BORRAR». lista = [{nombre,
  // email}] (borrables); bloqueados = los que tienen compras (solo se avisan).
  // Resuelve true si se confirma.
  function confirmarBorrado(lista, bloqueados) {
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'pa-modal';
      ov.innerHTML = '<div class="pa-modal-box" role="dialog" aria-modal="true" aria-labelledby="paBorrarT">'
        + '<h3 id="paBorrarT">Borrar ' + (lista.length === 1 ? 'contacto' : lista.length + ' contactos') + '</h3>'
        + '<p class="pa-small">Se elimina la solicitud y su historial de emails, y se cancela la secuencia. No se puede deshacer.</p>'
        + '<ul class="pa-modal-list">' + lista.map(function (c) { return '<li><b>' + esc(c.nombre) + '</b> · ' + esc(c.email) + '</li>'; }).join('') + '</ul>'
        + (bloqueados && bloqueados.length ? '<p class="pa-small pa-modal-warn">No se borran (tienen compras): ' + bloqueados.map(function (c) { return esc(c.nombre); }).join(', ') + '</p>' : '')
        + '<label class="pa-small">Escribe <b>BORRAR</b> para confirmar<input type="text" class="pa-modal-input" autocomplete="off"></label>'
        + '<div class="pa-btns"><button type="button" class="pa-btn danger" data-ok disabled>Borrar</button><button type="button" class="pa-btn" data-no>Cancelar</button></div></div>';
      document.body.appendChild(ov);
      var inp = ov.querySelector('input'), ok = ov.querySelector('[data-ok]');
      var cerrar = function (v) { ov.remove(); resolve(v); };
      inp.addEventListener('input', function () { ok.disabled = inp.value.trim() !== 'BORRAR'; });
      ok.addEventListener('click', function () { if (inp.value.trim() === 'BORRAR') cerrar(true); });
      ov.querySelector('[data-no]').addEventListener('click', function () { cerrar(false); });
      ov.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(false); });
      inp.focus();
    });
  }
  var AVISO_COMPRAS = 'Tiene compras: no se puede borrar. Puedes marcarlo como Descartado y darlo de baja';

  // Variables de los emails (mismas que _shared/crm-render.ts) y barra de
  // formato del editor: negrita, enlace, botón y chips de variables.
  var VARS = ['nombre', 'email', 'curso', 'fecha_inicio', 'hora', 'zoom', 'enlace_reserva', 'plazas_restantes',
    'enlace_plaza', 'enlace_formaciones', 'enlace_whatsapp', 'plazas_libres', 'plazas_totales',
    'precio_oferta_sesion', 'precio_sesion', 'horas_oferta', 'quedan_plazas', 'enlace_llamada', 'mes_intensivo'];
  function insertar(ta, antes, despues) {
    var a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
    ta.value = ta.value.slice(0, a) + antes + sel + despues + ta.value.slice(b);
    ta.focus(); ta.selectionStart = a + antes.length; ta.selectionEnd = a + antes.length + sel.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function barraEditor(cont, getTa) {
    var b = function (html, fn) { var x = document.createElement('button'); x.type = 'button'; x.className = 'em-chip'; x.innerHTML = html; x.addEventListener('click', fn); cont.appendChild(x); };
    b('<b>Negrita</b>', function () { insertar(getTa(), '**', '**'); });
    b('Enlace', function () { var u = prompt('URL del enlace (https://… o una variable como {enlace_plaza})'); if (u) insertar(getTa(), '[', '](' + u.trim() + ')'); });
    b('Botón', function () {
      var t = prompt('Texto del botón', 'Reservar mi plaza'); if (!t) return;
      var u = prompt('Enlace del botón (https://… o una variable)', '{enlace_plaza}'); if (!u) return;
      insertar(getTa(), '\n[[' + t.trim() + ']](' + u.trim() + ')\n', '');
    });
    VARS.forEach(function (v) { b('{' + v + '}', function () { insertar(getTa(), '{' + v + '}', ''); }); });
  }

  // Llamada de admisión (Cal.com): badge con fecha y estado.
  function llamada(s) {
    if (s.llamada_estado === 'reservada') return '<span class="pa-badge ok">' + fecha(s.llamada_at, true) + '</span>';
    if (s.llamada_estado === 'cancelada') return '<span class="pa-badge bad">Cancelada</span>';
    if (s.llamada_estado === 'no_presentado') return '<span class="pa-badge bad">No se presentó</span>';
    return '<span class="pa-muted">—</span>';
  }

  // Respuesta «inversion» de Cal.com (solo informativa)
  var INVERSION = { si: 'Sí', si_organizarme: 'Lo puedo conseguir', no_por_ahora: 'No por ahora' };
  function inversion(s) { return INVERSION[s.inversion] || ''; }

  return { ESTADOS: ESTADOS, llamada: llamada, inversion: inversion, VARS: VARS, insertar: insertar, barraEditor: barraEditor, confirmarBorrado: confirmarBorrado, AVISO_COMPRAS: AVISO_COMPRAS, consentChecks: consentChecks, guardarConsent: guardarConsent, CTA: CTA, R: R, esc: esc, eur: eur, fecha: fecha, telefono: telefono, respuestas: respuestas,
    compro: compro, waUrl: waUrl, mailUrl: mailUrl, toast: toast, estadoSelect: estadoSelect, guardarContacto: guardarContacto, abrirPdf: abrirPdf };
})();
