// /api/sitemap.js
//
// Edge Function de Vercel que genera el sitemap.xml dinámico con:
//   - URLs estáticas de Revista (landing + 5 secciones)
//   - URLs de todos los artículos publicados (consultados a Supabase
//     vía REST público).
//
// El rewrite /sitemap.xml → /api/sitemap en vercel.json hace que la
// URL pública sea casacurino.com/sitemap.xml.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

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
    { loc: 'https://casacurino.com/', changefreq: 'weekly' },
    { loc: 'https://casacurino.com/sobre-nosotros/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/proyecto-a-medida/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/solicitar-presupuesto/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/configurador-armarios-vestidores/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/configurador-2d/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/estudio/', changefreq: 'monthly' },

    // Revista
    { loc: 'https://casacurino.com/revista/', changefreq: 'daily' },
    { loc: 'https://casacurino.com/revista/proyectos/', changefreq: 'weekly' },
    { loc: 'https://casacurino.com/revista/materiales/', changefreq: 'weekly' },
    { loc: 'https://casacurino.com/revista/articulos/', changefreq: 'weekly' },
    { loc: 'https://casacurino.com/revista/noticias/', changefreq: 'weekly' },
    { loc: 'https://casacurino.com/revista/entrevistas/', changefreq: 'weekly' },

    // Productos
    { loc: 'https://casacurino.com/armarios-vestidores/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/cocinas/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/banos/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/puertas/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/paneles/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/escaleras/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/materiales/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/encimeras/', changefreq: 'monthly' },

    // Estancias
    { loc: 'https://casacurino.com/dormitorio/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/salon/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/comedor/', changefreq: 'monthly' },

    // Proyectos integrales
    { loc: 'https://casacurino.com/residencial/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/contract/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/couture/', changefreq: 'monthly' },
    { loc: 'https://casacurino.com/nautica/', changefreq: 'monthly' },

    // Páginas legales
    { loc: 'https://casacurino.com/aviso-legal/', changefreq: 'yearly' },
    { loc: 'https://casacurino.com/privacidad/', changefreq: 'yearly' },
    { loc: 'https://casacurino.com/cookies/', changefreq: 'yearly' }
  ];

  const articleEntries = (articles || []).map((a) => {
    const seccion = TYPE_TO_SECCION[a.type] || 'articulos';
    return {
      loc: `https://casacurino.com/revista/${seccion}/${encodeURIComponent(a.slug)}/`,
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
