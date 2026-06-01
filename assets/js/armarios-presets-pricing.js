/* ============================================================
 * armarios-presets-pricing.js — Configs y cálculo de precios
 * de los 8 presets del catálogo de /armarios-vestidores/.
 *
 * Permite recalcular los `precioAprox` de las tarjetas en runtime
 * con los precios actuales de Supabase, evitando drift cuando se
 * editan precios desde /admin/armarios/precios/.
 *
 * Exports en `window`:
 *   - ARMARIOS_PRESETS         : 8 configs (duplicadas del configurador
 *                                hasta que se haga un refactor de Opción C
 *                                que las unifique en un módulo compartido).
 *   - ARMARIOS_PRICES_FALLBACK : 20 valores hardcoded como respaldo si
 *                                Supabase falla (idénticos a los del
 *                                configurador).
 *   - ARMARIOS_PRICES          : precios en uso ahora mismo. Empieza
 *                                como ARMARIOS_PRICES_FALLBACK y se
 *                                sobrescribe si Supabase responde.
 *   - calcPresetPrice(preset, prices) : función PURA, devuelve el
 *                                precio total redondeado. Mismas
 *                                operaciones que calcPrice() del
 *                                configurador (Math.round incluido).
 *
 * Evento custom:
 *   - 'curino:armarios-prices-ready' se dispara cuando los precios
 *     están listos (sea de cache, fetch exitoso o fallback). El
 *     catálogo escucha este evento para sobrescribir el DOM.
 *
 * Cache compartido con el configurador via sessionStorage clave
 * "curino_prices" (TTL 10 min). Si el configurador ya cargó precios
 * en esta sesión, el catálogo los reusa sin volver a hacer fetch.
 * ============================================================ */
(function () {
  'use strict';

  // ── PRESETS — duplicados del configurador (configurador-armarios-vestidores
  // /index.html L1142-1207). Si cambias un preset en el configurador, actualiza
  // también este archivo (o haz un refactor Opción C que unifique).
  window.ARMARIOS_PRESETS = {
    'esencial-blanco': {
      label: 'Esencial',
      ancho: 150, alto: 240, fondo: 60,
      material: 'mad_wengue',
      interiores: ['colgadorlargo', 'colgadorlargo'],
      puertas: { gama: 'laminadas', lamRal: 0 }
    },
    'domestico-marfil': {
      label: 'Doméstico',
      ancho: 180, alto: 240, fondo: 60,
      material: 'mad_roble',
      interiores: ['cajoneraaccesorios', 'doblecolgador'],
      puertas: { gama: 'laminadas', lamRal: 3 }
    },
    'studio-calcio': {
      label: 'Studio',
      ancho: 200, alto: 240, fondo: 60,
      material: 'lam_nogal',
      interiores: ['colgadorlargo', 'estantes'],
      puertas: { gama: 'laminadas', lamRal: 1 }
    },
    'suite-lacada-9016': {
      label: 'Suite',
      ancho: 240, alto: 260, fondo: 60,
      material: 'mad_cerezo',
      interiores: ['cajoneraaccesorios', 'doblecolgador'],
      puertas: { gama: 'lisas', ral: 1 }
    },
    'atelier-snow': {
      label: 'Atelier',
      ancho: 280, alto: 280, fondo: 60,
      material: 'lam_blanco',
      interiores: ['cajoneraestantes', 'cajoneraestantes', 'doblecolgador'],
      puertas: { gama: 'molduras', marcoTipo: 'madera', mat: 'mad_cerezo', tx: 0, trav: true }
    },
    'boudoir-antracita': {
      label: 'Boudoir',
      ancho: 320, alto: 260, fondo: 60,
      material: 'mad_wengue',
      interiores: ['zapatero', 'cajoneraaccesorios', 'doblecolgador'],
      puertas: { gama: 'lisas', ral: 14 }
    },
    'galeria-gris': {
      label: 'Galería',
      ancho: 380, alto: 280, fondo: 60,
      material: 'lam_aluminio',
      interiores: ['doblecolgador', 'estantes', 'doblecolgador'],
      puertas: { gama: 'laminadas', lamRal: 2 }
    },
    'vestidor-couture-tobacco': {
      label: 'Vestidor Couture',
      ancho: 450, alto: 280, fondo: 65,
      material: 'mad_cerezo',
      interiores: ['cajoneraaccesorios', 'doblecolgador', 'doblecolgador', 'cajoneraaccesorios'],
      puertas: { gama: 'molduras', marcoTipo: 'madera', mat: 'mad_cerezo', tx: 4, trav: true }
    }
  };

  // ── FALLBACK de precios — idénticos a los del configurador
  // (configurador-armarios-vestidores/index.html, ver window.PRICES).
  // Se usan solo si el fetch a Supabase falla.
  window.ARMARIOS_PRICES_FALLBACK = {
    base_fixed: 800,
    base_per_m2: 150,
    door:     { laminadas: 90, lisas: 220, molduras: 400 },
    doorUnit: { laminadas: 0,  lisas: 0,   molduras: 0   },
    interior: { cajoneraaccesorios: 280, cajoneraestantes: 240, zapatero: 180,
                doblecolgador: 160, colgadorlargo: 140, estantes: 120, vacio: 80 },
    material: { mad_wengue: 120, mad_cerezo: 120, mad_roble: 80,
                lam_aluminio: 60, lam_linocoral: 60, lam_blanco: 60,
                lam_negro: 60, lam_nogal: 0 }
  };

  // Estado inicial: fallback. Se sobrescribe abajo si cache/fetch dan datos.
  window.ARMARIOS_PRICES = window.ARMARIOS_PRICES_FALLBACK;

  // ── Réplicas de calcModules() y p3Hojas() del configurador
  // (configurador-armarios-vestidores/index.html L1262-L1303). Necesarias
  // para contar nº de hojas por preset sin depender del DOM del configurador.
  // Si cambias la lógica allí, sincroniza aquí.
  function calcModulesLocal(w) {
    if (w >= 160) {
      for (var n = 1; n <= 12; n++) {
        var base = Math.floor(w / n), top = base + (w % n > 0 ? 1 : 0);
        if (base >= 80 && top <= 130) {
          var totalMm = Math.round(w * 10), baseMm = Math.floor(totalMm / n), remMm = totalMm - baseMm * n;
          var widths = [];
          for (var i = 0; i < n; i++) widths.push((baseMm + (i < remMm ? 1 : 0)) / 10);
          return widths;
        }
      }
    }
    if (w >= 131 && w <= 159) {
      var small = Math.round(w / 3), big = w - small;
      return [big, small];
    }
    return [w];
  }
  function p3HojasLocal(w) {
    if (w <= 65) return 1;
    if (w >= 80) return 2;
    return 1; // 66-79 fallback
  }

  // ── Función pura. MISMA fórmula que calcPrice() del configurador
  // (Math.round incluido). Asume 100% del frente cubierto por puerta
  // (todos los módulos con puerta), que es como applyConfigPreset
  // setea _P3.mods cuando llega un preset.
  window.calcPresetPrice = function (preset, prices) {
    if (!preset || !prices) return null;
    var W = preset.ancho;
    var H = preset.alto;
    var area = (W / 100) * (H / 100);
    var base = prices.base_fixed + area * prices.base_per_m2;
    var matP = prices.material[preset.material] || 0;
    var intP = (preset.interiores || []).reduce(function (s, intId) {
      return s + (prices.interior[intId] || 0);
    }, 0);
    var gama = preset.puertas && preset.puertas.gama;
    var dpm2 = (gama && prices.door[gama]) || 0;
    var dpud = (gama && prices.doorUnit && prices.doorUnit[gama]) || 0;
    var doorWcm = W; // 100% cubierto
    var widths = calcModulesLocal(W);
    var nDoors = widths.reduce(function (s, w) { return s + p3HojasLocal(w); }, 0);
    var doorP = (doorWcm / 100) * (H / 100) * dpm2 + nDoors * dpud;
    return Math.round(base + matP + intP + doorP);
  };

  // ── Cache + fetch de precios desde Supabase
  // Usa la MISMA clave 'curino_prices' que el configurador → cache compartida.
  // TTL 10 min. Si falla, queda con ARMARIOS_PRICES_FALLBACK.
  function dispatchReady() {
    // setTimeout(0) garantiza async aunque el cache hit sea síncrono: así
    // cualquier listener inline registrado tras este <script> recibe el evento.
    setTimeout(function () {
      document.dispatchEvent(new CustomEvent('curino:armarios-prices-ready', {
        detail: { prices: window.ARMARIOS_PRICES }
      }));
    }, 0);
  }

  (function loadPricesFromSupabase() {
    var CACHE_KEY = 'curino_prices';
    var TTL_MS = 10 * 60 * 1000;

    // 1) Cache hit válida → usar y disparar evento
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        var cached = JSON.parse(raw);
        if (cached && cached.ts && (Date.now() - cached.ts) < TTL_MS && cached.prices) {
          window.ARMARIOS_PRICES = cached.prices;
          dispatchReady();
          return;
        }
      }
    } catch (e) { /* sessionStorage no disponible → seguir al fetch */ }

    // 2) Sin cache: fetch async
    (async function () {
      try {
        var cfgResp = await fetch('/api/config', { redirect: 'follow' });
        var cfg = await cfgResp.json();
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { dispatchReady(); return; }
        if (!window.supabase || !window.supabase.createClient) { dispatchReady(); return; }
        var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        var res = await sb.from('pricing_config').select('key, value');
        if (res.error || !res.data || !res.data.length) { dispatchReady(); return; }

        // Construir nuevo PRICES partiendo del fallback
        var P = {
          base_fixed:  window.ARMARIOS_PRICES_FALLBACK.base_fixed,
          base_per_m2: window.ARMARIOS_PRICES_FALLBACK.base_per_m2,
          door:        Object.assign({}, window.ARMARIOS_PRICES_FALLBACK.door),
          doorUnit:    Object.assign({}, window.ARMARIOS_PRICES_FALLBACK.doorUnit),
          interior:    Object.assign({}, window.ARMARIOS_PRICES_FALLBACK.interior),
          material:    Object.assign({}, window.ARMARIOS_PRICES_FALLBACK.material)
        };
        res.data.forEach(function (row) {
          var v = Number(row.value);
          if (!isFinite(v)) return;
          if (row.key === 'base_fixed')                P.base_fixed  = v;
          else if (row.key === 'base_per_m2')          P.base_per_m2 = v;
          else if (row.key.indexOf('door_') === 0) {
            // door_{gama}_per_unit → P.doorUnit[gama]
            // door_{gama}          → P.door[gama]
            if (row.key.lastIndexOf('_per_unit') === row.key.length - 9) {
              P.doorUnit[row.key.slice(5, -9)] = v;
            } else {
              P.door[row.key.slice(5)] = v;
            }
          }
          else if (row.key.indexOf('interior_') === 0) P.interior[row.key.slice(9)] = v;
          else if (row.key.indexOf('material_') === 0) P.material[row.key.slice(9)] = v;
        });
        window.ARMARIOS_PRICES = P;
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), prices: P })); } catch (e) {}
        dispatchReady();
      } catch (e) {
        console.warn('[armarios-presets-pricing] fallback to hardcoded:', e && e.message ? e.message : e);
        dispatchReady();
      }
    })();
  })();
})();
