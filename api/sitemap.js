// /api/sitemap.js
//
// Edge Function de Vercel que genera el sitemap.xml dinámico con:
//   - URLs estáticas de Revista (landing + 5 secciones)
//   - URLs de todos los artículos publicados (consultados a Supabase
//     vía REST público).
//
// El rewrite /sitemap.xml → /api/sitemap en vercel.json hace que la
// URL pública sea casacurino.com/sitemap.xml.
//
// Dominio canónico del sitemap: el prefijo www-incluído coincide con
// la propiedad de Search Console y con (futuro) los <link rel=canonical>
// de las páginas. Centralizado en SITE_BASE para evitar drift.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const SITE_BASE = 'https://www.casacurino.com';

const TYPE_TO_SECCION = {
  proyecto: 'proyectos',
  material: 'materiales',
  articulo: 'articulos',
  noticia: 'noticias',
  entrevista: 'entrevistas'
};

export default async function handler() {
  let articles = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/magazine_articles_public?select=slug,type,published_at`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept': 'application/json'
        }
      }
    );
    if (res.ok) articles = await res.json();
    else console.error('sitemap: supabase fetch error', res.status, await res.text());
  } catch (err) {
    console.error('sitemap: fetch failed', err);
  }

  const staticUrls = [
    // Páginas raíz públicas
    { loc: `${SITE_BASE}/`, changefreq: 'weekly' },
    { loc: `${SITE_BASE}/sobre-nosotros/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/proyecto-a-medida/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/solicitar-presupuesto/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/maestro/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/configurador-armarios-vestidores/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/estudio/`, changefreq: 'monthly' },

    // Revista
    { loc: `${SITE_BASE}/revista/`, changefreq: 'daily' },
    { loc: `${SITE_BASE}/revista/proyectos/`, changefreq: 'weekly' },
    { loc: `${SITE_BASE}/revista/materiales/`, changefreq: 'weekly' },
    { loc: `${SITE_BASE}/revista/articulos/`, changefreq: 'weekly' },
    { loc: `${SITE_BASE}/revista/noticias/`, changefreq: 'weekly' },
    { loc: `${SITE_BASE}/revista/entrevistas/`, changefreq: 'weekly' },

    // Productos
    { loc: `${SITE_BASE}/armarios-vestidores/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/cocinas/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/banos/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/puertas/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/paneles/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/escaleras/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/materiales/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/encimeras/`, changefreq: 'monthly' },

    // Estancias
    { loc: `${SITE_BASE}/dormitorio/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/salon/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/comedor/`, changefreq: 'monthly' },

    // Proyectos integrales
    { loc: `${SITE_BASE}/residencial/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/contract/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/couture/`, changefreq: 'monthly' },
    { loc: `${SITE_BASE}/nautica/`, changefreq: 'monthly' },

    // Páginas legales
    { loc: `${SITE_BASE}/aviso-legal/`, changefreq: 'yearly' },
    { loc: `${SITE_BASE}/privacidad/`, changefreq: 'yearly' },
    { loc: `${SITE_BASE}/cookies/`, changefreq: 'yearly' }
  ];

  const articleEntries = (articles || []).map((a) => {
    const seccion = TYPE_TO_SECCION[a.type] || 'articulos';
    return {
      loc: `${SITE_BASE}/revista/${seccion}/${encodeURIComponent(a.slug)}/`,
      lastmod: a.published_at || undefined,
      changefreq: 'monthly'
    };
  });

  const allEntries = [...staticUrls, ...articleEntries];

  const body = allEntries.map((e) => {
    const lastmod = e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : '';
    return `  <url><loc>${escapeXml(e.loc)}</loc>${lastmod}<changefreq>${e.changefreq}</changefreq></url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400'
    }
  });
}

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
