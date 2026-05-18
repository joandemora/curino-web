/**
 * Helper para Supabase Image Transformations (plan Pro).
 *
 * Transforma una URL pública del bucket en una URL con resize on-the-fly.
 * Reescribe `/storage/v1/object/public/` → `/storage/v1/render/image/public/`
 * y añade query params width/height/quality/resize/format. Supabase devuelve
 * la imagen reescalada (WebP/AVIF auto según browser) y la CDN la cachea.
 *
 * La URL original almacenada en BD nunca cambia — solo se transforma al
 * renderizar. Si la URL no es de Supabase Storage público (otro dominio,
 * imagen local, dataURL...) se devuelve sin tocar.
 *
 * Usage:
 *   transformImageUrl(url, { width: 800, quality: 80 })
 *   transformImageUrl(url, 'card')   // preset
 */
(function () {
  'use strict';

  var IMAGE_PRESETS = {
    thumbnail: { width: 400, quality: 80 },
    card:      { width: 800, quality: 80 },
    hero:      { width: 1600, quality: 85 },
    sidebar:   { width: 400, quality: 80 },
    og:        { width: 1200, height: 630, resize: 'cover', quality: 85 }
  };

  function transformImageUrl(url, options) {
    if (!url) return url;
    // Solo transformar URLs públicas de Supabase Storage.
    if (typeof url !== 'string' || url.indexOf('/storage/v1/object/public/') === -1) {
      return url;
    }
    // Preset (string) o objeto opciones.
    var opts = (typeof options === 'string') ? (IMAGE_PRESETS[options] || {}) : (options || {});
    var transformed = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    var params = [];
    if (opts.width)   params.push('width=' + encodeURIComponent(opts.width));
    if (opts.height)  params.push('height=' + encodeURIComponent(opts.height));
    if (opts.quality) params.push('quality=' + encodeURIComponent(opts.quality));
    if (opts.resize)  params.push('resize=' + encodeURIComponent(opts.resize));
    if (opts.format)  params.push('format=' + encodeURIComponent(opts.format));
    return params.length ? transformed + '?' + params.join('&') : transformed;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { transformImageUrl: transformImageUrl, IMAGE_PRESETS: IMAGE_PRESETS };
  }
  if (typeof window !== 'undefined') {
    window.transformImageUrl = transformImageUrl;
    window.IMAGE_PRESETS = IMAGE_PRESETS;
  }
})();
