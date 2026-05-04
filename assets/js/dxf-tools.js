// Curino — herramientas DXF compartidas (Marcas + Catálogo Multi-vista)
// Originalmente vivían inline en configurador-2d/index.html. Extraídas
// aquí en Catálogo Fase B para que /admin/, /marca/ y el propio
// configurador compartan parser, k-means y ask-units sin duplicar código.
//
// Todos los símbolos quedan colgados de window porque el proyecto no
// usa bundler — `<script src="/assets/js/dxf-tools.js">` los pone como
// globales que cualquier inline script puede llamar.
(function(global){
  // ── DXF parser (LINE / CIRCLE / ARC / LWPOLYLINE / POLYLINE / SPLINE) ──
  function parseDxf(text){
    var lines=text.replace(/\r\n/g,'\n').split('\n');
    var pairs=[];
    for(var i=0;i+1<lines.length;i+=2){
      var code=parseInt(lines[i].trim(),10);
      if(isNaN(code)) continue;
      pairs.push([code,lines[i+1].trim()]);
    }
    var insunits=0;
    var section=null;
    var entities=[];
    var current=null;
    var currentVertex=null;
    function commit(){if(current){entities.push(current);current=null;currentVertex=null;}}
    for(var k=0;k<pairs.length;k++){
      var c=pairs[k][0], v=pairs[k][1];
      if(c===0){
        if(v==='SECTION'){
          if(pairs[k+1]&&pairs[k+1][0]===2) section=pairs[k+1][1];
        }else if(v==='ENDSEC'){
          commit(); section=null;
        }else if(v==='EOF'){
          commit(); break;
        }else if(section==='ENTITIES'){
          if(v==='LINE'||v==='CIRCLE'||v==='ARC'||v==='LWPOLYLINE'||v==='POLYLINE'){
            commit(); current={type:v,vertices:[],flags:0};
          }else if(v==='SPLINE'){
            commit(); current={type:'SPLINE',knots:[],controlPoints:[],fitPoints:[],degree:3,flags:0};
          }else if(v==='VERTEX'){
            if(current&&current.type==='POLYLINE'){
              currentVertex={x:0,y:0};
              current.vertices.push(currentVertex);
            }
          }else if(v==='SEQEND'){
            commit();
          }else{
            commit();
          }
        }
        continue;
      }
      if(section==='HEADER'&&c===9&&v==='$INSUNITS'){
        if(pairs[k+1]&&pairs[k+1][0]===70) insunits=parseInt(pairs[k+1][1],10)||0;
      }
      if(section!=='ENTITIES'||!current) continue;
      var nv=parseFloat(v);
      if(current.type==='LINE'){
        if(c===10) current.x1=nv; else if(c===20) current.y1=nv;
        else if(c===11) current.x2=nv; else if(c===21) current.y2=nv;
      }else if(current.type==='CIRCLE'){
        if(c===10) current.cx=nv; else if(c===20) current.cy=nv;
        else if(c===40) current.r=nv;
      }else if(current.type==='ARC'){
        if(c===10) current.cx=nv; else if(c===20) current.cy=nv;
        else if(c===40) current.r=nv;
        else if(c===50) current.a1=nv; else if(c===51) current.a2=nv;
      }else if(current.type==='LWPOLYLINE'){
        if(c===70) current.flags=parseInt(v,10)||0;
        else if(c===10) current.vertices.push({x:nv,y:0});
        else if(c===20&&current.vertices.length>0){
          current.vertices[current.vertices.length-1].y=nv;
        }
      }else if(current.type==='POLYLINE'){
        if(c===70) current.flags=parseInt(v,10)||0;
        else if(currentVertex){
          if(c===10) currentVertex.x=nv;
          else if(c===20) currentVertex.y=nv;
        }
      }else if(current.type==='SPLINE'){
        if(c===70) current.flags=parseInt(v,10)||0;
        else if(c===71) current.degree=parseInt(v,10)||3;
        else if(c===40) current.knots.push(nv);
        else if(c===10) current.controlPoints.push({x:nv,y:0});
        else if(c===20&&current.controlPoints.length>0){
          current.controlPoints[current.controlPoints.length-1].y=nv;
        }
        else if(c===11) current.fitPoints.push({x:nv,y:0});
        else if(c===21&&current.fitPoints.length>0){
          current.fitPoints[current.fitPoints.length-1].y=nv;
        }
      }
    }
    commit();
    return {insunits:insunits, entities:entities};
  }
  function nurbsFindSpan(n,p,u,knots){
    if(u>=knots[n+1]) return n;
    if(u<=knots[p]) return p;
    var low=p,high=n+1,mid=(low+high)>>1;
    while(u<knots[mid]||u>=knots[mid+1]){
      if(u<knots[mid]) high=mid; else low=mid;
      mid=(low+high)>>1;
      if(mid<=p) return p;
      if(mid>=n) return n;
    }
    return mid;
  }
  function nurbsDeBoor(cps,knots,p,u){
    var n=cps.length-1;
    var k=nurbsFindSpan(n,p,u,knots);
    var d=[];
    for(var j=0;j<=p;j++){
      var idx=k-p+j;
      if(idx<0) idx=0; if(idx>n) idx=n;
      d[j]={x:cps[idx].x,y:cps[idx].y};
    }
    for(var r=1;r<=p;r++){
      for(var j=p;j>=r;j--){
        var i=k-p+j;
        var denom=knots[i+p-r+1]-knots[i];
        var alpha=denom>0?(u-knots[i])/denom:0;
        d[j]={x:(1-alpha)*d[j-1].x+alpha*d[j].x, y:(1-alpha)*d[j-1].y+alpha*d[j].y};
      }
    }
    return d[p];
  }
  function sampleSpline(e){
    var p=e.degree||3;
    var cps=e.controlPoints||[];
    var fps=e.fitPoints||[];
    var knots=e.knots||[];
    var N=40;
    if(cps.length>=p+1&&knots.length===cps.length+p+1){
      var u0=knots[p], u1=knots[knots.length-p-1];
      if(u1>u0+1e-9){
        var samples=[];
        for(var i=0;i<=N;i++){
          var u=u0+(u1-u0)*i/N;
          samples.push(nurbsDeBoor(cps,knots,p,u));
        }
        return samples;
      }
    }
    if(fps.length>=2) return fps.slice();
    if(cps.length>=2) return cps.slice();
    return [];
  }
  function dxfScaleToMM(insunits, bboxMaxSpan){
    if(insunits===4) return 1;
    if(insunits===5) return 10;
    if(insunits===6) return 1000;
    if(insunits===1) return 25.4;
    if(insunits===2) return 304.8;
    if(bboxMaxSpan>0&&bboxMaxSpan<100) return 1000;
    if(bboxMaxSpan>100000) return 0.001;
    return 1;
  }
  function dxfArcToShapes(cx,cy,r,a1Deg,a2Deg){
    var a1=a1Deg*Math.PI/180, a2=a2Deg*Math.PI/180;
    var span=a2-a1; while(span<0) span+=2*Math.PI; while(span>2*Math.PI) span-=2*Math.PI;
    if(span<0.001) return [];
    if(span>Math.PI+0.001){
      var midA=a1+span/2;
      return dxfArcToShapes(cx,cy,r,a1Deg,midA*180/Math.PI)
        .concat(dxfArcToShapes(cx,cy,r,midA*180/Math.PI,a2Deg));
    }
    var x1=cx+r*Math.cos(a1), y1=cy+r*Math.sin(a1);
    var x2=cx+r*Math.cos(a2), y2=cy+r*Math.sin(a2);
    var sag=-(r-r*Math.cos(span/2));
    return [{type:'shape_arc',x1:x1,y1:y1,x2:x2,y2:y2,sagitta:sag,stroke:'#000000',strokeWidth:1}];
  }
  function dxfEntitiesToShapes(entities){
    var shapes=[];
    entities.forEach(function(e){
      if(e.type==='LINE'){
        if(e.x1==null||e.y1==null||e.x2==null||e.y2==null) return;
        shapes.push({type:'shape_line',x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2,stroke:'#000000',strokeWidth:1});
      }else if(e.type==='CIRCLE'){
        if(e.cx==null||e.cy==null||!e.r) return;
        shapes.push({type:'shape_circle',x:e.cx-e.r,y:e.cy-e.r,w:2*e.r,h:2*e.r,stroke:'#000000',strokeWidth:1,fill:'none'});
      }else if(e.type==='ARC'){
        if(e.cx==null||e.cy==null||!e.r||e.a1==null||e.a2==null) return;
        Array.prototype.push.apply(shapes,dxfArcToShapes(e.cx,e.cy,e.r,e.a1,e.a2));
      }else if(e.type==='LWPOLYLINE'||e.type==='POLYLINE'){
        var vs=e.vertices||[];
        if(vs.length<2) return;
        for(var i=0;i<vs.length-1;i++){
          shapes.push({type:'shape_line',x1:vs[i].x,y1:vs[i].y,x2:vs[i+1].x,y2:vs[i+1].y,stroke:'#000000',strokeWidth:1});
        }
        if((e.flags||0)&1){
          shapes.push({type:'shape_line',x1:vs[vs.length-1].x,y1:vs[vs.length-1].y,x2:vs[0].x,y2:vs[0].y,stroke:'#000000',strokeWidth:1});
        }
      }else if(e.type==='SPLINE'){
        var sp=sampleSpline(e);
        if(sp.length<2) return;
        for(var si=0;si<sp.length-1;si++){
          shapes.push({type:'shape_line',x1:sp[si].x,y1:sp[si].y,x2:sp[si+1].x,y2:sp[si+1].y,stroke:'#000000',strokeWidth:1});
        }
        if((e.flags||0)&1){
          shapes.push({type:'shape_line',x1:sp[sp.length-1].x,y1:sp[sp.length-1].y,x2:sp[0].x,y2:sp[0].y,stroke:'#000000',strokeWidth:1});
        }
      }
    });
    return shapes;
  }
  function readFileText(file){
    return new Promise(function(resolve,reject){
      var r=new FileReader();
      r.onload=function(){resolve(r.result);};
      r.onerror=function(){reject(r.error||new Error('read failed'));};
      r.readAsText(file);
    });
  }
  function childBboxLocal(ch){
    if(ch.type==='shape_line'||ch.type==='shape_arc'){
      return {
        x1:Math.min(ch.x1,ch.x2), y1:Math.min(ch.y1,ch.y2),
        x2:Math.max(ch.x1,ch.x2), y2:Math.max(ch.y1,ch.y2)
      };
    }
    return {x1:ch.x||0, y1:ch.y||0, x2:(ch.x||0)+(ch.w||0), y2:(ch.y||0)+(ch.h||0)};
  }
  function kmeansClusterChildren(children,N){
    var n=children.length;
    if(N>=n) return children.map(function(_,i){return [i];});
    var centroids=children.map(function(ch){
      var bb=childBboxLocal(ch);
      return {x:(bb.x1+bb.x2)/2, y:(bb.y1+bb.y2)/2};
    });
    var centers=[];
    centers.push({x:centroids[Math.floor(Math.random()*n)].x, y:centroids[Math.floor(Math.random()*n)].y});
    var distSq=new Float64Array(n);
    while(centers.length<N){
      var sum=0;
      for(var i=0;i<n;i++){
        var minD=Infinity;
        for(var j=0;j<centers.length;j++){
          var dx=centroids[i].x-centers[j].x, dy=centroids[i].y-centers[j].y;
          var d=dx*dx+dy*dy;
          if(d<minD) minD=d;
        }
        distSq[i]=minD; sum+=minD;
      }
      if(sum<=0) break;
      var r=Math.random()*sum, cum=0, picked=0;
      for(var ii=0;ii<n;ii++){cum+=distSq[ii]; if(cum>=r){picked=ii;break;}}
      centers.push({x:centroids[picked].x, y:centroids[picked].y});
    }
    var assign=new Int32Array(n);
    var maxIter=30;
    for(var iter=0;iter<maxIter;iter++){
      var changed=false;
      for(var i2=0;i2<n;i2++){
        var minD2=Infinity, best=0;
        for(var j2=0;j2<centers.length;j2++){
          var dx2=centroids[i2].x-centers[j2].x, dy2=centroids[i2].y-centers[j2].y;
          var d2=dx2*dx2+dy2*dy2;
          if(d2<minD2){minD2=d2; best=j2;}
        }
        if(assign[i2]!==best){assign[i2]=best; changed=true;}
      }
      if(!changed) break;
      var sx=new Float64Array(centers.length), sy=new Float64Array(centers.length), sn=new Int32Array(centers.length);
      for(var i3=0;i3<n;i3++){var a=assign[i3]; sx[a]+=centroids[i3].x; sy[a]+=centroids[i3].y; sn[a]++;}
      for(var j3=0;j3<centers.length;j3++){
        if(sn[j3]>0){centers[j3].x=sx[j3]/sn[j3]; centers[j3].y=sy[j3]/sn[j3];}
      }
    }
    var buckets={};
    for(var i4=0;i4<n;i4++){
      var aa=assign[i4];
      if(!buckets[aa]) buckets[aa]=[];
      buckets[aa].push(i4);
    }
    return Object.keys(buckets).map(function(k){return buckets[k];});
  }
  function askDxfUnits(bboxSpan){
    return new Promise(function(resolve){
      var ov=document.createElement('div');
      ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;font-family:var(--font,system-ui,sans-serif)';
      var box=document.createElement('div');
      box.style.cssText='background:#fff;padding:20px 24px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.3);max-width:440px;text-align:center';
      var hint=Math.round(bboxSpan*100)/100;
      box.innerHTML=
        '<h3 style="margin:0 0 8px;font-size:16px">Unidades del DXF no especificadas</h3>'+
        '<p style="margin:0 0 4px;color:#444;font-size:13px;line-height:1.4">El archivo no declara <code>$INSUNITS</code>. Selecciona la unidad original:</p>'+
        '<p style="margin:0 0 16px;color:#888;font-size:12px">Span máximo: '+hint+' unidades</p>';
      var row=document.createElement('div');
      row.style.cssText='display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:8px';
      [['mm',1],['cm',10],['m',1000],['pulgadas',25.4],['pies',304.8]].forEach(function(p){
        var btn=document.createElement('button');
        btn.textContent=p[0];
        btn.style.cssText='padding:8px 14px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;font-size:13px;min-width:64px';
        btn.onmouseover=function(){btn.style.background='#f0f0f0';};
        btn.onmouseout=function(){btn.style.background='#fff';};
        btn.onclick=function(){ov.remove();resolve(p[1]);};
        row.appendChild(btn);
      });
      box.appendChild(row);
      var cancel=document.createElement('button');
      cancel.textContent='Cancelar';
      cancel.style.cssText='margin-top:6px;padding:6px 12px;border:none;background:transparent;color:#888;cursor:pointer;font-size:12px';
      cancel.onclick=function(){ov.remove();resolve(null);};
      box.appendChild(cancel);
      ov.appendChild(box);
      document.body.appendChild(ov);
    });
  }
  // Toast UI shared by all consumers. Same look/feel as the configurador.
  function showToast(msg,type){
    var t=document.createElement('div');
    var bg=type==='error'?'#c62828':(type==='success'?'#2e7d32':'#333');
    t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:'+bg+';color:#fff;padding:8px 16px;border-radius:4px;font-size:13px;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.3);font-family:var(--font,system-ui,sans-serif)';
    t.textContent=msg;
    document.body.appendChild(t);
    setTimeout(function(){t.style.transition='opacity .4s';t.style.opacity='0';},2500);
    setTimeout(function(){t.remove();},3000);
  }
  // High-level: parse DXF text → return {shapes (in mm, bbox at origin), w, h}
  // unitMmOverride bypasses the askDxfUnits dialog when known. Returns null
  // if no shapes were extracted or the user cancelled the units dialog.
  async function dxfTextToShapes(text, unitMmOverride){
    var parsed=parseDxf(text);
    var rawShapes=dxfEntitiesToShapes(parsed.entities);
    if(rawShapes.length===0) return null;
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    rawShapes.forEach(function(sh){
      var bb=childBboxLocal(sh);
      if(bb.x1<minX) minX=bb.x1; if(bb.y1<minY) minY=bb.y1;
      if(bb.x2>maxX) maxX=bb.x2; if(bb.y2>maxY) maxY=bb.y2;
    });
    var span=Math.max(maxX-minX,maxY-minY);
    var scaleMM;
    if(parsed.insunits) scaleMM=dxfScaleToMM(parsed.insunits,span);
    else if(unitMmOverride) scaleMM=unitMmOverride;
    else { scaleMM=await askDxfUnits(span); if(!scaleMM) return null; }
    var w=Math.max(1,Math.round((maxX-minX)*scaleMM));
    var h=Math.max(1,Math.round((maxY-minY)*scaleMM));
    function tx(v){return Math.round((v-minX)*scaleMM);}
    function ty(v){return Math.round((v-minY)*scaleMM);}
    function tlen(v){return Math.round(v*scaleMM);}
    var shapes=rawShapes.map(function(sh){
      if(sh.type==='shape_line') return {type:'shape_line',x1:tx(sh.x1),y1:ty(sh.y1),x2:tx(sh.x2),y2:ty(sh.y2),stroke:sh.stroke,strokeWidth:sh.strokeWidth};
      if(sh.type==='shape_arc') return {type:'shape_arc',x1:tx(sh.x1),y1:ty(sh.y1),x2:tx(sh.x2),y2:ty(sh.y2),sagitta:tlen(sh.sagitta),stroke:sh.stroke,strokeWidth:sh.strokeWidth};
      if(sh.type==='shape_circle') return {type:'shape_circle',x:tx(sh.x),y:ty(sh.y),w:tlen(sh.w),h:tlen(sh.h),stroke:sh.stroke,strokeWidth:sh.strokeWidth,fill:sh.fill};
      return null;
    }).filter(Boolean);
    return {shapes:shapes, w:w, h:h};
  }

  global.CurinoDxf={
    parseDxf:parseDxf,
    dxfEntitiesToShapes:dxfEntitiesToShapes,
    dxfArcToShapes:dxfArcToShapes,
    dxfScaleToMM:dxfScaleToMM,
    sampleSpline:sampleSpline,
    nurbsFindSpan:nurbsFindSpan,
    nurbsDeBoor:nurbsDeBoor,
    readFileText:readFileText,
    askDxfUnits:askDxfUnits,
    showToast:showToast,
    childBboxLocal:childBboxLocal,
    kmeansClusterChildren:kmeansClusterChildren,
    dxfTextToShapes:dxfTextToShapes
  };
  // Expose top-level globals for the configurador's existing inline calls.
  // The configurador's inline definitions (which predate this file) would
  // shadow these but they keep the same names and behaviour. New code on
  // /admin/, /marca/, and the new /assets/js/catalog-form.js relies on
  // the globals being defined by THIS file.
  global.parseDxf=parseDxf;
  global.dxfEntitiesToShapes=dxfEntitiesToShapes;
  global.dxfArcToShapes=dxfArcToShapes;
  global.dxfScaleToMM=dxfScaleToMM;
  global.sampleSpline=sampleSpline;
  global.nurbsFindSpan=nurbsFindSpan;
  global.nurbsDeBoor=nurbsDeBoor;
  global.readFileText=readFileText;
  global.askDxfUnits=askDxfUnits;
  global.showToast=global.showToast||showToast;
  global.childBboxLocal=childBboxLocal;
  global.kmeansClusterChildren=kmeansClusterChildren;
})(window);
