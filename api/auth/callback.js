module.exports = async function handler(req, res) {
  // Supabase OAuth sends code as query param or token as hash fragment
  // Redirect to client-side callback page that handles both cases
  const url = new URL(req.url, `https://${req.headers.host}`);
  const queryString = url.search || '';

  res.writeHead(302, {
    Location: '/auth/callback/' + queryString
  });
  return res.end();
};
