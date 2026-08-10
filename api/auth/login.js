// GET /api/auth/login — begins the OAuth sign-in and redirects to Shopify's
// hosted credential screen (email + one-time code). PKCE + state are stored in
// a short-lived encrypted cookie for the callback to verify.

const auth = require('../_lib/customer-auth.js');

module.exports = async function handler(req, res) {
  if (!auth.isConfigured()) {
    res.setHeader('Location', '/account?error=not_configured');
    return res.status(302).end();
  }
  // Silent SSO: when the account page arrives just after checkout, it hits this
  // with ?silent=1. prompt=none tells Shopify to authenticate ONLY if the
  // shopper already has an active session — logging them straight back in with
  // no code. With no session, Shopify returns login_required and the callback
  // falls back to the normal sign-in screen (never Shopify's login page).
  const silent = String((req.query && req.query.silent) || '') === '1';

  const c = auth.config();
  const d = await auth.discover();
  const r = auth.buildAuthRequest();
  const redirectUri = auth.redirectUriFor(req);

  const params = new URLSearchParams({
    scope: 'openid email customer-account-api:full',
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state: r.state,
    nonce: r.nonce,
    code_challenge: r.challenge,
    code_challenge_method: 'S256'
  });
  if (silent) params.set('prompt', 'none');

  res.setHeader('Set-Cookie', auth.oauthCookie({ state: r.state, verifier: r.verifier, ru: redirectUri, silent: silent }));
  res.setHeader('Location', d.authorization_endpoint + '?' + params.toString());
  return res.status(302).end();
};
