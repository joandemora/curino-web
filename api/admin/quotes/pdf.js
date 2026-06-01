// /api/admin/quotes/pdf.js
//
// GET — Genera el PDF de un presupuesto con Puppeteer headless.
//
// Auth: Bearer token Supabase + check user_roles role='admin' (mismo
// patrón que generate-article.js). NO acepta query-param auth ni
// abrir directamente desde anchor — el cliente debe llamar con fetch
// y Authorization header y abrir el blob resultante.
//
// Flujo:
//  1. Verifica admin.
//  2. Carga quote + lines + settings (company, legal_clauses) usando
//     service-role (bypass RLS).
//  3. Descarga TODAS las imágenes de planos del bucket privado
//     'quote-plans' y las convierte a data: URI base64 (para que
//     puppeteer no dependa de signed URLs ni del network).
//  4. Lanza @sparticuz/chromium + puppeteer-core, abre about:blank,
//     inyecta window.PRESUPUESTO_DATA + window.IS_PDF via
//     evaluateOnNewDocument, navega a /admin/.../preview/?id=&mode=pdf
//     con waitUntil='networkidle0'.
//  5. Espera a window.__previewReady (data-ready="1" en body).
//  6. page.pdf({format:'A4', printBackground:true}).
//  7. Devuelve PDF.
//
// Variables de entorno:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SECRET_KEY)
//   - NEXT_PUBLIC_SUPABASE_ANON_KEY (o SUPABASE_ANON_KEY)
//   - VERCEL_URL          (auto)  — host de la deploy actual
//   - PREVIEW_BASE_URL    (opcional, override del host) — útil en local
//

const { createClient } = require('@supabase/supabase-js');

// maxDuration alto para que el cold start de Chromium quepa en plan Pro
module.exports.config = { maxDuration: 60 };

function logErr(step, err) {
  console.error('[quotes-pdf]', step, err && (err.stack || err.message || err));
}

function getBaseUrl(req) {
  if (process.env.PREVIEW_BASE_URL) return process.env.PREVIEW_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return 'https://' + process.env.VERCEL_URL;
  var host = (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost:3000';
  var proto = (req && req.headers && req.headers['x-forwarded-proto']) || 'https';
  return proto + '://' + host;
}

async function loadQuoteBundle(admin, quoteId) {
  var [qRes, lRes, sRes] = await Promise.all([
    admin.from('quotes').select('*').eq('id', quoteId).single(),
    admin.from('quote_lines').select('*').eq('quote_id', quoteId).order('orden', { ascending: true }),
    admin.from('quote_settings').select('key, value').in('key', ['company', 'legal_clauses'])
  ]);
  if (qRes.error) throw qRes.error;
  if (lRes.error) throw lRes.error;
  if (sRes.error) throw sRes.error;

  var company = {};
  var legal_clauses = [];
  (sRes.data || []).forEach(function (r) {
    if (r.key === 'company') company = r.value || {};
    if (r.key === 'legal_clauses') legal_clauses = Array.isArray(r.value) ? r.value : [];
  });

  return {
    quote: qRes.data,
    lines: lRes.data || [],
    company: company,
    legal_clauses: legal_clauses
  };
}

// Descarga el blob del bucket privado y lo devuelve como "data:image/...;base64,..."
async function fetchImageAsDataUri(admin, path) {
  try {
    var res = await admin.storage.from('quote-plans').download(path);
    if (res.error || !res.data) {
      console.warn('[quotes-pdf] storage download failed', path, res.error);
      return null;
    }
    var ab = await res.data.arrayBuffer();
    var b64 = Buffer.from(ab).toString('base64');
    var mime = res.data.type || 'image/png';
    return 'data:' + mime + ';base64,' + b64;
  } catch (e) {
    console.warn('[quotes-pdf] image fetch error', path, e && e.message);
    return null;
  }
}

async function embedAllImages(admin, lines) {
  var lineImageUrls = {};
  await Promise.all(lines.map(async function (l) {
    var paths = Array.isArray(l.imagenes) ? l.imagenes : [];
    if (!paths.length) { lineImageUrls[l.id] = []; return; }
    var dataUris = await Promise.all(paths.map(function (p) { return fetchImageAsDataUri(admin, p); }));
    lineImageUrls[l.id] = dataUris.filter(Boolean);
  }));
  return lineImageUrls;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // --- 0. ENV ---
  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  var SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    logErr('config', 'missing supabase env');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  // --- 1. AUTH ADMIN ---
  var authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return res.status(401).json({ error: 'auth_required' });
  }
  var userId;
  try {
    var userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    var au = await userClient.auth.getUser();
    if (au.error || !au.data || !au.data.user) return res.status(401).json({ error: 'auth_required' });
    userId = au.data.user.id;
  } catch (e) {
    logErr('auth', e);
    return res.status(401).json({ error: 'auth_required' });
  }

  var admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    var role = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
    if (!role.data || role.data.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  } catch (e) {
    logErr('role-check', e);
    return res.status(500).json({ error: 'auth_check_failed' });
  }

  // --- 2. ID ---
  var url = new URL(req.url, getBaseUrl(req));
  var quoteId = url.searchParams.get('id');
  if (!quoteId) return res.status(400).json({ error: 'missing_id' });

  // --- 3. Carga datos + embebe imágenes ---
  var bundle;
  try {
    bundle = await loadQuoteBundle(admin, quoteId);
  } catch (e) {
    logErr('load', e);
    return res.status(404).json({ error: 'quote_not_found', detail: e.message });
  }
  var lineImageUrls = {};
  try {
    lineImageUrls = await embedAllImages(admin, bundle.lines);
  } catch (e) {
    logErr('images', e);
    // sigue sin imágenes en vez de fallar el PDF entero
  }

  // --- 4. Puppeteer ---
  // Usamos @sparticuz/chromium-min (sin binario) + tarball remoto v131.0.1.
  // La versión del tarball DEBE coincidir EXACTAMENTE con la del paquete
  // (131.0.1 ↔ v131.0.1). puppeteer-core 23.10.4 trae Chrome 131.0.6778.108
  // → mismo major Chrome → DevTools protocol compatible.
  var CHROMIUM_TAR_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';
  var chromium, puppeteer;
  try {
    chromium = require('@sparticuz/chromium-min');
    puppeteer = require('puppeteer-core');
  } catch (e) {
    logErr('puppeteer-require', e);
    return res.status(500).json({ error: 'puppeteer_unavailable', detail: e.message });
  }

  var browser;
  try {
    var execPath = await chromium.executablePath(CHROMIUM_TAR_URL);
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 }, // A4 ~150dpi
      executablePath: execPath,
      headless: chromium.headless
    });

    var page = await browser.newPage();

    // Inyecta los datos ANTES de cargar la página → el template lee
    // window.PRESUPUESTO_DATA en vez de hacer fetch a Supabase.
    var injection = {
      quote: bundle.quote,
      lines: bundle.lines,
      company: bundle.company,
      legal_clauses: bundle.legal_clauses,
      lineImageUrls: lineImageUrls
    };
    await page.evaluateOnNewDocument(function (data) {
      window.PRESUPUESTO_DATA = data;
      window.IS_PDF = true;
    }, injection);

    var base = getBaseUrl(req);
    var previewUrl = base + '/admin/armarios/presupuestos/preview/?id=' + encodeURIComponent(quoteId) + '&mode=pdf';

    await page.goto(previewUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    // El template marca body[data-ready="1"] cuando todas las <img>
    // han terminado (incluso las que fallan).
    try {
      await page.waitForFunction('document.body && document.body.getAttribute("data-ready") === "1"', { timeout: 15000 });
    } catch (_) {
      // si timeout, sigue: con base64 inline las imágenes ya están listas
    }

    var pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,   // respeta @page del CSS
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    await browser.close();
    browser = null;

    var numero = (bundle.quote && bundle.quote.numero) || 'presupuesto';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + numero + '.pdf"');
    res.setHeader('Content-Length', pdf.length);
    return res.status(200).send(pdf);
  } catch (e) {
    logErr('render', e);
    try { if (browser) await browser.close(); } catch (_) {}
    return res.status(500).json({ error: 'render_failed', detail: e.message });
  }
};
