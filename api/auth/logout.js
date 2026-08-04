// GET /api/auth/logout — clears the portal session cookie and, when possible,
// also ends the Shopify SSO session so a shared computer is fully signed out.

const auth = require('../_lib/customer-auth.js');

module.exports = async function handler(req, res) {
  const session = auth.readSession(req);
  res.setHeader('Set-Cookie', auth.clearSessionCookies());

  let location = '/account';
  if (session && session.idt) {
    try {
      const d = await auth.discover();
      const params = new URLSearchParams({
        id_token_hint: session.idt,
        post_logout_redirect_uri: 'https://' + (req.headers.host || 'happy-beanie.vercel.app') + '/account'
      });
      location = d.end_session_endpoint + '?' + params.toString();
    } catch (e) { /* fall back to local sign-out */ }
  }
  res.setHeader('Location', location);
  return res.status(302).end();
};
