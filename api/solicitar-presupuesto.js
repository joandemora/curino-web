// /api/solicitar-presupuesto.js
//
// Edge Function de Vercel que recibe el formulario de solicitud de
// presupuesto. El frontend YA sube los archivos directamente al bucket
// privado `presupuesto-adjuntos` (con anon + policy que permite INSERT
// anónimo), y envía a este endpoint sólo los datos del formulario + las
// rutas (paths) de los archivos ya subidos.
//
// Este endpoint:
//   1. Valida campos (nombre, email, consentimiento RGPD, etc.)
//   2. Verifica que los paths recibidos existen en el bucket (con service_role)
//      y genera signed URLs (7 días) para que el equipo pueda descargarlos.
//   3. Inserta la solicitud en presupuesto_solicitudes (service_role bypass RLS).
//   4. Reenvía a la Edge Function de Supabase `presupuesto-form-relay` que
//      tiene RESEND_API_KEY y envía el email a info@casacurino.com.
//
// Variables de entorno requeridas en Vercel:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SECRET_KEY)
//   - NEXT_PUBLIC_SUPABASE_ANON_KEY (para invocar la Edge Function de Supabase)

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsfminynxnmhsagqenat.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const BUCKET = 'presupuesto-adjuntos';
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const ALLOWED_TIPOS = new Set(['cocina', 'armarios-vestidores', 'bano', 'integral', 'otro']);
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 días

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function emailValid(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  if (!SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY missing');
    return jsonResponse({ error: 'server_not_configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const {
    nombre,
    email,
    telefono,
    tipo_proyecto,
    mensaje,
    archivos_paths,        // [string] — paths ya subidos por el frontend al bucket
    consentimiento_rgpd
  } = body || {};

  // ── Validación de campos ──────────────────────────────────────────────
  if (!nombre || String(nombre).trim().length < 2) return jsonResponse({ error: 'invalid_nombre' }, 400);
  if (String(nombre).length > 120) return jsonResponse({ error: 'nombre_too_long' }, 400);
  if (!email || !emailValid(email)) return jsonResponse({ error: 'invalid_email' }, 400);
  if (telefono && String(telefono).length > 40) return jsonResponse({ error: 'telefono_too_long' }, 400);
  if (tipo_proyecto && !ALLOWED_TIPOS.has(String(tipo_proyecto))) {
    return jsonResponse({ error: 'invalid_tipo_proyecto' }, 400);
  }
  if (mensaje && String(mensaje).length > 5000) return jsonResponse({ error: 'mensaje_too_long' }, 400);
  if (consentimiento_rgpd !== true) return jsonResponse({ error: 'rgpd_required' }, 400);

  const paths = Array.isArray(archivos_paths) ? archivos_paths.filter(p => typeof p === 'string' && p.length > 0) : [];
  if (paths.length > MAX_FILES) return jsonResponse({ error: 'too_many_files', max: MAX_FILES }, 400);

  // ── Verificar archivos en Storage y generar signed URLs ───────────────
  const archivos = [];
  for (const path of paths) {
    // path debe empezar con un prefijo predecible (la subida del frontend lo coloca en upload/<uuid>/<filename>)
    // No imponemos formato estricto pero comprobamos que existe y obtenemos metadata.
    try {
      // Pedir info del object
      const headRes = await fetch(`${SUPABASE_URL}/storage/v1/object/info/${BUCKET}/${encodeURI(path)}`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY }
      });
      if (!headRes.ok) {
        console.warn(`Adjunto no encontrado: ${path} (status ${headRes.status})`);
        return jsonResponse({ error: 'attachment_not_found', path }, 400);
      }
      const meta = await headRes.json().catch(() => null) || {};
      const size = Number(meta?.size || 0);
      const type = String(meta?.metadata?.mimetype || meta?.content_type || meta?.mimetype || '').toLowerCase();

      if (size > MAX_FILE_BYTES) return jsonResponse({ error: 'attachment_too_large', path, size }, 400);
      if (type && !ALLOWED_TYPES.has(type)) {
        return jsonResponse({ error: 'attachment_invalid_type', path, type }, 400);
      }

      // Generar signed URL
      const sigRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encodeURI(path)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL })
      });
      if (!sigRes.ok) {
        const t = await sigRes.text();
        console.error('signed URL error:', sigRes.status, t);
        return jsonResponse({ error: 'signed_url_failed', detail: t }, 500);
      }
      const sigJson = await sigRes.json();
      const signedUrl = sigJson?.signedURL || sigJson?.signedUrl;
      const fullUrl = signedUrl
        ? (signedUrl.startsWith('http') ? signedUrl : `${SUPABASE_URL}/storage/v1${signedUrl}`)
        : null;

      // Derivar nombre amigable del path (última parte tras /)
      const filename = path.split('/').pop() || 'archivo';

      archivos.push({
        name: filename,
        path,
        size,
        type,
        signed_url: fullUrl
      });
    } catch (e) {
      console.error('attachment processing error:', e);
      return jsonResponse({ error: 'attachment_processing_failed' }, 500);
    }
  }

  // ── Insertar en BD (service_role bypass RLS) ──────────────────────────
  const userAgent = request.headers.get('user-agent') || '';
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
  const ipHash = ip ? await sha256(ip) : null;

  const insertPayload = {
    nombre: String(nombre).trim(),
    email: String(email).trim().toLowerCase(),
    telefono: telefono ? String(telefono).trim() : null,
    tipo_proyecto: tipo_proyecto ? String(tipo_proyecto) : null,
    mensaje: mensaje ? String(mensaje).trim() : null,
    archivos,
    consentimiento_rgpd: true,
    user_agent: userAgent.slice(0, 500),
    ip_hash: ipHash
  };

  let insertedRow;
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/presupuesto_solicitudes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(insertPayload)
    });
    if (!insertRes.ok) {
      const t = await insertRes.text();
      console.error('insert error:', insertRes.status, t);
      return jsonResponse({ error: 'insert_failed', detail: t }, 500);
    }
    const rows = await insertRes.json();
    insertedRow = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    console.error('insert exception:', e);
    return jsonResponse({ error: 'insert_exception' }, 500);
  }

  // ── Reenviar a Supabase Edge Function para enviar email vía Resend ────
  try {
    const relayRes = await fetch(`${SUPABASE_URL}/functions/v1/presupuesto-form-relay`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: insertedRow?.id,
        nombre: insertPayload.nombre,
        email: insertPayload.email,
        telefono: insertPayload.telefono,
        tipo_proyecto: insertPayload.tipo_proyecto,
        mensaje: insertPayload.mensaje,
        archivos
      })
    });
    if (!relayRes.ok) {
      const t = await relayRes.text();
      console.error('relay error:', relayRes.status, t);
      // La solicitud YA está guardada — devolvemos ok con warning para que el
      // frontend muestre éxito (el equipo puede revisar la BD aunque el email
      // falle), pero registramos el error.
      return jsonResponse({ ok: true, warning: 'email_delivery_failed', id: insertedRow?.id });
    }
  } catch (e) {
    console.error('relay exception:', e);
    return jsonResponse({ ok: true, warning: 'email_delivery_failed', id: insertedRow?.id });
  }

  return jsonResponse({ ok: true, id: insertedRow?.id });
}
