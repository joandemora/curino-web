/* assets/js/estudio-ui.js
 *
 * Estudio Curino · vistas compartidas entre el admin (/admin/partners/
 * estudio*.html) y el área de alumnos (/partners/estudio/). Sin build.
 *
 *   EstudioUI.proyectos(el, ctx, pid?)  proyectos, alzados por versión y chat con Claude
 *   EstudioUI.presupuesto(el, ctx, pid) editor del presupuesto, PDF y Excel
 *   EstudioUI.tarifa(el, ctx, de)       tarifa ('curino' admin · 'mia' alumno)
 *   EstudioUI.plantilla(el, ctx)        datos del emisor y plantilla del presupuesto
 *
 * ctx = {
 *   supa,                     cliente de Supabase (con sesión)
 *   modo: 'admin'|'alumno',
 *   rutas: { estudio(pid), presupuesto(pid), datos(), tarifa() }  → href
 *   alAbrir(pid)              opcional: refleja el proyecto abierto en la URL
 *   alCambiar()               opcional: tras gastar crédito o guardar datos
 * }
 * Todo pasa por la Edge Function estudio-ia (la clave de la IA nunca llega aquí).
 */
(function () {
  'use strict';

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fecha = function (d) { return new Date(d).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var $ = function (q, r) { return (r || document).querySelector(q); };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var eur = function (n) { if (n === null || n === undefined) return 'PENDIENTE'; var p = Math.abs(n).toFixed(2).split('.'); return (n < 0 ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1] + ' €'; };
  var numIn = function (v) { var t = String(v || '').trim().replace(/\./g, '').replace(',', '.'); if (t === '') return null; var n = Number(t); return isFinite(n) ? n : null; };
  var numOut = function (n) { return n === null || n === undefined ? '' : String(n).replace('.', ','); };

  /** Llamada a estudio-ia; el error lleva el JSON de respuesta en e.datos. */
  function api(ctx, body) {
    return ctx.supa.functions.invoke('estudio-ia', { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var c = r.error.context;
      return (c && c.json ? c.json() : Promise.reject(r.error)).then(function (d) {
        var e = new Error((d && (d.error || d.mensaje)) || 'Error'); e.datos = d || {}; throw e;
      });
    });
  }
  /** Mensaje de error con enlace a «Mis datos y plantilla» cuando faltan datos. */
  function textoError(ctx, e) {
    if (e.datos && e.datos.faltan && e.datos.faltan.length && ctx.rutas && ctx.rutas.datos) {
      return esc('Antes de descargar completa tus datos: falta ' + e.datos.faltan.join(', ') + '.') + ' <a href="' + ctx.rutas.datos() + '">Completar mis datos</a>';
    }
    if (e.datos && e.datos.bloqueantes && e.datos.bloqueantes.length) {
      // PDF / Excel del cliente bloqueados: qué líneas lo impiden (la vista previa sí se puede ver)
      return esc(e.message) + '<ul class="pr-bloq">' + e.datos.bloqueantes.slice(0, 15).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') +
        (e.datos.bloqueantes.length > 15 ? '<li>… y ' + (e.datos.bloqueantes.length - 15) + ' más</li>' : '') + '</ul>';
    }
    return esc(e.message);
  }

  // ════════════════════════════════════════════════════════════════
  // Proyectos: tarjetas y ficha (Diseño · Documentos · Archivos · Métricas)
  // ════════════════════════════════════════════════════════════════
  var EST_NOMBRE = { borrador: 'Borrador', enviado: 'Enviado', aceptado: 'Aceptado', rechazado: 'Rechazado' };
  var eurN = function (n) { return n === null || n === undefined ? '—' : (n < 0 ? '-' : '') + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €'; };
  var dia = function (d) { return d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  var pctTxt = function (n) { return n === null || n === undefined ? '—' : String(n).replace('.', ',') + ' %'; };

  function proyectos(el, ctx, pid, tab) {
    if (pid) return fichaProyecto(el, ctx, pid, tab || 'resumen');
    var lista = [], q = '', estado = '', orden = 'num';
    el.innerHTML = '<div class="ng"><div class="ng-cab"><h1>Proyectos</h1><div class="pj-filtros">' +
      '<input type="search" id="pjBuscar" placeholder="Buscar cliente o referencia">' +
      '<select id="pjEstado"><option value="">Todos los estados</option><option value="sin">Sin presupuesto</option>' + Object.keys(EST_NOMBRE).map(function (k) { return '<option value="' + k + '">' + EST_NOMBRE[k] + '</option>'; }).join('') + '</select>' +
      '<select id="pjOrden"><option value="num">N.º (más reciente arriba)</option><option value="num_asc">N.º (del 01 en adelante)</option><option value="fecha">Últimos modificados</option><option value="importe">Mayor importe</option><option value="margen">Mayor margen</option></select></div></div>' +
      '<div class="pj-grid" id="pjGrid"><p class="pa-muted">Cargando…</p></div></div>';
    function pintar() {
      var f = lista.filter(function (p) {
        var txt = (p.nombre + ' ' + (p.referencia || '') + ' ' + (p.numero || '')).toLowerCase();
        return (!q || txt.indexOf(q) >= 0) && (!estado || (estado === 'sin' ? !p.estado : p.estado === estado));
      }).sort(function (a, b) {
        // Sin n.º (OLD, Proveedores…) siempre al final
        if (orden === 'num' || orden === 'num_asc') {
          if (a.num == null || b.num == null) return (a.num == null) - (b.num == null) || a.nombre.localeCompare(b.nombre);
          return orden === 'num' ? b.num - a.num : a.num - b.num;
        }
        if (orden === 'importe') return (b.importe || 0) - (a.importe || 0);
        if (orden === 'margen') return (b.margen_pct === null ? -1e9 : b.margen_pct) - (a.margen_pct === null ? -1e9 : a.margen_pct);
        return String(b.actualizado).localeCompare(String(a.actualizado));
      });
      var nueva = '<form class="pj-card pj-nueva" id="pjNueva" autocomplete="off"><div class="pj-mas">+</div><strong>Nuevo proyecto</strong>' +
        '<input id="pjNombre" placeholder="Nombre del proyecto (el n.º se pone solo)" maxlength="80" required><input id="pjRef" placeholder="Referencia (opcional)" maxlength="40"><button class="pa-btn primary" type="submit">Crear</button></form>';
      document.getElementById('pjGrid').innerHTML = nueva + f.map(function (p) {
        var m = p.margen_pct;
        return '<a class="pj-card" href="' + ctx.rutas.estudio(p.id) + '" data-id="' + p.id + '">' +
          '<div class="pj-mini">' + (p.miniatura || '<span>Sin alzados todavía</span>') + '</div>' +
          '<div class="pj-info"><div class="pj-fila"><strong>' + esc(p.nombre) + '</strong>' + (p.estado ? '<span class="ng-tag ng-e-' + p.estado + '">' + EST_NOMBRE[p.estado] + '</span>' : '<span class="ng-tag ng-e-borrador">Sin presupuesto</span>') + '</div>' +
          '<small>' + esc([p.referencia, p.numero && p.numero !== p.referencia ? 'n.º ' + p.numero : '', p.version ? 'v' + p.version : ''].filter(Boolean).join(' · ') || '—') + '</small>' +
          '<div class="pj-nums"><span><b>' + eurN(p.importe) + '</b>importe</span><span class="' + (m !== null && m < 30 ? 'pj-bajo' : '') + '"><b>' + pctTxt(m) + '</b>margen</span><span><b>' + dia(p.actualizado) + '</b>modificado</span></div></div></a>';
      }).join('') + (f.length ? '' : '<p class="pa-muted pj-vacio">' + (lista.length ? 'Ningún proyecto con esos filtros.' : 'Crea tu primer proyecto con la tarjeta «Nuevo proyecto».') + '</p>');
      document.getElementById('pjNueva').addEventListener('submit', function (e) {
        e.preventDefault();
        api(ctx, { action: 'crear', nombre: document.getElementById('pjNombre').value, referencia: document.getElementById('pjRef').value })
          .then(function (d) { location.href = ctx.rutas.estudio(d.proyecto.id); if (ctx.alNavegar) ctx.alNavegar(); })
          .catch(function (err) { alert(err.message); });
      });
    }
    el.querySelector('#pjBuscar').addEventListener('input', function () { q = this.value.trim().toLowerCase(); pintar(); });
    el.querySelector('#pjEstado').addEventListener('change', function () { estado = this.value; pintar(); });
    el.querySelector('#pjOrden').addEventListener('change', function () { orden = this.value; pintar(); });
    api(ctx, { action: 'proyectos_lista' }).then(function (d) { lista = d.proyectos; pintar(); })
      .catch(function (e) { document.getElementById('pjGrid').innerHTML = '<p class="tf-err">' + esc(e.message) + '</p>'; });
  }

  function fichaProyecto(el, ctx, pid, tab) {
    // Pestañas antiguas (Archivos, Documentos, Métricas): ahora todo está en «Resumen»
    var irPresupuestos = tab === 'presupuesto';
    if (tab === 'archivos' || tab === 'documentos' || tab === 'metricas' || tab === 'presupuesto') tab = 'resumen';
    var TABS = [['resumen', 'Resumen'], ['diseno', 'Diseño']];
    el.innerHTML = '<div class="pj-ficha"><div class="pj-cab"><a class="pj-volver" href="' + ctx.rutas.estudio() + '">← Proyectos</a><h1 id="pjTitulo">…</h1>' +
      '<nav class="pj-tabs">' + TABS.map(function (t) { return '<a href="' + ctx.rutas.estudio(pid, t[0]) + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</a>'; }).join('') +
      '</nav></div><div id="pjCuerpo"></div></div>';
    // Cabecera: solo el nombre (el montaje está en el bloque «Montaje» del Resumen; «Borrar proyecto», al final del Resumen)
    var cargarCab = function () {
      return ctx.supa.from('estudio_proyectos').select('nombre, referencia').eq('id', pid).maybeSingle().then(function (r) {
        if (!r.data) return;
        document.getElementById('pjTitulo').innerHTML = esc(r.data.nombre) + (r.data.referencia ? ' <span class="pa-muted">· ' + esc(r.data.referencia) + '</span>' : '');
      });
    };
    cargarCab();
    var cuerpo = el.querySelector('#pjCuerpo');
    if (tab === 'resumen') return resumenProyecto(cuerpo, ctx, pid, { irPresupuestos: irPresupuestos });
    return disenoProyecto(cuerpo, ctx, pid);
  }

  // ── Diseño: chat con Claude, versiones y alzados ──
  /** Diseño: abre en blanco al instante; «Editar diseño» (desde Documentos) carga uno guardado. */
  var CLAVE_EDITAR = 'estudio-diseno-editar';
  function disenoProyecto(el, ctx, pid) {
    var supa = ctx.supa, diseno = null, versiones = [], viendo = 0, ocupado = false, versionInicio = 0;
    var editar = null; try { editar = sessionStorage.getItem(CLAVE_EDITAR); sessionStorage.removeItem(CLAVE_EDITAR); } catch (e) { /* sin almacenamiento */ }
    el.innerHTML =
      '<div class="es-grid es-grid-2">' +
      '<section><div class="es-card" id="esZona"></div></section>' +
      '<aside class="es-card es-chat" id="esChat"><div class="es-msgs" id="esMsgs"></div>' +
      '<form class="es-compose" id="esForm"><textarea id="esTexto" placeholder="Describe el armario o pide un cambio: «el módulo 2 con 4 cajones», «altillo de 40»…" maxlength="4000"></textarea>' +
      '<div class="es-fila"><label class="pa-btn" style="cursor:pointer">📎 Plano<input type="file" id="esArchivos" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden></label>' +
      '<span class="es-adj" id="esAdj"></span><button class="pa-btn primary" type="submit" id="esEnviar">Enviar</button></div>' +
      '<div class="es-error" id="esError" hidden></div></form></aside></div>';
    function alertaError(t) { var e = $('#esError'); e.textContent = t; e.hidden = !t; }
    function pintarZona(svgs) {
      var guardado = diseno && diseno.guardado;
      var titulo = diseno && guardado ? esc(diseno.nombre) : 'Diseño nuevo' + (diseno ? ' <span class="pr-tag">sin guardar</span>' : '');
      var chips = versiones.map(function (v, i) {
        return '<button type="button" class="es-v' + (v.numero === viendo ? ' on' : '') + (diseno && v.numero === diseno.version_actual ? ' actual' : '') +
          '" data-v="' + v.numero + '" title="' + esc((v.origen === 'ia' ? 'IA · ' : '') + (v.nota || '') + ' · ' + fecha(v.created_at)) + '">v' + (i + 1) + '</button>';
      }).join('');
      var acciones = '';
      if (viendo) acciones += '<button type="button" class="pa-btn primary" id="esGuardarDoc">Guardar en documentos</button><button type="button" class="pa-btn" id="esPdf">Descargar alzados</button>';
      if (diseno && viendo && viendo !== diseno.version_actual) acciones = '<button type="button" class="pa-btn" id="esRestaurar">Volver a esta versión</button> ' + acciones;
      if (diseno) acciones += '<button type="button" class="pa-btn" id="esNuevo">Empezar otro diseño</button>';
      $('#esZona').innerHTML =
        '<div class="es-cab"><div><strong class="es-titulo">' + titulo + '</strong><div class="es-versiones">' + chips + '</div></div>' +
        '<div class="pa-btns">' + acciones + '</div></div>' +
        '<div class="es-hojas" id="esHojas">' + (svgs ? svgs.map(function (s) {
          // Vistas extra por armario (sobre su primera hoja): un clic = versión nueva
          var vistas = s.vistas || [], barra = '';
          if ((s.pagina || 1) === 1 && viendo) {
            barra = '<div class="es-vistas" data-cod="' + esc(s.codigo) + '"><span>' + esc(s.codigo) + ' · vistas:</span><span class="pr-tag">' + (/^C\./.test(s.codigo) ? 'Alzado' : 'Interior + Cerrado') + '</span>' +
              [['lateral', 'Lateral'], ['planta', 'Planta']].map(function (x) {
                var on = vistas.indexOf(x[0]) >= 0;
                return '<button type="button" class="es-vista' + (on ? ' on' : '') + '" data-vista="' + x[0] + '" title="' + (on ? 'Quitar' : 'Añadir') + ' vista ' + (x[0] === 'lateral' ? 'lateral (sección)' : 'en planta') + '">' + (on ? '✓ ' : '+ ') + x[1] + '</button>';
              }).join('') + '</div>';
          }
          return barra + '<div class="es-hoja" title="' + esc(s.codigo) + ((s.pagina || 1) > 1 ? ' · hoja ' + s.pagina : '') + '">' + s.svg + '</div>';
        }).join('')
          : '<div class="es-vacio es-blanco">' + (viendo ? 'Cargando alzados…' : '<b>Diseño en blanco</b><br>Sube un plano o describe el armario en el chat y Claude preparará la primera versión.<br><small>Para seguir con un diseño anterior: «Documentos» → «Editar diseño».</small>') + '</div>') + '</div>';
    }
    function pintarChat(msgs) {
      $('#esMsgs').innerHTML = msgs.length ? msgs.map(burbuja).join('')
        : '<div class="es-vacio" style="padding:20px 6px">Adjunta un plano (PDF o foto) y cuéntale lo que quieres: medidas del hueco, alto, fondo, puertas, interior…</div>';
      $('#esMsgs').scrollTop = 1e9;
    }
    function burbuja(m) {
      var meta = [];
      if (m.version) meta.push('<a href="#" data-ir="' + m.version + '">ver</a>');
      if (m.uso && ctx.modo === 'admin') meta.push(Number(m.uso.tokens.entrada + m.uso.tokens.salida + m.uso.tokens.cache_escritura + m.uso.tokens.cache_lectura).toLocaleString('es-ES') + ' tokens · ' + String(m.uso.coste_usd).replace('.', ',') + ' $');
      if (m.created_at) meta.push(fecha(m.created_at));
      return '<div class="es-msg ' + m.rol + (m.pregunta ? ' pregunta' : '') + '">' + esc(m.texto) + (meta.length ? '<span class="es-meta">' + meta.join(' · ') + '</span>' : '') + '</div>';
    }
    function cargarVersion(n) {
      return api(ctx, { action: 'render', proyecto_id: pid, diseno_id: diseno && diseno.id, numero: n }).then(function (d) { if (viendo === n) pintarZona(d.svgs); })
        .catch(function (err) { $('#esHojas').innerHTML = '<div class="es-vacio">' + esc(err.message) + '</div>'; });
    }
    function abrirDiseno(id) {
      $('#esZona').innerHTML = '<div class="es-vacio">Abriendo el diseño…</div>';
      return api(ctx, { action: 'diseno', proyecto_id: pid, diseno_id: id }).then(function (d) {
        diseno = d.diseno; versiones = d.versiones; viendo = diseno.version_actual; versionInicio = diseno.version_actual;
        pintarChat(d.mensajes); pintarZona(d.svgs);
      }).catch(function (err) { alertaError(err.message); diseno = null; pintarZona(); });
    }
    // En blanco al instante; solo se carga algo si venimos de «Editar diseño»
    pintarChat([]); pintarZona();
    if (editar) abrirDiseno(editar);

    function guardarEnDocumentos() {
      var m = document.createElement('div'); m.className = 'eu-modal';
      var editando = diseno.guardado;
      m.innerHTML = '<form class="eu-modal-caja"><h2>' + (editando ? 'Guardar diseño' : 'Guardar en documentos') + '</h2>' +
        '<p class="pa-muted" style="font-size:13px;margin:4px 0 12px">Se guarda como documento de tipo «Diseño» con su miniatura, su JSON y su PDF de alzados.</p>' +
        '<label style="font-size:13px">Nombre<input id="dgNombre" value="' + esc(editando ? diseno.nombre : 'Diseño ' + (Date.now() % 1000)) + '" style="width:100%;padding:8px;border:1px solid #d9d3c8;border-radius:8px;margin-top:4px"></label>' +
        '<div class="eu-modal-bot"><button type="button" class="pa-btn" data-dg="cancelar">Cancelar</button>' +
        (editando ? '<button type="button" class="pa-btn" data-dg="nuevo">Guardar como nuevo diseño</button><button type="button" class="pa-btn primary" data-dg="cambios">Guardar cambios</button>' : '<button type="button" class="pa-btn primary" data-dg="cambios">Guardar</button>') + '</div></form>';
      document.body.appendChild(m);
      if (!editando) api(ctx, { action: 'disenos', proyecto_id: pid }).then(function (d) { var n = d.disenos.filter(function (x) { return x.guardado; }).length + 1; var i = m.querySelector('#dgNombre'); if (i && /^Diseño \d+$/.test(i.value)) i.value = 'Diseño ' + n; }).catch(function () {});
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-dg]'); if (!b) return;
        if (b.dataset.dg === 'cancelar') return m.remove();
        var nombre = m.querySelector('#dgNombre').value.trim();
        if (!nombre) return;
        m.querySelectorAll('button').forEach(function (x) { x.disabled = true; }); b.textContent = 'Guardando…';
        api(ctx, { action: 'diseno_guardar', proyecto_id: pid, diseno_id: diseno.id, nombre: nombre, modo: b.dataset.dg, version_inicio: versionInicio }).then(function (d) {
          m.remove(); diseno = d.diseno; versionInicio = diseno.version_actual;
          if (b.dataset.dg === 'nuevo') return abrirDiseno(diseno.id).then(function () { avisoZona('Guardado como nuevo diseño en Documentos'); });
          pintarZona(); cargarVersion(viendo).then(function () { avisoZona('Guardado en Documentos'); });
        }).catch(function (err) { m.remove(); alertaError(err.message); });
      });
    }
    function avisoZona(t) { var c = el.querySelector('.es-cab .pa-btns'); if (c) c.insertAdjacentHTML('beforeend', '<span class="pr-msg ok">' + esc(t) + '</span>'); }
    el.addEventListener('click', function (e) {
      var bv = e.target.closest('[data-vista]');
      if (bv) {
        if (ocupado) return;
        var cod = bv.closest('[data-cod]').dataset.cod, actuales = [];
        bv.parentNode.querySelectorAll('.es-vista.on').forEach(function (x) { actuales.push(x.dataset.vista); });
        var i = actuales.indexOf(bv.dataset.vista);
        if (i >= 0) actuales.splice(i, 1); else actuales.push(bv.dataset.vista);
        ocupado = true; bv.disabled = true; bv.textContent = '…';
        api(ctx, { action: 'vistas', proyecto_id: pid, diseno_id: diseno && diseno.id, numero: viendo, codigo: cod, vistas: actuales }).then(function (d) {
          if (diseno) diseno.version_actual = d.version;
          viendo = d.version;
          versiones.push({ numero: d.version, origen: 'manual', nota: d.nota, created_at: new Date().toISOString() });
          pintarZona(d.svgs);
          // Aviso en el chat al momento (el mismo que se guarda en el servidor)
          var msgs = $('#esMsgs');
          if (msgs.querySelector('.es-vacio')) msgs.innerHTML = '';
          msgs.insertAdjacentHTML('beforeend', burbuja({ rol: 'asistente', texto: d.mensaje || (d.nota + '. Guardado como versión nueva.'), version: d.version, created_at: new Date().toISOString() }));
          msgs.scrollTop = 1e9;
          if (ctx.alCambiar) ctx.alCambiar();
        }).catch(function (err) { alertaError(err.message); pintarZona(); cargarVersion(viendo); })
          .then(function () { ocupado = false; });
        return;
      }
      var hoja = e.target.closest('.es-hoja');
      if (hoja) {
        var url = URL.createObjectURL(new Blob(['<!DOCTYPE html><meta charset="utf-8"><title>' + esc(hoja.title) + '</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet"><body style="margin:0;background:#888">' + hoja.innerHTML.replace('<svg ', '<svg style="display:block;width:100%;height:auto;background:#fff" ') + '</body>'], { type: 'text/html' }));
        window.open(url, '_blank');
        return;
      }
      var v = e.target.closest('[data-v]');
      if (v) { viendo = Number(v.dataset.v); pintarZona(); cargarVersion(viendo); return; }
      var ir = e.target.closest('[data-ir]');
      if (ir) { e.preventDefault(); viendo = Number(ir.dataset.ir); pintarZona(); cargarVersion(viendo); return; }
      if (e.target.id === 'esGuardarDoc') return guardarEnDocumentos();
      if (e.target.id === 'esNuevo') { diseno = null; versiones = []; viendo = 0; pintarChat([]); pintarZona(); return; }
      if (e.target.id === 'esPdf') {
        e.target.disabled = true;
        api(ctx, { action: 'pdf', proyecto_id: pid, diseno_id: diseno && diseno.id, numero: viendo }).then(function (d) { descargar(base64Blob(d.base64, 'application/pdf'), d.nombre); })
          .catch(function (err) { alertaError(err.message); }).then(function () { e.target.disabled = false; });
        return;
      }
      if (e.target.id === 'esRestaurar') {
        e.target.disabled = true;
        api(ctx, { action: 'restaurar', proyecto_id: pid, diseno_id: diseno.id, numero: viendo }).then(function () { return abrirDiseno(diseno.id); }).catch(function (err) { alertaError(err.message); });
      }
    });
    $('#esArchivos').addEventListener('change', function () { $('#esAdj').textContent = Array.prototype.map.call(this.files, function (f) { return f.name; }).join(', '); });
    $('#esForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (ocupado) return;
      var texto = $('#esTexto').value.trim();
      var archivos = Array.prototype.slice.call($('#esArchivos').files || []);
      if (!texto && !archivos.length) return;
      ocupado = true; alertaError('');
      $('#esEnviar').disabled = true;
      var msgs = $('#esMsgs');
      if (msgs.querySelector('.es-vacio')) msgs.innerHTML = '';
      msgs.insertAdjacentHTML('beforeend', burbuja({ rol: 'usuario', texto: texto + (archivos.length ? '\n📎 ' + archivos.map(function (f) { return f.name; }).join(', ') : '') }) + '<div class="es-trabajando" id="esTrab">Subiendo…</div>');
      msgs.scrollTop = 1e9;
      var ids = [];
      // El diseño se crea al primer mensaje («Diseño sin guardar»)
      (diseno ? Promise.resolve() : api(ctx, { action: 'diseno_nuevo', proyecto_id: pid }).then(function (d) { diseno = d.diseno; }))
        .then(function () {
          return archivos.reduce(function (p, f) {
            return p.then(function () {
              return api(ctx, { action: 'subida', proyecto_id: pid, diseno_id: diseno.id, nombre: f.name, tipo: f.type, bytes: f.size }).then(function (d) {
                return supa.storage.from('estudio').uploadToSignedUrl(d.path, d.token, f, { contentType: f.type }).then(function (r) {
                  if (r.error) throw new Error('No se ha podido subir «' + f.name + '».');
                  ids.push(d.archivo_id);
                });
              });
            });
          }, Promise.resolve());
        }).then(function () {
          $('#esTrab').textContent = 'Claude está trabajando… (puede tardar hasta un minuto)';
          return api(ctx, { action: 'mensaje', proyecto_id: pid, diseno_id: diseno.id, texto: texto, archivo_ids: ids });
        }).then(function (d) {
          $('#esTexto').value = ''; $('#esArchivos').value = ''; $('#esAdj').textContent = '';
          var t = d.tipo === 'pregunta' ? [d.mensaje].concat(d.preguntas.map(function (p) { return '• ' + p; })).filter(Boolean).join('\n') : d.mensaje;
          $('#esTrab').remove();
          msgs.insertAdjacentHTML('beforeend', burbuja({ rol: 'asistente', texto: t, pregunta: d.tipo === 'pregunta', version: d.version, uso: d.uso }));
          msgs.scrollTop = 1e9;
          if (ctx.alCambiar) ctx.alCambiar();
          if (d.tipo === 'proyecto') {
            diseno.version_actual = d.version; viendo = d.version;
            versiones.push({ numero: d.version, origen: 'ia', nota: texto.slice(0, 200), created_at: new Date().toISOString() });
            pintarZona(d.svgs);
          }
        }).catch(function (err) {
          var t = $('#esTrab'); if (t) t.remove();
          var us = msgs.querySelectorAll('.es-msg.usuario'); if (us.length) us[us.length - 1].remove();
          alertaError(err.message);
          if (err.datos && err.datos.sin_credito && ctx.alCambiar) ctx.alCambiar();
        }).then(function () { ocupado = false; $('#esEnviar').disabled = false; });
    });
  }

  // ── Documentos: lo generado (alzados, presupuestos) y lo subido (facturas, planos, fotos…) juntos ──
  var TIPO_DOC = { alzados_pdf: 'Alzados (PDF)', presupuesto_pdf: 'Presupuesto (PDF)', presupuesto_xlsx: 'Presupuesto (Excel)' };
  var TIPO_F = { factura_proveedor: 'Factura de proveedor', presupuesto_proveedor: 'Presupuesto de proveedor', factura_cliente: 'Factura a cliente', foto_obra: 'Foto de obra', plano: 'Plano o medidas', otro: 'Otro' };
  var FILTROS_DOC = [['', 'Todo'], ['diseno', 'Diseño'], ['presupuesto', 'Presupuesto'], ['factura_cliente', 'Factura cliente'], ['factura_proveedor', 'Factura proveedor'], ['presupuesto_proveedor', 'Presupuesto proveedor'], ['plano', 'Plano'], ['foto_obra', 'Foto'], ['otro', 'Otro']];
  var filtroDoc = { tipo: '', orden: 'reciente' };
  // Etiqueta de color por tipo (mismos colores en tarjetas y filtros)
  var COL_TIPO = { diseno: '#2E6BE6', presupuesto: '#161616', factura_cliente: '#12B76A', factura_proveedor: '#F08C00', presupuesto_proveedor: '#E3B007', plano: '#7A5AF8', foto_obra: '#667085', otro: '#B9BDC5' };
  var NOM_TIPO = { diseno: 'Diseño', presupuesto: 'Presupuesto', factura_cliente: 'Factura cliente', factura_proveedor: 'Factura proveedor', presupuesto_proveedor: 'Presupuesto proveedor', plano: 'Plano', foto_obra: 'Foto', otro: 'Otro' };
  /** Tipo sugerido por el nombre del archivo al subirlo. */
  function tipoSugerido(f) {
    var n = (f.name || '').toLowerCase();
    if (/factura|fra[\s_.-]|\bfra\b|invoice/.test(n)) return 'factura_proveedor';
    if (/presupuesto|pressupost|oferta|\bpre\d|cotizaci/.test(n)) return 'presupuesto_proveedor';
    if (/plano|planta|medid|croquis|cotas|alzado|secci[oó]n/.test(n)) return 'plano';
    if (/^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic)$/.test(n)) return 'foto_obra';
    return 'otro';
  }
  var pdfjsCarga = null;
  function pdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsCarga) pdfjsCarga = new Promise(function (ok, ko) {
      var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      sc.onload = function () {
        // Worker de pdf.js desde el CDN: un Worker de otro dominio no se puede crear directamente → blob que lo importa
        var w = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        try { window.pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob(["importScripts('" + w + "');"], { type: 'application/javascript' }))); }
        catch (e) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = w; }
        ok(window.pdfjsLib);
      };
      sc.onerror = ko; document.head.appendChild(sc);
    });
    return pdfjsCarga;
  }
  /** Miniatura JPEG (320 px) de la 1.ª página de un PDF o de una imagen; se sube y se guarda para la próxima vez. */
  function crearMiniatura(ctx, pid, x) {
    var esPdf = /pdf$/i.test(x.mime || '') || /\.pdf$/i.test(x.nombre || '');
    var lienzo = function () {
      if (esPdf) return pdfjs().then(function (lib) { return lib.getDocument(x.url).promise; }).then(function (doc) { return doc.getPage(1); }).then(function (pg) {
        var v = pg.getViewport({ scale: 1 }), k = 320 / v.width, vp = pg.getViewport({ scale: k });
        var c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        // intent 'print': sin requestAnimationFrame (que Chrome pausa con la pestaña en segundo plano)
        var tarea = pg.render({ canvasContext: g, viewport: vp, intent: 'print' });
        return Promise.race([tarea.promise, new Promise(function (_, ko) { setTimeout(function () { try { tarea.cancel(); } catch (e) { /* */ } ko(new Error('tiempo')); }, 20000); })]).then(function () { return c; });
      });
      return new Promise(function (ok, ko) {
        var im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = function () { var k = Math.min(1, 320 / im.width), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(c); };
        im.onerror = ko; im.src = x.url;
      });
    };
    return lienzo().then(function (c) {
      return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.72); }).then(function (blob) {
        var tabla = x.kind === 'doc' ? 'doc' : 'fichero';
        return api(ctx, { action: 'miniatura_subida', proyecto_id: pid, tabla: tabla, id: x.id }).then(function (d) {
          return ctx.supa.storage.from('estudio').uploadToSignedUrl(d.path, d.token, blob, { contentType: 'image/jpeg' })
            .then(function () { return api(ctx, { action: 'miniatura_guardar', proyecto_id: pid, tabla: tabla, id: x.id }); })
            .then(function () { return URL.createObjectURL(blob); });
        });
      });
    });
  }
  function documentosProyecto(el, ctx, pid) {
    var supa = ctx.supa, items = [], cola = [];
    var tiposCoste = [], v2 = true, primeraCarga = true;
    el.innerHTML = '<div class="ng-card"><div class="ng-card-cab"><h2>Documentos</h2><span class="pa-btns"><span class="pa-muted" id="arUso" style="font-size:12px"></span><button type="button" class="pa-btn" id="dcCoste">+ Coste sin archivo</button></span></div>' +
      '<label class="dc-drop" id="dcDrop"><input type="file" id="dcFile" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.xlsx,.xls" hidden>' +
      '<span class="dc-drop-ico">⇪</span><b>Arrastra aquí tus archivos o pulsa para seleccionarlos</b><small>PDF, fotos o Excel · varios a la vez · te proponemos el tipo de cada uno</small></label>' +
      '<div id="dcCola"></div>' +
      '<div class="dc-filtros" id="dcFiltros">' + [['', 'Todo']].concat(Object.keys(NOM_TIPO).map(function (k) { return [k, NOM_TIPO[k]]; })).map(function (f) {
        return '<button type="button" data-f="' + f[0] + '"' + (f[0] === filtroDoc.tipo ? ' class="on"' : '') + (f[0] ? ' style="--c:' + COL_TIPO[f[0]] + '"' : '') + '>' + (f[0] ? '<i></i>' : '') + f[1] + '</button>';
      }).join('') + '<select id="dcOrden"><option value="reciente">Más recientes</option><option value="antiguo">Más antiguos</option></select></div>' +
      '<div id="arMsg" class="pr-msg"></div><div class="dc-grid" id="dcLista"><p class="pa-muted">Cargando…</p></div></div>';
    el.querySelector('#dcOrden').value = filtroDoc.orden;
    var msg = function (t, tipo) { var m = el.querySelector('#arMsg'); m.className = 'pr-msg ' + (tipo || ''); m.textContent = t || ''; };
    var grupo = function (x) { return x.kind === 'pres' ? 'presupuesto' : x.kind === 'diseno' ? 'diseno' : x.kind === 'doc' ? (x.tipo === 'alzados_pdf' ? 'diseno' : 'presupuesto') : x.tipo; };
    var nombreDe = function (x) { return x.kind === 'diseno' ? x.nombre : x.nombre; };
    var fechaDe = function (x) { return x.kind === 'diseno' || x.kind === 'pres' ? x.updated_at : x.created_at; };
    /** Último documento de un presupuesto (de un tipo y, si se pide, de una variante). */
    function ultimoDoc(x, tipo, variante) {
      return x.docs.filter(function (d) { return d.tipo === tipo && (variante === undefined || (d.variante || null) === variante); })
        .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })[0] || null;
    }
    /** Presupuesto: UNA tarjeta (también en borrador sin PDF); con comisión, descargas cliente e interiorista. */
    function tarjetaPres(x, i) {
      var pdf = x.comision ? ultimoDoc(x, 'presupuesto_pdf', 'cliente') || ultimoDoc(x, 'presupuesto_pdf') : ultimoDoc(x, 'presupuesto_pdf', null) || ultimoDoc(x, 'presupuesto_pdf');
      var xls = ultimoDoc(x, 'presupuesto_xlsx');
      x.pdf = pdf;
      var bajar = function (d, t) { return '<a class="dc-a" href="' + esc(d.url) + '&download=' + encodeURIComponent(d.nombre) + '">' + t + '</a>'; };
      var verA = function (d) { return '<a class="dc-a" href="' + esc(d.url) + '" target="_blank" rel="noopener">Ver</a>'; };
      var mini = pdf && pdf.miniatura_url ? '<img src="' + esc(pdf.miniatura_url) + '" alt="" loading="lazy">'
        : pdf && pdf.url ? '<span class="dc-ico" data-mini="' + i + '">PDF</span>' : '<span class="dc-ico">' + (x.importado && xls ? 'XLS' : 'PDF') + '</span>';
      var acc = '';
      if (x.importado) {
        var f = pdf || xls;
        if (f && f.url) acc += verA(f) + bajar(f, 'Descargar');
      } else {
        acc += pdf && pdf.url ? verA(pdf) : '<button class="dc-a" data-a="pver" data-i="' + i + '">Ver</button>';
        if (x.comision) acc += ['cliente', 'interiorista'].map(function (v) { var d = ultimoDoc(x, 'presupuesto_pdf', v); return d && d.url ? bajar(d, 'Descargar ' + v) : '<button class="dc-a" data-a="pdesc" data-v="' + v + '" data-i="' + i + '">Descargar ' + v + '</button>'; }).join('');
        else acc += pdf && pdf.url ? bajar(pdf, 'Descargar') : '<button class="dc-a" data-a="pdesc" data-v="" data-i="' + i + '">Descargar</button>';
        if (xls && xls.url) acc += bajar(xls, 'Excel');
        if (x.editable) acc += '<button class="dc-a" data-a="peditar" data-i="' + i + '">Editar</button><button class="dc-a" data-a="pduplicar" data-i="' + i + '">Duplicar</button>';
      }
      acc += '<button class="dc-a dc-borrar" data-a="pborrar" data-i="' + i + '">Borrar</button>';
      var sub = [dia(x.fecha), x.importe == null ? '' : eur(Number(x.importe))].filter(Boolean).join(' · ');
      return '<div class="dc-card dc-pres" data-i="' + i + '"><div class="dc-mini">' + mini + '</div>' +
        '<div class="dc-info"><span class="dc-tag" style="--c:' + COL_TIPO.presupuesto + '">' + NOM_TIPO.presupuesto + '</span>' +
        '<strong title="' + esc(x.numero || '') + '">' + (x.editable ? '<input type="checkbox" data-fus="' + x.id + '" title="Marcar para fusionar" style="width:auto;margin:0 6px 0 0;vertical-align:-1px">' : '') + esc(x.numero || 'Sin número') + '</strong>' +
        '<small>' + esc(sub) + (x.importado ? ' · <span class="pr-tag">histórico</span>' : '') + (x.comision ? ' <span class="pr-tag">interiorista ' + numOut(x.comision.pct) + ' %</span>' : '') + '</small>' +
        '<div style="margin-top:4px">' + selectEstado(pid, x.estado, x.id) + (x.estado_nota ? '<br><small class="pr-nota">' + esc(x.estado_nota) + '</small>' : '') + '</div></div>' +
        '<div class="dc-acc">' + acc + '</div></div>';
    }
    function tarjeta(x, i) {
      if (x.kind === 'pres') return tarjetaPres(x, i);
      var g = grupo(x), esImg = /^image\//.test(x.mime || ''), esPdf = /pdf$/i.test(x.mime || '') || /\.pdf$/i.test(x.nombre || ''), esXls = /\.xlsx?$/i.test(x.nombre || '');
      var sinArchivo = x.kind === 'fich' && !x.path;
      var esCoste = x.kind === 'fich' && (x.tipo === 'factura_proveedor' || x.tipo === 'presupuesto_proveedor');
      var mini = sinArchivo ? '<span class="dc-ico dc-ico-coste">€</span>'
        : x.kind === 'diseno' ? '<div class="dc-svg">' + (x.miniatura || '') + '</div>'
        : x.miniatura_url ? '<img src="' + esc(x.miniatura_url) + '" alt="" loading="lazy">'
        : (esPdf || esImg) && x.url && !(Number(x.bytes) > 15 * 1048576) ? '<span class="dc-ico" data-mini="' + i + '">' + (esPdf ? 'PDF' : 'IMG') + '</span>'
        : '<span class="dc-ico">' + (esXls ? 'XLS' : (String(x.nombre || '').split('.').pop() || '').toUpperCase().slice(0, 4)) + '</span>';
      var ver = x.kind === 'diseno' ? (x.pdf && x.pdf.url) : sinArchivo ? null : x.url;
      var acciones = (ver ? '<a class="dc-a" href="' + esc(ver) + '" target="_blank" rel="noopener">Ver</a><a class="dc-a" href="' + esc(ver) + '&download=' + encodeURIComponent(x.kind === 'diseno' ? x.pdf.nombre : x.nombre) + '">Descargar</a>' : '') +
        (x.kind === 'diseno' ? '<button class="dc-a" data-a="editar" data-i="' + i + '">Editar diseño</button>' : '') +
        (((x.kind === 'diseno' && x.guardado) || esPdf || esImg) && !(x.kind === 'doc' && /^presupuesto/.test(x.tipo)) ? '<button class="dc-a" data-a="presupuesto" data-i="' + i + '">Crear presupuesto</button>' : '') +
        (x.kind === 'fich' ? '<button class="dc-a" data-a="datos" data-i="' + i + '">Datos</button>' : '') +
        (x.kind === 'fich' && x.tipo === 'factura_proveedor' ? '<button class="dc-a" data-a="sustituye" data-i="' + i + '">Sustituye a…' + (sustituidos(x).length ? ' (' + sustituidos(x).length + ')' : '') + '</button>' : '') +
        '<button class="dc-a dc-borrar" data-a="borrar" data-i="' + i + '">Borrar</button>';
      var sub = x.kind === 'diseno' ? (x.guardado ? '' : 'sin guardar · se borra a los 30 días')
        : x.kind === 'doc' ? [x.numero ? 'n.º ' + x.numero : '', x.variante || '', x.version ? 'v' + x.version : ''].filter(Boolean).join(' · ')
        : [x.proveedor, x.concepto && x.concepto !== x.nombre ? x.concepto : '', x.base != null && Number(x.base) !== 0 ? eur(Number(x.base)) : '', x.notas && /Pendiente/.test(x.notas) ? 'pendiente de revisar' : '', sinArchivo ? 'sin archivo' : ''].filter(Boolean).join(' · ');
      // Documento de coste: tipo de coste, importe y, en presupuestos, si una factura lo sustituye
      var sust = x.kind === 'fich' && x.tipo === 'presupuesto_proveedor' && x.sustituido_por ? items.filter(function (y) { return y.id === x.sustituido_por; })[0] : null;
      var costeHtml = esCoste ? '<div class="dc-coste">' +
        '<select class="dc-tcoste" data-tcoste="' + i + '" title="Tipo de coste">' + tiposCoste.concat(x.tipo_coste && tiposCoste.indexOf(x.tipo_coste) < 0 ? [x.tipo_coste] : []).map(function (t) { return '<option' + (t === (x.tipo_coste || 'Otros') ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>' +
        (x.base == null || Number(x.base) === 0 ? '<span class="dc-sinimp" title="El margen del proyecto no es fiable hasta que tenga importe">sin importe</span>' : '') +
        (sust ? '<span class="dc-sust" title="No cuenta como coste: lo sustituye la factura">sustituido por ' + esc(sust.nombre || 'factura') + '</span>' : '') + '</div>' : '';
      return '<div class="dc-card' + (x.kind === 'diseno' && !x.guardado ? ' dc-borrador' : '') + '" data-i="' + i + '"><div class="dc-mini">' + mini + '</div>' +
        '<div class="dc-info"><span class="dc-tag" style="--c:' + COL_TIPO[g] + '">' + NOM_TIPO[g] + '</span>' +
        (x.kind === 'fich' ? '<select class="dc-tipo" data-tipo="' + i + '" title="Cambiar tipo">' + Object.keys(TIPO_F).map(function (k) { return '<option value="' + k + '"' + (k === x.tipo ? ' selected' : '') + '>' + TIPO_F[k] + '</option>'; }).join('') + '</select>' : '') +
        '<strong title="' + esc(nombreDe(x)) + '">' + esc(nombreDe(x)) + '</strong><small>' + dia(fechaDe(x)) + (sub ? ' · ' + esc(sub) : '') + '</small>' + costeHtml + '</div>' +
        '<div class="dc-acc">' + acciones + '</div></div>';
    }
    function versionesTxt(x) { return x.version_actual; }
    function sustituidos(f) { return items.filter(function (y) { return y.kind === 'fich' && y.tipo === 'presupuesto_proveedor' && y.sustituido_por === f.id; }); }
    var vistas = [];
    function pintar() {
      var lista = items.filter(function (x) { return !filtroDoc.tipo || grupo(x) === filtroDoc.tipo; })
        .sort(function (a, b) { return filtroDoc.orden === 'antiguo' ? String(fechaDe(a)).localeCompare(String(fechaDe(b))) : String(fechaDe(b)).localeCompare(String(fechaDe(a))); });
      vistas = lista;
      el.querySelectorAll('#dcFiltros [data-f]').forEach(function (b) {
        var n = b.dataset.f ? items.filter(function (x) { return grupo(x) === b.dataset.f; }).length : items.length;
        b.classList.toggle('on', b.dataset.f === filtroDoc.tipo); b.dataset.n = n; b.classList.toggle('vacio', !n);
      });
      el.querySelector('#dcLista').innerHTML = lista.length ? lista.map(tarjeta).join('')
        : '<p class="pa-muted">' + (items.length ? 'Nada de este tipo.' : 'Aún no hay documentos. Guarda un diseño, descarga un presupuesto o sube facturas, planos y fotos.') + '</p>';
      miniaturasPendientes();
    }
    // Miniaturas que faltan: se generan al verse la tarjeta, de 2 en 2
    var obs = null, enCurso = 0, pendientes = [], vigilando = false;
    function encolar(n) { if (n.dataset.enCola) return; n.dataset.enCola = '1'; if (obs) obs.unobserve(n); pendientes.push(n); siguiente(); }
    /** Además del observador (que no salta con la pestaña en segundo plano), se miran las tarjetas dentro de la pantalla. */
    function revisarVisibles() {
      var alto = window.innerHeight || 800;
      el.querySelectorAll('[data-mini]').forEach(function (n) { var r = n.getBoundingClientRect(); if (r.bottom > -200 && r.top < alto + 200) encolar(n); });
    }
    function miniaturasPendientes() {
      if (obs) obs.disconnect();
      if ('IntersectionObserver' in window) {
        obs = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (en.isIntersecting) encolar(en.target); }); }, { rootMargin: '200px' });
        el.querySelectorAll('[data-mini]').forEach(function (n) { obs.observe(n); });
      }
      setTimeout(revisarVisibles, 300);
      if (!vigilando) {
        vigilando = true;
        var t = null;
        window.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(function () { if (el.isConnected) revisarVisibles(); }, 200); }, { passive: true });
      }
    }
    function siguiente() {
      if (enCurso >= 2 || !pendientes.length) return;
      var n = pendientes.shift(), x0 = vistas[Number(n.dataset.mini)]; if (!x0) return siguiente();
      // En la tarjeta de un presupuesto, la miniatura es la de su último PDF
      var x = x0.kind === 'pres' ? (x0.pdf ? Object.assign({ kind: 'doc', mime: 'application/pdf' }, x0.pdf) : null) : x0; if (!x) return siguiente();
      enCurso++;
      crearMiniatura(ctx, pid, x).then(function (url) { (x0.kind === 'pres' ? x0.pdf : x).miniatura_url = url; if (n.isConnected) n.outerHTML = '<img src="' + url + '" alt="">'; })
        .catch(function () { /* se queda el icono */ }).then(function () { enCurso--; siguiente(); });
    }
    function cargar() {
      var presus = [];
      return api(ctx, { action: 'documentos_ficha', proyecto_id: pid }).then(function (d) { tiposCoste = d.tipos_coste || []; v2 = d.costes_v2 !== false; presus = d.presupuestos || []; return [{ disenos: d.disenos }, { documentos: d.documentos }, { ficheros: d.ficheros, almacenamiento: d.almacenamiento }]; }).then(function (rs) {
        var a = rs[2].almacenamiento;
        var gb = function (b) { return (b / 1073741824).toFixed(1).replace('.', ',').replace(/,0$/, '') + ' GB'; };
        el.querySelector('#arUso').textContent = 'Almacenamiento: ' + (a.usado / 1073741824).toFixed(1).replace('.', ',') + ' GB de ' + gb(a.limite);
        // Los PDF / Excel de un presupuesto van dentro de su tarjeta
        var conPres = {}; presus.forEach(function (p) { conPres[p.id] = true; });
        items = rs[0].disenos.map(function (x) { return Object.assign({ kind: 'diseno' }, x); })
          .concat(presus.map(function (p) { return Object.assign({ kind: 'pres', docs: rs[1].documentos.filter(function (x) { return x.presupuesto_id === p.id; }) }, p); }))
          .concat(rs[1].documentos.filter(function (x) { return !x.diseno_id && !(x.presupuesto_id && conPres[x.presupuesto_id]); }).map(function (x) { return Object.assign({ kind: 'doc', mime: /\.xlsx$/i.test(x.nombre) ? 'xlsx' : 'application/pdf' }, x); }))
          .concat(rs[2].ficheros.map(function (x) { return Object.assign({ kind: 'fich' }, x); }));
        pintar();
        if (!primeraCarga && ctx.alCambiarDocs) ctx.alCambiarDocs();
        if (primeraCarga && ctx.alDocsCargados) ctx.alDocsCargados();
        primeraCarga = false;
      }).catch(function (e) { el.querySelector('#dcLista').innerHTML = '<p class="tf-err">' + esc(e.message) + '</p>'; });
    }
    // ── Subida: arrastrar o elegir varios, con tipo sugerido para cada uno ──
    function pintarCola() {
      el.querySelector('#dcCola').innerHTML = cola.length ? '<div class="dc-cola">' + cola.map(function (c, i) {
        return '<div class="dc-cola-f"><span>' + esc(c.f.name) + ' <small class="pa-muted">' + Math.max(1, Math.round(c.f.size / 1024)) + ' KB</small></span><select data-cola="' + i + '">' + Object.keys(TIPO_F).map(function (k) { return '<option value="' + k + '"' + (k === c.tipo ? ' selected' : '') + '>' + TIPO_F[k] + '</option>'; }).join('') + '</select><button type="button" class="pa-btn" data-quitar-cola="' + i + '">×</button></div>';
      }).join('') + '<div class="pr-barra"><button type="button" class="pa-btn primary" id="dcSubir">Subir ' + cola.length + (cola.length === 1 ? ' archivo' : ' archivos') + '</button><button type="button" class="pa-btn" id="dcVaciar">Cancelar</button></div></div>' : '';
    }
    function anadir(files) { [].slice.call(files || []).forEach(function (f) { cola.push({ f: f, tipo: tipoSugerido(f) }); }); pintarCola(); }
    var drop = el.querySelector('#dcDrop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('sobre'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('sobre'); }); });
    drop.addEventListener('drop', function (e) { anadir(e.dataTransfer.files); });
    el.querySelector('#dcFile').addEventListener('change', function () { anadir(this.files); this.value = ''; });
    function subirCola() {
      var lote = cola.slice(); cola = []; pintarCola();
      var hechos = 0, errores = [];
      return lote.reduce(function (p, c) {
        return p.then(function () {
          msg('Subiendo ' + (hechos + 1) + ' de ' + lote.length + '…');
          var f = c.f, mime = f.type || (/\.xlsx$/i.test(f.name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.xls$/i.test(f.name) ? 'application/vnd.ms-excel' : '');
          return api(ctx, { action: 'fichero_subida', proyecto_id: pid, nombre: f.name, mime: mime, bytes: f.size, tipo: c.tipo }).then(function (d) {
            return supa.storage.from('estudio').uploadToSignedUrl(d.path, d.token, f, { contentType: mime }).then(function (r) {
              if (r.error) throw new Error('No se ha podido subir «' + f.name + '».');
              return api(ctx, { action: 'fichero_guardar', id: d.id, subido: true, tipo: c.tipo });
            });
          }).then(function () { hechos++; }, function (err) { errores.push(f.name + ': ' + err.message); });
        });
      }, Promise.resolve()).then(function () { msg(errores.length ? errores.join(' · ') : hechos + (hechos === 1 ? ' archivo subido' : ' archivos subidos'), errores.length ? 'err' : 'ok'); return cargar(); });
    }
    // ── Datos de un archivo (base, IVA, proveedor…) y «Leer con IA» ──
    function datos(x) {
      var leible = /^(application\/pdf|image\/)/.test(x.mime || '');
      var m = document.createElement('div'); m.className = 'eu-modal';
      m.innerHTML = '<div class="eu-modal-caja" style="max-width:560px"><h2>' + esc(x.nombre) + '</h2><div class="ar-g" style="margin-top:10px">' +
        '<label>Tipo<select data-k="tipo">' + Object.keys(TIPO_F).map(function (k) { return '<option value="' + k + '"' + (k === x.tipo ? ' selected' : '') + '>' + TIPO_F[k] + '</option>'; }).join('') + '</select></label>' +
        '<label>Proveedor / cliente<input data-k="proveedor" value="' + esc(x.proveedor || '') + '"></label>' +
        '<label>Fecha<input type="date" data-k="fecha" value="' + esc(x.fecha || '') + '"></label>' +
        '<label>Base (€)<input data-k="base" inputmode="decimal" value="' + numOut(x.base) + '"></label>' +
        '<label>IVA (€)<input data-k="iva" inputmode="decimal" value="' + numOut(x.iva) + '"></label>' +
        '<label>Total (€)<input data-k="total" inputmode="decimal" value="' + numOut(x.total) + '"></label></div>' +
        (x.notas ? '<p class="pa-muted" style="font-size:12px">' + esc(x.notas) + '</p>' : '') + '<span class="pr-msg" id="dmMsg"></span>' +
        '<div class="eu-modal-bot">' + (leible ? '<button class="pa-btn" data-m="ia">Leer con IA</button>' : '') + '<button class="pa-btn" data-m="cerrar">Cerrar</button><button class="pa-btn primary" data-m="guardar">Guardar</button></div></div>';
      document.body.appendChild(m);
      var mm = function (t, k) { var q = m.querySelector('#dmMsg'); q.className = 'pr-msg ' + (k || ''); q.textContent = t; };
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-m]'); if (!b) { if (e.target === m) m.remove(); return; }
        if (b.dataset.m === 'cerrar') return m.remove();
        if (b.dataset.m === 'guardar') {
          var d = { action: 'fichero_guardar', id: x.id };
          m.querySelectorAll('[data-k]').forEach(function (i) { d[i.dataset.k] = i.value; });
          return api(ctx, d).then(function () { m.remove(); msg('Guardado', 'ok'); cargar(); }).catch(function (err) { mm(err.message, 'err'); });
        }
        if (b.dataset.m === 'ia') {
          if (!b.dataset.ok) { b.dataset.ok = '1'; b.textContent = 'Gasta ≈ 1–2 créditos · ¿leer?'; b.classList.add('primary'); return; }
          b.disabled = true; b.textContent = 'Leyendo…';
          api(ctx, { action: 'fichero_leer_ia', id: x.id }).then(function (d) { m.remove(); msg('Leído con IA (' + d.creditos + (d.creditos === 1 ? ' crédito' : ' créditos') + '). Revisa los datos.', 'ok'); if (ctx.alCambiar) ctx.alCambiar(); return cargar().then(function () { var y = items.filter(function (z) { return z.id === x.id; })[0]; if (y) datos(y); }); })
            .catch(function (err) { mm(err.message, 'err'); b.disabled = false; b.textContent = 'Leer con IA'; });
        }
      });
    }
    /** Factura de proveedor: qué presupuestos de proveedor del proyecto sustituye (dejan de contar como coste). */
    function sustituye(f) {
      var pres = items.filter(function (y) { return y.kind === 'fich' && y.tipo === 'presupuesto_proveedor'; });
      var m = document.createElement('div'); m.className = 'eu-modal';
      m.innerHTML = '<div class="eu-modal-caja" style="max-width:520px"><h2>' + esc(f.nombre) + ' sustituye a…</h2><p class="pa-muted" style="font-size:13px;margin:4px 0 10px">Un presupuesto de proveedor cuenta como coste mientras ninguna factura lo sustituya.</p>' +
        (pres.length ? pres.map(function (y) {
          var otra = y.sustituido_por && y.sustituido_por !== f.id ? items.filter(function (z) { return z.id === y.sustituido_por; })[0] : null;
          return '<label class="dc-sus-op"><input type="checkbox" value="' + y.id + '"' + (y.sustituido_por === f.id ? ' checked' : '') + '> ' + esc(y.nombre) + ' <small class="pa-muted">' + [y.proveedor, y.base != null ? eur(Number(y.base)) : 'sin importe', otra ? 'ahora: ' + otra.nombre : ''].filter(Boolean).map(esc).join(' · ') + '</small></label>';
        }).join('') : '<p class="pa-muted">Este proyecto no tiene presupuestos de proveedor.</p>') +
        '<div class="eu-modal-bot"><button class="pa-btn" data-s="cerrar">Cancelar</button><button class="pa-btn primary" data-s="ok">Guardar</button></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-s]'); if (!b) { if (e.target === m) m.remove(); return; }
        if (b.dataset.s === 'cerrar') return m.remove();
        var ids = Array.prototype.map.call(m.querySelectorAll('input:checked'), function (c) { return c.value; });
        api(ctx, { action: 'fichero_guardar', id: f.id, sustituye: ids }).then(function () { m.remove(); msg('Guardado', 'ok'); return cargar(); }).catch(function (err) { alert(err.message); });
      });
    }
    /** Documento de coste sin archivo: factura o presupuesto de proveedor con su importe. */
    function costeSinArchivo() {
      var m = document.createElement('div'); m.className = 'eu-modal';
      m.innerHTML = '<form class="eu-modal-caja" style="max-width:560px"><h2>Coste sin archivo</h2><div class="ar-g" style="margin-top:10px">' +
        '<label>Documento<select data-k="tipo"><option value="factura_proveedor">Factura de proveedor</option><option value="presupuesto_proveedor">Presupuesto de proveedor</option></select></label>' +
        '<label>Tipo de coste<select data-k="tipo_coste">' + tiposCoste.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
        '<label>Concepto<input data-k="concepto" maxlength="200" required></label>' +
        '<label>Proveedor<input data-k="proveedor" maxlength="120"></label>' +
        '<label>Fecha<input type="date" data-k="fecha" value="' + new Date().toLocaleDateString('sv-SE') + '"></label>' +
        '<label>Importe sin IVA (€)<input data-k="base" inputmode="decimal" placeholder="vacío = sin importe"></label></div>' +
        '<div class="eu-modal-bot"><button type="button" class="pa-btn" data-c="cerrar">Cancelar</button><button class="pa-btn primary" type="submit">Añadir</button></div></form>';
      document.body.appendChild(m);
      m.querySelector('[data-c=cerrar]').addEventListener('click', function () { m.remove(); });
      m.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var d = { action: 'coste_nuevo', proyecto_id: pid };
        m.querySelectorAll('[data-k]').forEach(function (i) { d[i.dataset.k] = i.value; });
        api(ctx, d).then(function () { m.remove(); msg('Coste añadido', 'ok'); return cargar(); }).catch(function (err) { alert(err.message); });
      });
    }
    el.querySelector('#dcFiltros').addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (!b) return; filtroDoc.tipo = b.dataset.f; pintar(); });
    el.querySelector('#dcOrden').addEventListener('change', function () { filtroDoc.orden = this.value; pintar(); });
    if (ctx.alDocsListo) ctx.alDocsListo({ cargar: cargar });
    el.addEventListener('change', function (e) {
      if (e.target.classList.contains('ng-estado')) return cambiarEstado(ctx, e.target, function () { cargar(); if (ctx.alCambiarDocs) ctx.alCambiarDocs(); });
      if (e.target.dataset.fus !== undefined) { if (ctx.alFusMarcados) ctx.alFusMarcados(); return; }
      if (e.target.dataset.cola !== undefined) { cola[Number(e.target.dataset.cola)].tipo = e.target.value; return; }
      if (e.target.dataset.tcoste !== undefined) {
        var xc = vistas[Number(e.target.dataset.tcoste)];
        api(ctx, { action: 'fichero_guardar', id: xc.id, tipo_coste: e.target.value }).then(function () { msg('Tipo de coste: ' + e.target.value, 'ok'); return cargar(); }).catch(function (err) { msg(err.message, 'err'); });
        return;
      }
      if (e.target.dataset.tipo !== undefined) {
        var x = vistas[Number(e.target.dataset.tipo)];
        api(ctx, { action: 'fichero_guardar', id: x.id, tipo: e.target.value }).then(function () { msg('Tipo cambiado', 'ok'); return cargar(); }).catch(function (err) { msg(err.message, 'err'); });
      }
    });
    el.addEventListener('click', function (e) {
      if (e.target.id === 'dcSubir') return subirCola();
      if (e.target.id === 'dcCoste') return costeSinArchivo();
      if (e.target.id === 'dcVaciar') { cola = []; pintarCola(); return; }
      if (e.target.dataset.quitarCola !== undefined) { cola.splice(Number(e.target.dataset.quitarCola), 1); pintarCola(); return; }
      var b = e.target.closest('[data-a]'); if (!b) return;
      var x = vistas[Number(b.dataset.i)]; if (!x) return;
      var a = b.dataset.a;
      if (a === 'editar') { try { sessionStorage.setItem(CLAVE_EDITAR, x.id); } catch (err) { /* */ } location.href = ctx.rutas.estudio(pid, 'diseno'); if (ctx.alNavegar) ctx.alNavegar(); return; }
      if (a === 'presupuesto') {
        var preSel = { tabla: x.kind === 'diseno' ? 'diseno' : x.kind === 'doc' ? 'doc' : 'fichero', id: x.id };
        if (ctx.abrirPresupuesto) return ctx.abrirPresupuesto(preSel);
        try { sessionStorage.setItem(CLAVE_PRE, JSON.stringify(preSel)); } catch (err) { /* */ } location.href = ctx.rutas.estudio(pid, 'presupuesto'); if (ctx.alNavegar) ctx.alNavegar(); return;
      }
      // Tarjeta de presupuesto
      if (a === 'peditar') { if (ctx.editarPresupuesto) ctx.editarPresupuesto(x.id); return; }
      if (a === 'pduplicar') { if (ctx.duplicarPresupuesto) ctx.duplicarPresupuesto(x.id); return; }
      if (a === 'pborrar') { if (ctx.borrarPresupuesto) ctx.borrarPresupuesto(x); return; }
      if (a === 'pver') {
        // Sin PDF guardado: la vista previa (no guarda nada)
        var w = window.open('', '_blank'); msg('Generando la vista previa…');
        return api(ctx, { action: 'presupuesto_vista', presupuesto_id: x.id, datos: {} }).then(function (d) { msg(''); var u = URL.createObjectURL(base64Blob(d.base64, 'application/pdf')); if (w) w.location.href = u; else window.open(u, '_blank'); })
          .catch(function (err) { if (w) w.close(); msg(err.message, 'err'); });
      }
      if (a === 'pdesc') {
        // Sin PDF: se genera (y se guarda en Documentos) y se descarga
        b.disabled = true; msg('Generando PDF…');
        return api(ctx, { action: 'presupuesto_pdf', presupuesto_id: x.id }).then(function (d) {
          (d.archivos || [d]).filter(function (f) { return !b.dataset.v || f.variante === b.dataset.v; }).forEach(function (f) { descargar(base64Blob(f.base64, 'application/pdf'), f.nombre); });
          msg('PDF descargado y guardado en Documentos', 'ok'); return cargar();
        }).catch(function (err) { b.disabled = false; msg(err.message, 'err'); });
      }
      if (a === 'datos') return datos(x);
      if (a === 'sustituye') return sustituye(x);
      if (a === 'borrar') {
        if (!b.dataset.ok) { b.dataset.ok = '1'; b.textContent = '¿Seguro?'; b.classList.add('on'); return; }
        var accion = x.kind === 'diseno' ? { action: 'diseno_borrar', proyecto_id: pid, diseno_id: x.id } : x.kind === 'doc' ? { action: 'doc_borrar', id: x.id } : { action: 'fichero_borrar', id: x.id };
        api(ctx, accion).then(function () { msg('Movido a la papelera (se puede restaurar durante 30 días)', 'ok'); if (ctx.alPapelera) ctx.alPapelera(); if (ctx.alCambiarDocs) ctx.alCambiarDocs(); return cargar(); }).catch(function (err) { msg(err.message, 'err'); });
      }
    });
    cargar();
  }
  var CLAVE_PRE = 'estudio-presupuesto-desde';

  // ── Resumen del proyecto: métricas (arriba) + documentos (debajo) ──
  function resumenProyecto(el, ctx, pid, ropts) {
    ropts = ropts || {};
    el.innerHTML = '<div class="ng-card rs-met" id="rsMet"><p class="pa-muted">Cargando…</p></div><div id="rsDocs"></div>' +
      '<section class="ng-card rs-pres" id="rsPres"><h2 class="rs-pres-h">Presupuestos</h2><div id="rsPresCuerpo"></div></section>';
    var pintarMet = function () {
      return api(ctx, { action: 'metricas_proyecto', proyecto_id: pid }).then(function (m) {
        var z = el.querySelector('#rsMet'); if (!z) return;
        var P = m.presupuestos || {}, pct = m.margen_pct == null ? '' : ' · ' + String(m.margen_pct).replace('.', ',') + ' %';
        var origen = m.origen_facturacion === 'facturas' ? 'por facturas a cliente (superan lo aceptado)' : m.origen_facturacion === 'presupuesto' ? (P.aceptados > 1 ? 'suma de ' + P.aceptados + ' presupuestos aceptados' : 'presupuesto aceptado') : 'sin presupuesto aceptado';
        var nDocs = (m.costes_por_tipo || []).length;
        var tipos = (m.costes_por_tipo || []).filter(function (c) { return c.importe > 0; });
        var maxT = Math.max.apply(null, tipos.map(function (c) { return c.importe; }).concat([1]));
        z.innerHTML =
          '<div class="rs-kpis">' +
          '<div class="rs-kpi"><span>Facturación</span><b>' + eur(m.facturacion || 0) + '</b><small>' + esc(origen) + '</small></div>' +
          '<div class="rs-kpi"><span>Coste total</span><b>' + eur(m.costes || 0) + '</b><small>' + (m.costes_sin_importe ? '<em class="rs-mal">' + m.costes_sin_importe + (m.costes_sin_importe === 1 ? ' coste' : ' costes') + ' sin importe</em>' : m.hay_costes ? 'documentos de coste' : 'sin documentos de coste') + '</small>' +
            (m.coste_previsto ? '<small class="rs-previsto" title="Presupuestos de proveedor de un proyecto sin presupuesto aceptado: no cuentan como coste ni en el margen">Coste previsto: ' + eur(m.coste_previsto) + '</small>' : '') + '</div>' +
          '<div class="rs-kpi"><span>Margen</span><b class="' + (m.margen != null && m.margen < 0 ? 'rs-mal' : '') + '">' + (m.margen == null ? '—' : eur(m.margen)) + pct + '</b><small>' + (m.fiable ? '<em class="rs-ok">✓ fiable</em>' : '<em class="rs-mal">no fiable · ' + esc(m.motivo || '') + '</em>') + '</small></div>' +
          // Montaje: una línea por presupuesto aceptado (n.º · fecha prevista · Montado · fecha real), se guarda en ese presupuesto
          '<div class="rs-kpi rs-kpi-mont"><span>Montaje</span>' + ((m.montajes || []).filter(function (x) { return x.id; }).length ? m.montajes.filter(function (x) { return x.id; }).map(function (x) {
            return '<div class="rs-mont-f" data-mpr="' + x.id + '"><b>' + esc(x.numero || 'Aceptado') + '</b>' +
              '<input type="date" data-pm="prev" value="' + (x.montaje_previsto || '') + '" title="Fecha prevista de montaje">' +
              '<label class="pm-chk"><input type="checkbox" data-pm="mont"' + (x.montado ? ' checked' : '') + '> Montado</label>' +
              (x.montado ? '<input type="date" data-pm="real" value="' + (x.montado_at || '') + '" title="Fecha real de montaje">' : '') + '</div>';
          }).join('') + '<small class="pr-msg" id="rsMontMsg"></small>' : '<small>Sin presupuesto aceptado</small>') + '</div>' +
          '</div>' +
          (m.v2 ? '' : '<p class="pa-muted" style="font-size:12px;margin:8px 0 0">Costes con las reglas de antes (facturas de proveedor + costes manuales) hasta que se migre este proyecto.</p>');
      }).catch(function (e) { var z = el.querySelector('#rsMet'); if (z) z.innerHTML = '<p class="tf-err">' + esc(e.message) + '</p>'; });
    };
    pintarMet();
    el.querySelector('#rsMet').addEventListener('change', function (e) {
      var f = e.target.closest('[data-mpr]'), k = e.target.dataset.pm; if (!f || !k) return;
      var body = { action: 'proyecto_montaje', proyecto_id: pid, presupuesto_id: f.dataset.mpr };
      if (k === 'prev') body.montaje_previsto = e.target.value || null;
      if (k === 'mont') { body.montado = e.target.checked; body.montado_at = e.target.checked ? new Date().toLocaleDateString('sv-SE') : undefined; }
      if (k === 'real') body.montado_at = e.target.value || null;
      api(ctx, body).then(pintarMet).then(function () { var mm = el.querySelector('#rsMontMsg'); if (mm) { mm.className = 'pr-msg ok'; mm.textContent = 'Guardado'; } })
        .catch(function (err) { alert(err.message); });
    });
    // Presupuestos al final: al cambiar uno (aceptar, importe, montaje) se refrescan las cajas de arriba
    var pres = null;
    var irASeccion = function (suave) { var z = el.querySelector('#rsPres'); if (z) z.scrollIntoView({ block: 'start', behavior: suave ? 'smooth' : 'auto' }); };
    // Enlace a la antigua pestaña Presupuesto: baja a la sección cuando ya está la lista y otra vez al cargar los documentos (empujan hacia abajo)
    var bajarAlCargar = function () { if (ropts.irPresupuestos) irASeccion(false); };
    var docsApi = null;
    var ctxPres = Object.assign({}, ctx, { alCambiarPres: function () { pintarMet(); if (docsApi) docsApi.cargar(); }, alListo: function (api2) { pres = api2; }, alListaCargada: bajarAlCargar, alPapelera: function () { pintarPapelera(); } });
    presupuesto(el.querySelector('#rsPresCuerpo'), ctxPres, pid, { embebido: true });
    // «Crear presupuesto» de una tarjeta: baja a la sección y abre el asistente con ese documento, sin recargar
    var ctxDocs = Object.assign({}, ctx, { alCambiarDocs: pintarMet, alDocsCargados: bajarAlCargar, abrirPresupuesto: function (preSel) { irASeccion(true); if (pres) pres.nuevo(preSel); },
      alDocsListo: function (a) { docsApi = a; }, alFusMarcados: function () { if (pres) pres.actualizarFus(); }, alPapelera: function () { pintarPapelera(); },
      editarPresupuesto: function (id) { if (pres) pres.abrir(id); }, duplicarPresupuesto: function (id) { if (pres) pres.duplicar(id); }, borrarPresupuesto: function (x) { if (pres) pres.borrar(x); } });
    documentosProyecto(el.querySelector('#rsDocs'), ctxDocs, pid);
    // «Borrar proyecto»: al final, con confirmación escribiendo el nombre
    var pie = document.createElement('div'); pie.className = 'rs-pie';
    pie.innerHTML = '<button type="button" class="pa-btn" id="rsPapelera">Papelera</button><button type="button" class="rs-borrar">Borrar proyecto</button>';
    el.appendChild(pie);
    // Papelera: lo borrado (presupuestos, diseños, documentos) se puede restaurar durante 30 días
    function pintarPapelera() {
      return api(ctx, { action: 'papelera', proyecto_id: pid }).then(function (d) { var b = pie.querySelector('#rsPapelera'); var n = (d.papelera || []).length; b.textContent = 'Papelera' + (n ? ' (' + n + ')' : ''); return d.papelera || []; }).catch(function () { return []; });
    }
    pintarPapelera();
    pie.querySelector('#rsPapelera').addEventListener('click', function () {
      var NOM = { presupuesto: 'Presupuesto', diseno: 'Diseño', documento: 'Documento', fichero: 'Archivo' };
      var m = document.createElement('div'); m.className = 'eu-modal';
      m.innerHTML = '<div class="eu-modal-caja" style="max-width:620px"><h2>Papelera</h2><p class="pa-muted" style="font-size:13px;margin:4px 0 10px">Lo borrado se guarda 30 días; después se borra definitivamente.</p><div id="ppLista"><p class="pa-muted">Cargando…</p></div><span class="pr-msg" id="ppMsg"></span><div class="eu-modal-bot"><button class="pa-btn" data-pp="cerrar">Cerrar</button></div></div>';
      document.body.appendChild(m);
      var pintarPp = function () {
        return pintarPapelera().then(function (xs) {
          m.querySelector('#ppLista').innerHTML = xs.length ? '<table class="pr-tabla"><tbody>' + xs.map(function (x) {
            var dias = Math.max(0, Math.ceil((new Date(x.caduca_at) - new Date()) / 86400000));
            return '<tr><td><span class="pr-tag">' + (NOM[x.tipo] || x.tipo) + '</span> <b>' + esc(x.nombre) + '</b><br><small class="pa-muted">Borrado el ' + dia(String(x.borrado_at).slice(0, 10)) + ' · se borra definitivamente en ' + dias + (dias === 1 ? ' día' : ' días') + '</small></td><td class="pr-acc"><button class="pa-btn" data-restaurar="' + x.id + '">Restaurar</button></td></tr>';
          }).join('') + '</tbody></table>' : '<p class="pa-muted">La papelera está vacía.</p>';
        });
      };
      pintarPp();
      m.addEventListener('click', function (e) {
        var t = e.target;
        if (t === m || t.dataset.pp === 'cerrar') return m.remove();
        if (t.dataset.restaurar) {
          t.disabled = true; t.textContent = 'Restaurando…';
          api(ctx, { action: 'papelera_restaurar', id: t.dataset.restaurar }).then(function (r) {
            var q = m.querySelector('#ppMsg'); q.className = 'pr-msg ok'; q.textContent = 'Restaurado: ' + (r.nombre || '');
            pintarMet(); if (docsApi) docsApi.cargar();
            return pintarPp();
          }).catch(function (err) { t.disabled = false; t.textContent = 'Restaurar'; var q = m.querySelector('#ppMsg'); q.className = 'pr-msg err'; q.textContent = err.message; });
        }
      });
    });
    pie.querySelector('.rs-borrar').addEventListener('click', function () {
      ctx.supa.from('estudio_proyectos').select('nombre').eq('id', pid).maybeSingle().then(function (r) {
        var nombre = (r.data && r.data.nombre) || '';
        var m = document.createElement('div'); m.className = 'eu-modal';
        m.innerHTML = '<form class="eu-modal-caja" style="max-width:480px"><h2>Borrar proyecto</h2>' +
          '<p style="font-size:13px;margin:6px 0 10px">Se borran el proyecto y <b>todos sus documentos, diseños y presupuestos</b>. No se puede deshacer.</p>' +
          '<label style="font-size:13px">Para confirmarlo, escribe el nombre del proyecto: <b>' + esc(nombre) + '</b><input id="rbNombre" autocomplete="off" style="width:100%;padding:8px;border:1px solid #d9d3c8;border-radius:8px;margin-top:6px"></label>' +
          '<div class="eu-modal-bot"><button type="button" class="pa-btn" id="rbCancelar">Cancelar</button><button type="submit" class="pa-btn rb-ok" id="rbOk" disabled>Borrar definitivamente</button></div></form>';
        document.body.appendChild(m);
        var inp = m.querySelector('#rbNombre'), ok = m.querySelector('#rbOk');
        inp.focus();
        inp.addEventListener('input', function () { ok.disabled = inp.value.trim() !== nombre.trim(); });
        m.querySelector('#rbCancelar').addEventListener('click', function () { m.remove(); });
        m.querySelector('form').addEventListener('submit', function (e) {
          e.preventDefault(); if (ok.disabled) return;
          ok.disabled = true; ok.textContent = 'Borrando…';
          api(ctx, { action: 'borrar', proyecto_id: pid }).then(function () { m.remove(); location.href = ctx.rutas.estudio(); if (ctx.alNavegar) ctx.alNavegar(); })
            .catch(function (err) { alert(err.message); ok.disabled = false; ok.textContent = 'Borrar definitivamente'; });
        });
      });
    });
  }

  // ── Métricas del proyecto ──
  var COL_CAT = { proveedores: '#161616', materiales: '#8a6234', mano_obra: '#12B76A', transporte: '#b9b6ad', montaje: '#5f5b52', otros: '#d9d3c8', comision: '#c08a2b' };
  var NOM_CAT = { materiales: 'Materiales', mano_obra: 'Mano de obra', transporte: 'Transporte', montaje: 'Montaje', otros: 'Otros' };
  function barrasFCM(m) {
    var filas = [['Facturación', m.facturacion, '#d9d3c8'], ['Costes', m.costes, '#161616'], ['Margen', m.margen === null ? 0 : m.margen, m.margen !== null && m.margen < 0 ? '#b42318' : '#12B76A']];
    var max = Math.max.apply(null, filas.map(function (f) { return Math.abs(f[1]); }).concat([1]));
    return '<div class="mt-barras">' + filas.map(function (f) {
      return '<div class="mt-barra"><span>' + f[0] + '</span><div><i style="width:' + Math.max(0.5, Math.abs(f[1]) / max * 100) + '%;background:' + f[2] + '"></i></div><b>' + eurN(f[1]) + '</b></div>';
    }).join('') + '</div>';
  }
  function donut(cats) {
    var total = cats.reduce(function (s, c) { return s + c.importe; }, 0);
    if (!(total > 0)) return '<div class="ng-vacio">Sin costes todavía.</div>';
    var R = 70, r = 44, cx = 90, cy = 90, a = -Math.PI / 2, svg = '';
    cats.forEach(function (c) {
      var ang = (c.importe / total) * Math.PI * 2, a2 = a + ang, large = ang > Math.PI ? 1 : 0;
      var p = function (rad, t) { return [cx + rad * Math.cos(t), cy + rad * Math.sin(t)]; };
      var A = p(R, a), B = p(R, a2), C = p(r, a2), D = p(r, a);
      if (cats.length === 1) svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + r) / 2 + '" fill="none" stroke="' + (COL_CAT[c.categoria] || '#999') + '" stroke-width="' + (R - r) + '"/>';
      else svg += '<path d="M' + A + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + B + ' L' + C + ' A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + D + ' Z" fill="' + (COL_CAT[c.categoria] || '#999') + '"><title>' + esc(c.nombre) + ' ' + eurN(c.importe) + '</title></path>';
      a = a2;
    });
    svg += '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" class="mt-dt">' + eurN(total) + '</text>';
    return '<div class="mt-donut"><svg viewBox="0 0 180 180">' + svg + '</svg><ul>' + cats.map(function (c) {
      return '<li><i style="background:' + (COL_CAT[c.categoria] || '#999') + '"></i>' + esc(c.nombre) + '<b>' + eurN(c.importe) + '</b><small>' + Math.round(c.importe / total * 100) + ' %</small></li>';
    }).join('') + '</ul></div>';
  }
  function lineaTiempo(eventos) {
    if (!eventos.length) return '<div class="ng-vacio">Sin cobros ni pagos todavía.</div>';
    var W = 1000, H = 230, izq = 70, abajo = 30, arriba = 14;
    var t = function (f) { return new Date(f + 'T12:00:00').getTime(); };
    var t0 = t(eventos[0].fecha), t1 = Math.max(t(eventos[eventos.length - 1].fecha), t0 + 86400000 * 7);
    var acc = { cobro: 0, pago: 0 }, ptos = { cobro: [[t0, 0]], pago: [[t0, 0]] };
    eventos.forEach(function (e) { acc[e.tipo] += e.importe; ptos[e.tipo].push([t(e.fecha), acc[e.tipo]]); });
    var max = Math.max(acc.cobro, acc.pago, 1);
    var X = function (v) { return izq + (v - t0) / (t1 - t0) * (W - izq - 10); }, Y = function (v) { return arriba + (H - abajo - arriba) * (1 - v / max); };
    var linea = function (l, col) { var d = ''; l.forEach(function (p, i) { d += (i ? ' H' + X(p[0]) + ' V' + Y(p[1]) : 'M' + X(p[0]) + ' ' + Y(p[1])); }); d += ' H' + X(t1); return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.5"/>'; };
    var g = '';
    for (var i = 0; i <= 4; i++) { var v = max / 4 * i; g += '<line x1="' + izq + '" x2="' + W + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#ece9e2"/><text x="' + (izq - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + eurN(v) + '</text>'; }
    g += linea(ptos.cobro, '#12B76A') + linea(ptos.pago, '#161616');
    eventos.forEach(function (e) { g += '<circle cx="' + X(t(e.fecha)) + '" cy="' + (H - abajo + 8) + '" r="3.5" fill="' + (e.tipo === 'cobro' ? (e.real ? '#12B76A' : '#fff') : '#161616') + '" stroke="' + (e.tipo === 'cobro' ? '#12B76A' : '#161616') + '"><title>' + esc(e.concepto) + ' · ' + eurN(e.importe) + ' · ' + dia(e.fecha) + (e.tipo === 'cobro' && !e.real ? ' (previsto)' : '') + '</title></circle>'; });
    g += '<text x="' + izq + '" y="' + (H - 2) + '">' + dia(eventos[0].fecha) + '</text><text x="' + W + '" y="' + (H - 2) + '" text-anchor="end">' + dia(new Date(t1).toISOString().slice(0, 10)) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ng-graf">' + g + '</svg>';
  }
  function metricasProyecto(el, ctx, pid) {
    el.innerHTML = '<p class="pa-muted">Cargando…</p>';
    function cargar() {
      api(ctx, { action: 'metricas_proyecto', proyecto_id: pid }).then(function (m) {
        var html = '';
        if (m.avisos.length) html += m.avisos.map(function (a) { return '<div class="eu-faltan">' + esc(a) + '</div>'; }).join('');
        html += '<div class="ng-kpis">' +
          '<div class="ng-kpi fuerte"><span>Facturación</span><b>' + eurN(m.facturacion) + '</b><small>' + (m.origen_facturacion === 'facturas' ? 'facturas a cliente (superan el presupuesto)' : m.origen_facturacion === 'presupuesto' ? 'presupuesto aceptado' : 'sin IVA') + '</small></div>' +
          '<div class="ng-kpi"><span>Costes</span><b>' + eurN(m.costes) + '</b><small>sin IVA</small></div>' +
          '<div class="ng-kpi"><span>Margen bruto</span><b class="' + (m.margen_pct !== null && m.margen_pct < 30 ? 'mt-rojo' : '') + '">' + eurN(m.margen) + '</b><small>' + pctTxt(m.margen_pct) + '</small></div>' +
          '<div class="ng-kpi"><span>Cobrado</span><b>' + eurN(m.cobros.cobrado) + '</b><small>de ' + eurN(m.cobros.total) + ' con IVA (' + String(m.iva_pct == null ? 21 : m.iva_pct) + ' %)</small></div>' +
          '<div class="ng-kpi"><span>Pendiente de cobro</span><b>' + eurN(m.cobros.pendiente) + '</b><small>' + (m.cobros.vencidos.length ? m.cobros.vencidos.length + ' vencido' + (m.cobros.vencidos.length === 1 ? '' : 's') : 'nada vencido') + '</small></div></div>';
        html += '<div class="ng-dos"><div class="ng-card"><h2>Facturación, coste y margen</h2>' + barrasFCM(m) + '</div><div class="ng-card"><h2>Costes por categoría</h2>' + donut(m.costes_por_categoria) + '</div></div>';
        html += '<div class="ng-card"><div class="ng-card-cab"><h2>Cobros y pagos</h2><span class="ng-ley"><i style="background:#12B76A"></i>Cobros (con IVA) <i style="background:#161616"></i>Pagos</span></div>' + lineaTiempo(m.eventos) + '</div>';
        // Cobros
        html += '<div class="ng-dos"><div class="ng-card"><div class="ng-card-cab"><h2>Cobros</h2><span><label class="pa-muted" style="font-size:12px">IVA del proyecto <select id="mtIva">' + [21, 10, 4, 0].map(function (v) { return '<option value="' + v + '"' + (Number(m.iva_pct) === v ? ' selected' : '') + '>' + v + ' %</option>'; }).join('') + '</select></label> ' + (m.presupuesto && m.presupuesto.estado === 'aceptado' ? '<button class="pa-btn" id="mtRegen">Recalcular plazos</button>' : '') + '</span></div>' +
          (m.cobros_lista.length ? '<table class="ng-tabla mt-cobros"><thead><tr><th>Plazo</th><th>Importe</th><th>Previsto</th><th>Cobrado</th></tr></thead><tbody>' + m.cobros_lista.map(function (c) {
            var vencido = !c.cobrado && c.fecha_prevista && c.fecha_prevista < new Date().toISOString().slice(0, 10);
            return '<tr data-cobro="' + c.id + '"' + (vencido ? ' class="mt-vencido"' : '') + '><td>' + esc(c.concepto) + (c.pct ? ' <small class="pa-muted">' + String(c.pct).replace('.', ',') + ' %</small>' : '') + '</td><td><input data-c="importe" inputmode="decimal" value="' + numOut(c.importe) + '"></td>' +
              '<td><input type="date" data-c="fecha_prevista" value="' + esc(c.fecha_prevista || '') + '"></td><td><label class="mt-check"><input type="checkbox" data-c="cobrado"' + (c.cobrado ? ' checked' : '') + '> <input type="date" data-c="fecha_cobro" value="' + esc(c.fecha_cobro || '') + '"' + (c.cobrado ? '' : ' disabled') + '></label></td></tr>';
          }).join('') + '</tbody></table>' : '<p class="pa-muted">' + (m.presupuesto && m.presupuesto.estado === 'aceptado' ? 'Sin plazos.' : 'Los plazos se crean al marcar el presupuesto como aceptado (con la forma de pago de tu plantilla).') + '</p>') + '</div>';
        // Costes manuales
        html += '<div class="ng-card"><h2>Costes manuales</h2><p class="pa-muted" style="font-size:12.5px;margin:0 0 8px">Sin IVA. Las facturas de proveedor se suman solas desde «Archivos».</p>' +
          '<ul class="ng-lista">' + m.costes_lista.map(function (c) { return '<li><div><strong>' + esc(c.concepto || NOM_CAT[c.categoria]) + '</strong><small>' + NOM_CAT[c.categoria] + ' · ' + dia(c.fecha) + '</small></div><span class="ng-imp">' + eurN(c.importe) + '</span><button class="pa-btn" data-coste-borrar="' + c.id + '">×</button></li>'; }).join('') + '</ul>' +
          '<form class="mt-coste" id="mtCoste"><select name="categoria">' + Object.keys(NOM_CAT).map(function (k) { return '<option value="' + k + '">' + NOM_CAT[k] + '</option>'; }).join('') + '</select>' +
          '<input name="concepto" placeholder="Concepto"><input name="fecha" type="date"><input name="importe" inputmode="decimal" placeholder="€ sin IVA" required><button class="pa-btn primary" type="submit">Añadir</button></form></div></div>';
        el.innerHTML = html;
      }).catch(function (e) { el.innerHTML = '<p class="tf-err">' + esc(e.message) + '</p>'; });
    }
    el.addEventListener('change', function (e) {
      var tr = e.target.closest('[data-cobro]'); if (!tr) return;
      var k = e.target.dataset.c, datos = { action: 'cobro_guardar', id: tr.dataset.cobro };
      if (k === 'cobrado') { datos.cobrado = e.target.checked; datos.fecha_cobro = tr.querySelector('[data-c="fecha_cobro"]').value; }
      else datos[k] = e.target.value;
      api(ctx, datos).then(cargar).catch(function (err) { alert(err.message); });
    });
    el.addEventListener('submit', function (e) {
      if (e.target.id !== 'mtCoste') return;
      e.preventDefault();
      var f = e.target;
      api(ctx, { action: 'coste_guardar', proyecto_id: pid, categoria: f.categoria.value, concepto: f.concepto.value, fecha: f.fecha.value, importe: f.importe.value })
        .then(cargar).catch(function (err) { alert(err.message); });
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-coste-borrar]');
      if (b) return api(ctx, { action: 'coste_borrar', id: b.dataset.costeBorrar }).then(cargar).catch(function (err) { alert(err.message); });
      if (e.target.id === 'mtRegen') api(ctx, { action: 'cobros_regenerar', proyecto_id: pid }).then(cargar).catch(function (err) { alert(err.message); });
    });
    el.addEventListener('change', function (e) {
      if (e.target.id === 'mtIva') api(ctx, { action: 'proyecto_iva', proyecto_id: pid, iva_pct: Number(e.target.value) }).then(cargar).catch(function (err) { alert(err.message); });
    });
    cargar();
  }

  // ════════════════════════════════════════════════════════════════
  // Presupuesto
  // ════════════════════════════════════════════════════════════════
  // ── Desglose de una partida: puntos de cada concepto, total de puntos y precio; opciones de la tarifa por puntos ──
  var NOM_MOD = { m1: 'Modelo 1 · altillo + estantes + 3 cajones', m2: 'Modelo 2 · altillo + estante + barra', m3: 'Modelo 3 · altillo + estantes', m4: 'Modelo 4 · altillo + doble barra', m5: 'Modelo 5 · altillo + barra largo', m6: 'Modelo 6 · altillo + hueco libre' };
  var NOM_COSTADO = { melamina: 'Melamina', madera_barnizada: 'Madera barnizada', dm_lacado: 'DM lacado', espejo: 'Con espejo' };
  function desglosePuntos(p, i) {
    var op = p.opciones || {}, cost = (op.costados && op.costados[0]) || { tipo: 'melamina', n: 0 };
    var hayPuntos = p.desglose.some(function (d) { return d.puntos != null; });
    var filas = p.desglose.map(function (d) {
      var pts = d.puntos_linea != null ? d.puntos_linea : d.puntos != null ? Math.ceil(Math.round(d.puntos * d.cantidad * 1e6) / 1e6 - 1e-9) : null;
      return '<tr' + (d.aviso ? ' class="pr-aviso"' : '') + '><td>' + esc(d.nombre) + (d.aviso ? '<br><small>⚠ ' + esc(d.aviso) + '</small>' : '') + '</td><td>' + (d.unidad === '%' ? '' : numOut(d.cantidad)) + '</td>' +
        '<td>' + (d.puntos != null ? numOut(d.puntos) + ' pt' : '') + '</td><td>' + (pts != null ? '<b>' + numOut(pts) + '</b>' : '') + '</td>' +
        '<td>' + (d.precio === null ? 'PENDIENTE' : d.unidad === '%' ? numOut(d.precio) + '%' : eur(d.precio)) + '</td><td>' + (d.importe == null ? '—' : eur(d.importe)) + '</td></tr>';
    }).join('');
    var tot = '<tr class="pr-des-tot"><td>Total</td><td></td><td></td><td><b>' + numOut(p.puntos || 0) + ' pt</b></td><td></td><td><b>' + (p.precio == null ? 'PENDIENTE' : eur(p.precio)) + '</b></td></tr>';
    var avisos = (p.avisos || []).map(function (a) { return '<li>⚠ ' + esc(a) + '</li>'; }).join('');
    var mods = (p.modulos || []).map(function (m) {
      var cur = (op.modelos && op.modelos[m.clave]) || m.modelo;
      return '<label class="pr-op-mod">Módulo ' + (m.modulo + 1) + (p.modulos.some(function (x) { return x.cuerpo > 0; }) ? ' (cuerpo ' + (m.cuerpo + 1) + ')' : '') + ' · ' + m.ancho_mm + ' mm' +
        '<select data-opm="' + m.clave + '" data-auto="' + m.automatico + '">' + Object.keys(NOM_MOD).map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + NOM_MOD[k] + (k === m.automatico ? ' (asignado)' : '') + '</option>'; }).join('') + '</select>' +
        (m.nota ? '<small class="pr-nota">' + esc(m.nota) + '</small>' : '') + '</label>';
    }).join('');
    return '<details class="pr-des"' + (hayPuntos ? ' open' : '') + '><summary>Desglose' + (hayPuntos ? ' · ' + numOut(p.puntos || 0) + ' puntos' : '') + '</summary>' +
      '<table class="pr-des-t"><thead><tr><th>Concepto</th><th>Ud.</th><th>Pt/ud.</th><th>Puntos</th><th>Precio/ud.</th><th>Importe</th></tr></thead><tbody>' + filas + tot + '</tbody></table>' +
      (avisos ? '<ul class="pr-avisos">' + avisos + '</ul>' : '') +
      (p.tipo === 'cocina' ? '<p class="pa-muted" style="font-size:12px;margin:6px 0 0">Tarifa de cocinas · precio = puntos × precio del punto cocina' + (p.precio == null && !p.precio_manual ? ' (PENDIENTE: ponlo en la tarifa)' : '') + '.</p>' : '') +
      (hayPuntos && p.tipo !== 'cocina' ? '<div class="pr-op" data-op="' + i + '"><b>Opciones de la tarifa por puntos</b>' + mods +
        '<div class="pr-op-fila"><label>Costados vistos <input data-o="costado_n" inputmode="numeric" value="' + (cost.n || 0) + '" style="width:44px"></label>' +
        '<select data-o="costado_tipo">' + Object.keys(NOM_COSTADO).map(function (k) { return '<option value="' + k + '"' + (k === cost.tipo ? ' selected' : '') + '>' + NOM_COSTADO[k] + '</option>'; }).join('') + '</select>' +
        '<label>Remate <select data-o="remate"><option value="">Sin remate</option><option value="barniz"' + (op.remate === 'barniz' ? ' selected' : '') + '>Barniz</option><option value="lacado"' + (op.remate === 'lacado' ? ' selected' : '') + '>Lacado</option></select></label></div>' +
        '<div class="pr-op-fila"><label><input type="checkbox" data-o="cajeado"' + (op.cajeado ? ' checked' : '') + '> Cajeados (+10 %)</label><label><input type="checkbox" data-o="inclinacion"' + (op.inclinacion ? ' checked' : '') + '> Inclinación (+25 %)</label>' +
        '<label>Divisiones verticales <input data-o="divisiones" inputmode="numeric" value="' + (op.divisiones || 0) + '" style="width:44px"></label><label>Rinconeros <input data-o="rinconeros" inputmode="numeric" value="' + (op.rinconeros || 0) + '" style="width:44px"></label></div></div>' : '') +
      '</details>';
  }
  function leerOpciones(card) {
    var z = card.querySelector('.pr-op'); if (!z) return undefined;
    var v = function (k) { var e = z.querySelector('[data-o="' + k + '"]'); return e ? (e.type === 'checkbox' ? e.checked : e.value) : null; };
    var modelos = {};
    z.querySelectorAll('[data-opm]').forEach(function (s) { if (s.value !== s.dataset.auto) modelos[s.dataset.opm] = s.value; });
    var n = parseInt(v('costado_n'), 10) || 0;
    return { modelos: modelos, costados: n > 0 ? [{ tipo: v('costado_tipo'), n: n }] : [], remate: v('remate') || null, cajeado: !!v('cajeado'), inclinacion: !!v('inclinacion'),
      divisiones: parseInt(v('divisiones'), 10) || 0, rinconeros: parseInt(v('rinconeros'), 10) || 0 };
  }

  function presupuesto(el, ctx, pid, opts) {
    opts = opts || {};
    var supa = ctx.supa, proyecto, doc = null, iva = 21, versionActual = 0, ocupado = false;
    var lista = [], info = { versiones: [], disenos: [], documentos: [], siguiente: '' }, sel = null;
    var pre = null; try { pre = JSON.parse(sessionStorage.getItem(CLAVE_PRE) || 'null'); sessionStorage.removeItem(CLAVE_PRE); } catch (e) { /* */ }
    el.innerHTML = (opts.embebido ? '<p id="prSub" class="pa-muted" style="margin:0 0 8px"></p>' : '<div class="pa-hero"><div><h1 id="prTitulo">Presupuestos</h1><p id="prSub" class="pa-muted"></p></div></div>') +
      '<div class="pr-card" id="prLista"><p class="pa-muted">Cargando…</p></div><div class="pr-card" id="prNuevo" hidden></div><div id="prZona"></div>';
    supa.from('estudio_proyectos').select('*').eq('id', pid).maybeSingle().then(function (r) {
      proyecto = r && r.data;
      if (!proyecto) { $('#prLista').innerHTML = 'Proyecto no encontrado.'; return; }
      if ($('#prTitulo')) $('#prTitulo').textContent = 'Presupuestos · ' + proyecto.nombre;
      // Al entrar: solo la lista (ninguno abierto); desde «Crear presupuesto» de un documento, el asistente
      return cargarLista(false).then(function () { if (pre) pintarNuevo(pre); if (ctx.alListaCargada) ctx.alListaCargada(); });
    });
    // Dentro del Resumen: las tarjetas de Documentos abren aquí el asistente o el editor
    function actualizarFus() { var b = $('#prFusionar'); if (b) b.disabled = document.querySelectorAll('[data-fus]:checked').length < 2; }
    if (ctx.alListo) ctx.alListo({
      nuevo: function (preSel) { return pintarNuevo(preSel); },
      abrir: function (id) { return abrir(id); },
      borrar: function (x) { return borrarPresupuesto(x); },
      duplicar: function (id) { return bloquear(function () { return api(ctx, { action: 'presupuesto_duplicar', presupuesto_id: id }).then(function (d) { return refrescarLista().then(function () { return abrir(d.id); }).then(function () { return 'Duplicado como ' + (d.numero || ''); }); }); }, 'Duplicando…'); },
      actualizarFus: actualizarFus
    });

    // ── Lista de presupuestos del proyecto ──
    /** Lista ligera leída directamente de la base de datos (sin partidas ni dibujos): < 0,3 s. */
    function leerLista() {
      return supa.from('estudio_presupuestos').select('id, numero, estado, estado_nota, importe, created_at, updated_at, montaje_previsto, montado, montado_at, fecha:datos->>fecha, importado:datos->importado, comision:datos->comision')
        .eq('proyecto_id', pid).order('created_at').then(function (r) {
          if (r.error) throw r.error;
          lista = (r.data || []).map(function (x) {
            return { id: x.id, numero: x.numero || '', fecha: x.fecha || String(x.created_at).slice(0, 10), importe: x.importe, estado: x.estado, estado_nota: x.estado_nota,
              importado: !!x.importado, comision: x.comision && x.comision.activa ? x.comision : null, actualizado: x.updated_at,
              montaje_previsto: x.montaje_previsto, montado: !!x.montado, montado_at: x.montado_at };
          });
        });
    }
    function cargarLista(reabrir) {
      return leerLista().then(function () {
        pintarLista();
        if (reabrir && sel) return abrir(sel);
        if (!sel) { $('#prZona').innerHTML = ''; $('#prSub').textContent = lista.length ? 'Abre un presupuesto de la lista o crea uno nuevo.' : 'Aún no hay presupuestos. Crea el primero desde tus documentos (diseños incluidos) o en blanco.'; }
      });
    }
    /** En el Resumen, solo «Nuevo presupuesto» y «Fusionar»: los presupuestos son tarjetas en Documentos. */
    function pintarLista() {
      if (opts.embebido) {
        $('#prLista').innerHTML = '<div class="ng-card-cab"><h2>Presupuestos</h2><span class="pa-btns"><button class="pa-btn" id="prFusionar" disabled title="Marca dos o más presupuestos en Documentos">Fusionar</button><button class="pa-btn primary" id="prNuevoBtn">Nuevo presupuesto</button></span></div>' +
          '<p class="pa-muted" style="font-size:12px;margin:6px 0 0">Cada presupuesto es una tarjeta en «Documentos»: ahí se ve, se descarga, se cambia su estado o se abre para editarlo aquí. Marca dos o más para fusionarlos. Puede haber varios aceptados (fases, extras): se suman en las métricas.</p>';
        actualizarFus();
        return;
      }
      $('#prLista').innerHTML = '<div class="ng-card-cab"><h2>Presupuestos del proyecto</h2><span class="pa-btns"><button class="pa-btn" id="prFusionar" disabled title="Marca dos o más presupuestos">Fusionar</button><button class="pa-btn primary" id="prNuevoBtn">Nuevo presupuesto</button></span></div>' +
        (lista.length ? '<table class="pr-tabla"><thead><tr><th></th><th>N.º</th><th>Fecha</th><th>Importe</th><th>Estado</th><th></th></tr></thead><tbody>' + lista.map(function (x) {
          return '<tr class="' + (x.id === sel ? 'on' : '') + '"><td>' + (x.importado ? '' : '<input type="checkbox" data-fus="' + x.id + '" title="Para fusionar">') + '</td><td><b>' + esc(x.numero || '—') + '</b>' + (x.importado ? ' <span class="pr-tag">histórico</span>' : '') + (x.comision ? ' <span class="pr-tag">interiorista ' + numOut(x.comision.pct) + ' %</span>' : '') + '</td>' +
            '<td>' + dia(x.fecha) + '</td><td>' + (x.importe == null ? '—' : eur(Number(x.importe))) + '</td>' +
            '<td>' + selectEstado(pid, x.estado, x.id) + (x.estado_nota ? '<br><small class="pr-nota">' + esc(x.estado_nota) + '</small>' : '') + '</td>' +
            '<td class="pr-acc">' + (x.id === sel ? '<button class="pa-btn" data-cerrar="1">Cerrar</button>' : '<button class="pa-btn" data-abrir="' + x.id + '">Abrir</button>') + (x.importado ? '' : '<button class="pa-btn" data-duplicar="' + x.id + '">Duplicar</button>') + '<button class="pa-btn pr-borrar" data-borrar-pr="' + x.id + '">Borrar</button></td></tr>';
        }).join('') + '</tbody></table><p class="pa-muted" style="font-size:12px;margin:6px 0 0">Puede haber varios aceptados (fases, extras): se suman para la facturación y las métricas; su montaje está en la caja «Montaje» de arriba. Marca dos o más para fusionarlos en uno nuevo.</p>' : '<p class="pa-muted">Aún no hay presupuestos.</p>');
    }

    // ── Nuevo presupuesto: desde el diseño, desde documentos o en blanco ──
    function pintarNuevo(preSel) {
      // Se cierra cualquier presupuesto abierto; lo que necesita el asistente se pide ahora (no al entrar)
      sel = null; doc = null; $('#prZona').innerHTML = ''; pintarLista();
      var z = $('#prNuevo'); z.hidden = false; z.innerHTML = '<p class="pa-muted">Cargando…</p>';
      return api(ctx, { action: 'presupuesto_asistente', proyecto_id: pid }).then(function (d) { info = d; pintarAsistente(preSel); })
        .catch(function (e) { z.innerHTML = '<p class="tf-err">' + esc(e.message) + '</p>'; });
    }
    function pintarAsistente(preSel) {
      var z = $('#prNuevo');
      var hayDocs = info.disenos.length || info.documentos.length;
      var marcado = function (tabla, id) { return preSel && preSel.tabla === tabla && preSel.id === id; };
      z.innerHTML = '<h3 style="margin-top:0">Nuevo presupuesto</h3>' +
        '<div class="pn-fila"><label>N.º de presupuesto * <input id="pnNum" value="' + esc(info.siguiente || '') + '" placeholder="Z…" required></label></div>' +
        '<div class="pn-bases pn-bases-2">' +
        '<label class="pn-base"><input type="radio" name="pnBase" value="documentos"' + (hayDocs ? ' checked' : ' disabled') + '> <b>Desde documentos</b><small>Diseños, planos, croquis o presupuestos del proyecto. De los diseños salen partidas con su dibujo; del resto, Claude propone las partidas (gasta créditos).</small></label>' +
        '<label class="pn-base"><input type="radio" name="pnBase" value="blanco"' + (hayDocs ? '' : ' checked') + '> <b>En blanco</b><small>Partidas a mano.</small></label></div>' +
        '<div class="pn-det" data-base="documentos">' +
        (info.disenos.length ? '<h4 class="pn-h">Diseños</h4>' + info.disenos.map(function (d) {
          var on = marcado('diseno', d.id) || (!preSel && info.disenos.length === 1);
          return '<div class="pn-ver"><label class="pn-dis"><input type="checkbox" data-dis="' + d.id + '"' + (on ? ' checked' : '') + '><span class="pn-mini">' + (d.miniatura || '') + '</span><b>' + esc(d.nombre) + '</b>' + (d.guardado ? '' : ' <span class="pr-tag">sin guardar</span>') + '</label><div class="pn-arm">' + d.armarios.map(function (a) {
            return '<label><input type="checkbox" data-arm="' + d.id + '" value="' + esc(a.codigo) + '"' + (on ? ' checked' : '') + '> ' + esc(a.codigo + ' ' + (a.titulo || '')) + '</label>';
          }).join('') + '</div></div>';
        }).join('') : '') +
        (info.documentos.filter(function (x) { return x.tipo !== 'alzados_pdf' || true; }).length ? '<h4 class="pn-h">Otros documentos <small class="pa-muted">(Claude los lee · hasta 4)</small></h4>' + info.documentos.map(function (x) {
          return '<label class="pn-doc"><input type="checkbox" data-doc="' + x.tabla + ':' + x.id + '"' + (marcado(x.tabla, x.id) ? ' checked' : '') + '> ' + esc(x.nombre) + ' <small class="pa-muted">' + esc(TIPO_DOC[x.tipo] || TIPO_F[x.tipo] || x.tipo) + '</small></label>';
        }).join('') : '') +
        (hayDocs ? '' : '<p class="pa-muted">Aún no hay documentos: guarda un diseño o sube planos y presupuestos en «Documentos».</p>') + '</div>' +
        '<div class="pr-barra"><button class="pa-btn primary" id="pnCrear">Crear presupuesto</button><button class="pa-btn" id="pnCancelar">Cancelar</button><span id="pnMsg" class="pr-msg"></span></div>';
      var mostrar = function () { var v = (z.querySelector('[name=pnBase]:checked') || {}).value; z.querySelectorAll('.pn-det').forEach(function (d) { d.hidden = d.dataset.base !== v; }); };
      z.querySelectorAll('[name=pnBase]').forEach(function (r) { r.addEventListener('change', mostrar); });
      z.querySelectorAll('[data-dis]').forEach(function (c) { c.addEventListener('change', function () { z.querySelectorAll('[data-arm="' + c.dataset.dis + '"]').forEach(function (a) { a.checked = c.checked; }); }); });
      mostrar();
      z.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    function crearNuevo() {
      var z = $('#prNuevo'), tipo = (z.querySelector('[name=pnBase]:checked') || {}).value || 'blanco', base = { tipo: tipo };
      if (!z.querySelector('#pnNum').value.trim()) { z.querySelector('#pnNum').focus(); throw new Error('Pon el n.º de presupuesto.'); }
      if (tipo === 'documentos') {
        base.documentos = [];
        z.querySelectorAll('[data-dis]').forEach(function (c) {
          var arm = [].slice.call(z.querySelectorAll('[data-arm="' + c.dataset.dis + '"]:checked')).map(function (a) { return a.value; });
          if (arm.length) base.documentos.push({ tabla: 'diseno', id: c.dataset.dis, armarios: arm });
        });
        var otros = [].slice.call(z.querySelectorAll('[data-doc]:checked')).map(function (c) { var p = c.dataset.doc.split(':'); return { tabla: p[0], id: p[1] }; });
        if (otros.length > 4) throw new Error('Elige como mucho 4 documentos para que los lea Claude.');
        base.documentos = base.documentos.concat(otros);
        if (!base.documentos.length) throw new Error('Elige al menos un diseño (con algún armario) o un documento.');
      }
      return api(ctx, { action: 'presupuesto_nuevo', proyecto_id: pid, numero: z.querySelector('#pnNum').value, base: base });
    }

    function aviso(t, tipo, html) { var m = $('#prMsg'); if (!m) return; m.className = 'pr-msg ' + (tipo || ''); m[html ? 'innerHTML' : 'textContent'] = t || ''; }
    var estadoP = 'borrador', importado = null, importes = null;
    function refrescarLista() { return leerLista().then(pintarLista).then(function () { if (ctx.alCambiarPres) ctx.alCambiarPres(); }); }
    /** Borrar con confirmación (doble si está aceptado); los PDF/Excel se quedan salvo que se marque lo contrario. */
    function borrarPresupuesto(x) {
      if (!x) return;
      var acept = x.estado === 'aceptado', m = document.createElement('div'); m.className = 'eu-modal';
      m.innerHTML = '<form class="eu-modal-caja"><h2>Borrar presupuesto ' + esc(x.numero || '') + '</h2>' +
        (acept ? '<p class="pr-nota" style="font-size:13px">Es el presupuesto <b>aceptado</b>: mientras esté en la papelera, el proyecto se queda sin su facturación en las métricas.</p>' : '') +
        '<p class="pa-muted" style="font-size:13px">Va a la papelera con sus PDF y Excel: se puede restaurar durante 30 días.</p>' +
        (acept ? '<label style="font-size:13px;display:block;margin:8px 0"><input type="checkbox" id="bpOk"> Entiendo que afecta a facturación y métricas</label>' : '') +
        '<div class="eu-modal-bot"><button type="button" class="pa-btn" data-bp="no">Cancelar</button><button type="submit" class="pa-btn primary pr-borrar-ok">Borrar</button></div></form>';
      document.body.appendChild(m);
      m.querySelector('[data-bp=no]').addEventListener('click', function () { m.remove(); });
      m.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        if (acept && !m.querySelector('#bpOk').checked) { m.querySelector('#bpOk').parentNode.style.color = '#b42318'; return; }
        var b = m.querySelector('.pr-borrar-ok'); b.disabled = true; b.textContent = 'Borrando…';
        api(ctx, { action: 'presupuesto_borrar', presupuesto_id: x.id, confirmar_aceptado: acept })
          .then(function () { m.remove(); if (sel === x.id) { sel = null; doc = null; $('#prZona').innerHTML = ''; } if (ctx.alPapelera) ctx.alPapelera(); return refrescarLista(); })
          .catch(function (err) { b.disabled = false; b.textContent = 'Borrar'; alert(err.message); });
      });
    }
    function abrir(id) {
      sel = id; $('#prNuevo').hidden = true; pintarLista(); $('#prZona').innerHTML = '<div class="pr-card pa-muted">Abriendo…</div>';
      if (opts.embebido) $('#prZona').scrollIntoView({ block: 'start', behavior: 'smooth' });
      return api(ctx, { action: 'presupuesto', presupuesto_id: id }).then(cargar);
    }
    function cargar(d) {
      doc = d.presupuesto; importado = d.importado || null; importes = d.importes || null; iva = d.iva_pct == null ? 21 : Number(d.iva_pct); versionActual = d.version_actual; estadoP = d.estado || 'borrador';
      if (d.id && d.id !== sel) { sel = d.id; }
      pintar();
    }

    function pintar() {
      if (!doc) {
        $('#prSub').textContent = importado ? 'Presupuesto importado del histórico' : '';
        $('#prZona').innerHTML = importado ? '<div class="pr-card"><p>Presupuesto <b>' + esc(importado.numero || '') + '</b>' + (importado.importe != null ? ' · ' + esc(String(importado.importe).replace('.', ',')) + ' € sin IVA' : '') + '. El original está en «Documentos». Para editarlo, crea uno nuevo.</p></div>' : '';
        return;
      }
      var vs = (doc.versiones && doc.versiones.length ? doc.versiones : [doc.version]).filter(Boolean);
      var hayDiseno = doc.partidas.some(function (p) { return !p.libre; });
      $('#prSub').textContent = hayDiseno ? 'Desde ' + (vs.length > 1 ? 'las versiones ' : 'la versión ') + vs.map(function (v) { return 'v' + v; }).join(', ') + (vs.indexOf(versionActual) < 0 && versionActual ? ' · el diseño ya va por v' + versionActual : '') : 'Partidas a mano';
      var cab = [['numero', 'N.º de presupuesto'], ['fecha', 'Fecha', 'date'], ['validez', 'Validez oferta'], ['atencion', 'Cliente (nombre o empresa)'],
        ['cliente_nif', 'NIF/CIF'], ['direccion_facturacion', 'Dirección de facturación'], ['proyecto', 'Proyecto'], ['proyecto_2', 'Dirección del proyecto']];
      var cm = doc.comision || { activa: false, pct: 15, paga: 'cliente' };
      var html = '<div class="pr-barra"><button class="pa-btn primary" id="prGuardar">Guardar</button>' + (hayDiseno ? '<button class="pa-btn" id="prTextos">Redactar textos con IA</button>' : '') +
        '<button class="pa-btn" id="prPdf">Descargar PDF</button><button class="pa-btn" id="prExcel">Descargar Excel</button>' +
        (hayDiseno ? '<button class="pa-btn" id="prGenerar">Recalcular con la tarifa</button>' : '') +
        '<button class="pa-btn" data-cerrar="1">Cerrar</button><span id="prMsg" class="pr-msg"></span></div>';
      html += '<div class="pr-card pr-f"><div class="pr-cab">' + cab.map(function (c) {
        return '<div><label>' + c[1] + '</label><input data-c="' + c[0] + '" type="' + (c[2] || 'text') + '" value="' + esc(doc[c[0]] || '') + '"></div>';
      }).join('') + '</div>' +
        '<div class="pr-com"><label><input type="checkbox" id="prComOn"' + (cm.activa ? ' checked' : '') + ' style="width:auto"> <b>Comisión interiorista</b></label>' +
        '<span' + (cm.activa ? '' : ' hidden') + ' id="prComDet"><label>% <input id="prComPct" inputmode="decimal" value="' + numOut(cm.pct) + '" style="width:64px"></label>' +
        '<small class="pa-muted">Al descargar se generan dos versiones: «_cliente» (PVP, sin descuento) e «_interiorista» (con DTO. PROFESIONAL).</small></span></div></div>';
      html += doc.partidas.map(function (p, i) {
        return '<div class="pr-card pr-f" data-i="' + i + '"><div class="pr-partida"><div>' +
          (p.libre ? '<label>Título de la partida</label><input data-p="titulo" value="' + esc(p.titulo) + '">' :
            '<h3>' + esc(p.titulo) + (p.version && vs.length > 1 ? ' <span class="pr-tag">v' + p.version + '</span>' : '') + (p.pendientes.length && !p.precio_manual ? ' <span class="pr-tag">' + p.pendientes.length + ' conceptos PENDIENTE</span>' : '') + '</h3>') +
          '<label' + (p.libre ? ' style="margin-top:6px"' : '') + '>Subtítulo</label><input data-p="subtitulo" value="' + esc(p.subtitulo) + '">' +
          '<label style="margin-top:6px">Introducción</label><textarea data-p="intro" placeholder="Opcional' + (p.libre ? '' : ' (o «Redactar textos con IA»)') + '">' + esc(p.intro) + '</textarea>' +
          '<label style="margin-top:6px">' + (p.libre ? 'Descripción' : 'Ficha técnica') + '</label><textarea data-p="tecnico" style="min-height:96px">' + esc(p.tecnico) + '</textarea>' +
          '<label style="margin-top:6px">Materiales</label><textarea data-p="materiales">' + esc(p.materiales) + '</textarea>' +
          '</div><div>' +
          '<div class="pr-num"><div><label>Cantidad</label><input data-p="cantidad" inputmode="numeric" value="' + p.cantidad + '"></div>' +
          '<div' + (cm.activa ? ' hidden' : '') + ' class="pr-dto"><label>Dto. profesional %</label><input data-p="dto_pct" inputmode="decimal" value="' + numOut(p.dto_pct) + '"></div></div>' +
          (p.libre ? '' : '<label style="margin-top:8px"><input type="checkbox" data-p="precio_manual"' + (p.precio_manual ? ' checked' : '') + ' style="width:auto"> Precio a mano</label>') +
          '<div class="' + (p.precio === null ? 'pr-pend' : '') + '"><label>Precio unitario (PVP sin IVA)</label><input data-p="precio" inputmode="decimal" placeholder="PENDIENTE" value="' + numOut(p.precio) + '"' + (p.libre || p.precio_manual ? '' : ' readonly') + '></div>' +
          '<div class="pr-res" data-res></div>' +
          '<button class="pa-btn pr-quitar" data-quitar="' + i + '">Quitar partida</button></div></div>' +
          (p.libre ? '' : desglosePuntos(p, i)) + '</div>';
      }).join('');
      html += '<div class="pr-barra"><button class="pa-btn" id="prAnadir">+ Añadir partida</button></div><div class="pr-card"><div class="pr-tot" id="prTot"></div></div>';
      // Forma de pago del presupuesto (se copia de la plantilla al crearlo): filas concepto + %, importe con IVA
      html += '<div class="pr-card pr-f" id="prFp"><label><b>Forma de pago</b></label><div id="prFpFilas">' + filasFp(doc.forma_pago || []) + '</div>' +
        '<div style="display:flex;gap:10px;align-items:center;margin-top:6px"><button class="pa-btn" type="button" data-fp="add">+ Añadir plazo</button><span id="prFpAviso" class="pa-muted" style="font-size:12.5px"></span></div></div>';
      var vistaCab = '<div class="pr-vista-cab"><b>Vista previa</b>' + (cm.activa ? '<select id="prVistaVar"><option value="cliente">Cliente</option><option value="interiorista">Interiorista</option></select>' : '') + '<span id="prVistaEst" class="pa-muted"></span></div>';
      $('#prZona').innerHTML = '<div class="pr-alternar"><button class="pa-btn on" data-ver="editor">Editor</button><button class="pa-btn" data-ver="vista">Vista previa</button></div>' +
        '<div class="pr-dos" data-modo="editor"><div class="pr-ed">' + html + '</div><aside class="pr-vista">' + vistaCab + '<div id="prVistaPags"><p class="pa-muted">Generando…</p></div></aside></div>';
      if ($('#prVistaVar')) $('#prVistaVar').value = varVista;
      recalcular();
      vistaPrevia(0);
    }

    // ── Vista previa: el PDF real (con los cambios sin guardar), regenerado 1,5 s después de editar ──
    var tVista = null, nVista = 0, varVista = 'cliente';
    function vistaPrevia(retardo) {
      clearTimeout(tVista);
      tVista = setTimeout(function () {
        if (!doc || !sel) return;
        var n = ++nVista, est = $('#prVistaEst'); if (est) est.textContent = ' · actualizando…';
        api(ctx, { action: 'presupuesto_vista', presupuesto_id: sel, datos: leer(), variante: varVista }).then(function (d) {
          if (n !== nVista) return;
          return pdfjs().then(function (lib) { return lib.getDocument({ data: Uint8Array.from(atob(d.base64), function (c) { return c.charCodeAt(0); }) }).promise; }).then(function (pdf) {
            var cont = $('#prVistaPags'); if (!cont || n !== nVista) return;
            var ancho = Math.max(280, cont.clientWidth - 4), nuevo = document.createElement('div'), tareas = [];
            for (var i = 1; i <= pdf.numPages; i++) tareas.push(pdf.getPage(i).then(function (pg) {
              var vp1 = pg.getViewport({ scale: 1 }), k = ancho / vp1.width, ratio = Math.min(2, window.devicePixelRatio || 1), vp = pg.getViewport({ scale: k * ratio });
              var c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = ancho + 'px'; c.className = 'pr-pag';
              return pg.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise.then(function () { return c; });
            }));
            return Promise.all(tareas).then(function (cs) { if (n !== nVista) return; cs.forEach(function (c) { nuevo.appendChild(c); }); cont.replaceChildren.apply(cont, [].slice.call(nuevo.childNodes)); if (est) est.textContent = ''; });
          });
        }).catch(function (e) { if (n === nVista && est) est.textContent = ' · ' + e.message; });
      }, retardo === undefined ? 1500 : retardo);
    }

    function filasFp(fp) {
      return fp.map(function (x, k) {
        var b = function (a, t, dis) { return '<button type="button" class="pa-btn" data-fp="' + a + '" data-k="' + k + '"' + (dis ? ' disabled' : '') + ' style="padding:2px 8px">' + t + '</button>'; };
        return '<div class="pr-fp" data-fpi="' + k + '" style="display:flex;gap:6px;align-items:center;margin:4px 0"><input data-fpc value="' + esc(x.concepto || '') + '" placeholder="Concepto" style="flex:1">' +
          '<input data-fpp inputmode="decimal" value="' + numOut(x.pct) + '" style="width:58px"> %<span data-fpimp class="pa-muted" style="min-width:210px;text-align:right;font-size:12.5px"></span>' +
          b('up', '↑', k === 0) + b('down', '↓', k === fp.length - 1) + b('del', '✕') + '</div>';
      }).join('');
    }
    function leerFpEd() {
      return [].map.call(document.querySelectorAll('#prFpFilas .pr-fp'), function (r) { return { concepto: r.querySelector('[data-fpc]').value.trim(), pct: numIn(r.querySelector('[data-fpp]').value) || 0 }; });
    }
    /** Importe de cada plazo (base + IVA) y aviso si los % no suman 100. */
    function pintarFp(base) {
      var fp = leerFpEd(), suma = r2(fp.reduce(function (s, x) { return s + x.pct; }, 0)), filas = document.querySelectorAll('#prFpFilas .pr-fp');
      var total = base === null ? null : r2(base * (1 + iva / 100)), acum = 0;
      fp.forEach(function (x, k) {
        var span = filas[k] && filas[k].querySelector('[data-fpimp]');
        if (!span) return;
        if (base === null) { span.textContent = 'PENDIENTE'; return; }
        var b = r2(base * x.pct / 100), t = r2(total * x.pct / 100);
        if (k === fp.length - 1 && Math.abs(suma - 100) < 0.001) t = r2(total - acum);   // el último cuadra el total
        acum += t;
        span.textContent = eur(b) + ' + IVA = ' + eur(t);
      });
      var av = $('#prFpAviso');
      if (av) { var ok = Math.abs(suma - 100) < 0.001; av.style.color = ok ? '' : '#b42318'; av.textContent = ok ? 'Suma 100 %' : 'Los % suman ' + numOut(suma) + ' %: tienen que sumar 100 % (sin eso no se descarga el PDF ni el Excel del cliente)'; }
    }
    function leer() {
      var d = { partidas: [] };
      document.querySelectorAll('#prZona [data-c]').forEach(function (i) { d[i.dataset.c] = i.value; });
      var on = $('#prComOn');
      if (on) d.comision = { activa: on.checked, pct: numIn($('#prComPct').value) || 0, paga: 'cliente' };
      if ($('#prFpFilas')) d.forma_pago = leerFpEd();
      document.querySelectorAll('#prZona [data-i]').forEach(function (card) {
        var p = doc.partidas[Number(card.dataset.i)], x = { codigo: p.codigo, clave: p.clave }, op = leerOpciones(card);
        if (op) x.opciones = op;
        card.querySelectorAll('[data-p]').forEach(function (i) {
          var k = i.dataset.p;
          if (k === 'precio_manual') x[k] = i.checked;
          else if (k === 'cantidad') x[k] = Math.max(1, parseInt(i.value, 10) || 1);
          else if (k === 'dto_pct' || k === 'precio') x[k] = numIn(i.value);
          else x[k] = i.value;
        });
        d.partidas.push(x);
      });
      return d;
    }
    function recalcular() {
      var d = leer(), pvp = 0, imp = 0, netoInt = 0, pend = 0, cm = d.comision && d.comision.activa ? d.comision : null;
      if ($('#prComDet')) $('#prComDet').hidden = !cm;
      document.querySelectorAll('#prZona .pr-dto').forEach(function (x) { x.hidden = !!cm; });
      d.partidas.forEach(function (x, i) {
        var p = doc.partidas[i];
        var precio = p.libre || x.precio_manual ? x.precio : p.precio;
        var card = document.querySelector('#prZona [data-i="' + i + '"]');
        if (!p.libre) card.querySelector('[data-p="precio"]').readOnly = !x.precio_manual;
        var res = card.querySelector('[data-res]');
        if (precio === null || precio === undefined) { pend++; res.innerHTML = 'PVP <span class="pr-pvp">PENDIENTE</span><br>Importe <b>PENDIENTE</b>'; return; }
        var dto = cm ? 0 : (x.dto_pct || 0);
        var l = r2(precio * x.cantidad), m = r2(l * (1 - dto / 100));
        pvp += l; imp += m;
        if (cm) netoInt += r2(l * (1 - cm.pct / 100));   // neto por línea, como el PDF «interiorista»
        res.innerHTML = 'PVP <span class="pr-pvp">' + eur(l) + '</span><br>Importe <b>' + eur(m) + '</b>';
      });
      pintarFp(pend ? null : cm ? r2(pvp) : r2(imp));
      if (pend) { $('#prTot').innerHTML = '<span>PVP sin IVA: PENDIENTE</span><span>Importe total: <b>PENDIENTE</b></span><span class="pr-tag">' + pend + (pend === 1 ? ' partida' : ' partidas') + ' sin precio</span>'; return; }
      if (cm) {
        var neto = r2(netoInt), com = r2(pvp - neto), fact = r2(pvp);
        $('#prTot').innerHTML = '<span>PVP cliente: <b>' + eur(r2(pvp)) + '</b></span><span>Comisión interiorista (' + numOut(cm.pct) + ' %): ' + eur(com) + '</span><span>Neto interiorista: ' + eur(neto) + '</span>' +
          '<span class="pa-muted">Facturación en métricas: ' + eur(fact) + ' (paga el cliente, a PVP) · la comisión cuenta como coste</span>';
        return;
      }
      $('#prTot').innerHTML = '<span>PVP sin IVA: ' + eur(r2(pvp)) + '</span>' + (imp !== pvp ? '<span>Dto. profesional: ' + eur(r2(imp - pvp)) + '</span>' : '') + '<span>Importe total: <b>' + eur(r2(imp)) + '</b></span><span class="pa-muted">IVA ' + numOut(iva) + '%: ' + eur(r2(imp * iva / 100)) + '</span>';
    }
    el.addEventListener('input', function (e) { if (doc && e.target.closest('.pr-ed')) { recalcular(); vistaPrevia(); } });
    el.addEventListener('change', function (e) {
      if (doc && (e.target.id === 'prComOn' || (e.target.dataset && e.target.dataset.p === 'precio_manual'))) recalcular();
      if (doc && e.target.closest('.pr-op')) { bloquear(function () { return guardar().then(function () { refrescarLista(); return 'Recalculado por puntos'; }); }, 'Recalculando…'); return; }
      if (doc && e.target.closest('.pr-ed')) vistaPrevia();
      if (e.target.id === 'prVistaVar') { varVista = e.target.value; vistaPrevia(0); }
      if (e.target.classList.contains('ng-estado')) cambiarEstado(ctx, e.target, function () { refrescarLista(); if (ctx.alCambiar) ctx.alCambiar(); });
      if (e.target.dataset && e.target.dataset.fus !== undefined) actualizarFus();
      var mz = e.target.closest && e.target.closest('[data-mpr]');
      if (mz) {
        var body = { action: 'proyecto_montaje', proyecto_id: pid, presupuesto_id: mz.dataset.mpr };
        if (e.target.dataset.mprev !== undefined) body.montaje_previsto = e.target.value || null;
        if (e.target.dataset.mmont !== undefined) { body.montado = e.target.checked; body.montado_at = e.target.checked ? new Date().toLocaleDateString('sv-SE') : undefined; }
        if (e.target.dataset.mreal !== undefined) body.montado_at = e.target.value || null;
        api(ctx, body).then(function () { if (ctx.alCambiar) ctx.alCambiar(); return refrescarLista(); }).catch(function (err) { alert(err.message); });
      }
    });

    function guardar() { return api(ctx, { action: 'presupuesto_guardar', presupuesto_id: sel, datos: leer() }).then(function (d) { cargar(d); return d; }); }
    function bloquear(fn, t) {
      if (ocupado) return; ocupado = true;
      var m = $('#prMsg') || $('#pnMsg'); if (m) { m.className = 'pr-msg pr-trab'; m.textContent = t; }
      Promise.resolve().then(fn).then(function (msg) { aviso(msg || 'Hecho', 'ok'); })
        .catch(function (e) { var mm = $('#prMsg') || $('#pnMsg'); if (mm) { mm.className = 'pr-msg err'; mm.innerHTML = textoError(ctx, e); } else alert(e.message); }).then(function () { ocupado = false; });
    }
    el.addEventListener('click', function (e) {
      var id = e.target.id, t = e.target;
      if (doc && t.dataset && t.dataset.fp) {
        var fp = leerFpEd(), k = Number(t.dataset.k);
        if (t.dataset.fp === 'add') fp.push({ concepto: '', pct: Math.max(0, r2(100 - fp.reduce(function (s, x) { return s + x.pct; }, 0))) });
        else if (t.dataset.fp === 'del') fp.splice(k, 1);
        else { var j = t.dataset.fp === 'up' ? k - 1 : k + 1; if (j >= 0 && j < fp.length) { var x = fp[k]; fp[k] = fp[j]; fp[j] = x; } }
        $('#prFpFilas').innerHTML = filasFp(fp); recalcular(); vistaPrevia(); return;
      }
      if (id === 'prNuevoBtn') return pintarNuevo(null);
      if (id === 'pnCancelar') { $('#prNuevo').hidden = true; return; }
      if (id === 'pnCrear') return bloquear(function () {
        return crearNuevo().then(function (d) { $('#prNuevo').hidden = true; sel = d.id; if (ctx.alCambiar) ctx.alCambiar(); if (ctx.alCambiarPres) ctx.alCambiarPres(); return cargarLista(true).then(function () { return 'Presupuesto ' + (d.numero || '') + ' creado'; }); });
      }, 'Creando…');
      if (t.dataset.abrir) return abrir(t.dataset.abrir);
      if (t.dataset.cerrar) { sel = null; doc = null; nVista++; $('#prZona').innerHTML = ''; pintarLista(); return; }
      if (t.dataset.ver) { var dos = el.querySelector('.pr-dos'); if (dos) dos.dataset.modo = t.dataset.ver; el.querySelectorAll('[data-ver]').forEach(function (b) { b.classList.toggle('on', b === t); }); return; }
      if (t.dataset.borrarPr) return borrarPresupuesto(lista.filter(function (x) { return x.id === t.dataset.borrarPr; })[0]);
      if (id === 'prFusionar') {
        var ids = Array.prototype.map.call(document.querySelectorAll('[data-fus]:checked'), function (c) { return c.dataset.fus; });
        if (ids.length < 2) return;
        return bloquear(function () {
          return api(ctx, { action: 'presupuesto_fusionar', proyecto_id: pid, ids: ids }).then(function (d) { sel = d.id; if (ctx.alCambiarPres) ctx.alCambiarPres(); return cargarLista(true).then(function () { return 'Fusionados ' + (d.fusionados || []).join(' + ') + ' en ' + (d.numero || ''); }); });
        }, 'Fusionando…');
      }
      if (t.dataset.duplicar) return bloquear(function () {
        return api(ctx, { action: 'presupuesto_duplicar', presupuesto_id: t.dataset.duplicar }).then(function (d) { sel = d.id; return cargarLista(true).then(function () { return 'Duplicado como ' + (d.numero || ''); }); });
      }, 'Duplicando…');
      if (t.dataset.quitar !== undefined && doc) { var d0 = leer(); d0.partidas.splice(Number(t.dataset.quitar), 1); return bloquear(function () { return api(ctx, { action: 'presupuesto_guardar', presupuesto_id: sel, datos: d0 }).then(cargar).then(function () { return 'Partida quitada'; }); }, 'Guardando…'); }
      if (id === 'prAnadir' && doc) { var d1 = leer(); d1.partidas.push({ titulo: 'NUEVA PARTIDA', cantidad: 1, precio: null, dto_pct: 0 }); return bloquear(function () { return api(ctx, { action: 'presupuesto_guardar', presupuesto_id: sel, datos: d1 }).then(cargar).then(function () { return 'Partida añadida'; }); }, 'Guardando…'); }
      if (id === 'prGenerar') bloquear(function () {
        return guardar().then(function () { return api(ctx, { action: 'presupuesto_generar', presupuesto_id: sel }); }).then(cargar).then(function () { refrescarLista(); return 'Recalculado con la tarifa (se conservan precios a mano y textos editados)'; });
      }, 'Recalculando…');
      if (id === 'prGuardar') bloquear(function () { return guardar().then(function () { refrescarLista(); return 'Guardado'; }); }, 'Guardando…');
      if (id === 'prTextos') bloquear(function () {
        return guardar().then(function () { return api(ctx, { action: 'presupuesto_textos', presupuesto_id: sel }); })
          .then(function (d) { cargar(d); if (ctx.alCambiar) ctx.alCambiar(); return 'Textos redactados' + (ctx.modo === 'admin' ? ' · ' + String(d.coste_usd).replace('.', ',') + ' $' : ''); });
      }, 'Claude está redactando…');
      if (id === 'prPdf') bloquear(function () {
        return guardar().then(function () { return api(ctx, { action: 'presupuesto_pdf', presupuesto_id: sel }); })
          .then(function (d) { (d.archivos || [d]).forEach(function (a) { descargar(base64Blob(a.base64, 'application/pdf'), a.nombre); }); return (d.archivos && d.archivos.length > 1 ? 'PDF cliente e interiorista descargados' : 'PDF descargado') + ' y guardados en Documentos' + avisoSupuestos(d.supuestos); });
      }, 'Generando PDF…');
      if (id === 'prExcel') bloquear(function () {
        return guardar().then(function () { return api(ctx, { action: 'presupuesto_dibujos', presupuesto_id: sel }); }).then(function (d) {
          var vars = doc.comision && doc.comision.activa ? ['cliente', 'interiorista'] : [null];
          return vars.reduce(function (pr, v) {
            return pr.then(function () {
              excel.guardar = function (blob, nombre, dd) {
                return api(ctx, { action: 'doc_subida', proyecto_id: pid, tipo: 'presupuesto_xlsx', version: dd.version, numero: dd.numero, nombre: nombre, bytes: blob.size, presupuesto_id: sel, variante: v })
                  .then(function (r) { return ctx.supa.storage.from('estudio').uploadToSignedUrl(r.path, r.token, blob, { contentType: blob.type }); });
              };
              return excel(d, varianteDoc(d.presupuesto_cliente || doc, v), proyecto, v);
            });
          }, Promise.resolve()).then(function () { return (vars.length > 1 ? 'Excel cliente e interiorista descargados y guardados en Documentos' : 'Excel descargado y guardado en Documentos') + avisoSupuestos(d.supuestos); });
        });
      }, 'Generando Excel…');
    });
  }
  /** Aviso (no bloquea) de valores supuestos sin confirmar: en el documento del cliente salen sin la palabra «supuesto». */
  function avisoSupuestos(n) { return n > 0 ? ' · Aviso: hay ' + n + (n === 1 ? ' valor supuesto' : ' valores supuestos') + ' sin confirmar' : ''; }
  /** Variante del presupuesto para descargar (igual que docVariante del servidor). */
  function varianteDoc(d, v) {
    if (!v || !d.comision || !d.comision.activa) return d;
    var dto = v === 'cliente' ? 0 : Number(d.comision.pct) || 0;
    return Object.assign({}, d, { partidas: d.partidas.map(function (p) { return Object.assign({}, p, { dto_pct: dto }); }) });
  }

  // ── Descargas ──
  function base64Blob(b64, tipo) { var bin = atob(b64), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: tipo }); }
  function descargar(blob, nombre) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); }
  function png(svg, anchoPx) {
    return new Promise(function (ok, ko) {
      var img = new Image();
      img.onload = function () {
        var k = anchoPx / img.width, c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        ok({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
      };
      img.onerror = function () { ko(new Error('No se ha podido dibujar el alzado para el Excel.')); };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    });
  }

  // ── Excel imprimible igual que el PDF ──
  // Misma rejilla que presupuesto-pdf.ts (pt): columnas con los anchos del PDF,
  // filas con sus alturas, márgenes = marco, saltos de página manuales y filas
  // de relleno hasta el final de cada página; marco y barra negra con bordes;
  // dibujos anclados (absolutos) al tamaño del PDF. Importes: los números
  // editables van en columnas ocultas (M–P) y lo visible es una fórmula que
  // escribe «6.373,52 €» igual en cualquier idioma del ordenador. Fuente Arial:
  // un .xlsx no admite fuente alternativa y Open Sans casi nunca está instalada
  // (LibreOffice la cambiaba por una con serifas); Arial está en Windows y Mac y
  // LibreOffice la sustituye por Liberation Sans, con las mismas medidas.
  var XL = {
    alto: 733.3,                                   // alto útil de página (842 − márgenes del marco)
    cols: [25.1, 44.2, 88, 81, 35, 32, 33, 47, 43, 58.5, 47, 25.1], // A–L en pt (17,7 → 576,6 del PDF)
    gris: 'FFF2F2F2', negro: 'FF000000'
  };
  function medidor() {
    var c = document.createElement('canvas').getContext('2d');
    return function (t, size, bold) { c.font = (bold ? '700 ' : '400 ') + size + 'px Arial, "Liberation Sans", Helvetica, sans-serif'; return c.measureText(t).width; };
  }
  function partirTexto(t, ancho, size, medir) {
    var out = [];
    String(t || '').split('\n').forEach(function (par) {
      if (!par.trim()) { out.push(''); return; }
      var linea = '';
      par.split(/\s+/).forEach(function (w) {
        var prueba = linea ? linea + ' ' + w : w;
        if (medir(prueba, size) > ancho && linea) { out.push(linea); linea = w; } else linea = prueba;
      });
      out.push(linea);
    });
    return out;
  }
  /** Fórmula que escribe el importe de la celda «ref» como 6.373,52 € sin depender del idioma de Excel. */
  function fEur(ref) {
    var c = 'ROUND(ABS(' + ref + ')*100,0)', e = 'INT(' + c + '/100)';
    return 'IF(' + ref + '<0,"-","")&IF(' + e + '>=1000000,INT(' + e + '/1000000)&"."&TEXT(MOD(INT(' + e + '/1000),1000),"000")&"."&TEXT(MOD(' + e + ',1000),"000"),' +
      'IF(' + e + '>=1000,INT(' + e + '/1000)&"."&TEXT(MOD(' + e + ',1000),"000"),' + e + '&""))&","&TEXT(MOD(' + c + ',100),"00")&" €"';
  }
  function fPct(ref) { return 'SUBSTITUTE(ROUND(' + ref + '*100,2)&"",".",",")&"%"'; }
  function eurTxt(n) { if (n === null || n === undefined) return 'PENDIENTE'; var p = Math.abs(n).toFixed(2).split('.'); return (n < 0 ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1] + ' €'; }
  function aDataUrl(url) {
    return fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { ok({ data: fr.result, tipo: b.type }); }; fr.readAsDataURL(b); });
    });
  }

  function excel(d, doc, proyecto, variante) {
    if (!window.ExcelJS) throw new Error('No se ha cargado el generador de Excel.');
    // Sin ningún descuento no se muestra la columna ni la línea «DTO. PROFESIONAL»
    var conDto = doc.partidas.some(function (p) { return Number(p.dto_pct) > 0; });
    var pl = d.plantilla, ivaPct = d.iva_pct == null ? 21 : Number(d.iva_pct), medir = medidor();
    var curino = pl.tipo === 'curino', acento = !curino && /^#[0-9a-f]{6}$/i.test(pl.color || '') ? 'FF' + pl.color.slice(1).toUpperCase() : XL.negro;
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet(('PRESUPUESTO ' + (doc.numero || '')).trim().slice(0, 31), {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
        margins: { left: 0.246, right: 0.246, top: 0.746, bottom: 0.764, header: 0, footer: 0 } }
    });
    ws.columns = XL.cols.map(function (pt) { return { width: Math.max(1, (pt * 96 / 72 - 5) / 7) }; })
      .concat([{ width: 12, hidden: true }, { width: 8, hidden: true }, { width: 12, hidden: true }, { width: 12, hidden: true }]);
    var F = { name: 'Arial', family: 2 };
    var fuente = function (o) { return Object.assign({}, F, { size: 7, color: { argb: 'FF000000' } }, o || {}); };
    var COL = 'ABCDEFGHIJKL';
    var fila = 0, enPagina = 0, iniPagina = 1, tareas = [], filasPartida = [];

    function nueva(h) { fila++; ws.getRow(fila).height = h; enPagina += h; return fila; }
    function texto(ref, v, o) {
      o = o || {};
      var c = ws.getCell(ref); c.value = v;
      c.font = fuente(o.font); c.alignment = Object.assign({ vertical: 'bottom', horizontal: 'left' }, o.al || {});
      return c;
    }
    function relleno(r, desde, hasta, argb) { for (var k = desde; k <= hasta; k++) ws.getCell(COL[k] + r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } }; }
    function linea(r, desde, hasta, lado, estilo) { for (var k = desde; k <= hasta; k++) { var c = ws.getCell(COL[k] + r); c.border = Object.assign({}, c.border || {}); c.border[lado] = { style: estilo || 'thin', color: { argb: XL.negro } }; } }
    /** Cierra la página: relleno hasta el alto útil, línea inferior, laterales del marco y salto. */
    function cerrarPagina(barraAbajo) {
      var resto = XL.alto - enPagina - (barraAbajo ? 4.7 : 0) - 0.6;
      while (resto > 0.5) { var h = Math.min(400, resto); nueva(h); resto -= h; }
      if (barraAbajo) { var rb = nueva(4.7); relleno(rb, 0, 11, acento); }
      else linea(fila, 0, 11, 'bottom', 'thin');
      for (var r = iniPagina; r <= fila; r++) { linea(r, 0, 0, 'left', 'thin'); linea(r, 11, 11, 'right', 'thin'); }
      ws.getRow(fila).addPageBreak();
      iniPagina = fila + 1; enPagina = 0;
    }
    function cabeceraTabla(primeraDePagina) {
      var r1 = nueva(10.2), r2 = nueva(10.2), g = { color: { argb: 'FF404040' } };
      if (primeraDePagina) linea(r1, 0, 11, 'top', 'thin');
      linea(r1, 1, 10, 'top', 'thin'); linea(r2, 1, 10, 'bottom', 'thin');
      [['B', 'CANTIDAD'], ['C', 'PRODUCTO'], ['D', 'MATERIAL Y GROSOR'], ['H', 'PRECIO'], ['I', 'PVP'], ['K', 'IMPORTE']].forEach(function (x) {
        ws.mergeCells(x[0] + r1 + ':' + x[0] + r2);
        texto(x[0] + r1, x[1], { font: g, al: { vertical: 'middle', horizontal: 'center' } });
      });
      ws.mergeCells('E' + r1 + ':G' + r1);
      texto('E' + r1, 'MEDIDAS EN CM', { font: g, al: { horizontal: 'center' } });
      if (conDto) texto('J' + r1, 'DTO.', { font: g, al: { horizontal: 'center' } });
      [['E', 'ANCHO'], ['F', 'ALTO'], ['G', 'FONDO']].forEach(function (x) { texto(x[0] + r2, x[1], { font: { size: 5.5, color: g.color }, al: { horizontal: 'center', vertical: 'top' } }); });
      if (conDto) texto('J' + r2, 'PROFESIONAL', { font: g, al: { horizontal: 'center', vertical: 'top' } });
      nueva(6);   // sin fila de «sección»
    }
    function png64(o) { return o.data.split(',')[1]; }
    /** Columna (con fracción) de una x en pt del PDF: la columna A empieza en 17,7 pt. */
    function colDe(xpt) { var x = xpt - 17.7; for (var k = 0; k < XL.cols.length; k++) { if (x < XL.cols[k]) return k + x / XL.cols[k]; x -= XL.cols[k]; } return XL.cols.length; }

    // ── Página 1: cabecera ──
    var rb = nueva(4.8); relleno(rb, 0, 11, acento);
    nueva(15.5);
    var rLogo = nueva(10);
    if (curino) tareas.push(png(d.logo, 400).then(function (im) { ws.addImage(wb.addImage({ base64: png64(im), extension: 'png' }), { tl: { col: 1, row: rLogo - 1 }, ext: { width: 101.5 * 96 / 72, height: 27 * 96 / 72 }, editAs: 'absolute' }); }));
    else if (d.logo_url) tareas.push(aDataUrl(d.logo_url).then(function (im) {
      return new Promise(function (ok) { var i = new Image(); i.onload = function () { var k = Math.min(150 / i.width, 34 / i.height); ws.addImage(wb.addImage({ base64: png64(im), extension: /png/.test(im.tipo) ? 'png' : 'jpeg' }), { tl: { col: 1, row: rLogo - 1 }, ext: { width: i.width * k * 96 / 72, height: i.height * k * 96 / 72 }, editAs: 'absolute' }); ok(); }; i.onerror = ok; i.src = im.data; });
    }));
    else texto('B' + rLogo, (pl.empresa || '').toUpperCase(), { font: { size: 16, bold: true } });
    var dir = [pl.direccion_1, pl.direccion_2, pl.email, pl.telefono].filter(Boolean);
    for (var k = 0; k < 4; k++) { var rr = k === 0 ? rLogo : nueva(10); if (dir[k]) texto('K' + rr, dir[k], { font: { size: 5.5, color: { argb: 'FF434343' } }, al: { horizontal: 'right' } }); }
    nueva(30);
    var rLema = nueva(12); if (pl.lema) texto('K' + rLema, pl.lema.toUpperCase(), { font: { size: 9.5, bold: true, color: { argb: acento } }, al: { horizontal: 'right' } });
    nueva(26);
    texto('B' + nueva(18), 'PRESUPUESTO', { font: { size: 13.5 } });
    var fc = doc.fecha.split('-'); texto('B' + nueva(11), Number(fc[2]) + '/' + Number(fc[1]) + '/' + fc[0], { font: { color: { argb: 'FF1D1E1E' } } });
    nueva(15);
    // Cliente (nombre, NIF y dirección de facturación), proyecto (y su dirección), n.º y validez
    var rEt = nueva(11), rVa = nueva(11), rVa2 = nueva(10), rVa3 = nueva(10);
    var gv = { size: 5.5, color: { argb: 'FF666666' } };
    [['B', 'CLIENTE', doc.atencion], ['D', 'PROYECTO', doc.proyecto], ['E', 'N.º DE PRESUPUESTO', doc.numero], ['J', 'VALIDEZ OFERTA', doc.validez]].forEach(function (c) {
      texto(c[0] + rEt, c[1], { font: { color: { argb: 'FF434343' } } });
      texto(c[0] + rVa, String(c[2] || '').toUpperCase(), { font: gv });
    });
    if (doc.cliente_nif) texto('B' + rVa2, ('NIF/CIF ' + doc.cliente_nif).toUpperCase(), { font: gv });
    if (doc.direccion_facturacion) texto('B' + rVa3, doc.direccion_facturacion.toUpperCase(), { font: gv });
    if (doc.proyecto_2) texto('D' + rVa2, doc.proyecto_2.toUpperCase(), { font: gv });
    nueva(223.1 - enPagina);

    // ── Partidas: una por página, caja gris y dibujo debajo ──
    doc.partidas.forEach(function (p, i) {
      if (i > 0) cabeceraTabla(true); else cabeceraTabla(false);
      var cuerpo = [p.subtitulo].concat(p.intro ? ['', p.intro] : []).concat(['', p.tecnico, '', p.materiales]).join('\n').replace(/\n{3,}/g, '\n\n');
      var lineas = 1 + partirTexto(cuerpo, 262, 7, medir).length;
      var alto = Math.min(409, lineas * 10.9 + 6);
      var r = nueva(alto);
      ws.mergeCells('C' + r + ':G' + r);
      var c = ws.getCell('C' + r);
      c.value = { richText: [{ text: p.titulo + '\n', font: fuente({ bold: true }) }, { text: cuerpo, font: fuente() }] };
      c.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
      relleno(r, 1, 10, XL.gris);
      var med = { vertical: 'middle' };
      texto('B' + r, p.cantidad, { al: { vertical: 'middle', horizontal: 'center' } });
      if (p.precio === null) {
        ['H', 'I', 'K'].forEach(function (q) { texto(q + r, 'PENDIENTE', { font: q === 'K' ? { bold: true } : q === 'I' ? { color: { argb: 'FF808080' } } : {}, al: { vertical: 'middle', horizontal: 'right' } }); });
      } else {
        ws.getCell('M' + r).value = p.precio;
        ws.getCell('O' + r).value = { formula: 'M' + r + '*B' + r, result: r2(p.precio * p.cantidad) };
        ws.getCell('P' + r).value = { formula: 'O' + r + '*(1-N' + r + ')', result: r2(p.precio * p.cantidad * (1 - p.dto_pct / 100)) };
        texto('H' + r, { formula: fEur('M' + r), result: eurTxt(p.precio) }, { al: { vertical: 'middle', horizontal: 'right' } });
        texto('I' + r, { formula: fEur('O' + r), result: eurTxt(r2(p.precio * p.cantidad)) }, { font: { color: { argb: 'FF808080' } }, al: { vertical: 'middle', horizontal: 'right' } });
        texto('K' + r, { formula: fEur('P' + r), result: eurTxt(r2(p.precio * p.cantidad * (1 - p.dto_pct / 100))) }, { font: { bold: true }, al: { vertical: 'middle', horizontal: 'right' } });
        filasPartida.push(r);
      }
      ws.getCell('N' + r).value = (p.dto_pct || 0) / 100;
      if (conDto) {
        texto('J' + r, { formula: fPct('N' + r), result: String(Math.round(p.dto_pct * 100) / 100).replace('.', ',') + '%' }, { al: med });
        ws.getCell('J' + r).alignment = { vertical: 'middle', horizontal: 'center' };
      }
      // Dibujos por filas a todo el ancho (interior + cerrado; sección + planta), igual que el PDF:
      // escala = la menor entre el ancho de la fila y su alto máximo; si no cabe, página nueva
      var FD = d.fila || { x0: 42.8, ancho: 508.7, alto: 380, separacion: 8 };
      var dibs = p.libre ? [] : d.dibujos.filter(function (x) { return x.codigo === (p.clave || p.codigo); });
      dibs.forEach(function (dib) {
        // Misma escala en todas las vistas del armario / cocina: la menor de su grupo (como grupoDibujo del servidor)
        var grupo = function (x) { return x.codigo.replace(/^((?:v\d+:)?[AC]\.\d+).*$/, '$1'); };
        var kk = d.dibujos.filter(function (x) { return grupo(x) === grupo(dib); }).reduce(function (m, x) { return Math.min(m, FD.ancho / x.ancho, FD.alto / x.alto); }, Infinity);
        var w = dib.ancho * kk, h = dib.alto * kk;
        if (enPagina + FD.separacion + h + 2 > XL.alto - 12) { cerrarPagina(false); linea(fila + 1, 0, 11, 'top', 'thin'); nueva(16); }
        nueva(FD.separacion);
        var rd = nueva(h + 2), tl = colDe(FD.x0 + (FD.ancho - w) / 2);
        tareas.push(png(dib.svg, 2000).then(function (im) {
          ws.addImage(wb.addImage({ base64: png64(im), extension: 'png' }), { tl: { col: tl, row: rd - 1 }, ext: { width: w * 96 / 72, height: h * 96 / 72 }, editAs: 'absolute' });
        }));
      });
      cerrarPagina(false);
    });

    // ── Última página: forma de pago, totales, condiciones y firmas ──
    linea(fila + 1, 0, 11, 'top', 'thin');
    nueva(48.5);
    var hayPend = doc.partidas.some(function (p) { return p.precio === null; });
    var sum = function (col) { return filasPartida.length ? 'SUM(' + filasPartida.map(function (r) { return col + r; }).join(',') + ')' : '0'; };
    var tot = { pvp: 0, imp: 0 };
    doc.partidas.forEach(function (p) { if (p.precio !== null) { tot.pvp += p.precio * p.cantidad; tot.imp += p.precio * p.cantidad * (1 - p.dto_pct / 100); } });
    tot.pvp = r2(tot.pvp); tot.imp = r2(tot.imp);
    var etq = function (r, t, bold) { ws.mergeCells('G' + r + ':J' + r); texto('G' + r, t, { font: bold ? { bold: true } : {}, al: { horizontal: 'right' } }); };
    var valor = function (r, ref, formula, res, o) {
      ws.getCell(ref).value = { formula: formula, result: res };
      texto('K' + r, hayPend ? 'PENDIENTE' : { formula: fEur(ref), result: eurTxt(res) }, Object.assign({ al: { horizontal: 'right' } }, o || {}));
    };
    var rFp = nueva(11);
    texto('B' + rFp, 'FORMA DE PAGO', { font: { bold: true } }); linea(rFp, 1, 10, 'bottom', 'thin');
    etq(rFp, 'PVP SIN IVA'); valor(rFp, 'O' + rFp, sum('O'), tot.pvp, { font: { size: 8, color: { argb: 'FF808080' } } });
    // Forma de pago del presupuesto (o la de la plantilla): concepto, % e importe con IVA (el último cuadra el total)
    var plazos = (doc.forma_pago && doc.forma_pago.length ? doc.forma_pago : pl.forma_pago) || [];
    var rows = [];
    for (var j = 0; j < Math.max(3, plazos.length); j++) rows.push(nueva(j === 2 ? 16 : 12));
    var totIva = r2(tot.imp * (1 + ivaPct / 100)), sumPct = plazos.reduce(function (s, x) { return s + Number(x.pct || 0); }, 0), acum = 0;
    ws.mergeCells('E' + rFp + ':F' + rFp); texto('E' + rFp, 'IMPORTE (IVA INCL.)', { font: { size: 5.5, color: { argb: 'FF434343' } }, al: { horizontal: 'right' } });
    plazos.forEach(function (fp, j) {
      ws.mergeCells('B' + rows[j] + ':C' + rows[j]); texto('B' + rows[j], (fp.concepto || '').toUpperCase());
      texto('D' + rows[j], String(fp.pct).replace('.', ',') + '%', { al: { horizontal: 'right' } });
      var imp = r2(totIva * Number(fp.pct || 0) / 100);
      if (j === plazos.length - 1 && Math.abs(sumPct - 100) < 0.001) imp = r2(totIva - acum);
      acum += imp;
      ws.mergeCells('E' + rows[j] + ':F' + rows[j]); texto('E' + rows[j], hayPend ? 'PENDIENTE' : eurTxt(imp), { al: { horizontal: 'right' } });
    });
    if (conDto) { etq(rows[1], 'DTO.  PROFESIONAL'); valor(rows[1], 'O' + rows[1], sum('P') + '-' + sum('O'), r2(tot.imp - tot.pvp), { font: { size: 8 } }); }
    etq(rows[2], 'IMPORTE TOTAL', true); valor(rows[2], 'O' + rows[2], sum('P'), tot.imp, { font: { size: 8, bold: true } });
    var rIva = nueva(14);
    if (pl.mostrar_iva) {
      etq(rIva, 'IVA (' + ivaPct + '%)'); valor(rIva, 'O' + rIva, 'O' + rows[2] + '*' + ivaPct / 100, r2(tot.imp * ivaPct / 100), { font: { size: 8 } });
      var rTc = nueva(14); etq(rTc, 'TOTAL CON IVA', true); valor(rTc, 'O' + rTc, 'O' + rows[2] + '+O' + rIva, r2(tot.imp * (1 + ivaPct / 100)), { font: { size: 8, bold: true } });
    } else texto('K' + rIva, 'IMPUESTOS IVA NO INCLUIDOS', { font: { size: 5.5 }, al: { horizontal: 'right', vertical: 'top' } });
    if (pl.iban) {
      var rT = nueva(12); texto('B' + rT, 'TRANSFERENCIA BANCARIA', { font: { bold: true } }); linea(rT, 1, 3, 'bottom', 'thin');
      ws.mergeCells('B' + nueva(12) + ':E' + fila); texto('B' + fila, pl.iban);
    }
    nueva(Math.max(8, 209.3 - enPagina));
    (pl.condiciones || '').split('\n').forEach(function (par) {
      var n = Math.max(1, partirTexto(par, 500, 7, medir).length), h = n * 10.4;
      if (enPagina + h > XL.alto - 8) { cerrarPagina(false); linea(fila + 1, 0, 11, 'top', 'thin'); nueva(20); }
      var r = nueva(h);
      ws.mergeCells('B' + r + ':K' + r);
      texto('B' + r, par, { font: /:\s*$/.test(par) ? {} : { color: { argb: 'FF808080' } }, al: { wrapText: true, vertical: 'top' } });
    });
    if (enPagina > XL.alto - 190) { cerrarPagina(false); linea(fila + 1, 0, 11, 'top', 'thin'); nueva(20); }
    nueva(30);
    if (pl.ciudad_firma) texto('B' + nueva(12), 'EN ' + pl.ciudad_firma.toUpperCase() + ' A,', { font: { size: 8, color: { argb: 'FF434343' } } });
    nueva(9);
    texto('B' + nueva(12), new Date(doc.fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), { font: { size: 7.5, bold: true, color: { argb: 'FF434343' } } });
    nueva(18);
    var rCli = nueva(12);
    texto('B' + rCli, 'CLIENTE', { font: { size: 8, bold: true, color: { argb: 'FF434343' } } });
    texto('H' + rCli, (pl.empresa || '').toUpperCase(), { font: { size: 8, bold: true, color: { argb: 'FF434343' } } });
    var der = [[pl.nif], [[pl.direccion_1, pl.direccion_2].filter(Boolean).join(' ')], [pl.cargo, true], [pl.firmante]].filter(function (x) { return x[0]; });
    var rAt = nueva(10.6); texto('B' + rAt, (doc.atencion || '').toUpperCase(), { font: { size: 6, color: { argb: 'FF434343' } } });
    der.forEach(function (x, j) { var r = j === 0 ? rAt : nueva(10.6); texto('H' + r, x[0], { font: { size: 6, bold: !!x[1], color: { argb: 'FF434343' } } }); });
    if (d.firma_url) {
      var rF = nueva(72);
      tareas.push(aDataUrl(d.firma_url).then(function (im) {
        return new Promise(function (ok) { var i = new Image(); i.onload = function () { var k = Math.min(145 / i.width, 67 / i.height); ws.addImage(wb.addImage({ base64: png64(im), extension: /png/.test(im.tipo) ? 'png' : 'jpeg' }), { tl: { col: 6 + 16 / 33, row: rF - 1 }, ext: { width: i.width * k * 96 / 72, height: i.height * k * 96 / 72 }, editAs: 'absolute' }); ok(); }; i.onerror = ok; i.src = im.data; });
      }));
    }
    cerrarPagina(true);
    ws.pageSetup.printArea = 'A1:L' + fila;

    return Promise.all(tareas).then(function () { return wb.xlsx.writeBuffer(); }).then(function (buf) {
      var tipo = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      var nombre = 'Presupuesto_' + (doc.numero || proyecto.nombre).replace(/[^\w-]+/g, '_') + (variante ? '_' + variante : '') + '.xlsx';
      var blob = new Blob([buf], { type: tipo });
      descargar(blob, nombre);
      // Se guarda también en «Documentos» del proyecto
      return (excel.guardar ? excel.guardar(blob, nombre, doc) : Promise.resolve()).then(function () { return 'Excel descargado y guardado en Documentos'; }, function () { return 'Excel descargado'; });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Tarifa
  // ════════════════════════════════════════════════════════════════
  var UN = { ml: '€/ml', ud: '€/ud', '%': '%' };
  function tarifa(el, ctx, de) {
    var mia = de === 'mia';
    el.innerHTML = '<section class="tf-card"><h2>' + (mia ? 'Mi tarifa' : 'Tarifa Curino (por defecto)') + '</h2>' +
      '<p class="pa-muted" style="font-size:12.5px;margin:0" id="tfNota">' + (mia ? '' : 'La usan los alumnos que no tengan tarifa propia.') + '</p>' +
      '<div id="tfConceptos"><p class="pa-muted">Cargando…</p></div>' +
      '<h3>Descuento e IVA</h3><table class="tf-tabla"><tbody>' +
      '<tr><td>Descuento profesional por defecto</td><td><input class="tf-in" id="tfDto" inputmode="decimal" placeholder="PENDIENTE"><span class="tf-u">%</span></td></tr>' +
      '<tr><td>IVA</td><td><input class="tf-in" id="tfIva" inputmode="decimal" placeholder="PENDIENTE"><span class="tf-u">%</span></td></tr></tbody></table>' +
      (mia ? '<h3>Tipos de coste</h3><p class="pa-muted" style="font-size:12px;margin:0 0 6px">Los que eliges en cada factura o presupuesto de proveedor. Uno por línea.</p><textarea id="tfTiposCoste" rows="6" style="width:100%;max-width:360px"></textarea>' : '') +
      (mia ? '<h3>Numeración de presupuestos</h3><table class="tf-tabla"><tbody><tr><td>Siguiente n.º base (proyecto nuevo)<br><span class="pa-muted" style="font-size:11.5px">El primer presupuesto de cada proyecto sale con este número y «-A» (Z2606964-A) y la serie avanza; los siguientes del proyecto, -B, -C… Vacío = el siguiente a tu número más alto.</span></td>' +
        '<td><input class="tf-in" id="tfSerie" style="width:120px;text-align:left" autocomplete="off"></td></tr></tbody></table>' : '') +
      '<div class="tf-pie"><button class="pa-btn primary" id="tfGuardar">Guardar tarifa</button><span id="tfMsg"></span></div></section>' +
      '<section class="tf-card" id="tfCocina"><p class="pa-muted">Cargando tarifa de cocinas…</p></section>';
    tarifaCocina($('#tfCocina'), ctx, mia);
    function msg(t, ok) { var m = $('#tfMsg'); m.className = ok ? 'tf-ok' : 'tf-err'; m.textContent = t; }
    function cargar() {
      return api(ctx, { action: 'tarifa', de: mia ? 'mia' : 'curino' }).then(function (d) {
        if (mia) $('#tfNota').textContent = d.propia ? 'Tu tarifa: con estos precios se calculan tus presupuestos.' : 'Ahora ves la tarifa Curino por defecto. Cambia lo que quieras y guarda: se convierte en tu tarifa.';
        var v = d.tarifa.valores, html = '', P = d.puntos, base = P.base, mios = d.tarifa.puntos || {};
        tfBase = base;
        // ── Armarios por puntos (tabla OTG 2026) ──
        var celda = function (k) {
          var val = mios[k] !== undefined ? mios[k] : base[k], mod = mios[k] !== undefined && mios[k] !== base[k];
          return '<td class="tf-pt' + (mod ? ' mod' : '') + '"><input class="tf-in" data-pk="' + k + '" inputmode="decimal" value="' + esc(numOut(val)) + '"><button type="button" class="tf-reset" data-reset="' + k + '" title="Restablecer al original (' + numOut(base[k]) + ')">↺</button></td>';
        };
        html += '<div class="tf-puntos"><div class="tf-puntos-cab"><h3 style="margin:0">Armarios por puntos <span class="pr-tag">' + esc(P.version) + '</span></h3>' +
          '<label class="tf-punto">Precio del punto <input class="tf-in" id="tfPunto" inputmode="decimal" placeholder="PENDIENTE" value="' + esc(numOut(d.tarifa.precio_punto)) + '"><span class="tf-u">€/punto</span></label>' +
          '<button type="button" class="pa-btn" id="tfResetTodo">Restablecer todo</button></div>' +
          '<p class="pa-muted" style="font-size:12.5px;margin:4px 0 10px">Precio = puntos × precio del punto. Si cambias un punto queda marcado como <b>modificado</b> y puedes volver al original con ↺. Tabla para altura 2600 mm y fondo 550 mm (650 con puertas), haya/maple 19/25 mm, trasera 10 mm. Ancho entre tramos → tramo superior; más de 1000 mm → se prolonga la tabla con la subida media de los 3 últimos escalones por cada 100 mm y se marca «fuera de tabla, valor extrapolado: revisar» (no bloquea el PDF; solo bloquean las líneas a 0 puntos).</p>';
        var cabAnchos = '<thead><tr><th></th>' + P.anchos.map(function (a) { return '<th>' + a + '</th>'; }).join('') + '</tr></thead>';
        html += '<h4>1 · Interiores por modelo (puntos por ancho de módulo, mm)</h4><div class="tf-scroll"><table class="tf-tabla tf-pts">' + cabAnchos + '<tbody>' +
          Object.keys(P.modelos).map(function (m) { return '<tr><td><b>' + esc(P.modelos[m].nombre) + '</b><br><span class="pa-muted" style="font-size:11px">' + esc(P.modelos[m].incluye) + '</span></td>' + P.anchos.map(function (a) { return celda(m + '_' + a); }).join('') + '</tr>'; }).join('') +
          '<tr><td>' + esc(P.sueltos.rinconero.nombre) + '</td>' + celda('rinconero') + '</tr></tbody></table></div>';
        html += '<h4>2 · Extras de interior</h4><div class="tf-scroll"><table class="tf-tabla tf-pts">' + cabAnchos + '<tbody>' +
          Object.keys(P.extras).map(function (k) { return '<tr><td>' + esc(P.extras[k].nombre) + '</td>' + P.anchos.map(function (a) { return celda(k + '_' + a); }).join('') + '</tr>'; }).join('') +
          '<tr><td>' + esc(P.sueltos.division.nombre) + '</td>' + celda('division') + '</tr>' +
          (P.sueltos.tapeta_cajonera ? '<tr><td>' + esc(P.sueltos.tapeta_cajonera.nombre) + ' <span class="pr-tag">revisar</span><br><span class="pa-muted" style="font-size:11px">No está en la tabla OTG: valor propio pendiente de confirmar</span></td>' + celda('tapeta_cajonera') + '</tr>' : '') +
          '</tbody></table></div>';
        // Puertas y herrajes
        html += '<div class="tf-dos-col"><div><h4>Puertas (por puerta hasta 2800 × 650 × 19 mm)</h4><p class="pa-muted" style="font-size:11.5px;margin:0 0 4px">Frente fijo = su material, sin bisagras. Más grande: proporcional al exceso de superficie («revisar»).</p><table class="tf-tabla tf-pts"><tbody>' +
          Object.keys(P.puertas || {}).map(function (k) { return '<tr><td>' + esc(P.puertas[k].nombre.replace('Puerta ', '')) + '</td>' + celda('puerta_' + k) + '</tr>'; }).join('') + '</tbody></table></div>' +
          '<div><h4>Herrajes y accesorios</h4><p class="pa-muted" style="font-size:11.5px;margin:0 0 4px">El uñero sustituye al tirador. Coplanar por juego de 2 puertas (impares, al juego superior).</p><table class="tf-tabla tf-pts"><tbody>' +
          Object.keys(P.herrajes || {}).map(function (k) { return '<tr><td>' + esc(P.herrajes[k].nombre) + '</td>' + celda(k) + '</tr>'; }).join('') + '</tbody></table></div></div>';
        html += '<div class="tf-dos-col"><div><h4>3 · Costados vistos (2800 × 650 × 19)</h4><table class="tf-tabla tf-pts"><tbody>' +
          Object.keys(P.costados).map(function (k) { return '<tr><td>' + esc(P.costados[k].nombre.replace('Costado visto ', '')) + '</td>' + celda('costado_' + k) + '</tr>'; }).join('') + '</tbody></table>' +
          '<h4>4 · Recargos (% sobre el interior)</h4><table class="tf-tabla tf-pts"><tbody>' +
          Object.keys(P.recargos).map(function (k) { return '<tr><td>' + esc(P.recargos[k].nombre) + '</td>' + celda('recargo_' + k) + '</tr>'; }).join('') + '</tbody></table></div>' +
          '<div><h4>5 · Remate armario (conjunto)</h4><table class="tf-tabla tf-pts"><thead><tr><th></th><th>Barniz</th><th>Lacado</th></tr></thead><tbody>' +
          P.remates.map(function (r) { return '<tr><td>Hasta ' + r.hasta + ' cm</td>' + celda('remate_' + r.hasta + '_barniz') + celda('remate_' + r.hasta + '_lacado') + '</tr>'; }).join('') + '</tbody></table></div></div></div>';
        if (d.conceptos.length) html += '<h3 style="margin-top:18px">En euros (aún no están en la tabla de puntos)</h3>';
        var grupos = {};
        d.conceptos.filter(function (c) { return c.clave.indexOf('cuerpo_') !== 0; }).forEach(function (c) { (grupos[c.grupo] = grupos[c.grupo] || []).push(c); });
        Object.keys(grupos).forEach(function (g) {
          html += '<h3>' + esc(g) + '</h3><table class="tf-tabla"><tbody>' + grupos[g].map(function (c) {
            return '<tr><td>' + esc(c.nombre) + (c.ayuda ? '<br><span class="pa-muted" style="font-size:11.5px">' + esc(c.ayuda) + '</span>' : '') +
              '</td><td style="white-space:nowrap"><input class="tf-in" data-k="' + c.clave + '" inputmode="decimal" placeholder="PENDIENTE" value="' + esc(numOut(v[c.clave])) + '"><span class="tf-u">' + UN[c.unidad] + '</span></td></tr>';
          }).join('') + '</tbody></table>';
        });
        $('#tfConceptos').innerHTML = html;
        $('#tfDto').value = numOut(d.tarifa.descuento_pct);
        if ($('#tfTiposCoste')) $('#tfTiposCoste').value = (d.tipos_coste && d.tipos_coste.length ? d.tipos_coste : d.tipos_coste_def || []).join('\n');
        if ($('#tfSerie') && d.serie) { $('#tfSerie').value = d.serie.guardada || ''; $('#tfSerie').placeholder = d.serie.auto || 'Z…'; }
        $('#tfIva').value = numOut(d.tarifa.iva_pct);
      });
    }
    var tfBase = {};
    // Marca «modificado» al teclear y ↺ / «Restablecer todo» vuelven al original (se aplica al guardar)
    el.addEventListener('input', function (e) {
      var k = e.target.dataset && e.target.dataset.pk; if (!k) return;
      e.target.closest('td').classList.toggle('mod', numIn(e.target.value) !== tfBase[k]);
    });
    el.addEventListener('click', function (e) {
      var r = e.target.closest('[data-reset]');
      if (r) { var i = el.querySelector('[data-pk="' + r.dataset.reset + '"]'); i.value = numOut(tfBase[r.dataset.reset]); i.closest('td').classList.remove('mod'); msg('Restablecido · pulsa «Guardar tarifa» para aplicarlo', true); return; }
      if (e.target.id === 'tfResetTodo') { el.querySelectorAll('[data-pk]').forEach(function (i) { i.value = numOut(tfBase[i.dataset.pk]); i.closest('td').classList.remove('mod'); }); msg('Tabla original restablecida · pulsa «Guardar tarifa» para aplicarlo', true); }
    });
    $('#tfGuardar').addEventListener('click', function () {
      var valores = {};
      document.querySelectorAll('#tfConceptos [data-k]').forEach(function (i) { valores[i.dataset.k] = i.value.trim() === '' ? null : i.value.trim(); });
      var puntos = {};
      document.querySelectorAll('#tfConceptos [data-pk]').forEach(function (i) { var n = numIn(i.value); if (n !== null) puntos[i.dataset.pk] = n; });
      api(ctx, { action: 'tarifa_guardar', de: mia ? 'mia' : 'curino', valores: valores, descuento_pct: $('#tfDto').value, iva_pct: $('#tfIva').value, precio_punto: $('#tfPunto') ? $('#tfPunto').value : null, puntos: puntos, serie_presupuesto: $('#tfSerie') ? $('#tfSerie').value : undefined, tipos_coste: $('#tfTiposCoste') ? $('#tfTiposCoste').value.split('\n') : undefined })
        .then(function (d) { msg('Guardada' + (d.cambiados ? ' · ' + d.cambiados + ' puntos modificados' : '') + (d.pendientes ? ' · ' + d.pendientes + ' conceptos PENDIENTE' : ''), true); return cargar(); })
        .catch(function (e) { msg(e.message); });
    });
    cargar();
  }

  // ── Tarifa de cocinas: puntos (€ del proveedor al alza) y precio del punto cocina propio ──
  var TIPO_COC = { bajo: 'Módulo bajo', horno: 'Horno', fregadero: 'Fregadero', esquinero: 'Esquinero bajo (93 × 93)', alto: 'Módulo alto', esquinero_alto: 'Esquinero alto (63 × 63)', columna: 'Columna universal', columna_hm: 'Columna horno + micro (sin medida)', sobrenevera: 'Sobrenevera', transversal: 'Transversal', lateral_bajo: 'Lateral bajo (366 × 58)', lateral_alto: 'Lateral alto (366 × 33)' };
  var ACAB_COC = { blanco16: 'Blanco 16', gris_plomo16: 'Gris plomo 16', blanco_plus18: 'Blanco Plus 18 hidrófugo' };
  function tarifaCocina(el, ctx, mia) {
    var base = {}, revisar = {};
    function msg(t, ok) { var m = el.querySelector('#tcMsg'); if (m) { m.className = ok ? 'tf-ok' : 'tf-err'; m.textContent = t; } }
    function cargar() {
      return api(ctx, { action: 'tarifa_cocina', de: mia ? 'mia' : 'curino' }).then(function (d) {
        var T = d.tarifa, mios = d.puntos || {};
        base = T.base; revisar = T.revisar;
        var eur = function (v) { return v === null || v === undefined ? '' : String(v.toFixed(2)).replace('.', ','); };
        var celda = function (k) {
          if (base[k] === undefined) return '<td class="tf-pt tc-sin" title="Sin precio en la tarifa">—</td>';
          var val = mios[k] !== undefined ? mios[k] : base[k], mod = mios[k] !== undefined && mios[k] !== base[k];
          return '<td class="tf-pt' + (mod ? ' mod' : '') + (revisar[k] ? ' tc-rev' : '') + '"' + (revisar[k] ? ' title="Revisar: ' + esc(revisar[k]) + '"' : '') + '><input class="tf-in" data-ck="' + k + '" inputmode="decimal" value="' + esc(numOut(val)) + '"><button type="button" class="tf-reset" data-creset="' + k + '" title="Restablecer al original (' + numOut(base[k]) + ')">↺</button></td>';
        };
        var fila1 = function (nombre, k, extra) { return '<tr><td>' + nombre + (extra ? '<br><span class="pa-muted" style="font-size:11px">' + extra + '</span>' : '') + '</td>' + celda(k) + '</tr>'; };
        var h = '<div class="tf-puntos-cab"><h2 style="margin:0">Cocinas por puntos <span class="pr-tag">' + esc(T.proveedor) + ' · ' + T.fecha.split('-').reverse().join('/') + '</span></h2>' +
          '<label class="tf-punto">Precio del punto cocina <input class="tf-in" id="tcPunto" inputmode="decimal" placeholder="PENDIENTE" value="' + esc(numOut(d.precio_punto)) + '"><span class="tf-u">€/punto</span></label>' +
          '<button type="button" class="pa-btn" id="tcResetTodo">Restablecer todo</button></div>' +
          '<p class="pa-muted" style="font-size:12.5px;margin:4px 0 10px">Independiente del precio del punto de armarios. Puntos = € de coste de la tarifa del proveedor redondeados al alza (39,64 € → 40). Precio = puntos × precio del punto cocina (vacío = PENDIENTE: el presupuesto muestra los puntos pero no el importe). Medida entre escalones → el siguiente hacia arriba con precio; por encima del último → «fuera de tarifa – revisar». Celdas <span class="tc-rev-leyenda">en ámbar</span> = dudas del PDF pendientes del proveedor (salen con aviso).</p>';
        // 1 · Cuerpos: una tabla por tipo (filas alto · acabado, columnas anchos)
        var porTipo = {};
        T.modulos.forEach(function (m) { (porTipo[m.tipo] = porTipo[m.tipo] || []).push(m); });
        h += '<details class="tc-sec" open><summary>1 · Módulos (cuerpos) · p1</summary>';
        Object.keys(porTipo).forEach(function (tipo) {
          var ms = porTipo[tipo], anchos = [], filas = {};
          ms.forEach(function (m) { if (m.ancho !== null && anchos.indexOf(m.ancho) < 0) anchos.push(m.ancho); var f = (m.alto === null ? '' : m.alto + ' alto · ') + ACAB_COC[m.acabado]; (filas[f] = filas[f] || {})[m.ancho === null ? '-' : m.ancho] = m.clave; });
          anchos.sort(function (a, b) { return a - b; });
          var cols = anchos.length ? anchos : ['-'];
          h += '<h4>' + esc(TIPO_COC[tipo] || tipo) + '</h4><div class="tf-scroll"><table class="tf-tabla tf-pts"><thead><tr><th></th>' + cols.map(function (a) { return '<th>' + (a === '-' ? 'pieza' : a) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            Object.keys(filas).map(function (f) { return '<tr><td>' + esc(f) + '</td>' + cols.map(function (a) { var k = filas[f][a]; return k ? celda(k) : '<td class="tf-pt tc-sin">—</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        });
        h += '</details>';
        // 2 · Puertas por grupo (alto × ancho)
        h += '<details class="tc-sec"><summary>2 · Puertas por grupo (alto × ancho, cm) · p4–6</summary>';
        T.puertas.grupos.forEach(function (g) {
          var srv = T.servicio.filter(function (x) { return x.grupo === g; }).map(function (x) { return x.linea + ' (' + x.acabado + ', ' + x.grueso + ' mm)'; }).join(' · ');
          h += '<details class="tc-sub"><summary>Grupo ' + g + (g === 12 || g === 14 ? ' · uñero' : g === 10 ? ' · 4 cantos' : '') + (srv ? ' <span class="pa-muted" style="font-weight:400">— ' + esc(srv) + '</span>' : '') + '</summary><div class="tf-scroll"><table class="tf-tabla tf-pts"><thead><tr><th>alto \\ ancho</th>' +
            T.puertas.anchos.map(function (a) { return '<th>' + a + '</th>'; }).join('') + '</tr></thead><tbody>' +
            T.puertas.altos.map(function (a) { return '<tr><td>' + String(a).replace('.', ',') + '</td>' + T.puertas.anchos.map(function (w) { return celda('puerta_g' + g + '_' + String(a).replace('.', '_') + 'x' + w); }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
        });
        h += '</details>';
        // 3 · Encimeras, 4 · Cajones, 5 · Herrajes
        h += '<details class="tc-sec"><summary>3 · Encimeras de compacto (por placa) · p2</summary><table class="tf-tabla tf-pts"><tbody>' +
          T.encimeras.map(function (e) { return fila1('<b>' + esc(e.ref) + '</b>', e.clave, 'Núcleo ' + ({ negro: 'negro', al_tono: 'al tono', blanco: 'blanco' })[e.nucleo] + ' · ' + e.medida + ' mm · ' + eur(e.eur) + ' €'); }).join('') + '</tbody></table></details>';
        h += '<details class="tc-sec"><summary>4 · Cajones Advänced y Legrabox · p2</summary><table class="tf-tabla tf-pts"><tbody>' +
          T.cajones.map(function (c) { return fila1(esc(c.nombre), c.clave, eur(c.eur) + ' €'); }).join('') + '</tbody></table></details>';
        h += '<details class="tc-sec"><summary>5 · Herrajes, cubos y Aventos · p2</summary><table class="tf-tabla tf-pts"><tbody>' +
          T.herrajes.map(function (x) { return x.eur === null ? '<tr><td>' + esc(x.codigo + ' · ' + x.articulo) + '<br><span class="pa-muted" style="font-size:11px">sin precio en la tarifa – revisar</span></td><td class="tf-pt tc-sin">—</td></tr>' : fila1(esc(x.codigo + ' · ' + x.articulo), x.clave, eur(x.eur) + ' €'); }).join('') + '</tbody></table></details>';
        h += '<details class="tc-sec"><summary>6 · Tableros por grupo (puntos por m²) · p3</summary><table class="tf-tabla tf-pts"><tbody>' +
          T.tableros.map(function (t) { var info = (t.grupo ? 'Grupo ' + t.grupo : 'Sin grupo') + ' · ' + t.calidad + (t.grueso ? ' · ' + String(t.grueso).replace('.', ',') + ' mm' : ''); return t.eur === null ? '<tr><td>' + esc(t.descripcion) + '<br><span class="pa-muted" style="font-size:11px">' + esc(info) + ' · sin precio – revisar</span></td><td class="tf-pt tc-sin">—</td></tr>' : fila1(esc(t.descripcion), t.clave, esc(info) + ' · ' + eur(t.eur) + ' €/m²'); }).join('') + '</tbody></table></details>';
        h += '<h4>Del Estudio (no están en la tarifa del proveedor)</h4><p class="pa-muted" style="font-size:11.5px;margin:0 0 4px">Tiradores como en armarios (no se cobran con uñero) y zócalo por metro lineal de bajos y columnas.</p><table class="tf-tabla tf-pts"><tbody>' +
          T.extras.map(function (x) { return fila1(esc(x.nombre), x.clave); }).join('') + '</tbody></table>';
        h += '<details class="tc-sec"><summary>Dudas del PDF pendientes del proveedor (' + T.dudas.length + ')</summary><ul class="tc-dudas">' + T.dudas.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></details>';
        h += '<div class="tf-pie"><button class="pa-btn primary" id="tcGuardar">Guardar tarifa de cocinas</button><span id="tcMsg"></span></div>';
        el.innerHTML = h;
      }).catch(function (e) { el.innerHTML = '<p class="tf-err">' + esc(e.message) + '</p>'; });
    }
    el.addEventListener('input', function (e) {
      var k = e.target.dataset && e.target.dataset.ck; if (!k) return;
      e.target.closest('td').classList.toggle('mod', numIn(e.target.value) !== base[k]);
    });
    el.addEventListener('click', function (e) {
      var r = e.target.closest('[data-creset]');
      if (r) { var i = el.querySelector('[data-ck="' + r.dataset.creset + '"]'); i.value = numOut(base[r.dataset.creset]); i.closest('td').classList.remove('mod'); msg('Restablecido · pulsa «Guardar tarifa de cocinas» para aplicarlo', true); return; }
      if (e.target.id === 'tcResetTodo') { el.querySelectorAll('[data-ck]').forEach(function (i) { i.value = numOut(base[i.dataset.ck]); i.closest('td').classList.remove('mod'); }); msg('Tarifa original restablecida · pulsa «Guardar tarifa de cocinas» para aplicarlo', true); return; }
      if (e.target.id === 'tcGuardar') {
        var puntos = {};
        el.querySelectorAll('[data-ck]').forEach(function (i) { var n = numIn(i.value); if (n !== null) puntos[i.dataset.ck] = n; });
        e.target.disabled = true;
        api(ctx, { action: 'tarifa_cocina_guardar', de: mia ? 'mia' : 'curino', precio_punto: el.querySelector('#tcPunto').value, puntos: puntos })
          .then(function (d) { return cargar().then(function () { msg('Guardada' + (d.cambiados ? ' · ' + d.cambiados + ' puntos modificados' : '') + (d.pendiente ? ' · precio del punto cocina PENDIENTE' : ''), true); }); })
          .catch(function (err) { msg(err.message); }).then(function () { var b = el.querySelector('#tcGuardar'); if (b) b.disabled = false; });
      }
    });
    cargar();
  }

  // ════════════════════════════════════════════════════════════════
  // Datos del emisor y plantilla
  // ════════════════════════════════════════════════════════════════
  var CAMPOS = { plEmpresa: 'empresa', plNif: 'nif', plDir1: 'direccion_1', plDir2: 'direccion_2', plEmail: 'email', plTel: 'telefono', plLema: 'lema', plIban: 'iban', plFirmante: 'firmante', plCargo: 'cargo', plCiudad: 'ciudad_firma', plColor: 'color', plCondiciones: 'condiciones' };
  function plantilla(el, ctx) {
    var alumno = ctx.modo === 'alumno', supa = ctx.supa, rutas = { logo: null, firma: null };
    var req = function (t) { return '<label' + (alumno ? ' class="tf-req"' : '') + '>' + t + '</label>'; };
    el.innerHTML = '<section class="tf-card tf-f"><h2>' + (alumno ? 'Mis datos y plantilla' : 'Mi plantilla de presupuesto') + '</h2>' +
      '<p class="pa-muted" style="font-size:12.5px;margin:0">' + (alumno
        ? 'Tus presupuestos salen con estos datos: tu empresa, tu NIF, tu IBAN y tu firma. Los campos con * son obligatorios para descargar.'
        : 'Desde la cuenta de admin los presupuestos salen con los datos de SISTEMA &amp; CURINO. Los alumnos siempre con los suyos.') + '</p>' +
      '<div class="eu-faltan" id="plFaltan" hidden></div>' +
      '<label>Estilo</label><select id="plTipo"><option value="curino">' + (alumno ? 'Plantilla Curino (maquetación Curino con tus datos)' : 'Plantilla Curino (logo &amp; CURINO)') + '</option><option value="propia">Propia (tu logo y tu color)</option></select>' +
      '<div class="tf-dos">' +
      '<div>' + req('Empresa') + '<input type="text" id="plEmpresa" maxlength="80"></div>' +
      '<div>' + req('NIF / CIF') + '<input type="text" id="plNif" maxlength="20"></div>' +
      '<div>' + req('Dirección (línea 1)') + '<input type="text" id="plDir1" maxlength="80"></div>' +
      '<div>' + req('Código postal y ciudad') + '<input type="text" id="plDir2" maxlength="80"></div>' +
      '<div>' + req('Email') + '<input type="email" id="plEmail" maxlength="80"></div>' +
      '<div>' + req('Teléfono') + '<input type="text" id="plTel" maxlength="30"></div>' +
      '<div><label>Lema</label><input type="text" id="plLema" maxlength="50"></div>' +
      '<div>' + req('IBAN') + '<input type="text" id="plIban" maxlength="40" autocomplete="off"></div>' +
      '<div>' + req('Firmante') + '<input type="text" id="plFirmante" maxlength="80"></div>' +
      '<div><label>Cargo</label><input type="text" id="plCargo" maxlength="60"></div>' +
      '<div><label>Ciudad de firma</label><input type="text" id="plCiudad" maxlength="40"></div>' +
      '<div><label>Color (plantilla propia)</label><input type="text" id="plColor" maxlength="7" placeholder="#1d1d1b"></div></div>' +
      '<label><input type="checkbox" id="plIva"> Mostrar IVA y total con IVA (si no: «IMPUESTOS IVA NO INCLUIDOS»)</label>' +
      req('Forma de pago') + '<div id="plFp"></div><button type="button" class="pa-btn" id="plFpMas">+ Plazo</button>' +
      req('Condiciones (las líneas que acaban en «:» son títulos)') + '<textarea id="plCondiciones" style="min-height:180px"></textarea>' +
      '<label>Logo (plantilla propia) · PNG o JPG</label><div class="tf-img"><img id="plLogoVer" alt="" hidden><input type="file" id="plLogo" accept="image/png,image/jpeg"></div>' +
      req('Firma · PNG o JPG (mejor con fondo transparente)') + '<div class="tf-img"><img id="plFirmaVer" alt="" hidden><input type="file" id="plFirma" accept="image/png,image/jpeg"></div>' +
      '<div class="tf-pie"><button class="pa-btn primary" id="plGuardar">Guardar ' + (alumno ? 'mis datos' : 'plantilla') + '</button><span id="plMsg"></span></div></section>';

    function msg(t, ok) { var m = $('#plMsg'); m.className = ok ? 'tf-ok' : 'tf-err'; m.textContent = t; }
    function ver(sel, url) { var i = $(sel); i.hidden = !url; if (url) i.src = url; }
    function pintarFp(fp) {
      $('#plFp').innerHTML = fp.map(function (x) {
        return '<div class="tf-fp"><input type="text" class="fpC" value="' + esc(x.concepto) + '" maxlength="40"><input type="text" class="fpP tf-in" value="' + esc(numOut(x.pct)) + '" inputmode="decimal"><button type="button" class="pa-btn fpX" title="Quitar">×</button></div>';
      }).join('');
    }
    function leerFp() {
      return Array.prototype.map.call(document.querySelectorAll('#plFp .tf-fp'), function (r) { return { concepto: r.querySelector('.fpC').value, pct: r.querySelector('.fpP').value.replace(',', '.') }; });
    }
    function cargar() {
      return Promise.all([api(ctx, { action: 'plantilla' }), alumno ? api(ctx, { action: 'yo' }) : Promise.resolve(null)]).then(function (rs) {
        var d = rs[0], yo = rs[1], p = d.plantilla;
        Object.keys(CAMPOS).forEach(function (id) { $('#' + id).value = p[CAMPOS[id]] || ''; });
        $('#plTipo').value = p.tipo; $('#plIva').checked = !!p.mostrar_iva;
        rutas.logo = p.logo_path; rutas.firma = p.firma_path;
        ver('#plLogoVer', d.logo_url); ver('#plFirmaVer', d.firma_url);
        pintarFp(p.forma_pago || []);
        // Cuenta propia de Curino en el área de alumnos: emite como SISTEMA & CURINO
        if (alumno && d.emisor_curino) el.querySelector('.tf-f > p.pa-muted').innerHTML = 'Esta cuenta emite los presupuestos con los datos de SISTEMA &amp; CURINO.';
        var f = $('#plFaltan');
        if (alumno && yo && yo.faltan.length) { f.hidden = false; f.textContent = 'Para descargar presupuestos te falta: ' + yo.faltan.join(', ') + '.'; }
        else if (!alumno && !p.iban) { f.hidden = false; f.textContent = 'Falta el IBAN: sin él, el presupuesto sale sin el bloque «Transferencia bancaria».'; }
        else f.hidden = true;
      });
    }
    $('#plFpMas').addEventListener('click', function () { var fp = leerFp(); fp.push({ concepto: '', pct: '' }); pintarFp(fp); });
    $('#plFp').addEventListener('click', function (e) { if (e.target.classList.contains('fpX')) e.target.closest('.tf-fp').remove(); });
    function subir(campo, input) {
      var f = input.files && input.files[0];
      if (!f) return Promise.resolve();
      return api(ctx, { action: 'plantilla_subida', campo: campo, tipo: f.type, bytes: f.size }).then(function (d) {
        return supa.storage.from('estudio').uploadToSignedUrl(d.path, d.token, f, { contentType: f.type }).then(function (r) {
          if (r.error) throw new Error('No se ha podido subir la imagen.');
          rutas[campo] = d.path;
        });
      });
    }
    $('#plGuardar').addEventListener('click', function () {
      var b = $('#plGuardar'); b.disabled = true;
      subir('logo', $('#plLogo')).then(function () { return subir('firma', $('#plFirma')); }).then(function () {
        var datos = { tipo: $('#plTipo').value, mostrar_iva: $('#plIva').checked, forma_pago: leerFp(), logo_path: rutas.logo, firma_path: rutas.firma };
        Object.keys(CAMPOS).forEach(function (id) { datos[CAMPOS[id]] = $('#' + id).value; });
        return api(ctx, { action: 'plantilla_guardar', datos: datos });
      }).then(function () {
        $('#plLogo').value = ''; $('#plFirma').value = '';
        msg(alumno ? 'Datos guardados' : 'Plantilla guardada', true);
        if (ctx.alCambiar) ctx.alCambiar();
        return cargar();
      }).catch(function (e) { msg(e.message); }).then(function () { b.disabled = false; });
    });
    cargar();
  }


  // ════════════════════════════════════════════════════════════════
  // Mi negocio
  // ════════════════════════════════════════════════════════════════
  var ESTADOS = [['borrador', 'Borrador'], ['enviado', 'Enviado'], ['aceptado', 'Aceptado'], ['rechazado', 'Rechazado']];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  // Miles con punto también en 4 cifras (toLocaleString('es-ES') no agrupa 2450)
  var eur0 = function (n) { return n === null || n === undefined ? '—' : (n < 0 ? '-' : '') + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €'; };
  function selectEstado(pid, estado, prid) {
    return '<select class="ng-estado ng-e-' + estado + '" data-pid="' + pid + '"' + (prid ? ' data-prid="' + prid + '"' : '') + ' data-estado="' + estado + '">' + ESTADOS.map(function (e) { return '<option value="' + e[0] + '"' + (e[0] === estado ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select>';
  }
  function cambiarEstado(ctx, sel, despues, extra) {
    var antes = sel.dataset.estado || (sel.className.match(/ng-e-(\w+)/) || [])[1] || 'borrador';
    sel.disabled = true;
    api(ctx, Object.assign({ action: 'presupuesto_estado', proyecto_id: sel.dataset.pid, presupuesto_id: sel.dataset.prid || undefined, estado: sel.value }, extra || {}))
      .then(function () { sel.className = 'ng-estado ng-e-' + sel.value; sel.dataset.estado = sel.value; sel.disabled = false; if (despues) despues(); })
      .catch(function (e) {
        sel.disabled = false;
        // Aceptar exige la fecha prevista de montaje: ventana obligatoria
        if (e.datos && e.datos.falta_montaje) return pedirMontaje(function (f) { cambiarEstado(ctx, sel, despues, { montaje_previsto: f }); }, function () { sel.value = antes; });
        alert(e.message); sel.value = antes;
      });
  }
  /** Ventana modal: fecha prevista de montaje (obligatoria para aceptar). */
  function pedirMontaje(ok, cancelar) {
    var m = document.createElement('div');
    m.className = 'eu-modal';
    m.innerHTML = '<form class="eu-modal-caja"><h2>Fecha prevista de montaje</h2><p class="pa-muted" style="font-size:13px;margin:4px 0 12px">Para aceptar el presupuesto, indica cuándo está previsto el montaje. Aparecerá en el calendario de «Mi negocio».</p>' +
      '<input type="date" required id="euMontaje"><div class="eu-modal-bot"><button type="button" class="pa-btn" id="euCancelar">Cancelar</button><button class="pa-btn primary" type="submit">Aceptar presupuesto</button></div></form>';
    document.body.appendChild(m);
    var inp = m.querySelector('#euMontaje'); inp.focus();
    m.querySelector('#euCancelar').addEventListener('click', function () { m.remove(); if (cancelar) cancelar(); });
    m.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); if (!inp.value) return; m.remove(); ok(inp.value); });
  }
  /** Gráfica de barras (presupuestado vs aceptado) de los últimos 12 meses, en SVG. */
  function grafica(serie) {
    var W = 1000, H = 250, izq = 64, abajo = 28, arriba = 12;
    var max = Math.max.apply(null, serie.map(function (m) { return Math.max(m.presupuestado, m.aceptado, m.margen || 0); }).concat([0]));
    if (!(max > 0)) return '<div class="ng-vacio">Cuando marques presupuestos como enviados o aceptados verás aquí su evolución mes a mes.</div>';
    // Tope «redondo» para que las 4 divisiones salgan en cifras limpias
    var bruto = max / 4, p10 = Math.pow(10, Math.floor(Math.log10(bruto)));
    var paso = [1, 2, 2.5, 5, 10].map(function (k) { return k * p10; }).filter(function (v) { return v >= bruto; })[0];
    var tope = paso * 4;
    var hUtil = H - abajo - arriba, wCol = (W - izq) / serie.length, wBar = Math.min(20, wCol / 4);
    var y = function (v) { return arriba + hUtil - (v / tope) * hUtil; };
    var g = '';
    for (var i = 0; i <= 4; i++) {
      var v = (tope / 4) * i, yy = y(v);
      g += '<line x1="' + izq + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" stroke="#ece9e2"/>' +
        '<text x="' + (izq - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + eur0(v) + '</text>';
    }
    serie.forEach(function (m, k) {
      var cx = izq + wCol * k + wCol / 2;
      var mg = Math.max(0, m.margen || 0), tMg = 'Margen ' + eur0(m.margen || 0) + (m.margen_pct != null ? ' (' + String(m.margen_pct).replace('.', ',') + ' %)' : ' · sin proyectos con costes');
      g += '<rect x="' + (cx - 1.5 * wBar - 2) + '" y="' + y(m.presupuestado) + '" width="' + wBar + '" height="' + (y(0) - y(m.presupuestado)) + '" fill="#d9d3c8" rx="2"><title>Presupuestado ' + eur0(m.presupuestado) + '</title></rect>' +
        '<rect x="' + (cx - 0.5 * wBar) + '" y="' + y(m.aceptado) + '" width="' + wBar + '" height="' + (y(0) - y(m.aceptado)) + '" fill="#161616" rx="2"><title>Aceptado ' + eur0(m.aceptado) + '</title></rect>' +
        '<rect x="' + (cx + 0.5 * wBar + 2) + '" y="' + y(mg) + '" width="' + wBar + '" height="' + (y(0) - y(mg)) + '" fill="#12B76A" rx="2"><title>' + tMg + '</title></rect>' +
        '<text x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle">' + MESES[Number(m.mes.slice(5)) - 1] + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ng-graf" role="img" aria-label="Presupuestado y aceptado por mes">' + g + '</svg>';
  }
  /** Calendario de montajes: vista mes (flechas) o lista + aceptados sin fecha. */
  var calEstado = { mes: null, vista: 'mes' };
  function calendario(el, ctx, items, recargar) {
    if (!el) return;
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var hoyIso = hoy.toLocaleDateString('sv-SE');
    if (!calEstado.mes) calEstado.mes = hoyIso.slice(0, 7);
    var dias = function (f) { return Math.round((new Date(f + 'T00:00:00') - hoy) / 86400000); };
    var conFecha = items.filter(function (p) { return p.montaje_previsto; });
    var sinFecha = items.filter(function (p) { return !p.montaje_previsto && !p.montado; });
    // Una entrada por presupuesto aceptado (varios por proyecto: fases, extras)
    var nom = function (p) { return esc(p.nombre) + (p.presupuesto ? ' <small class="ng-cal-pr">' + esc(p.presupuesto) + '</small>' : ''); };
    var clave = function (p) { return p.presupuesto_id || p.id; };
    var clase = function (p) { var d = dias(p.montaje_previsto); return p.montado ? 'montado' : d >= 0 && d <= 7 ? 'prox' : d < 0 ? 'atrasado' : ''; };
    var chip = function (p) {
      return '<a class="ng-cal-it ' + clase(p) + '" href="' + ctx.rutas.estudio(p.id, 'resumen') + '" title="' + esc(p.nombre) + ' · ' + eur0(p.importe) + ' · ' + (p.cobro === 'cobrado' ? 'cobrado' : 'pendiente de cobro') + (p.montado ? ' · montado' : '') + '">' +
        '<b>' + nom(p) + '</b><span>' + eur0(p.importe) + ' · <i class="ng-cobro ' + p.cobro + '">' + (p.cobro === 'cobrado' ? 'cobrado' : 'pendiente') + '</i></span></a>';
    };
    var y = Number(calEstado.mes.slice(0, 4)), mo = Number(calEstado.mes.slice(5)) - 1;
    var NOMBRES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var cab = '<div class="ng-card-cab"><h2>Calendario de montajes</h2><span class="ng-cal-ctl">' +
      (calEstado.vista === 'mes' ? '<button class="pa-btn" data-cal="prev" aria-label="Mes anterior">‹</button><b class="ng-cal-mes">' + NOMBRES[mo] + ' ' + y + '</b><button class="pa-btn" data-cal="next" aria-label="Mes siguiente">›</button><button class="pa-btn" data-cal="hoy">Hoy</button>' : '') +
      '<button class="pa-btn' + (calEstado.vista === 'mes' ? ' on' : '') + '" data-cal="vmes">Mes</button><button class="pa-btn' + (calEstado.vista === 'lista' ? ' on' : '') + '" data-cal="vlista">Lista</button></span></div>' +
      '<p class="ng-cal-ley"><i class="prox"></i>Montaje en 7 días o menos <i class="atrasado"></i>Fecha pasada sin montar <i class="montado"></i>Montado</p>';
    var cuerpo = '';
    if (calEstado.vista === 'mes') {
      var primero = new Date(y, mo, 1), off = (primero.getDay() + 6) % 7, nd = new Date(y, mo + 1, 0).getDate();
      cuerpo = '<div class="ng-cal"><div class="ng-cal-dow">' + ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="ng-cal-grid">';
      for (var i = 0; i < off; i++) cuerpo += '<div class="ng-cal-dia vacio"></div>';
      for (var d = 1; d <= nd; d++) {
        var iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var del = conFecha.filter(function (p) { return p.montaje_previsto === iso; });
        cuerpo += '<div class="ng-cal-dia' + (iso === hoyIso ? ' hoy' : '') + '"><span class="ng-cal-n">' + d + '</span>' + del.map(chip).join('') + '</div>';
      }
      cuerpo += '</div></div>';
    } else {
      var orden = conFecha.slice().sort(function (a, b) { return a.montaje_previsto.localeCompare(b.montaje_previsto); });
      cuerpo = orden.length ? '<ul class="ng-lista ng-cal-lista">' + orden.map(function (p) {
        var dd = dias(p.montaje_previsto);
        return '<li class="' + clase(p) + '"><span class="ng-cal-fecha">' + new Date(p.montaje_previsto + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span><div><a href="' + ctx.rutas.estudio(p.id, 'resumen') + '"><strong>' + nom(p) + '</strong></a><small>' + (p.montado ? 'montado' : dd === 0 ? 'hoy' : dd > 0 ? 'en ' + dd + (dd === 1 ? ' día' : ' días') : 'hace ' + (-dd) + (dd === -1 ? ' día' : ' días') + ', sin marcar como montado') + '</small></div>' +
          '<span class="ng-imp">' + eur0(p.importe) + '</span><i class="ng-cobro ' + p.cobro + '">' + (p.cobro === 'cobrado' ? 'cobrado' : 'pendiente') + '</i></li>';
      }).join('') + '</ul>' : '<p class="pa-muted">Aún no hay montajes con fecha.</p>';
    }
    var sin = '<h3 class="dc-grupo">Aceptados sin fecha de montaje' + (sinFecha.length ? ' (' + sinFecha.length + ')' : '') + '</h3>' + (sinFecha.length ? '<ul class="ng-lista">' + sinFecha.map(function (p) {
      return '<li><div><a href="' + ctx.rutas.estudio(p.id, 'resumen') + '"><strong>' + nom(p) + '</strong></a><small>' + eur0(p.importe) + ' · ' + (p.cobro === 'cobrado' ? 'cobrado' : 'pendiente de cobro') + '</small></div>' +
        '<span class="ng-cal-poner"><input type="date" data-mfecha="' + clave(p) + '"><button class="pa-btn" data-mguardar="' + clave(p) + '" data-mpid="' + p.id + '" data-mprid="' + (p.presupuesto_id || '') + '">Guardar</button><button class="pa-btn" data-mmontado="' + clave(p) + '" data-mpid="' + p.id + '" data-mprid="' + (p.presupuesto_id || '') + '" title="Ya está montado">Montado</button></span></li>';
    }).join('') + '</ul>' : '<p class="pa-muted" style="margin:4px 0 0">Todos los aceptados tienen fecha de montaje o están montados.</p>');
    el.innerHTML = cab + cuerpo + sin;
    el.onclick = function (e) {
      var b = e.target.closest('[data-cal]');
      if (b) {
        var k = b.dataset.cal, dt = new Date(y, mo, 1);
        if (k === 'prev') dt.setMonth(mo - 1); else if (k === 'next') dt.setMonth(mo + 1); else if (k === 'hoy') dt = new Date();
        if (k === 'vmes') calEstado.vista = 'mes'; else if (k === 'vlista') calEstado.vista = 'lista'; else calEstado.mes = dt.toLocaleDateString('sv-SE').slice(0, 7);
        return calendario(el, ctx, items, recargar);
      }
      var g = e.target.closest('[data-mguardar]'), mt = e.target.closest('[data-mmontado]');
      if (g) {
        var f = el.querySelector('[data-mfecha="' + g.dataset.mguardar + '"]').value;
        if (!f) return alert('Elige la fecha prevista de montaje.');
        api(ctx, { action: 'proyecto_montaje', proyecto_id: g.dataset.mpid, presupuesto_id: g.dataset.mprid || undefined, montaje_previsto: f }).then(recargar).catch(function (err) { alert(err.message); });
      }
      if (mt) {
        var fr = el.querySelector('[data-mfecha="' + mt.dataset.mmontado + '"]').value;
        api(ctx, { action: 'proyecto_montaje', proyecto_id: mt.dataset.mpid, presupuesto_id: mt.dataset.mprid || undefined, montado: true, montado_at: fr || undefined }).then(recargar).catch(function (err) { alert(err.message); });
      }
    };
  }
  function negocio(el, ctx, opts) {
    opts = opts || {};
    var admin = !!opts.agregado, periodo = 'anio', clavePer = 'estudio-periodo';
    // Recordar el último periodo elegido (por usuario y navegador)
    try { var guardado = localStorage.getItem(clavePer + ':' + (ctx.usuario || '')); if (['mes', 'trimestre', 'anio', 'todo'].indexOf(guardado) >= 0) periodo = guardado; } catch (e) { /* sin almacenamiento */ }
    el.innerHTML = '<div class="ng"><div class="ng-cab"><h1>' + (admin ? 'Negocio de los alumnos' : 'Mi negocio') + '</h1>' +
      '<div class="ng-periodos">' + [['mes', 'Mes'], ['trimestre', 'Trimestre'], ['anio', 'Año'], ['todo', 'Todo']].map(function (p) { return '<button data-per="' + p[0] + '"' + (p[0] === periodo ? ' class="on"' : '') + (p[0] === 'anio' ? ' title="Últimos 12 meses"' : '') + '>' + p[1] + '</button>'; }).join('') + '</div></div>' +
      '<div id="ngCuerpo"><p class="pa-muted">Cargando…</p></div></div>';
    el.querySelector('.ng-periodos').addEventListener('click', function (e) {
      var b = e.target.closest('[data-per]'); if (!b) return;
      periodo = b.dataset.per;
      try { localStorage.setItem(clavePer + ':' + (ctx.usuario || ''), periodo); } catch (err) { /* sin almacenamiento */ }
      el.querySelectorAll('.ng-periodos button').forEach(function (x) { x.classList.toggle('on', x === b); });
      cargar();
    });
    el.addEventListener('change', function (e) { if (e.target.classList.contains('ng-estado')) cambiarEstado(ctx, e.target, cargar); });
    function kpi(etq, valor, sub, fuerte) { return '<div class="ng-kpi' + (fuerte ? ' fuerte' : '') + '"><span>' + etq + '</span><b>' + valor + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
    function cargar() {
      var piden = [api(ctx, { action: admin ? 'admin_negocio' : 'negocio', periodo: periodo })];
      if (!admin) piden.push(api(ctx, { action: 'yo' }).catch(function () { return null; }));
      return Promise.all(piden).then(function (rs) {
        var m = rs[0], yo = rs[1], c = yo && yo.credito;
        var viejo = m.pendientes.length ? m.pendientes[0].dias : null;
        var html = '<div class="ng-kpis">' +
          kpi('Ventas · aceptado', eur0(m.ventas), m.aceptados + (m.aceptados === 1 ? ' presupuesto' : ' presupuestos'), true) +
          kpi('Presupuestado', eur0(m.presupuestado), m.enviados + (m.enviados === 1 ? ' enviado' : ' enviados')) +
          kpi('Tasa de cierre', m.tasa_cierre === null ? '—' : String(m.tasa_cierre).replace('.', ',') + ' %', 'aceptados / enviados') +
          kpi('Ticket medio', eur0(m.ticket_medio), 'por venta') +
          kpi('Proyectos creados', String(m.proyectos), admin ? (m.alumnos_con_actividad + ' alumnos con actividad') : '') +
          kpi('Pendientes de respuesta', String(m.pendientes.length), viejo !== null ? 'el más antiguo, hace ' + viejo + (viejo === 1 ? ' día' : ' días') : 'ninguno') +
          (c ? (c.ilimitado ? kpi('Créditos', 'Ilimitados', cr(c.gastados) + ' gastados este mes') : kpi('Créditos del mes', cr(c.restantes), 'de ' + cr(c.mes) + (c.saldo > 0 ? ' · +' + cr(c.saldo) + ' de packs' : ''))) : '') +
          '</div>';
        // Rentabilidad real: solo proyectos con margen fiable (facturación y todos los costes con importe)
        var r = m.real;
        if (r) {
          html += '<div class="ng-card"><div class="ng-card-cab"><h2>Rentabilidad real</h2><span class="pa-muted" style="font-size:12px">Proyectos aceptados o facturados en el periodo · sin IVA</span></div>' +
            '<div class="ng-kpis ng-kpis-in">' + kpi('Facturación', eur0(r.facturacion), '') + kpi('Costes', eur0(r.costes), 'proveedores y costes manuales') +
            kpi('Margen bruto', eur0(r.margen), r.margen_pct === null ? 'añade costes en cada proyecto' : String(r.margen_pct).replace('.', ',') + ' %', false) + '</div>' +
            '<p class="pa-muted ng-fiable">Calculado con ' + r.n_fiables + ' de ' + r.n_aceptados + ' proyectos aceptados · ' + r.n_incompletos + ' sin costes completos</p></div>';
        }
        html += '<div class="ng-card"><div class="ng-card-cab"><h2>Evolución mensual</h2><span class="ng-ley"><i style="background:#d9d3c8"></i>Presupuestado <i style="background:#161616"></i>Aceptado <i style="background:#12B76A"></i>Margen</span></div>' + grafica(m.serie) + '</div>';
        if (!admin) html += '<div class="ng-card" id="ngCal"></div>';
        var lista = function (titulo, filas, conDias) {
          return '<div class="ng-card"><h2>' + titulo + '</h2>' + (filas.length ? '<ul class="ng-lista">' + filas.map(function (f) {
            return '<li><div><strong>' + esc(f.cliente || '—') + '</strong><small>' + (f.numero ? esc(f.numero) + ' · ' : '') + (conDias ? 'enviado hace ' + f.dias + (f.dias === 1 ? ' día' : ' días') : new Date(f.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })) + '</small></div>' +
              '<span class="ng-imp">' + eur0(f.importe) + '</span>' + (admin ? '<span class="ng-tag ng-e-' + f.estado + '">' + f.estado + '</span>' : selectEstado(f.proyecto_id, f.estado)) + '</li>';
          }).join('') + '</ul>' : '<p class="pa-muted" style="margin:6px 0 0">' + (conDias ? 'Nada pendiente de respuesta.' : 'Aún no hay presupuestos.') + '</p>') + '</div>';
        };
        // Seguimiento: enviados que pasarán solos a «rechazado» en los próximos 15 días
        if (m.caducan && m.caducan.length) {
          html += '<div class="ng-card ng-aviso"><h2>Caducan en los próximos 15 días</h2><p class="pa-muted" style="margin:2px 0 8px;font-size:12.5px">Un presupuesto enviado pasa a «rechazado» a los ' + (m.dias_caducidad || 90) + ' días sin respuesta. Haz seguimiento antes de perderlos.</p><ul class="ng-lista">' + m.caducan.map(function (f) {
            return '<li><div><strong>' + esc(f.cliente || '—') + '</strong><small>' + (f.numero ? esc(f.numero) + ' · ' : '') + (f.quedan === 0 ? 'caduca hoy' : 'caduca en ' + f.quedan + (f.quedan === 1 ? ' día' : ' días')) + '</small></div>' +
              '<span class="ng-imp">' + eur0(f.importe) + '</span>' + (admin ? '<span class="ng-tag ng-e-enviado">enviado</span>' : selectEstado(f.proyecto_id, f.estado)) + '</li>';
          }).join('') + '</ul></div>';
        }
        html += '<div class="ng-dos">' + lista('Pendientes de respuesta', m.pendientes, true) + lista('Últimos presupuestos', m.ultimos, false) + '</div>';
        var fin = '';   // «Proyectos por margen» al final de la página
        if (r) {
          var filaR = function (x, i, incompleto) {
            var bajo = x.margen_pct !== null && x.margen_pct < 30;
            return '<li><span class="ng-pos">' + (incompleto ? '·' : i + 1) + '</span><div><strong>' + esc(x.cliente) + '</strong><small>' + (x.alumno ? esc(x.alumno) + ' · ' : '') + 'facturación ' + eur0(x.facturacion) + ' · costes ' + eur0(x.costes) + (incompleto ? ' · ' + esc(x.motivo) : '') + '</small></div>' +
              (incompleto ? '<span class="ng-tag ng-e-borrador">incompleto</span>' : '<span class="ng-imp">' + eur0(x.margen) + '</span><span class="ng-tag ' + (bajo ? 'ng-e-rechazado' : 'ng-e-aceptado') + '">' + String(x.margen_pct).replace('.', ',') + ' %</span>') + '</li>';
          };
          fin = '<div class="ng-card"><div class="ng-card-cab"><h2>Proyectos por margen</h2><span class="pa-muted" style="font-size:12px">Solo proyectos con todos los costes con importe</span></div>' +
            (r.ranking.length ? '<ul class="ng-lista">' + r.ranking.map(function (x, i) { return filaR(x, i, false); }).join('') + '</ul>' : '<p class="pa-muted" style="margin:4px 0 0">Aún no hay proyectos con margen fiable en el periodo.</p>') +
            (r.incompletos && r.incompletos.length ? '<h3 class="dc-grupo">Margen incompleto (' + r.incompletos.length + ')</h3><p class="ng-aviso-txt">Faltan costes o importes: su margen no es real y no cuenta en la rentabilidad. Añade las facturas de proveedor o los costes en cada proyecto.</p><ul class="ng-lista ng-incompletos">' +
              r.incompletos.map(function (x, i) { return filaR(x, i, true); }).join('') + '</ul>' : '') + '</div>';
        }
        if (admin && m.alumnos) {
          html += '<div class="ng-card"><h2>Por alumno</h2>' + (m.alumnos.length ? '<div style="overflow-x:auto"><table class="ng-tabla"><thead><tr><th>Alumno</th><th>Proyectos</th><th>Enviados</th><th>Presupuestado</th><th>Aceptados</th><th>Ventas</th><th>Cierre</th><th>Pendientes</th></tr></thead><tbody>' +
            m.alumnos.map(function (a) { return '<tr><td>' + esc(a.email) + '</td><td>' + a.proyectos + '</td><td>' + a.enviados + '</td><td>' + eur0(a.presupuestado) + '</td><td>' + a.aceptados + '</td><td><b>' + eur0(a.ventas) + '</b></td><td>' + (a.tasa_cierre === null ? '—' : String(a.tasa_cierre).replace('.', ',') + ' %') + '</td><td>' + a.pendientes + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '<p class="pa-muted">Sin actividad de alumnos en el periodo.</p>') + '</div>';
        }
        html += fin;
        el.querySelector('#ngCuerpo').innerHTML = html;
        if (!admin) calendario(el.querySelector('#ngCal'), ctx, m.calendario || [], cargar);
      }).catch(function (e) { el.querySelector('#ngCuerpo').innerHTML = '<p class="tf-err">' + esc(e.message) + '</p>'; });
    }
    var cr = function (n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
    cargar();
  }

  // ════════════════════════════════════════════════════════════════
  // Créditos y plan (Stripe)
  // ════════════════════════════════════════════════════════════════
  function creditos(el, ctx, opts) {
    opts = opts || {};
    var cr = function (n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
    var eur = function (n) { return Number(n).toLocaleString('es-ES', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €'; };
    var dia = function (d) { return d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'; };
    el.innerHTML = '<div class="ng"><div class="ng-cab"><h1>Créditos y plan</h1></div>' + (opts.ok ? '<div class="ng-ok">Pago recibido. Los créditos o el plan aparecen aquí en unos segundos (recarga si no los ves).</div>' : '') + '<div id="crCuerpo"><p class="pa-muted">Cargando…</p></div></div>';
    function ir(accion, extra) {
      return function (e) {
        e.target.disabled = true;
        api(ctx, Object.assign({ action: accion }, extra || {})).then(function (d) { location.href = d.url; })
          .catch(function (err) { alert(err.message); e.target.disabled = false; });
      };
    }
    api(ctx, { action: 'creditos' }).then(function (d) {
      var c = d.credito, s = d.suscripcion, vigente = s && ['active', 'trialing', 'past_due'].indexOf(s.estado) >= 0;
      var pct = c && c.mes > 0 ? Math.min(100, Math.round(100 * c.gastados / c.mes)) : 0;
      var html = '<div class="ng-dos">';
      html += '<div class="ng-card"><h2>Tus créditos</h2>' + (c
        ? '<p class="cr-grande">' + cr(c.restantes) + ' <small>de ' + cr(c.mes) + ' créditos este mes</small></p><div class="cr-barra"><span style="width:' + pct + '%"></span></div>' +
          '<p class="pa-muted" style="font-size:12.5px">Se renuevan el día 1 de cada mes.</p>'
        : '<p class="pa-muted">Sin créditos mensuales.</p>') +
        '<p class="cr-saldo">Créditos de packs: <b>' + cr(d.saldo) + '</b> <small>· no caducan; se usan cuando se acaban los del mes</small></p>' +
        '<p class="cr-ref">Referencia: ≈ 5–10 créditos por proyecto completo (plano, cambios y textos del presupuesto).</p>' +
        (d.acceso && d.acceso.hasta ? '<p class="pa-muted" style="font-size:12.5px;margin:6px 0 0">Acceso al Estudio ' + (d.acceso.activo ? 'hasta el ' : 'terminó el ') + dia(d.acceso.hasta) + '</p>' : '') + '</div>';
      html += '<div class="ng-card cr-plan"><h2>Plan mensual</h2><p class="cr-grande">' + eur(d.plan.eur) + ' <small>/ mes, IVA incluido</small></p>' +
        '<ul class="cr-inc"><li>Acceso al Estudio cuando termine el incluido en tu curso</li><li>' + cr(d.plan.creditos) + ' créditos cada mes (no se acumulan)</li><li>Cancela cuando quieras</li></ul>' +
        (vigente
          ? '<p class="ng-ok" style="margin:8px 0">' + (s.cancel_at_period_end ? 'Se cancela el ' + dia(s.current_period_end) : 'Activo · se renueva el ' + dia(s.current_period_end)) + (s.estado === 'past_due' ? ' · <b>pago pendiente</b>' : '') + '</p><button class="pa-btn" id="crPortal">Gestionar mi suscripción</button>'
          : '<button class="pa-btn primary cr-btn" id="crPlan">Suscribirme</button>') + '</div></div>';
      if (d.packs.length && (!d.acceso || d.acceso.activo)) {
        html += '<div class="ng-card"><h2>Packs de créditos</h2><p class="pa-muted" style="font-size:12.5px;margin:0 0 10px">Pago único, IVA incluido. Se suman a tus créditos y no caducan.</p><div class="cr-packs">' +
          d.packs.map(function (p) { return '<div class="cr-pack"><b>' + eur(p.eur) + '</b><span>' + cr(p.creditos) + ' créditos</span><button class="pa-btn primary" data-pack="' + esc(p.id) + '">Comprar</button></div>'; }).join('') + '</div></div>';
      }
      if (d.compras.length) {
        html += '<div class="ng-card"><div class="ng-card-cab"><h2>Mis compras</h2><button class="pa-btn" id="crPortal2">Facturas y tarjeta</button></div><ul class="ng-lista">' + d.compras.map(function (x) {
          return '<li><div><strong>' + (x.tipo === 'pack' ? 'Pack de ' + cr(x.creditos) + ' créditos' : 'Plan mensual') + '</strong><small>' + dia(x.created_at) + (x.invoice_number ? ' · factura ' + esc(x.invoice_number) : '') + '</small></div><span class="ng-imp">' + eur(x.importe_cents / 100) + '</span>' + (x.estado === 'reembolsada' ? '<span class="ng-tag ng-e-rechazado">reembolsada</span>' : '') + '</li>';
        }).join('') + '</ul></div>';
      }
      html += '<p class="pa-muted" style="font-size:12px">Precios con IVA incluido. Pago seguro con Stripe; la factura te llega por email. Al comprar aceptas las <a href="/partners/condiciones/#estudio" target="_blank">condiciones del Estudio</a>.</p>';
      var cuerpo = el.querySelector('#crCuerpo');
      cuerpo.innerHTML = html;
      var b = cuerpo.querySelector('#crPlan'); if (b) b.addEventListener('click', ir('comprar_plan'));
      ['#crPortal', '#crPortal2'].forEach(function (q) { var x = cuerpo.querySelector(q); if (x) x.addEventListener('click', ir('portal')); });
      cuerpo.querySelectorAll('[data-pack]').forEach(function (x) { x.addEventListener('click', ir('comprar_pack', { pack_id: x.dataset.pack })); });
    }).catch(function (e) { el.querySelector('#crCuerpo').innerHTML = '<p class="tf-err">' + esc(e.message) + '</p>'; });
  }

  window.EstudioUI = { proyectos: proyectos, presupuesto: presupuesto, tarifa: tarifa, plantilla: plantilla, negocio: negocio, creditos: creditos, api: api };
})();
