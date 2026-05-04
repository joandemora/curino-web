// Curino — helpers compartidos por las tres páginas que consumen el
// catálogo: el panel "Marcas" del configurador (drag → import), el panel
// admin (/admin/) y el panel marca (/marca/).
//
// Phase A introduces only the multi-view DXF resolver. Phases B/C/D will
// add per-view upload/edit helpers, variant rendering, etc. Kept as a
// single global namespace `CurinoCatalog` so it stays trivially loadable
// via <script src="/assets/js/catalog-helpers.js"></script> on a project
// that has no bundler.
(function(global){
  // Order in which views are tried when resolving the default DXF.
  // `top` first because plan drawings are the most useful default in 2D.
  var VIEW_ORDER=['top','side','front','back'];

  // Returns the URL of the DXF that should be used as the default when
  // the user drags this catalog_item onto the canvas.
  //
  //   1. views.top.dxf_url           — explicit "top" view if set.
  //   2. first non-null entry in views (in VIEW_ORDER, then any key).
  //   3. legacy item.dxf_url field   — pieces created before Phase A
  //                                    only had this column; they keep
  //                                    working unchanged.
  // Returns null when nothing is set.
  function getDefaultDxfUrl(item){
    if(!item) return null;
    var v=item.views;
    if(v && typeof v==='object'){
      for(var i=0;i<VIEW_ORDER.length;i++){
        var k=VIEW_ORDER[i];
        if(v[k] && v[k].dxf_url) return v[k].dxf_url;
      }
      // Forward-compat: any other key the schema gains later.
      for(var key in v){
        if(VIEW_ORDER.indexOf(key)>=0) continue;
        if(v[key] && v[key].dxf_url) return v[key].dxf_url;
      }
    }
    return item.dxf_url||null;
  }

  global.CurinoCatalog={
    VIEW_ORDER:VIEW_ORDER,
    getDefaultDxfUrl:getDefaultDxfUrl
  };
})(window);
