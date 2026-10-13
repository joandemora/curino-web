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
    return esc(e.message);
  }

  // ════════════════════════════════════════════════════════════════
  // Proyectos + chat
  // ════════════════════════════════════════════════════════════════
  function proyectos(el, ctx, pidInicial) {
    var supa = ctx.supa, lista = [], actual = null, versiones = [], viendo = 0, ocupado = false;
    el.innerHTML =
      '<div class="es-grid">' +
      '<aside class="es-card"><form class="es-form" id="esNuevo" autocomplete="off"><strong style="font-size:13px">Nuevo proyecto</strong>' +
      '<input id="esNombre" placeholder="Cliente o proyecto" maxlength="80" required><input id="esRef" placeholder="Referencia (opcional)" maxlength="40">' +
      '<button class="pa-btn primary" type="submit" style="width:100%;margin-top:4px">Crear</button></form>' +
      '<ul class="es-lista" id="esLista"><li class="pa-muted">Cargando…</li></ul></aside>' +
      '<section><div class="es-card" id="esZona"><div class="es-vacio">Crea un proyecto o elige uno de la lista.</div></div></section>' +
      '<aside class="es-card es-chat" id="esChat" hidden><div class="es-msgs" id="esMsgs"></div>' +
      '<form class="es-compose" id="esForm"><textarea id="esTexto" placeholder="Describe el armario o pide un cambio: «el módulo 2 con 4 cajones», «altillo de 40»…" maxlength="4000"></textarea>' +
      '<div class="es-fila"><label class="pa-btn" style="cursor:pointer">📎 Plano<input type="file" id="esArchivos" accept="application/pdf,image/jpeg,image/png,image/webp" multiple hidden></label>' +
      '<span class="es-adj" id="esAdj"></span><button class="pa-btn primary" type="submit" id="esEnviar">Enviar</button></div>' +
      '<div class="es-error" id="esError" hidden></div></form></aside></div>';

    function alertaError(t, html) { var e = $('#esError'); e[html ? 'innerHTML' : 'textContent'] = t; e.hidden = !t; }

    function cargarLista() {
      // RLS: el alumno ve solo los suyos; admin ve todos (aquí, solo los propios)
      return supa.auth.getUser().then(function (u) {
        var q = supa.from('estudio_proyectos').select('id, nombre, referencia, version_actual, updated_at').order('updated_at', { ascending: false });
        if (u.data && u.data.user) q = q.eq('user_id', u.data.user.id);
        return q;
      }).then(function (r) {
        lista = r.data || [];
        $('#esLista').innerHTML = lista.length ? lista.map(function (p) {
          return '<li data-id="' + p.id + '"' + (actual && actual.id === p.id ? ' class="on"' : '') + '>' + esc(p.nombre) +
            '<small>' + (p.referencia ? esc(p.referencia) + ' · ' : '') + (p.version_actual ? 'v' + p.version_actual : 'sin versión') + ' · ' + fecha(p.updated_at) + '</small></li>';
        }).join('') : '<li class="pa-muted">Aún no hay proyectos.</li>';
      });
    }
    $('#esLista').addEventListener('click', function (e) { var li = e.target.closest('li[data-id]'); if (li) abrir(li.dataset.id); });
    $('#esNuevo').addEventListener('submit', function (e) {
      e.preventDefault();
      api(ctx, { action: 'crear', nombre: $('#esNombre').value, referencia: $('#esRef').value }).then(function (d) {
        $('#esNombre').value = ''; $('#esRef').value = '';
        actual = d.proyecto;
        return cargarLista().then(function () { abrir(d.proyecto.id); });
      }).catch(function (err) { alert(err.message); });
    });

    function abrir(id) {
      if (ctx.alAbrir) ctx.alAbrir(id);
      return Promise.all([
        supa.from('estudio_proyectos').select('*').eq('id', id).maybeSingle(),
        supa.from('estudio_versiones').select('numero, origen, nota, created_at').eq('proyecto_id', id).order('numero'),
        supa.from('estudio_mensajes').select('rol, texto, version, pregunta, created_at').eq('proyecto_id', id).order('created_at')
      ]).then(function (rs) {
        actual = rs[0].data; versiones = rs[1].data || [];
        if (!actual) return;
        $('#esChat').hidden = false;
        document.querySelectorAll('#esLista li').forEach(function (li) { li.classList.toggle('on', li.dataset.id === id); });
        pintarChat(rs[2].data || []);
        viendo = actual.version_actual;
        pintarZona();
        if (viendo) cargarVersion(viendo);
      });
    }

    function pintarZona(svgs) {
      var p = actual;
      var chips = versiones.map(function (v) {
        return '<button type="button" class="es-v' + (v.numero === viendo ? ' on' : '') + (v.numero === p.version_actual ? ' actual' : '') +
          '" data-v="' + v.numero + '" title="' + esc((v.origen === 'ia' ? 'IA · ' : '') + (v.nota || '') + ' · ' + fecha(v.created_at)) + '">v' + v.numero + '</button>';
      }).join('');
      var acciones = viendo ? '<a class="pa-btn primary" href="' + ctx.rutas.presupuesto(p.id) + '">Presupuesto</a> <button type="button" class="pa-btn" id="esPdf">Descargar alzados v' + viendo + '</button>' : '';
      if (viendo && viendo !== p.version_actual) acciones = '<button type="button" class="pa-btn primary" id="esRestaurar">Volver a v' + viendo + '</button> ' + acciones;
      acciones += ' <button type="button" class="pa-btn" id="esBorrar">Borrar</button>';
      $('#esZona').innerHTML =
        '<div class="es-cab"><div><h2>' + esc(p.nombre) + (p.referencia ? ' <span class="pa-muted" style="font-weight:400">· ' + esc(p.referencia) + '</span>' : '') + '</h2>' +
        '<div class="es-versiones">' + (chips || '<span class="pa-muted" style="font-size:12.5px">Sin versiones todavía</span>') + '</div></div>' +
        '<div class="pa-btns">' + acciones + '</div></div>' +
        '<div class="es-hojas" id="esHojas">' + (svgs ? svgs.map(function (s) { return '<div class="es-hoja" title="' + esc(s.codigo) + '">' + s.svg + '</div>'; }).join('')
          : '<div class="es-vacio">' + (viendo ? 'Cargando alzados…' : 'Sube un plano o describe el armario en el chat y Claude preparará la primera versión.') + '</div>') + '</div>';
    }

    $('#esZona').addEventListener('click', function (e) {
      var hoja = e.target.closest('.es-hoja');
      if (hoja) {
        var url = URL.createObjectURL(new Blob(['<!DOCTYPE html><meta charset="utf-8"><title>' + esc(hoja.title) + '</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet"><body style="margin:0;background:#888">' + hoja.innerHTML.replace('<svg ', '<svg style="display:block;width:100%;height:auto;background:#fff" ') + '</body>'], { type: 'text/html' }));
        window.open(url, '_blank');
        return;
      }
      var v = e.target.closest('[data-v]');
      if (v) { viendo = Number(v.dataset.v); pintarZona(); cargarVersion(viendo); return; }
      if (e.target.id === 'esPdf') return descargarAlzados(e.target);
      if (e.target.id === 'esRestaurar') {
        e.target.disabled = true;
        return api(ctx, { action: 'restaurar', proyecto_id: actual.id, numero: viendo }).then(function () { return abrir(actual.id); }).then(cargarLista)
          .catch(function (err) { alertaError(err.message); });
      }
      if (e.target.id === 'esBorrar') {
        if (!e.target.dataset.ok) { e.target.dataset.ok = '1'; e.target.textContent = '¿Seguro? Pulsa otra vez'; e.target.classList.add('primary'); return; }
        return api(ctx, { action: 'borrar', proyecto_id: actual.id }).then(function () {
          actual = null; if (ctx.alAbrir) ctx.alAbrir(null);
          $('#esChat').hidden = true;
          $('#esZona').innerHTML = '<div class="es-vacio">Proyecto borrado.</div>';
          return cargarLista();
        }).catch(function (err) { alertaError(err.message); });
      }
    });

    function cargarVersion(n) {
      return api(ctx, { action: 'render', proyecto_id: actual.id, numero: n }).then(function (d) { if (viendo === n) pintarZona(d.svgs); })
        .catch(function (err) { $('#esHojas').innerHTML = '<div class="es-vacio">' + esc(err.message) + '</div>'; });
    }
    function descargarAlzados(btn) {
      btn.disabled = true;
      api(ctx, { action: 'pdf', proyecto_id: actual.id, numero: viendo }).then(function (d) {
        descargar(base64Blob(d.base64, 'application/pdf'), d.nombre);
      }).catch(function (err) { alertaError(err.message); }).then(function () { btn.disabled = false; });
    }

    function pintarChat(msgs) {
      $('#esMsgs').innerHTML = msgs.length ? msgs.map(burbuja).join('')
        : '<div class="es-vacio" style="padding:20px 6px">Adjunta un plano (PDF o foto) y cuéntale lo que quieres: medidas del hueco, alto, fondo, puertas, interior…</div>';
      $('#esMsgs').scrollTop = 1e9;
    }
    function burbuja(m) {
      var meta = [];
      if (m.version) meta.push('<a href="#" data-ir="' + m.version + '">v' + m.version + '</a>');
      if (m.uso && ctx.modo === 'admin') meta.push(Number(m.uso.tokens.entrada + m.uso.tokens.salida + m.uso.tokens.cache_escritura + m.uso.tokens.cache_lectura).toLocaleString('es-ES') + ' tokens · ' + String(m.uso.coste_usd).replace('.', ',') + ' $');
      if (m.created_at) meta.push(fecha(m.created_at));
      return '<div class="es-msg ' + m.rol + (m.pregunta ? ' pregunta' : '') + '">' + esc(m.texto) + (meta.length ? '<span class="es-meta">' + meta.join(' · ') + '</span>' : '') + '</div>';
    }
    $('#esMsgs').addEventListener('click', function (e) {
      var a = e.target.closest('[data-ir]'); if (!a) return;
      e.preventDefault(); viendo = Number(a.dataset.ir); pintarZona(); cargarVersion(viendo);
    });
    $('#esArchivos').addEventListener('change', function () {
      $('#esAdj').textContent = Array.prototype.map.call(this.files, function (f) { return f.name; }).join(', ');
    });

    $('#esForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (ocupado || !actual) return;
      var texto = $('#esTexto').value.trim();
      var archivos = Array.prototype.slice.call($('#esArchivos').files || []);
      if (!texto && !archivos.length) return;
      ocupado = true; alertaError('');
      $('#esEnviar').disabled = true;
      var msgs = $('#esMsgs');
      if (msgs.querySelector('.es-vacio')) msgs.innerHTML = '';
      msgs.insertAdjacentHTML('beforeend', burbuja({ rol: 'usuario', texto: texto + (archivos.length ? '\n📎 ' + archivos.map(function (f) { return f.name; }).join(', ') : '') }) +
        '<div class="es-trabajando" id="esTrab">Subiendo…</div>');
      msgs.scrollTop = 1e9;
      var ids = [];
      var subir = archivos.reduce(function (p, f) {
        return p.then(function () {
          return api(ctx, { action: 'subida', proyecto_id: actual.id, nombre: f.name, tipo: f.type, bytes: f.size }).then(function (d) {
            return supa.storage.from('estudio').uploadToSignedUrl(d.path, d.token, f, { contentType: f.type }).then(function (r) {
              if (r.error) throw new Error('No se ha podido subir «' + f.name + '».');
              ids.push(d.archivo_id);
            });
          });
        });
      }, Promise.resolve());
      subir.then(function () {
        $('#esTrab').textContent = 'Claude está trabajando… (puede tardar hasta un minuto)';
        return api(ctx, { action: 'mensaje', proyecto_id: actual.id, texto: texto, archivo_ids: ids });
      }).then(function (d) {
        $('#esTexto').value = ''; $('#esArchivos').value = ''; $('#esAdj').textContent = '';
        var t = d.tipo === 'pregunta' ? [d.mensaje].concat(d.preguntas.map(function (p) { return '• ' + p; })).filter(Boolean).join('\n') : d.mensaje;
        $('#esTrab').remove();
        msgs.insertAdjacentHTML('beforeend', burbuja({ rol: 'asistente', texto: t, pregunta: d.tipo === 'pregunta', version: d.version, uso: d.uso }));
        msgs.scrollTop = 1e9;
        if (ctx.alCambiar) ctx.alCambiar();
        if (d.tipo === 'proyecto') {
          actual.version_actual = d.version; viendo = d.version;
          return supa.from('estudio_versiones').select('numero, origen, nota, created_at').eq('proyecto_id', actual.id).order('numero')
            .then(function (r) { versiones = r.data || []; pintarZona(d.svgs); return cargarLista(); });
        }
      }).catch(function (err) {
        var t = $('#esTrab'); if (t) t.remove();
        // Si falla, el servidor no guarda el mensaje (o lo retira): se quita la burbuja
        var us = msgs.querySelectorAll('.es-msg.usuario'); if (us.length) us[us.length - 1].remove();
        alertaError(err.message);
        if (err.datos && err.datos.sin_credito && ctx.alCambiar) ctx.alCambiar();
      }).then(function () { ocupado = false; $('#esEnviar').disabled = false; });
    });

    cargarLista().then(function () { if (pidInicial) abrir(pidInicial); });
  }

  // ════════════════════════════════════════════════════════════════
  // Presupuesto
  // ════════════════════════════════════════════════════════════════
  function presupuesto(el, ctx, pid) {
    var supa = ctx.supa, proyecto, doc = null, iva = 21, versionActual = 0, ocupado = false;
    el.innerHTML = '<div class="pa-hero"><div><h1 id="prTitulo">Presupuesto</h1><p id="prSub" class="pa-muted"></p></div></div><div id="prZona"><div class="pr-card pa-muted">Cargando…</div></div>';
    supa.from('estudio_proyectos').select('*').eq('id', pid).maybeSingle().then(function (r) {
      proyecto = r && r.data;
      if (!proyecto) { $('#prZona').innerHTML = '<div class="pr-card">Proyecto no encontrado.</div>'; return; }
      $('#prTitulo').textContent = 'Presupuesto · ' + proyecto.nombre;
      return api(ctx, { action: 'presupuesto', proyecto_id: pid }).then(cargar);
    });

    function aviso(t, tipo, html) { var m = $('#prMsg'); if (!m) return; m.className = 'pr-msg ' + (tipo || ''); m[html ? 'innerHTML' : 'textContent'] = t || ''; }
    var estadoP = 'borrador', estadoAt = null;
    function cargar(d) { doc = d.presupuesto; iva = d.iva_pct == null ? 21 : Number(d.iva_pct); versionActual = d.version_actual; estadoP = d.estado || 'borrador'; estadoAt = d.estado_at; pintar(); }

    function pintar() {
      if (!doc) {
        $('#prSub').textContent = versionActual ? 'Aún no hay presupuesto para este proyecto.' : 'El proyecto aún no tiene alzados.';
        $('#prZona').innerHTML = '<div class="pr-card">' + (versionActual
          ? '<p>Se crea una partida por armario de la versión v' + versionActual + ', con el precio de tu tarifa (o PENDIENTE) y los textos técnicos.</p><button class="pa-btn primary" id="prGenerar">Generar presupuesto desde v' + versionActual + '</button> <span id="prMsg" class="pr-msg"></span>'
          : '<p>Crea primero una versión de los alzados.</p>') + '</div>';
        return;
      }
      $('#prSub').textContent = 'Generado desde la versión v' + doc.version + (doc.version !== versionActual ? ' · el proyecto ya va por v' + versionActual : '');
      var cab = [['numero', 'N.º de presupuesto'], ['fecha', 'Fecha', 'date'], ['atencion', 'A la atención de'], ['validez', 'Validez oferta'],
        ['proyecto', 'Proyecto'], ['proyecto_2', 'Proyecto (2.ª línea)'], ['seccion', 'Sección']];
      var html = '<div class="pr-barra"><button class="pa-btn primary" id="prGuardar">Guardar</button><button class="pa-btn" id="prTextos">Redactar textos con IA</button>' +
        '<button class="pa-btn" id="prPdf">Descargar PDF</button><button class="pa-btn" id="prExcel">Descargar Excel</button>' +
        (doc.version !== versionActual ? '<button class="pa-btn" id="prGenerar">Actualizar a v' + versionActual + '</button>' : '<button class="pa-btn" id="prGenerar">Recalcular con la tarifa</button>') +
        '<span class="pr-estado">Estado ' + selectEstado(pid, estadoP) + (estadoAt ? ' <small class="pa-muted">desde el ' + new Date(estadoAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + '</small>' : '') + '</span>' +
        '<span id="prMsg" class="pr-msg"></span></div>';
      html += '<div class="pr-card pr-f"><div class="pr-cab">' + cab.map(function (c) {
        return '<div><label>' + c[1] + '</label><input data-c="' + c[0] + '" type="' + (c[2] || 'text') + '" value="' + esc(doc[c[0]]) + '"></div>';
      }).join('') + '</div></div>';
      html += doc.partidas.map(function (p, i) {
        return '<div class="pr-card pr-f" data-i="' + i + '"><div class="pr-partida"><div>' +
          '<h3>' + esc(p.titulo) + (p.pendientes.length && !p.precio_manual ? ' <span class="pr-tag">' + p.pendientes.length + ' conceptos PENDIENTE</span>' : '') + '</h3>' +
          '<label>Subtítulo</label><input data-p="subtitulo" value="' + esc(p.subtitulo) + '">' +
          '<label style="margin-top:6px">Introducción</label><textarea data-p="intro" placeholder="Opcional (o «Redactar textos con IA»)">' + esc(p.intro) + '</textarea>' +
          '<label style="margin-top:6px">Ficha técnica</label><textarea data-p="tecnico" style="min-height:96px">' + esc(p.tecnico) + '</textarea>' +
          '<label style="margin-top:6px">Materiales</label><textarea data-p="materiales">' + esc(p.materiales) + '</textarea>' +
          '</div><div>' +
          '<div class="pr-num"><div><label>Cantidad</label><input data-p="cantidad" inputmode="numeric" value="' + p.cantidad + '"></div>' +
          '<div><label>Dto. profesional %</label><input data-p="dto_pct" inputmode="decimal" value="' + numOut(p.dto_pct) + '"></div></div>' +
          '<label style="margin-top:8px"><input type="checkbox" data-p="precio_manual"' + (p.precio_manual ? ' checked' : '') + ' style="width:auto"> Precio a mano</label>' +
          '<div class="' + (p.precio === null ? 'pr-pend' : '') + '"><label>Precio unitario (PVP sin IVA)</label><input data-p="precio" inputmode="decimal" placeholder="PENDIENTE" value="' + numOut(p.precio) + '"' + (p.precio_manual ? '' : ' readonly') + '></div>' +
          '<div class="pr-res" data-res></div>' +
          '<details class="pr-des"><summary>Desglose de tarifa</summary><table>' + p.desglose.map(function (d) {
            return '<tr><td>' + esc(d.nombre) + '</td><td>' + (d.unidad === '%' ? '' : numOut(d.cantidad) + ' ' + d.unidad) + '</td><td>' + (d.precio === null ? 'PENDIENTE' : d.unidad === '%' ? numOut(d.precio) + '%' : eur(d.precio)) + '</td><td>' + eur(d.importe) + '</td></tr>';
          }).join('') + '</table></details></div></div></div>';
      }).join('');
      html += '<div class="pr-card"><div class="pr-tot" id="prTot"></div></div>';
      $('#prZona').innerHTML = html;
      recalcular();
    }

    function leer() {
      var d = { partidas: [] };
      document.querySelectorAll('#prZona [data-c]').forEach(function (i) { d[i.dataset.c] = i.value; });
      document.querySelectorAll('#prZona [data-i]').forEach(function (card) {
        var p = doc.partidas[Number(card.dataset.i)], x = { codigo: p.codigo };
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
      var d = leer(), pvp = 0, imp = 0, pend = 0;
      d.partidas.forEach(function (x, i) {
        var p = doc.partidas[i];
        var precio = x.precio_manual ? x.precio : p.precio;
        var card = document.querySelector('#prZona [data-i="' + i + '"]');
        card.querySelector('[data-p="precio"]').readOnly = !x.precio_manual;
        var res = card.querySelector('[data-res]');
        if (precio === null || precio === undefined) { pend++; res.innerHTML = 'PVP <span class="pr-pvp">PENDIENTE</span><br>Importe <b>PENDIENTE</b>'; return; }
        var l = r2(precio * x.cantidad), m = r2(l * (1 - (x.dto_pct || 0) / 100));
        pvp += l; imp += m;
        res.innerHTML = 'PVP <span class="pr-pvp">' + eur(l) + '</span><br>Importe <b>' + eur(m) + '</b>';
      });
      $('#prTot').innerHTML = pend
        ? '<span>PVP sin IVA: PENDIENTE</span><span>Importe total: <b>PENDIENTE</b></span><span class="pr-tag">' + pend + (pend === 1 ? ' partida' : ' partidas') + ' sin precio</span>'
        : '<span>PVP sin IVA: ' + eur(r2(pvp)) + '</span><span>Dto. profesional: ' + eur(r2(imp - pvp)) + '</span><span>Importe total: <b>' + eur(r2(imp)) + '</b></span><span class="pa-muted">IVA ' + numOut(iva) + '%: ' + eur(r2(imp * iva / 100)) + '</span>';
    }
    el.addEventListener('input', function () { if (doc) recalcular(); });
    el.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.p === 'precio_manual') recalcular();
      if (e.target.classList.contains('ng-estado')) cambiarEstado(ctx, e.target, function () { estadoP = e.target.value; estadoAt = new Date().toISOString(); aviso('Estado: ' + e.target.options[e.target.selectedIndex].text, 'ok'); });
    });

    function guardar() { return api(ctx, { action: 'presupuesto_guardar', proyecto_id: pid, datos: leer() }).then(cargar); }
    function bloquear(fn, t) {
      if (ocupado) return; ocupado = true;
      var m = $('#prMsg'); if (m) { m.className = 'pr-msg pr-trab'; m.textContent = t; }
      Promise.resolve().then(fn).then(function (msg) { aviso(msg || 'Hecho', 'ok'); })
        .catch(function (e) { aviso(textoError(ctx, e), 'err', true); }).then(function () { ocupado = false; });
    }
    el.addEventListener('click', function (e) {
      var id = e.target.id;
      if (id === 'prGenerar') bloquear(function () {
        var hay = !!doc;
        return (hay ? guardar() : Promise.resolve()).then(function () { return api(ctx, { action: 'presupuesto_generar', proyecto_id: pid }); })
          .then(cargar).then(function () { return hay ? 'Actualizado (se conservan precios a mano y textos editados)' : 'Presupuesto generado'; });
      }, 'Generando…');
      if (id === 'prGuardar') bloquear(function () { return guardar().then(function () { return 'Guardado'; }); }, 'Guardando…');
      if (id === 'prTextos') bloquear(function () {
        return guardar().then(function () { return api(ctx, { action: 'presupuesto_textos', proyecto_id: pid }); })
          .then(function (d) { cargar(d); if (ctx.alCambiar) ctx.alCambiar(); return 'Textos redactados' + (ctx.modo === 'admin' ? ' · ' + String(d.coste_usd).replace('.', ',') + ' $' : ''); });
      }, 'Claude está redactando…');
      if (id === 'prPdf') bloquear(function () {
        return guardar().then(function () { return api(ctx, { action: 'presupuesto_pdf', proyecto_id: pid }); })
          .then(function (d) { descargar(base64Blob(d.base64, 'application/pdf'), d.nombre); return 'PDF descargado'; });
      }, 'Generando PDF…');
      if (id === 'prExcel') bloquear(function () {
        return guardar().then(function () { return api(ctx, { action: 'presupuesto_dibujos', proyecto_id: pid }); }).then(function (d) { return excel(d, doc, proyecto); });
      }, 'Generando Excel…');
    });
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

  function excel(d, doc, proyecto) {
    if (!window.ExcelJS) throw new Error('No se ha cargado el generador de Excel.');
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
      texto('J' + r1, 'DTO.', { font: g, al: { horizontal: 'center' } });
      [['E', 'ANCHO'], ['F', 'ALTO'], ['G', 'FONDO']].forEach(function (x) { texto(x[0] + r2, x[1], { font: { size: 5.5, color: g.color }, al: { horizontal: 'center', vertical: 'top' } }); });
      texto('J' + r2, 'PROFESIONAL', { font: g, al: { horizontal: 'center', vertical: 'top' } });
      var r3 = nueva(21);
      texto('B' + r3, (doc.seccion || '').toUpperCase(), { font: { bold: true }, al: { vertical: 'middle' } });
    }
    function png64(o) { return o.data.split(',')[1]; }

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
    var rEt = nueva(11), rVa = nueva(11), rVa2 = nueva(10);
    [['B', 'A LA ATENCIÓN DE', doc.atencion], ['D', 'PROYECTO', doc.proyecto], ['E', 'N.º DE PRESUPUESTO', doc.numero], ['J', 'VALIDEZ OFERTA', doc.validez]].forEach(function (c) {
      texto(c[0] + rEt, c[1], { font: { color: { argb: 'FF434343' } } });
      texto(c[0] + rVa, String(c[2] || '').toUpperCase(), { font: { size: 5.5, color: { argb: 'FF666666' } } });
    });
    if (doc.proyecto_2) texto('D' + rVa2, doc.proyecto_2.toUpperCase(), { font: { size: 5.5, color: { argb: 'FF666666' } } });
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
      texto('J' + r, { formula: fPct('N' + r), result: String(Math.round(p.dto_pct * 100) / 100).replace('.', ',') + '%' }, { al: med });
      ws.getCell('J' + r).alignment = { vertical: 'middle', horizontal: 'center' };
      // Dibujo (mismo tamaño que en el PDF)
      var dib = d.dibujos.filter(function (x) { return x.codigo === p.codigo; })[0];
      if (dib) {
        var y0 = enPagina + 4, hMax = Math.max(120, Math.min(260, XL.alto - 12 - y0));
        var kk = Math.min(461 / dib.ancho, hMax / dib.alto), w = dib.ancho * kk, h = dib.alto * kk;
        nueva(4);
        var rd = nueva(h + 2);
        var colOff = (87 - 87) + (461 - w) / 2 - 2;   // centrado en 85 → 546 como el PDF
        tareas.push(png(dib.svg, 1600).then(function (im) {
          ws.addImage(wb.addImage({ base64: png64(im), extension: 'png' }), { tl: { col: 2 + colOff / 88, row: rd - 1 }, ext: { width: w * 96 / 72, height: h * 96 / 72 }, editAs: 'absolute' });
        }));
      }
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
    var plazos = pl.forma_pago || [];
    var rows = [];
    for (var j = 0; j < Math.max(3, plazos.length); j++) rows.push(nueva(j === 2 ? 16 : 12));
    plazos.forEach(function (fp, j) { ws.mergeCells('B' + rows[j] + ':C' + rows[j]); texto('B' + rows[j], (fp.concepto || '').toUpperCase()); texto('D' + rows[j], fp.pct + '%', { al: { horizontal: 'right' } }); });
    etq(rows[1], 'DTO.  PROFESIONAL'); valor(rows[1], 'O' + rows[1], sum('P') + '-' + sum('O'), r2(tot.imp - tot.pvp), { font: { size: 8 } });
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
      descargar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Presupuesto_' + (doc.numero || proyecto.nombre).replace(/[^\w-]+/g, '_') + '.xlsx');
      return 'Excel descargado';
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
      '<div class="tf-pie"><button class="pa-btn primary" id="tfGuardar">Guardar tarifa</button><span id="tfMsg"></span></div></section>';
    function msg(t, ok) { var m = $('#tfMsg'); m.className = ok ? 'tf-ok' : 'tf-err'; m.textContent = t; }
    function cargar() {
      return api(ctx, { action: 'tarifa', de: mia ? 'mia' : 'curino' }).then(function (d) {
        if (mia) $('#tfNota').textContent = d.propia ? 'Tu tarifa: con estos precios se calculan tus presupuestos.' : 'Ahora ves la tarifa Curino por defecto. Cambia lo que quieras y guarda: se convierte en tu tarifa.';
        var v = d.tarifa.valores, html = '';
        var altos = ['alto hasta 240', 'alto 241–270', 'alto más de 270'], fondos = ['fondo hasta 45', 'fondo 46–65', 'fondo más de 65'];
        html += '<h3>Cuerpo · €/metro lineal</h3><table class="tf-tabla"><thead><tr><th></th>' + altos.map(function (a) { return '<th>' + a + '</th>'; }).join('') + '</tr></thead><tbody>';
        fondos.forEach(function (f, i) {
          html += '<tr><td>' + f + '</td>' + altos.map(function (_, j) {
            var k = 'cuerpo_f' + i + '_a' + j;
            return '<td><input class="tf-in" data-k="' + k + '" inputmode="decimal" placeholder="PENDIENTE" value="' + esc(numOut(v[k])) + '"></td>';
          }).join('') + '</tr>';
        });
        html += '</tbody></table>';
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
        $('#tfIva').value = numOut(d.tarifa.iva_pct);
      });
    }
    $('#tfGuardar').addEventListener('click', function () {
      var valores = {};
      document.querySelectorAll('#tfConceptos [data-k]').forEach(function (i) { valores[i.dataset.k] = i.value.trim() === '' ? null : i.value.trim(); });
      api(ctx, { action: 'tarifa_guardar', de: mia ? 'mia' : 'curino', valores: valores, descuento_pct: $('#tfDto').value, iva_pct: $('#tfIva').value })
        .then(function (d) { msg('Guardada' + (d.pendientes ? ' · ' + d.pendientes + ' conceptos PENDIENTE' : ''), true); return cargar(); })
        .catch(function (e) { msg(e.message); });
    });
    cargar();
  }

  // ════════════════════════════════════════════════════════════════
  // Datos del emisor y plantilla
  // ════════════════════════════════════════════════════════════════
  var CAMPOS = { plEmpresa: 'empresa', plNif: 'nif', plDir1: 'direccion_1', plDir2: 'direccion_2', plEmail: 'email', plTel: 'telefono', plLema: 'lema', plIban: 'iban', plFirmante: 'firmante', plCargo: 'cargo', plCiudad: 'ciudad_firma', plColor: 'color', plMateriales: 'materiales', plCondiciones: 'condiciones' };
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
      '<label>Materiales (se añaden a cada partida)</label><textarea id="plMateriales"></textarea>' +
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
  function selectEstado(pid, estado) {
    return '<select class="ng-estado ng-e-' + estado + '" data-pid="' + pid + '">' + ESTADOS.map(function (e) { return '<option value="' + e[0] + '"' + (e[0] === estado ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select>';
  }
  function cambiarEstado(ctx, sel, despues) {
    sel.disabled = true;
    api(ctx, { action: 'presupuesto_estado', proyecto_id: sel.dataset.pid, estado: sel.value })
      .then(function () { sel.className = 'ng-estado ng-e-' + sel.value; if (despues) despues(); })
      .catch(function (e) { alert(e.message); }).then(function () { sel.disabled = false; });
  }
  /** Gráfica de barras (presupuestado vs aceptado) de los últimos 12 meses, en SVG. */
  function grafica(serie) {
    var W = 1000, H = 250, izq = 64, abajo = 28, arriba = 12;
    var max = Math.max.apply(null, serie.map(function (m) { return Math.max(m.presupuestado, m.aceptado); }).concat([0]));
    if (!(max > 0)) return '<div class="ng-vacio">Cuando marques presupuestos como enviados o aceptados verás aquí su evolución mes a mes.</div>';
    // Tope «redondo» para que las 4 divisiones salgan en cifras limpias
    var bruto = max / 4, p10 = Math.pow(10, Math.floor(Math.log10(bruto)));
    var paso = [1, 2, 2.5, 5, 10].map(function (k) { return k * p10; }).filter(function (v) { return v >= bruto; })[0];
    var tope = paso * 4;
    var hUtil = H - abajo - arriba, wCol = (W - izq) / serie.length, wBar = Math.min(22, wCol / 3);
    var y = function (v) { return arriba + hUtil - (v / tope) * hUtil; };
    var g = '';
    for (var i = 0; i <= 4; i++) {
      var v = (tope / 4) * i, yy = y(v);
      g += '<line x1="' + izq + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" stroke="#ece9e2"/>' +
        '<text x="' + (izq - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + eur0(v) + '</text>';
    }
    serie.forEach(function (m, k) {
      var cx = izq + wCol * k + wCol / 2;
      g += '<rect x="' + (cx - wBar - 1) + '" y="' + y(m.presupuestado) + '" width="' + wBar + '" height="' + (y(0) - y(m.presupuestado)) + '" fill="#d9d3c8" rx="2"><title>Presupuestado ' + eur0(m.presupuestado) + '</title></rect>' +
        '<rect x="' + (cx + 1) + '" y="' + y(m.aceptado) + '" width="' + wBar + '" height="' + (y(0) - y(m.aceptado)) + '" fill="#161616" rx="2"><title>Aceptado ' + eur0(m.aceptado) + '</title></rect>' +
        '<text x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle">' + MESES[Number(m.mes.slice(5)) - 1] + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ng-graf" role="img" aria-label="Presupuestado y aceptado por mes">' + g + '</svg>';
  }
  function negocio(el, ctx, opts) {
    opts = opts || {};
    var admin = !!opts.agregado, periodo = 'mes';
    el.innerHTML = '<div class="ng"><div class="ng-cab"><h1>' + (admin ? 'Negocio de los alumnos' : 'Mi negocio') + '</h1>' +
      '<div class="ng-periodos">' + [['mes', 'Mes'], ['trimestre', 'Trimestre'], ['anio', 'Año'], ['todo', 'Todo']].map(function (p) { return '<button data-per="' + p[0] + '"' + (p[0] === periodo ? ' class="on"' : '') + '>' + p[1] + '</button>'; }).join('') + '</div></div>' +
      '<div id="ngCuerpo"><p class="pa-muted">Cargando…</p></div></div>';
    el.querySelector('.ng-periodos').addEventListener('click', function (e) {
      var b = e.target.closest('[data-per]'); if (!b) return;
      periodo = b.dataset.per;
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
          (c ? kpi('Créditos del mes', cr(c.restantes), 'de ' + cr(c.mes) + (c.saldo > 0 ? ' · +' + cr(c.saldo) + ' de packs' : '')) : '') +
          '</div>';
        html += '<div class="ng-card"><div class="ng-card-cab"><h2>Evolución mensual</h2><span class="ng-ley"><i style="background:#d9d3c8"></i>Presupuestado <i style="background:#161616"></i>Aceptado</span></div>' + grafica(m.serie) + '</div>';
        var lista = function (titulo, filas, conDias) {
          return '<div class="ng-card"><h2>' + titulo + '</h2>' + (filas.length ? '<ul class="ng-lista">' + filas.map(function (f) {
            return '<li><div><strong>' + esc(f.cliente || '—') + '</strong><small>' + (f.numero ? esc(f.numero) + ' · ' : '') + (conDias ? 'enviado hace ' + f.dias + (f.dias === 1 ? ' día' : ' días') : new Date(f.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })) + '</small></div>' +
              '<span class="ng-imp">' + eur0(f.importe) + '</span>' + (admin ? '<span class="ng-tag ng-e-' + f.estado + '">' + f.estado + '</span>' : selectEstado(f.proyecto_id, f.estado)) + '</li>';
          }).join('') + '</ul>' : '<p class="pa-muted" style="margin:6px 0 0">' + (conDias ? 'Nada pendiente de respuesta.' : 'Aún no hay presupuestos.') + '</p>') + '</div>';
        };
        html += '<div class="ng-dos">' + lista('Pendientes de respuesta', m.pendientes, true) + lista('Últimos presupuestos', m.ultimos, false) + '</div>';
        if (admin && m.alumnos) {
          html += '<div class="ng-card"><h2>Por alumno</h2>' + (m.alumnos.length ? '<div style="overflow-x:auto"><table class="ng-tabla"><thead><tr><th>Alumno</th><th>Proyectos</th><th>Enviados</th><th>Presupuestado</th><th>Aceptados</th><th>Ventas</th><th>Cierre</th><th>Pendientes</th></tr></thead><tbody>' +
            m.alumnos.map(function (a) { return '<tr><td>' + esc(a.email) + '</td><td>' + a.proyectos + '</td><td>' + a.enviados + '</td><td>' + eur0(a.presupuestado) + '</td><td>' + a.aceptados + '</td><td><b>' + eur0(a.ventas) + '</b></td><td>' + (a.tasa_cierre === null ? '—' : String(a.tasa_cierre).replace('.', ',') + ' %') + '</td><td>' + a.pendientes + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '<p class="pa-muted">Sin actividad de alumnos en el periodo.</p>') + '</div>';
        }
        el.querySelector('#ngCuerpo').innerHTML = html;
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
