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
    inicio: { noviembre: 'Ya (noviembre)', proximos_meses: 'Próximos meses', informandome: 'Informándose' },
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
  return { ESTADOS: ESTADOS, CTA: CTA, R: R, esc: esc, eur: eur, fecha: fecha, telefono: telefono, respuestas: respuestas,
    compro: compro, waUrl: waUrl, mailUrl: mailUrl, toast: toast, estadoSelect: estadoSelect, guardarContacto: guardarContacto, abrirPdf: abrirPdf };
})();
