// GET /api/auth/login — begins the OAuth sign-in and redirects to Shopify's
// hosted credential screen (email + one-time code). PKCE + state are stored in
// a short-lived encrypted cookie for the callback to verify.

const auth = require('../_lib/customer-auth.js');

module.exports = async function handler(req, res) {
  if (!auth.isConfigured()) {
    res.setHeader('Location', '/account?error=not_configured');
    return res.status(302).end();
  }
  const c = auth.config();
  const d = await auth.discover();
  const r = auth.buildAuthRequest();

  const params = new URLSearchParams({
    scope: 'openid email customer-account-api:full',
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: c.redirectUri,
    state: r.state,
    nonce: r.nonce,
    code_challenge: r.challenge,
    code_challenge_method: 'S256'
  });

  res.setHeader('Set-Cookie', auth.oauthCookie({ state: r.state, verifier: r.verifier }));
  res.setHeader('Location', d.authorization_endpoint + '?' + params.toString());
  return res.status(302).end();
};
