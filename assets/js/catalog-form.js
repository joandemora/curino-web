// Curino — modal de subida/edición de pieza de catálogo (Catálogo Fase B).
//
// Compartido por /admin/ y /marca/. La diferencia entre los dos consumidores
// se concreta en el config que se le pasa a `open()`:
//   - admin: storagePathPrefix='', brand viene del input visible.
//   - brand: storagePathPrefix='<user_id>/', brand auto-rellena (oculto).
//
// El modal soporta:
//   1. Crear pieza nueva: pick DXF → parse → auto-cluster (k-means K=4 si
//      ≥50 entidades, K=1 si menos) → etiquetar cada cluster (Arriba /
//      Lado / Delante / Detrás / Ignorar) → save.
//   2. Editar pieza existente: pre-rellena campos. El DXF queda opcional
//      — si no se sube uno nuevo, las views existentes se conservan
//      intactas. Si se sube, se re-parsea y reemplaza todas las views.
//   3. Editar pieza legacy (sólo dxf_url, views=null): igual que (2). Al
//      no subir DXF nuevo conserva el dxf_url legacy. Al subir uno nuevo
//      activa el flujo multi-vista y deja los nuevos views poblados (el
//      dxf_url legacy se reemplaza por la URL de la vista "top").
//
// Format de los archivos subidos:
//   <prefix><uuid>_<label>.json  →  {w, h, shapes: [...]}
// Ver catalog-helpers.js para el resolver de URLs en el lado consumidor.
(function(global){
  var VIEW_LABELS=[
    {key:'top',   label:'Arriba'},
    {key:'side',  label:'Lado'},
    {key:'front', label:'Delante'},
    {key:'back',  label:'Detrás'}
  ];
  var DEFAULT_LABEL_ORDER=['top','side','front','back']; // applied to clusters[0..N-1]
  // Phase D-1: variant types are a closed list. The variant.name field
  // stores the type; variant.value (renamed from variant.size) holds the
  // actual choice. Adding a new type means appending here only.
  var VARIANT_TYPES=['Material','Color','Talla'];
  // Placeholder text for the value input depends on the chosen type.
  var VARIANT_VALUE_HINT={
    Material:'Material (ej. Roble natural)',
    Color:'Color (ej. Negro)',
    Talla:'Talla (ej. 120 cm)'
  };

  function escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function uuid(){
    if(window.crypto&&window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});
  }
  function ensureStyle(){
    if(document.getElementById('curino-catform-style')) return;
    var s=document.createElement('style');
    s.id='curino-catform-style';
    s.textContent=[
      '.cf-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:200;padding:1rem;font-family:var(--font,system-ui,sans-serif)}',
      '.cf-overlay.open{display:flex}',
      '.cf-modal{background:#fff;border-radius:10px;max-width:780px;width:100%;max-height:92vh;overflow-y:auto;padding:1.5rem 1.75rem;color:#1a1a1a}',
      '.cf-h2{font-size:16px;font-weight:600;margin:0 0 1rem}',
      '.cf-section{border-top:1px solid #e5e5e5;padding-top:1rem;margin-top:1rem}',
      '.cf-section:first-of-type{border-top:none;padding-top:0;margin-top:0}',
      '.cf-section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:.6rem}',
      '.cf-row{display:grid;grid-template-columns:1fr 1fr;gap:0 1rem}',
      '.cf-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 1rem}',
      '.cf-label{display:block;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.06em;margin:.85rem 0 .25rem}',
      '.cf-input,.cf-select{width:100%;padding:.55rem .6rem;font-size:13px;border:1px solid #e5e5e5;border-radius:4px;background:#fff;font-family:inherit;color:#1a1a1a}',
      '.cf-input[type=file]{padding:.45rem 0;border:none}',
      '.cf-checkbox{display:flex;align-items:center;gap:.5rem;margin-top:1rem;font-size:13px;color:#1a1a1a}',
      '.cf-error{display:none;background:#f8d7da;color:#721c24;padding:.5rem .7rem;font-size:12px;border-radius:4px;margin-top:.6rem}',
      '.cf-progress{display:none;background:#fff8e1;color:#8a6d1c;padding:.5rem .7rem;font-size:12px;border-radius:4px;margin-top:.6rem}',
      '.cf-actions{display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.25rem;padding-top:1rem;border-top:1px solid #e5e5e5}',
      '.cf-btn{padding:.5rem .85rem;font-size:12px;font-weight:600;border:1px solid #e5e5e5;background:#fff;border-radius:4px;cursor:pointer;font-family:inherit;color:#1a1a1a;letter-spacing:.04em}',
      '.cf-btn:hover{border-color:#1a1a1a}',
      '.cf-btn-primary{background:#1a1a1a;color:#fff;border-color:#1a1a1a}',
      '.cf-btn-primary:hover{background:#333}',
      '.cf-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.cf-views-hint{font-size:12px;color:#888;margin:.5rem 0 .75rem;line-height:1.5}',
      '.cf-cluster-controls{display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem;flex-wrap:wrap}',
      '.cf-cluster-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.75rem}',
      '.cf-cluster{border:1px solid #e5e5e5;border-radius:8px;padding:.6rem;background:#fafaf7;display:flex;flex-direction:column;gap:.5rem}',
      '.cf-cluster.ignored{opacity:.45}',
      '.cf-cluster-preview{width:100%;height:120px;background:#fff;border:1px solid #e5e5e5;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '.cf-cluster-preview svg{max-width:100%;max-height:100%;display:block}',
      '.cf-cluster-meta{font-size:10px;color:#888;text-align:center}',
      '.cf-cluster-select{width:100%;font-size:12px;padding:.3rem .4rem;border:1px solid #ddd;border-radius:4px;background:#fff;font-family:inherit}',
      '.cf-existing-views{font-size:12px;color:#555;background:#f4f4f0;padding:.6rem .75rem;border-radius:6px;margin-bottom:.6rem}',
      '.cf-existing-views strong{color:#1a1a1a}',
      '.cf-photo-row{display:flex;align-items:flex-start;gap:.75rem;margin-bottom:.5rem}',
      '.cf-photo-thumb{width:64px;height:64px;flex-shrink:0;border:1px solid #e5e5e5;border-radius:6px;background:#fafaf7;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:9px;color:#888}',
      '.cf-photo-thumb img{max-width:100%;max-height:100%;object-fit:contain}',
      '.cf-photo-actions{flex:1;display:flex;flex-direction:column;gap:.3rem}',
      '.cf-variants-list{display:flex;flex-direction:column;gap:.6rem;margin-top:.6rem}',
      '.cf-variant{border:1px solid #e5e5e5;border-radius:8px;padding:.6rem;background:#fafaf7;display:grid;grid-template-columns:64px 1fr auto;gap:.6rem;align-items:start}',
      '.cf-variant input[type=text]{padding:.35rem .5rem;font-size:12px;border:1px solid #ddd;border-radius:4px;width:100%;font-family:inherit}',
      '.cf-variant input[type=color]{width:40px;height:28px;padding:0;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:#fff}',
      '.cf-variant input[type=file]{font-size:11px}',
      '.cf-var-fields{display:flex;flex-direction:column;gap:.35rem}',
      '.cf-var-row-inline{display:flex;gap:.35rem;align-items:center}',
      '.cf-var-row-inline input[type=text]{flex:1}',
      '.cf-var-remove{background:transparent;border:none;color:#a83232;cursor:pointer;font-size:18px;padding:0;width:24px;height:24px;line-height:1}',
      '.cf-var-remove:hover{color:#7a1f1f}',
      '.cf-add-variant{margin-top:.5rem;padding:.45rem .8rem;background:#fff;border:1px dashed #999;border-radius:4px;cursor:pointer;font-size:12px;color:#444;width:100%}',
      '.cf-add-variant:hover{border-color:#1a1a1a;color:#1a1a1a}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // Render a cluster's shapes as an SVG <svg> string sized to fit `boxSize`.
  function renderClusterPreview(shapes,boxSize){
    if(!shapes.length) return '<svg width="'+boxSize+'" height="'+boxSize+'"></svg>';
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    shapes.forEach(function(s){
      var bb=window.childBboxLocal?childBboxLocal(s):null;
      if(!bb){
        if(s.type==='shape_line'||s.type==='shape_arc'){
          bb={x1:Math.min(s.x1,s.x2),y1:Math.min(s.y1,s.y2),x2:Math.max(s.x1,s.x2),y2:Math.max(s.y1,s.y2)};
        }else{
          bb={x1:s.x||0,y1:s.y||0,x2:(s.x||0)+(s.w||0),y2:(s.y||0)+(s.h||0)};
        }
      }
      if(bb.x1<minX) minX=bb.x1; if(bb.y1<minY) minY=bb.y1;
      if(bb.x2>maxX) maxX=bb.x2; if(bb.y2>maxY) maxY=bb.y2;
    });
    var w=maxX-minX, h=maxY-minY;
    var pad=Math.max(w,h)*0.05;
    var viewW=w+pad*2, viewH=h+pad*2;
    if(viewW<=0) viewW=1; if(viewH<=0) viewH=1;
    var svg='<svg viewBox="'+(minX-pad)+' '+(minY-pad)+' '+viewW+' '+viewH+'" preserveAspectRatio="xMidYMid meet" width="'+boxSize+'" height="'+boxSize+'" style="transform:scaleY(-1)">';
    shapes.forEach(function(s){
      if(s.type==='shape_line'){
        svg+='<line x1="'+s.x1+'" y1="'+s.y1+'" x2="'+s.x2+'" y2="'+s.y2+'" stroke="#000" stroke-width="'+(Math.max(w,h)*0.003)+'" vector-effect="non-scaling-stroke"/>';
      }else if(s.type==='shape_circle'){
        var cx=s.x+s.w/2, cy=s.y+s.h/2, rx=s.w/2, ry=s.h/2;
        svg+='<ellipse cx="'+cx+'" cy="'+cy+'" rx="'+rx+'" ry="'+ry+'" stroke="#000" fill="none" vector-effect="non-scaling-stroke"/>';
      }else if(s.type==='shape_arc'){
        // Approximate arc as a sampled polyline (simpler than computing SVG arc params from sagitta).
        var dx=s.x2-s.x1, dy=s.y2-s.y1;
        var chord=Math.sqrt(dx*dx+dy*dy)||1;
        var halfC=chord/2;
        var sag=Math.min(Math.abs(s.sagitta||0),halfC);
        if(sag<0.5){
          svg+='<line x1="'+s.x1+'" y1="'+s.y1+'" x2="'+s.x2+'" y2="'+s.y2+'" stroke="#000" vector-effect="non-scaling-stroke"/>';
        }else{
          var arcR=(halfC*halfC)/(2*sag)+sag/2;
          var midX=(s.x1+s.x2)/2, midY=(s.y1+s.y2)/2;
          var nx=-dy/chord, ny=dx/chord;
          var sign=(s.sagitta||1)>0?1:-1;
          var dist=arcR-sag;
          var ccx=midX-nx*sign*dist, ccy=midY-ny*sign*dist;
          var a1=Math.atan2(s.y1-ccy,s.x1-ccx);
          var a2=Math.atan2(s.y2-ccy,s.x2-ccx);
          var span=a2-a1; while(span<-Math.PI) span+=2*Math.PI; while(span>Math.PI) span-=2*Math.PI;
          var pts=[];
          for(var i=0;i<=20;i++){
            var t=i/20, ang=a1+span*t;
            pts.push((ccx+arcR*Math.cos(ang))+','+(ccy+arcR*Math.sin(ang)));
          }
          svg+='<polyline points="'+pts.join(' ')+'" stroke="#000" fill="none" vector-effect="non-scaling-stroke"/>';
        }
      }
    });
    svg+='</svg>';
    return svg;
  }

  // Slice raw shapes into a per-cluster shapes array with coords made
  // relative to that cluster's own bbox (so the resulting JSON can be
  // dropped at any world position). Returns {shapes,w,h}.
  function shapesFromCluster(allShapes,indices){
    if(indices.length===0) return null;
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    indices.forEach(function(i){
      var bb=childBboxLocal(allShapes[i]);
      if(bb.x1<minX) minX=bb.x1; if(bb.y1<minY) minY=bb.y1;
      if(bb.x2>maxX) maxX=bb.x2; if(bb.y2>maxY) maxY=bb.y2;
    });
    var w=Math.max(1,Math.round(maxX-minX));
    var h=Math.max(1,Math.round(maxY-minY));
    var shapes=indices.map(function(i){
      var s=JSON.parse(JSON.stringify(allShapes[i]));
      if(s.type==='shape_line'||s.type==='shape_arc'){
        s.x1=Math.round(s.x1-minX); s.y1=Math.round(s.y1-minY);
        s.x2=Math.round(s.x2-minX); s.y2=Math.round(s.y2-minY);
      }else{
        s.x=Math.round((s.x||0)-minX); s.y=Math.round((s.y||0)-minY);
      }
      return s;
    });
    return {shapes:shapes,w:w,h:h};
  }

  function open(config){
    ensureStyle();
    var supabase=config.supabase;
    var user=config.user;
    var role=config.role;             // 'admin' | 'brand'
    var brandFixed=config.brand||'';  // brand name for brand role
    var brandUserId=config.brandUserId||null;
    var item=config.item||null;
    var categories=config.categories||[];
    var onSaved=config.onSaved||function(){};

    // ── Build modal DOM ─────────────────────────────────────────────────
    var ov=document.createElement('div');
    ov.className='cf-overlay open';
    var modal=document.createElement('div');
    modal.className='cf-modal';
    var isEdit=!!item;
    var hasViews=isEdit&&item.views&&typeof item.views==='object'&&Object.keys(item.views).filter(function(k){return item.views[k]&&item.views[k].dxf_url;}).length>0;
    var hasLegacyDxf=isEdit&&!hasViews&&item.dxf_url;

    var brandFieldHtml=role==='admin'
      ?'<label class="cf-label">Marca *</label><input type="text" class="cf-input" id="cfBrand" required maxlength="80">'
      :'';

    var catOptions='<option value="">—</option>'+categories.map(function(c){return '<option value="'+c.key+'">'+escHtml(c.label)+'</option>';}).join('');
    var existingViewsBlock='';
    if(hasViews){
      var keys=Object.keys(item.views).filter(function(k){return item.views[k]&&item.views[k].dxf_url;});
      existingViewsBlock='<div class="cf-existing-views"><strong>Vistas actuales:</strong> '+keys.map(escHtml).join(', ')+'. Sube un DXF nuevo para reemplazarlas.</div>';
    }else if(hasLegacyDxf){
      existingViewsBlock='<div class="cf-existing-views"><strong>Pieza legacy:</strong> tiene un único DXF sin etiquetar. Sube un DXF nuevo para activar el sistema multi-vista.</div>';
    }

    modal.innerHTML=
      '<h2 class="cf-h2">'+(isEdit?'Editar pieza':'Añadir pieza')+'</h2>'+
      '<div class="cf-section">'+
        '<div class="cf-section-title">Datos</div>'+
        '<label class="cf-label">Nombre *</label><input type="text" class="cf-input" id="cfName" required maxlength="120">'+
        brandFieldHtml+
        '<div class="cf-row">'+
          '<div><label class="cf-label">Categoría *</label><select class="cf-select" id="cfCategory" required>'+catOptions+'</select></div>'+
          '<div><label class="cf-label">Subcategoría *</label><select class="cf-select" id="cfSub" required><option value="">—</option></select></div>'+
        '</div>'+
        '<div class="cf-row">'+
          '<div><label class="cf-label">Diseñador</label><input type="text" class="cf-input" id="cfDesigner" maxlength="80"></div>'+
          '<div><label class="cf-label">Año</label><input type="number" class="cf-input" id="cfYear" min="1800" max="2100"></div>'+
        '</div>'+
        '<div class="cf-row-3">'+
          '<div><label class="cf-label">Ancho (mm)</label><input type="number" class="cf-input" id="cfW" min="0"></div>'+
          '<div><label class="cf-label">Alto (mm)</label><input type="number" class="cf-input" id="cfH" min="0"></div>'+
          '<div><label class="cf-label">Fondo (mm)</label><input type="number" class="cf-input" id="cfD" min="0"></div>'+
        '</div>'+
        '<label class="cf-label">Unidad por defecto del DXF</label>'+
        '<select class="cf-select" id="cfUnit"><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option><option value="in">pulgadas</option><option value="ft">pies</option></select>'+
        '<label class="cf-checkbox"><input type="checkbox" id="cfActive" checked> Activa (visible en el catálogo público)</label>'+
      '</div>'+
      '<div class="cf-section">'+
        '<div class="cf-section-title">Vistas</div>'+
        existingViewsBlock+
        '<label class="cf-label">'+(isEdit?'Re-subir DXF (opcional)':'DXF *')+'</label>'+
        '<input type="file" class="cf-input" id="cfDxf" accept=".dxf">'+
        '<div class="cf-views-hint" id="cfViewsHint">Selecciona un archivo .dxf para ver las vistas detectadas.</div>'+
        '<div id="cfClusterArea" style="display:none">'+
          '<div class="cf-cluster-controls">'+
            '<label style="font-size:12px;color:#555">Vistas detectadas: '+
              '<select class="cf-select" id="cfK" style="display:inline-block;width:auto;margin-left:.5rem">'+
                [1,2,3,4,5,6,7,8].map(function(n){return '<option value="'+n+'">'+n+'</option>';}).join('')+
              '</select>'+
            '</label>'+
            '<span style="font-size:11px;color:#888" id="cfEntInfo"></span>'+
          '</div>'+
          '<div class="cf-cluster-grid" id="cfClusterGrid"></div>'+
        '</div>'+
      '</div>'+
      '<div class="cf-section">'+
        '<div class="cf-section-title">Imagen del producto</div>'+
        '<div class="cf-photo-row">'+
          '<div class="cf-photo-thumb" id="cfMainThumb">foto</div>'+
          '<div class="cf-photo-actions">'+
            '<label class="cf-label" style="margin-top:0">Foto principal (JPG/PNG/WebP)</label>'+
            '<input type="file" class="cf-input" id="cfMainPhoto" accept="image/jpeg,image/png,image/webp">'+
            '<button type="button" class="cf-btn cf-btn-small" id="cfMainPhotoRemove" style="display:none;align-self:flex-start;padding:.25rem .6rem;font-size:11px">Quitar foto</button>'+
          '</div>'+
        '</div>'+
        '<div class="cf-section-title" style="margin-top:1rem">Variantes</div>'+
        '<div class="cf-variants-list" id="cfVariantsList"></div>'+
        '<button type="button" class="cf-add-variant" id="cfAddVariant">+ Añadir variante</button>'+
      '</div>'+
      '<div class="cf-error" id="cfError"></div>'+
      '<div class="cf-progress" id="cfProgress"></div>'+
      '<div class="cf-actions">'+
        '<button type="button" class="cf-btn" id="cfCancel">Cancelar</button>'+
        '<button type="button" class="cf-btn cf-btn-primary" id="cfSave">Guardar</button>'+
      '</div>';
    ov.appendChild(modal);
    document.body.appendChild(ov);

    // ── Pre-fill form ───────────────────────────────────────────────────
    function $(id){return document.getElementById(id);}
    if(item){
      $('cfName').value=item.name||'';
      if(role==='admin'&&$('cfBrand')) $('cfBrand').value=item.brand||'';
      $('cfCategory').value=(item.category||'').toLowerCase();
      populateSubs();
      $('cfSub').value=(item.subcategory||'').toLowerCase();
      $('cfDesigner').value=item.designer||'';
      $('cfYear').value=item.year||'';
      $('cfW').value=item.width_mm||'';
      $('cfH').value=item.height_mm||'';
      $('cfD').value=item.depth_mm||'';
      $('cfUnit').value=item.default_unit||'mm';
      $('cfActive').checked=!!item.active;
    }
    $('cfCategory').addEventListener('change',populateSubs);
    function populateSubs(){
      var cat=$('cfCategory').value;
      var sel=$('cfSub');
      sel.innerHTML='<option value="">—</option>';
      if(!cat) return;
      var c=categories.find(function(x){return x.key===cat;});
      if(c) sel.innerHTML+=c.subs.map(function(s){return '<option value="'+s.key+'">'+escHtml(s.label)+'</option>';}).join('');
    }

    // ── Parsing + clustering state ──────────────────────────────────────
    var parsedShapes=null;     // raw shapes after parse+scale, in mm
    var parsedW=0, parsedH=0;
    var clusters=null;         // array of arrays of indices
    var labels=[];             // string per cluster: 'top'|'side'|'front'|'back'|'ignore'

    // ── Product photo + variants state (Fase D) ────────────────────────
    // mainPhoto: {existingUrl, newFile, removed} — `removed` only meaningful
    //            on edit, marks the existing photo for deletion on save.
    // variants:  array of {id,name,color_hex,size,existingPhotoUrl,newFile}.
    //            id is stable per variant so the storage path
    //            <prefix><uuid>_var_<id>.<ext> survives reorder/edit.
    // removedPhotoPaths: best-effort cleanup queue for variants the user
    //            removed during this session (and the main photo if dropped).
    var mainPhoto={existingUrl:item&&item.product_photo_url||null, newFile:null, removed:false};
    var variants=[];
    var removedPhotoPaths=[];
    if(item&&Array.isArray(item.variants)){
      item.variants.forEach(function(v){
        // Re-derive a synthetic id from the existing photo URL when present
        // so the upload path stays the same on edit and we don't accumulate
        // stale files. New variants get a fresh uuid.
        var stableId=null;
        if(v.photo_url){
          var m=String(v.photo_url).match(/_var_([a-zA-Z0-9-]+)\./);
          if(m) stableId=m[1];
        }
        // Phase D-1: variant.name is now a fixed dropdown of types and the
        // old `size` field becomes `value`. Backwards-compat at read:
        //   - value: v.value (new) → v.size (legacy) → ''.
        //   - name : keep v.name only if it matches a known type, else
        //            default to 'Material'. Legacy free-text names like
        //            "Roble natural" lose their label here; the user has
        //            to re-pick the type on next edit.
        var typeName=(VARIANT_TYPES.indexOf(v.name)>=0)?v.name:VARIANT_TYPES[0];
        variants.push({
          id:stableId||uuid(),
          name:typeName,
          color_hex:v.color_hex||'',
          value:(v.value!=null?v.value:(v.size||''))||'',
          existingPhotoUrl:v.photo_url||null,
          newFile:null
        });
      });
    }
    function refreshMainPhotoPreview(){
      var box=$('cfMainThumb');
      var rmBtn=$('cfMainPhotoRemove');
      var url=null;
      if(mainPhoto.newFile) url=URL.createObjectURL(mainPhoto.newFile);
      else if(mainPhoto.existingUrl&&!mainPhoto.removed) url=mainPhoto.existingUrl;
      if(url){
        box.innerHTML='<img src="'+escHtml(url)+'" alt="">';
        rmBtn.style.display='inline-block';
      }else{
        box.innerHTML='foto';
        rmBtn.style.display='none';
      }
    }
    function renderVariants(){
      var list=$('cfVariantsList');
      list.innerHTML='';
      variants.forEach(function(v,idx){
        var thumbUrl=null;
        if(v.newFile) thumbUrl=URL.createObjectURL(v.newFile);
        else if(v.existingPhotoUrl) thumbUrl=v.existingPhotoUrl;
        var thumb=thumbUrl?'<img src="'+escHtml(thumbUrl)+'" alt="">':'foto';
        var div=document.createElement('div');
        div.className='cf-variant';
        var typeOpts=VARIANT_TYPES.map(function(t){return '<option value="'+t+'"'+(v.name===t?' selected':'')+'>'+t+'</option>';}).join('');
        var valuePh=VARIANT_VALUE_HINT[v.name]||'Valor';
        div.innerHTML=
          '<div class="cf-photo-thumb" style="width:64px;height:64px">'+thumb+'</div>'+
          '<div class="cf-var-fields">'+
            '<select data-field="name" class="cf-cluster-select">'+typeOpts+'</select>'+
            '<input type="text" placeholder="'+escHtml(valuePh)+'" value="'+escHtml(v.value||'')+'" data-field="value">'+
            '<input type="file" accept="image/jpeg,image/png,image/webp" data-field="file">'+
            '<div class="cf-var-row-inline">'+
              '<input type="color" value="'+(v.color_hex||'#cccccc')+'" data-field="color" title="Color hex">'+
            '</div>'+
          '</div>'+
          '<button type="button" class="cf-var-remove" title="Eliminar variante">×</button>';
        var inputs=div.querySelectorAll('[data-field]');
        var valueInp=div.querySelector('input[data-field="value"]');
        inputs.forEach(function(inp){
          var evt=(inp.tagName==='SELECT')?'change':'change';
          inp.addEventListener(evt,function(){
            if(inp.dataset.field==='name'){
              v.name=inp.value;
              // Update the value input's placeholder live so the label
              // hint reflects the chosen type without a full re-render
              // (which would lose focus on whatever input the user is
              // about to fill next).
              if(valueInp) valueInp.placeholder=VARIANT_VALUE_HINT[v.name]||'Valor';
            }
            else if(inp.dataset.field==='color') v.color_hex=inp.value;
            else if(inp.dataset.field==='value') v.value=inp.value;
            else if(inp.dataset.field==='file'&&inp.files&&inp.files[0]){
              if(inp.files[0].size>5*1024*1024){alert('Foto de variante demasiado grande (>5 MB).');inp.value='';return;}
              v.newFile=inp.files[0];
              renderVariants();
            }
          });
        });
        div.querySelector('.cf-var-remove').addEventListener('click',function(){
          if(v.existingPhotoUrl){
            var p=storagePathFromUrl(v.existingPhotoUrl,'catalog-photos');
            if(p) removedPhotoPaths.push(p);
          }
          variants.splice(idx,1);
          renderVariants();
        });
        list.appendChild(div);
      });
    }
    $('cfMainPhoto').addEventListener('change',function(){
      var f=this.files&&this.files[0];
      if(!f) return;
      if(f.size>5*1024*1024){alert('Foto principal demasiado grande (>5 MB).');this.value='';return;}
      mainPhoto.newFile=f;
      mainPhoto.removed=false;
      refreshMainPhotoPreview();
    });
    $('cfMainPhotoRemove').addEventListener('click',function(){
      mainPhoto.newFile=null;
      mainPhoto.removed=!!mainPhoto.existingUrl;
      $('cfMainPhoto').value='';
      refreshMainPhotoPreview();
    });
    $('cfAddVariant').addEventListener('click',function(){
      variants.push({id:uuid(),name:'',color_hex:'',size:'',existingPhotoUrl:null,newFile:null});
      renderVariants();
    });
    function storagePathFromUrl(url,bucket){
      var m=String(url||'').match(new RegExp('/storage/v1/object/public/'+bucket+'/([^?]+)'));
      return m?decodeURIComponent(m[1]):null;
    }
    refreshMainPhotoPreview();
    renderVariants();

    $('cfDxf').addEventListener('change',function(){onDxfPicked(this.files[0]);});
    $('cfK').addEventListener('change',function(){
      if(!parsedShapes) return;
      var K=parseInt(this.value,10)||4;
      reCluster(K);
    });

    async function onDxfPicked(file){
      if(!file){return;}
      $('cfError').style.display='none';
      $('cfViewsHint').textContent='Analizando DXF…';
      $('cfClusterArea').style.display='none';
      try{
        var text=await readFileText(file);
        var unitOverride=null;
        var defaultUnit=$('cfUnit').value;
        // The user's unit choice in the form is treated as a hint when
        // the DXF lacks $INSUNITS — saves a click for repeat uploads.
        if(defaultUnit==='mm') unitOverride=1;
        else if(defaultUnit==='cm') unitOverride=10;
        else if(defaultUnit==='m') unitOverride=1000;
        else if(defaultUnit==='in') unitOverride=25.4;
        else if(defaultUnit==='ft') unitOverride=304.8;
        var parsed=await CurinoDxf.dxfTextToShapes(text,unitOverride);
        if(!parsed||parsed.shapes.length===0){
          $('cfViewsHint').textContent='El DXF no contiene entidades importables.';
          parsedShapes=null;return;
        }
        parsedShapes=parsed.shapes; parsedW=parsed.w; parsedH=parsed.h;
        // Auto-K: 1 if <50 entities, 4 otherwise.
        var initialK=parsedShapes.length<50?1:4;
        if(initialK>parsedShapes.length) initialK=parsedShapes.length;
        $('cfK').value=String(initialK);
        $('cfEntInfo').textContent=parsedShapes.length+' entidades · bbox '+parsedW+'×'+parsedH+' mm';
        $('cfClusterArea').style.display='block';
        $('cfViewsHint').textContent='Etiqueta cada vista o márcala como Ignorar.';
        reCluster(initialK);
      }catch(err){
        console.error(err);
        $('cfViewsHint').textContent='Error al leer el DXF.';
        parsedShapes=null;
      }
    }
    function reCluster(K){
      if(!parsedShapes) return;
      if(K<=1||parsedShapes.length<2){
        clusters=[parsedShapes.map(function(_,i){return i;})];
      }else{
        clusters=kmeansClusterChildren(parsedShapes,K);
      }
      // Default labels per cluster index, falling through to 'ignore' for >4.
      labels=clusters.map(function(_,i){return DEFAULT_LABEL_ORDER[i]||'ignore';});
      renderClusters();
    }
    function renderClusters(){
      var grid=$('cfClusterGrid');
      grid.innerHTML='';
      clusters.forEach(function(idxs,i){
        var label=labels[i];
        var cluster=shapesFromCluster(parsedShapes,idxs);
        var div=document.createElement('div');
        div.className='cf-cluster'+(label==='ignore'?' ignored':'');
        var preview=cluster?renderClusterPreview(cluster.shapes,120):'';
        div.innerHTML=
          '<div class="cf-cluster-preview">'+preview+'</div>'+
          '<div class="cf-cluster-meta">'+idxs.length+' entidades</div>'+
          '<select class="cf-cluster-select">'+
            VIEW_LABELS.map(function(l){return '<option value="'+l.key+'"'+(label===l.key?' selected':'')+'>'+l.label+'</option>';}).join('')+
            '<option value="ignore"'+(label==='ignore'?' selected':'')+'>Ignorar</option>'+
          '</select>';
        var sel=div.querySelector('select');
        sel.addEventListener('change',function(){
          labels[i]=this.value;
          // Auto-reflect ignore visual without a full re-render.
          div.classList.toggle('ignored',this.value==='ignore');
        });
        grid.appendChild(div);
      });
    }

    // ── Save ────────────────────────────────────────────────────────────
    $('cfCancel').addEventListener('click',close);
    $('cfSave').addEventListener('click',save);

    function close(){ov.remove();}
    function fail(msg){var e=$('cfError');e.textContent=msg;e.style.display='block';$('cfProgress').style.display='none';$('cfSave').disabled=false;}

    async function save(){
      $('cfError').style.display='none';
      var btn=$('cfSave');
      btn.disabled=true;
      var name=$('cfName').value.trim();
      var brand=role==='admin'?($('cfBrand')?$('cfBrand').value.trim():''):brandFixed;
      var category=$('cfCategory').value;
      var subcategory=$('cfSub').value;
      if(!name||!brand||!category||!subcategory){fail('Faltan campos obligatorios.');return;}
      var designer=$('cfDesigner').value.trim()||null;
      var year=parseInt($('cfYear').value,10)||null;
      var width_mm=parseInt($('cfW').value,10)||null;
      var height_mm=parseInt($('cfH').value,10)||null;
      var depth_mm=parseInt($('cfD').value,10)||null;
      var default_unit=$('cfUnit').value||'mm';
      var active=$('cfActive').checked;
      var hasNewDxf=parsedShapes&&clusters;

      // For new pieces a DXF is required. For edits, keeping the existing
      // views (no new file) is allowed.
      if(!isEdit&&!hasNewDxf){fail('El DXF es obligatorio al crear una pieza.');return;}

      // Validate at least one labelled cluster when uploading a new DXF.
      var labelled=hasNewDxf?labels.filter(function(l){return l!=='ignore';}):[];
      if(hasNewDxf&&labelled.length===0){fail('Etiqueta al menos una vista (no todo "Ignorar").');return;}

      var prog=$('cfProgress');prog.style.display='block';prog.textContent='Subiendo…';

      var id=item?item.id:uuid();
      var prefix=role==='brand'?(user.id+'/'):'';
      var newViews=null;
      var topUrl=null;

      try{
        if(hasNewDxf){
          newViews={};
          // Each labelled cluster gets one JSON file. Multiple clusters with
          // the same label collapse to the last one (sane fallback for the
          // unlikely "two clusters labelled Top" case).
          for(var i=0;i<clusters.length;i++){
            var label=labels[i];
            if(label==='ignore') continue;
            var cluster=shapesFromCluster(parsedShapes,clusters[i]);
            if(!cluster) continue;
            var payload={w:cluster.w,h:cluster.h,shapes:cluster.shapes};
            var blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
            var path=prefix+id+'_'+label+'.json';
            var up=await supabase.storage.from('catalog-dxfs').upload(path,blob,{upsert:true,contentType:'application/json'});
            if(up.error) throw new Error('Subida '+label+': '+up.error.message);
            var url=supabase.storage.from('catalog-dxfs').getPublicUrl(path).data.publicUrl;
            newViews[label]={dxf_url:url};
            if(label==='top') topUrl=url;
          }
          if(!topUrl){
            // No "top" label — pick the first available view for the legacy dxf_url field.
            for(var k=0;k<DEFAULT_LABEL_ORDER.length;k++){
              var key=DEFAULT_LABEL_ORDER[k];
              if(newViews[key]){topUrl=newViews[key].dxf_url;break;}
            }
          }
        }
      }catch(err){fail(err.message||'Error subiendo archivos.');return;}

      // Main product photo is mandatory — covers both new pieces and edits
      // of legacy pieces (which arrive with no product_photo_url at all).
      // Editing a legacy piece therefore forces the migration: the user
      // can't save until they upload a hero shot. The check looks at three
      // states: (a) a fresh file picked in this session, (b) the existing
      // URL preserved from the loaded item, (c) explicit removal flagged.
      var hasMainPhoto=mainPhoto.newFile||(mainPhoto.existingUrl&&!mainPhoto.removed);
      if(!hasMainPhoto){fail('Sube una foto del producto antes de guardar.');return;}

      // Validate variants before doing any photo I/O so we fail fast.
      // name is the type (Material/Color/Talla); value is the actual choice.
      // Variants stay optional — only the main photo is mandatory.
      for(var vi=0;vi<variants.length;vi++){
        var vv=variants[vi];
        if(VARIANT_TYPES.indexOf(vv.name)<0){fail('Cada variante necesita un tipo válido.');return;}
        if(!vv.value||!String(vv.value).trim()){fail('La variante de tipo "'+vv.name+'" necesita un valor.');return;}
        if(!vv.newFile&&!vv.existingPhotoUrl){fail('La variante "'+vv.name+': '+vv.value+'" necesita una foto.');return;}
      }

      // Photos: main product photo + per-variant photos. Skipped on errors
      // — falls back to keeping whatever URL was already there.
      prog.textContent='Subiendo fotos…';
      var product_photo_url=item&&item.product_photo_url||null;
      try{
        if(mainPhoto.newFile){
          var mext=(mainPhoto.newFile.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
          if(!mext) mext='jpg';
          // One main photo per piece — drop alternate extensions for the same id.
          ['jpg','jpeg','png','webp'].forEach(function(e){if(e!==mext) supabase.storage.from('catalog-photos').remove([prefix+id+'_main.'+e]);});
          var mpath=prefix+id+'_main.'+mext;
          var mup=await supabase.storage.from('catalog-photos').upload(mpath,mainPhoto.newFile,{upsert:true,contentType:mainPhoto.newFile.type});
          if(mup.error) throw new Error('Foto principal: '+mup.error.message);
          product_photo_url=supabase.storage.from('catalog-photos').getPublicUrl(mpath).data.publicUrl;
        }else if(mainPhoto.removed&&mainPhoto.existingUrl){
          var mp=storagePathFromUrl(mainPhoto.existingUrl,'catalog-photos');
          if(mp) await supabase.storage.from('catalog-photos').remove([mp]);
          product_photo_url=null;
        }
        // Per-variant uploads. Path is stable on `variant.id` so re-saves
        // overwrite the same key. Cleanup of removedPhotoPaths runs after.
        var finalVariants=[];
        for(var vj=0;vj<variants.length;vj++){
          var vrec=variants[vj];
          var photoUrl=vrec.existingPhotoUrl;
          if(vrec.newFile){
            var vext=(vrec.newFile.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
            if(!vext) vext='jpg';
            ['jpg','jpeg','png','webp'].forEach(function(e){if(e!==vext) supabase.storage.from('catalog-photos').remove([prefix+id+'_var_'+vrec.id+'.'+e]);});
            var vpath=prefix+id+'_var_'+vrec.id+'.'+vext;
            var vup=await supabase.storage.from('catalog-photos').upload(vpath,vrec.newFile,{upsert:true,contentType:vrec.newFile.type});
            if(vup.error) throw new Error('Variante "'+vrec.name+'": '+vup.error.message);
            photoUrl=supabase.storage.from('catalog-photos').getPublicUrl(vpath).data.publicUrl;
          }
          finalVariants.push({
            name:vrec.name,                      // Material | Color | Talla
            value:String(vrec.value||'').trim(), // free text value
            color_hex:vrec.color_hex||null,
            photo_url:photoUrl
          });
        }
        // Remove orphan files from variants the user deleted in this session.
        for(var rp=0;rp<removedPhotoPaths.length;rp++){
          await supabase.storage.from('catalog-photos').remove([removedPhotoPaths[rp]]);
        }
      }catch(err){fail(err.message||'Error subiendo fotos.');return;}

      // Build payload. When keeping existing views (edit without new DXF),
      // leave views and dxf_url untouched.
      prog.textContent='Guardando…';
      var payload={
        id:id,
        name:name, brand:brand,
        category:category, subcategory:subcategory,
        designer:designer, year:year,
        width_mm:width_mm, height_mm:height_mm, depth_mm:depth_mm,
        default_unit:default_unit, active:active,
        product_photo_url:product_photo_url,
        variants:finalVariants.length>0?finalVariants:null
      };
      if(role==='brand') payload.brand_user_id=brandUserId;
      if(hasNewDxf){
        payload.views=newViews;
        payload.dxf_url=topUrl||'';
        payload.thumbnail_url=item&&item.thumbnail_url||null;
      }
      var op=isEdit
        ?supabase.from('catalog_items').update(payload).eq('id',id)
        :supabase.from('catalog_items').insert(payload);
      var res=await op;
      if(res.error){fail('Error guardando la pieza: '+res.error.message);return;}
      prog.style.display='none';
      btn.disabled=false;
      close();
      onSaved();
    }
  }

  global.CurinoCatalogForm={open:open};
})(window);
