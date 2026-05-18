// /api/revista/[seccion]/[slug].js
//
// Edge Function de Vercel para SSR del detalle de artículo de Revista
// Curino. Renderiza HTML completo en cada request (con caché CDN corta)
// para que Open Graph, Twitter Cards y Schema.org lleguen completos a
// crawlers (Google, Facebook, LinkedIn, etc.).
//
// La página /revista/<seccion>/<slug>/ se sirve por este handler
// gracias al rewrite en vercel.json.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const VALID_SECCIONES = ['proyectos', 'materiales', 'articulos', 'noticias', 'entrevistas'];

const TYPE_MAP = {
  proyectos: 'proyecto',
  materiales: 'material',
  articulos: 'articulo',
  noticias: 'noticia',
  entrevistas: 'entrevista'
};

const SECTION_TITLES = {
  proyectos: 'Proyectos',
  materiales: 'Materiales',
  articulos: 'Artículos',
  noticias: 'Noticias',
  entrevistas: 'Entrevistas'
};

export default async function handler(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // Esperamos: ['revista', '<seccion>', '<slug>']
  if (parts.length < 3 || parts[0] !== 'revista') {
    return new Response('Not found', { status: 404 });
  }
  const seccion = parts[1];
  const slug = decodeURIComponent(parts[2]);

  if (!VALID_SECCIONES.includes(seccion)) {
    return new Response(buildNotFoundHtml('Sección no válida'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const type = TYPE_MAP[seccion];

  try {
    const articleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/magazine_articles_public?slug=eq.${encodeURIComponent(slug)}&type=eq.${type}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!articleRes.ok) {
      console.error('Supabase fetch error', articleRes.status, await articleRes.text());
      return new Response(buildNotFoundHtml('Error al cargar el artículo'), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    const articles = await articleRes.json();
    if (!Array.isArray(articles) || articles.length === 0) {
      return new Response(buildNotFoundHtml(), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    const article = articles[0];

    // Reescribe en runtime las URLs públicas del bucket magazine-articles
    // que viven dentro de content_html (imágenes inline insertadas por el
    // editor TipTap) para que también pasen por Image Transformations.
    // 1200px de ancho cubre el body del artículo (~700-900px reales) con
    // margen para retina 2x. Sin tocar Schema.org image (sigue siendo el
    // cover_image_url original para que Google indexe alta resolución).
    if (article.content_html) {
      article.content_html = article.content_html.replace(
        /\/storage\/v1\/object\/public\/(magazine-articles\/[^"'\s)?]+)/g,
        '/storage/v1/render/image/public/$1?width=1200&quality=85'
      );
    }

    // Query artículos relacionados (mismo type, excluyendo el actual).
    // Si hay menos de 4 del mismo type, completa con otros publicados más recientes.
    let related = [];
    try {
      const relatedRes = await fetch(
        `${SUPABASE_URL}/rest/v1/magazine_articles_public?type=eq.${type}&id=neq.${article.id}&select=*&order=published_at.desc&limit=4`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Accept': 'application/json'
          }
        }
      );
      if (relatedRes.ok) related = await relatedRes.json();

      if (related.length < 4) {
        const excludeIds = [article.id, ...related.map(r => r.id)];
        const excludeFilter = excludeIds.map(id => `id.neq.${id}`).join(',');
        const fillRes = await fetch(
          `${SUPABASE_URL}/rest/v1/magazine_articles_public?and=(${excludeFilter})&select=*&order=published_at.desc&limit=${4 - related.length}`,
          {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Accept': 'application/json'
            }
          }
        );
        if (fillRes.ok) {
          const fill = await fillRes.json();
          related = [...related, ...fill];
        }
      }
    } catch (relErr) {
      console.error('related fetch failed (non-blocking)', relErr);
      related = [];
    }

    const html = buildArticleHtml(article, seccion, related);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Caché 60s en CDN, sirve stale hasta 5 min mientras revalida.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
      }
    });
  } catch (err) {
    console.error('SSR error', err);
    return new Response(buildNotFoundHtml('Error inesperado'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// Mismo helper que /assets/js/image-transform.js, inline en el Edge runtime
// para evitar imports (la function corre en Vercel Edge, no en el browser).
function transformImageUrl(url, opts) {
  if (!url || typeof url !== 'string') return url;
  if (url.indexOf('/storage/v1/object/public/') === -1) return url;
  const o = opts || {};
  const transformed = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const params = [];
  if (o.width)   params.push('width=' + encodeURIComponent(o.width));
  if (o.height)  params.push('height=' + encodeURIComponent(o.height));
  if (o.quality) params.push('quality=' + encodeURIComponent(o.quality));
  if (o.resize)  params.push('resize=' + encodeURIComponent(o.resize));
  if (o.format)  params.push('format=' + encodeURIComponent(o.format));
  return params.length ? transformed + '?' + params.join('&') : transformed;
}

function buildArticleHtml(article, seccion, related) {
  const sectionTitle = SECTION_TITLES[seccion];
  related = Array.isArray(related) ? related : [];
  const author = ((article.author_first_name || '') + ' ' + (article.author_last_name || '')).trim() || 'Curino';
  const description = article.meta_description || article.title;
  const canonical = `https://casacurino.com/revista/${seccion}/${article.slug}/`;
  // og:image: 1200x630 cover (estándar de redes sociales).
  // cover (hero CSS background): 1600 wide (full-width hero).
  // Original sin tocar para Schema.org Article (Google prefiere alta resolución).
  const rawOgImage = article.og_image_url || article.cover_image_url || 'https://casacurino.com/assets/imagenes/logo-curino.svg';
  const ogImage = transformImageUrl(rawOgImage, { width: 1200, height: 630, resize: 'cover', quality: 85 });
  const rawCover = article.cover_image_url || '';
  const cover = transformImageUrl(rawCover, { width: 1600, quality: 85 });
  const publishedAt = article.published_at || article.created_at;
  const dateLabel = publishedAt ? new Date(publishedAt).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': article.title,
    // Google Image indexing prefiere alta resolución — uso la original sin transform.
    'image': rawCover ? [rawCover] : undefined,
    'datePublished': publishedAt,
    'dateModified': article.created_at,
    'author': { '@type': 'Person', 'name': author },
    'publisher': {
      '@type': 'Organization',
      'name': 'Curino',
      'logo': { '@type': 'ImageObject', 'url': 'https://casacurino.com/assets/imagenes/logo-curino.svg' }
    },
    'mainEntityOfPage': { '@type': 'WebPage', '@id': canonical },
    'description': description
  });

  // article.content_html viene del editor TipTap, ya moderado por admin.
  // Lo consideramos confiable (XSS contenido es responsabilidad del moderador).
  const contentHtml = article.content_html || '<p><em>Contenido no disponible.</em></p>';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(article.title)} | Curino Revista</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">

<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(article.title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:site_name" content="Curino Revista">
${publishedAt ? `<meta property="article:published_time" content="${escapeHtml(publishedAt)}">` : ''}
<meta property="article:author" content="${escapeHtml(author)}">
<meta property="article:section" content="${escapeHtml(sectionTitle)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(article.title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">

<link rel="icon" type="image/png" href="/assets/imagenes/logo-solo-curino.png">
<link rel="apple-touch-icon" href="/assets/imagenes/logo-solo-curino.png">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/revista-shell.css">
<link rel="stylesheet" href="/assets/css/revista.css">

<script type="application/ld+json">${jsonLd}</script>
</head>
<body>

<div id="rv-nav-mount"></div>

<article class="magazine-article">
  <header class="article-hero"${cover ? ` style="background-image:url('${escapeAttr(cover)}')"` : ''}>
    <div class="article-hero-overlay">
      <a href="/revista/${seccion}/" class="breadcrumb-link">${escapeHtml(sectionTitle)}</a>
      <h1>${escapeHtml(article.title)}</h1>
      <p class="article-author">Por ${escapeHtml(author)}${dateLabel ? ' · ' + escapeHtml(dateLabel) : ''}</p>
    </div>
  </header>

  <div class="article-layout">
    <div class="article-main">
      <div class="article-body">
        ${contentHtml}
      </div>

      <section class="article-contact rv-contact">
        <h3>¿Quieres contactar con ${escapeHtml(article.author_first_name || 'el autor')}?</h3>
        <p class="rv-contact-intro">Envíale un mensaje. Tu nombre, email y texto llegarán directamente a su dirección de contacto.</p>
        <button id="openContactBtn" class="rv-btn-primary" type="button">Contactar al autor</button>

        <div class="rv-contact-form" id="contactForm" style="display:none">
          <input type="text" id="contactName" placeholder="Tu nombre" autocomplete="name">
          <input type="email" id="contactEmail" placeholder="Tu email" autocomplete="email">
          <textarea id="contactMessage" placeholder="Tu mensaje..." rows="6"></textarea>
          <div class="rv-contact-actions">
            <button id="sendContactBtn" class="rv-btn-primary" type="button">Enviar mensaje</button>
            <button id="cancelContactBtn" class="rv-btn-outline" type="button">Cancelar</button>
          </div>
          <div class="rv-contact-status" id="contactStatus"></div>
        </div>
      </section>
    </div>

    ${related.length > 0 ? `<aside class="article-sidebar">
      <h3 class="sidebar-title">Más en Revista</h3>
      <div class="sidebar-cards">
        ${related.map(r => {
          const rSeccion = (Object.entries(TYPE_MAP).find(([, t]) => t === r.type) || [seccion])[0];
          const rCover = transformImageUrl(r.cover_image_url || '', { width: 400, quality: 80 });
          const rAuthor = ((r.author_first_name || '') + ' ' + (r.author_last_name || '')).trim();
          return `<a href="/revista/${rSeccion}/${encodeURIComponent(r.slug)}/" class="sidebar-card">
            <div class="sidebar-card-img"${rCover ? ` style="background-image:url('${escapeAttr(rCover)}')"` : ''}></div>
            <div class="sidebar-card-info">
              <span class="sidebar-card-type">${escapeHtml(rSeccion.toUpperCase())}</span>
              <h4>${escapeHtml(r.title)}</h4>
              ${rAuthor ? `<p>${escapeHtml(rAuthor)}</p>` : ''}
            </div>
          </a>`;
        }).join('')}
      </div>
    </aside>` : ''}
  </div>
</article>

<div id="rv-footer-mount"></div>

<script src="/assets/js/revista-shell.js"></script>
<script>
(function(){
  var openBtn=document.getElementById('openContactBtn');
  var form=document.getElementById('contactForm');
  var cancelBtn=document.getElementById('cancelContactBtn');
  var sendBtn=document.getElementById('sendContactBtn');
  var status=document.getElementById('contactStatus');
  var ARTICLE_ID=${JSON.stringify(article.id)};
  var AUTHOR_FIRST=${JSON.stringify(article.author_first_name || 'el autor')};
  function escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  openBtn.addEventListener('click',function(){openBtn.style.display='none';form.style.display='flex';});
  cancelBtn.addEventListener('click',function(){form.style.display='none';openBtn.style.display='inline-block';status.textContent='';status.className='rv-contact-status';});
  sendBtn.addEventListener('click',async function(){
    var name=document.getElementById('contactName').value.trim();
    var email=document.getElementById('contactEmail').value.trim();
    var message=document.getElementById('contactMessage').value.trim();
    if(!name||!email||!message){
      status.textContent='Rellena todos los campos.';
      status.className='rv-contact-status error';
      return;
    }
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){
      status.textContent='Email no válido.';
      status.className='rv-contact-status error';
      return;
    }
    sendBtn.disabled=true;sendBtn.textContent='Enviando…';
    status.textContent='';status.className='rv-contact-status';
    try{
      var resp=await fetch('/api/revista/contact-author',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({article_id:ARTICLE_ID,sender_name:name,sender_email:email,message:message})
      });
      var data=await resp.json();
      if(resp.ok&&data&&data.ok){
        form.innerHTML='<p style="color:#1d6f3d;font-size:14px;margin:0">¡Mensaje enviado! '+escHtml(AUTHOR_FIRST)+' te contactará pronto.</p>';
      }else{
        status.textContent='Error: '+((data&&data.error)||'Inténtalo de nuevo.');
        status.className='rv-contact-status error';
        sendBtn.disabled=false;sendBtn.textContent='Enviar mensaje';
      }
    }catch(e){
      status.textContent='Error de conexión. Inténtalo de nuevo.';
      status.className='rv-contact-status error';
      sendBtn.disabled=false;sendBtn.textContent='Enviar mensaje';
    }
  });
})();
</script>
</body>
</html>`;
}

function buildNotFoundHtml(msg) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Artículo no encontrado | Curino Revista</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/assets/css/tokens.css">
<style>body{font-family:'Open Sans',sans-serif;padding:120px 24px;text-align:center;color:#1a1a1a;background:#fff}h1{font-family:Georgia,serif;font-size:36px;font-weight:300;margin-bottom:1rem}a{color:#cc785c}</style>
</head>
<body>
<h1>Artículo no encontrado</h1>
<p>${escapeHtml(msg || 'El artículo que buscas no existe o ya no está disponible.')}</p>
<p><a href="/revista/">← Volver a Revista</a></p>
</body>
</html>`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}
