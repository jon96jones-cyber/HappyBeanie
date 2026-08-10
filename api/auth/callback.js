// GET /api/auth/callback — OAuth redirect target. Verifies state, exchanges the
// code for tokens (confidential client + PKCE), stores them in an encrypted
// httpOnly cookie, and sends the customer to their portal.

const auth = require('../_lib/customer-auth.js');

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const stash = auth.readOauthCookie(req);
  // A silent SSO attempt (prompt=none) with no active Shopify session comes back
  // as login_required / interaction_required — that's the expected "nobody's
  // logged in" answer, not a failure. Send those quietly to the normal sign-in
  // screen with no error banner.
  const benign = ['login_required', 'interaction_required', 'consent_required', 'account_selection_required'];
  const silent = !!(stash && stash.silent) || benign.indexOf(String(q.error)) !== -1;

  if (q.error) {
    res.setHeader('Set-Cookie', auth.cookieString('hb_oauth', '', 0));
    res.setHeader('Location', silent ? '/account?sso=none' : '/account?error=' + encodeURIComponent(String(q.error)));
    return res.status(302).end();
  }

  if (!stash || !q.state || stash.state !== q.state || !q.code) {
    res.setHeader('Location', silent ? '/account?sso=none' : '/account?error=state_mismatch');
    return res.status(302).end();
  }

  try {
    const tokens = await auth.exchangeCode(String(q.code), stash.verifier, stash.ru);
    const session = auth.sessionFromTokens(tokens, null);
    res.setHeader('Set-Cookie', [
      auth.sessionCookie(session),
      auth.cookieString('hb_oauth', '', 0)
    ]);
    res.setHeader('Location', '/account');
    return res.status(302).end();
  } catch (err) {
    console.error('[auth/callback]', err && err.message);
    res.setHeader('Location', silent ? '/account?sso=none' : '/account?error=exchange_failed');
    return res.status(302).end();
  }
};
