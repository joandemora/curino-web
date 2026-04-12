module.exports = async function handler(req, res) {
  // OAuth callback — Supabase handles the token exchange client-side
  // This endpoint just redirects back to the app with the hash fragment
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');

  if (code) {
    // Exchange code for session via Supabase (server-side)
    // For client-side flow, just redirect — the JS SDK handles the rest
    res.writeHead(302, {
      Location: '/configurador-armarios-vestidores/'
    });
    return res.end();
  }

  // Fallback redirect
  res.writeHead(302, {
    Location: '/configurador-armarios-vestidores/'
  });
  return res.end();
};
