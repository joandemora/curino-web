// supabase/functions/_shared/lead-token.ts
//
// Token firmado de un lead de /partners (partners_solicitudes.id) para los
// enlaces de los emails de seguimiento y /partners/formaciones.
// Formato: "<uuid>.<hmac>" con HMAC-SHA256(PARTNERS_LEAD_SECRET, uuid) en
// base64url truncado a 32 caracteres. Sin caducidad: solo identifica a la
// persona; precios y ventanas se calculan siempre en servidor.

const enc = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hmac(id: string): Promise<string> {
  const secret = Deno.env.get('PARTNERS_LEAD_SECRET');
  if (!secret) throw new Error('PARTNERS_LEAD_SECRET missing');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(id)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}

export async function signLeadToken(solicitudId: string): Promise<string> {
  return `${solicitudId}.${await hmac(solicitudId)}`;
}

// Devuelve el id de la solicitud si el token es valido; null si no.
export async function verifyLeadToken(token: string | null | undefined): Promise<string | null> {
  const t = String(token || '').trim();
  const dot = t.indexOf('.');
  if (dot < 0) return null;
  const id = t.slice(0, dot);
  const sig = t.slice(dot + 1);
  if (!UUID_RE.test(id) || sig.length !== 32) return null;
  let expected: string;
  try { expected = await hmac(id); } catch { return null; }
  // Comparacion en tiempo constante
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? id : null;
}
