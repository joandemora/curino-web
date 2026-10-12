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
    function cargar(d) { doc = d.presupuesto; iva = d.iva_pct == null ? 21 : Number(d.iva_pct); versionActual = d.version_actual; pintar(); }

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
    el.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.p === 'precio_manual') recalcular(); });

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

  // Excel con la estructura del presupuesto de referencia: una partida por bloque y su dibujo debajo.
  function excel(d, doc, proyecto) {
    if (!window.ExcelJS) throw new Error('No se ha cargado el generador de Excel.');
    var pl = d.plantilla, ivaPct = d.iva_pct == null ? 21 : Number(d.iva_pct);
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet(('PRESUPUESTO ' + (doc.numero || '')).trim().slice(0, 31), { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
    ws.columns = [6.2, 10.3, 20.2, 20.3, 8.2, 8.2, 8.2, 11.3, 11.3, 12.5, 14].map(function (w) { return { width: w }; });
    var F = 'Open Sans', EUR = '#,##0.00 "€"', GRIS = { argb: 'FF808080' };
    var put = function (ref, v, o) { var c = ws.getCell(ref); c.value = v; c.font = Object.assign({ name: F, size: 8 }, (o && o.font) || {}); if (o && o.al) c.alignment = o.al; if (o && o.fmt) c.numFmt = o.fmt; return c; };
    var tareas = [];
    if (pl.tipo === 'curino') tareas.push(png(d.logo, 360).then(function (im) { ws.addImage(wb.addImage({ base64: im.data, extension: 'png' }), { tl: { col: 1, row: 1 }, ext: { width: 160, height: 160 * im.h / im.w } }); }));
    else put('B3', pl.empresa, { font: { size: 16, bold: true } });
    [pl.direccion_1, pl.direccion_2, pl.email, pl.telefono].forEach(function (t, k) { if (t) put('K' + (4 + k), t, { font: { size: 7, color: { argb: 'FF434343' } }, al: { horizontal: 'right' } }); });
    if (pl.lema) put('K9', pl.lema, { font: { size: 11, bold: true }, al: { horizontal: 'right' } });
    put('B11', 'PRESUPUESTO', { font: { size: 15 } });
    put('B12', new Date(doc.fecha + 'T12:00:00'), { fmt: 'd/m/yyyy' });
    [['B', 'A LA ATENCIÓN DE', doc.atencion], ['D', 'PROYECTO', doc.proyecto], ['F', 'N.º DE PRESUPUESTO', doc.numero], ['J', 'VALIDEZ OFERTA', doc.validez]].forEach(function (c) {
      put(c[0] + '14', c[1], { font: { color: { argb: 'FF434343' } } }); put(c[0] + '15', String(c[2] || '').toUpperCase(), { font: { size: 7, color: { argb: 'FF666666' } } });
    });
    if (doc.proyecto_2) put('D16', doc.proyecto_2.toUpperCase(), { font: { size: 7, color: { argb: 'FF666666' } } });
    var fila = 19, filasLinea = [];
    var cabecera = function () {
      ['CANTIDAD', 'PRODUCTO', 'MATERIAL Y GROSOR', 'MEDIDAS EN CM', '', '', 'PRECIO', 'PVP', 'DTO. PROFESIONAL', 'IMPORTE'].forEach(function (t, k) {
        if (t) put(String.fromCharCode(66 + k) + fila, t, { font: { color: { argb: 'FF404040' } }, al: { horizontal: 'center', vertical: 'middle', wrapText: true } });
      });
      ws.mergeCells('E' + fila + ':G' + fila);
      ['ANCHO', 'ALTO', 'FONDO'].forEach(function (t, k) { put(String.fromCharCode(69 + k) + (fila + 1), t, { font: { size: 7, color: { argb: 'FF404040' } }, al: { horizontal: 'center' } }); });
      for (var col = 2; col <= 11; col++) { ws.getCell(fila, col).border = { top: { style: 'thin' } }; ws.getCell(fila + 1, col).border = { bottom: { style: 'thin' } }; }
      put('B' + (fila + 2), doc.seccion, { font: { bold: true } });
      fila += 3;
    };
    doc.partidas.forEach(function (p) {
      cabecera();
      var texto = [p.titulo, p.subtitulo, '', p.intro, p.intro ? '' : null, p.tecnico, '', p.materiales].filter(function (x) { return x !== null; }).join('\n').replace(/\n{3,}/g, '\n\n');
      var lineas = texto.split('\n').reduce(function (n, l) { return n + Math.max(1, Math.ceil(l.length / 62)); }, 0);
      var r = fila;
      ws.mergeCells('C' + r + ':G' + r);
      put('C' + r, { richText: [{ text: p.titulo + '\n', font: { name: F, size: 8, bold: true } }, { text: texto.slice(p.titulo.length + 1), font: { name: F, size: 8 } }] }, { al: { wrapText: true, vertical: 'top' } });
      ws.getRow(r).height = Math.min(409, lineas * 11 + 6);
      put('B' + r, p.cantidad, { al: { horizontal: 'center', vertical: 'middle' } });
      if (p.precio === null) put('H' + r, 'PENDIENTE', { al: { horizontal: 'right', vertical: 'middle' } });
      else put('H' + r, p.precio, { fmt: EUR, al: { vertical: 'middle' } });
      put('I' + r, p.precio === null ? 'PENDIENTE' : { formula: 'H' + r + '*B' + r }, { fmt: EUR, font: { color: GRIS }, al: { horizontal: 'right', vertical: 'middle' } });
      put('J' + r, (p.dto_pct || 0) / 100, { fmt: '0%', al: { horizontal: 'center', vertical: 'middle' } });
      put('K' + r, p.precio === null ? 'PENDIENTE' : { formula: 'I' + r + '*(1-J' + r + ')' }, { fmt: EUR, font: { bold: true }, al: { horizontal: 'right', vertical: 'middle' } });
      for (var col = 2; col <= 11; col++) ws.getCell(r, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      filasLinea.push(r);
      var dib = d.dibujos.filter(function (x) { return x.codigo === p.codigo; })[0];
      fila = r + 1;
      if (dib) {
        var filaImg = fila, anchoPx = 620, altoPx = anchoPx * dib.alto / dib.ancho;
        tareas.push(png(dib.svg, 1400).then(function (im) { ws.addImage(wb.addImage({ base64: im.data, extension: 'png' }), { tl: { col: 2, row: filaImg }, ext: { width: anchoPx, height: altoPx } }); }));
        fila += Math.ceil(altoPx / 20) + 1;
      }
      fila += 2;
    });
    var sum = function (col) { return filasLinea.map(function (r) { return col + r; }).join(','); };
    var hayPend = doc.partidas.some(function (p) { return p.precio === null; });
    var t = fila + 1;
    put('B' + t, 'FORMA DE PAGO', { font: { bold: true } });
    (pl.forma_pago || []).forEach(function (fp, k) { put('B' + (t + 1 + k), fp.concepto); put('D' + (t + 1 + k), fp.pct / 100, { fmt: '0%' }); });
    put('H' + t, 'PVP SIN IVA'); put('K' + t, hayPend ? 'PENDIENTE' : { formula: 'SUM(' + sum('I') + ')' }, { fmt: EUR, font: { color: GRIS }, al: { horizontal: 'right' } });
    put('H' + (t + 2), 'DTO. PROFESIONAL'); put('K' + (t + 2), hayPend ? 'PENDIENTE' : { formula: 'SUM(' + sum('K') + ')-SUM(' + sum('I') + ')' }, { fmt: EUR, al: { horizontal: 'right' } });
    put('H' + (t + 3), 'IMPORTE TOTAL', { font: { bold: true } }); put('K' + (t + 3), hayPend ? 'PENDIENTE' : { formula: 'SUM(' + sum('K') + ')' }, { fmt: EUR, font: { bold: true }, al: { horizontal: 'right' } });
    if (pl.mostrar_iva) {
      put('H' + (t + 4), 'IVA (' + ivaPct + '%)'); put('K' + (t + 4), hayPend ? 'PENDIENTE' : { formula: 'K' + (t + 3) + '*' + ivaPct / 100 }, { fmt: EUR, al: { horizontal: 'right' } });
      put('H' + (t + 5), 'TOTAL CON IVA', { font: { bold: true } }); put('K' + (t + 5), hayPend ? 'PENDIENTE' : { formula: 'K' + (t + 3) + '+K' + (t + 4) }, { fmt: EUR, font: { bold: true }, al: { horizontal: 'right' } });
    } else put('K' + (t + 4), 'IMPUESTOS IVA NO INCLUIDOS', { font: { size: 7 }, al: { horizontal: 'right' } });
    var y = t + Math.max(5, (pl.forma_pago || []).length + 2);
    if (pl.iban) { put('B' + y, 'TRANSFERENCIA BANCARIA', { font: { bold: true } }); put('B' + (y + 1), pl.iban); y += 2; }
    y += 2;
    (pl.condiciones || '').split('\n').forEach(function (l) {
      ws.mergeCells('B' + y + ':K' + y);
      put('B' + y, l, { font: /:\s*$/.test(l) ? {} : { color: GRIS }, al: { wrapText: true, vertical: 'top' } });
      ws.getRow(y).height = Math.max(12, Math.ceil(l.length / 135) * 11);
      y++;
    });
    y += 2;
    if (pl.ciudad_firma) put('B' + y, 'EN ' + pl.ciudad_firma.toUpperCase() + ' A,');
    put('B' + (y + 2), new Date(doc.fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), { font: { bold: true } });
    y += 5;
    put('B' + y, 'CLIENTE', { font: { bold: true, size: 9 } }); put('B' + (y + 1), (doc.atencion || '').toUpperCase());
    put('H' + y, (pl.empresa || '').toUpperCase(), { font: { bold: true, size: 9 } });
    [pl.nif, [pl.direccion_1, pl.direccion_2].filter(Boolean).join(' '), pl.cargo, pl.firmante].forEach(function (l, k) { if (l) put('H' + (y + 1 + k), l, { font: k === 2 ? { bold: true } : {} }); });
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

  window.EstudioUI = { proyectos: proyectos, presupuesto: presupuesto, tarifa: tarifa, plantilla: plantilla, api: api };
})();
