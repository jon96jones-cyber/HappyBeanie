// GET /api/auth/callback — OAuth redirect target. Verifies state, exchanges the
// code for tokens (confidential client + PKCE), stores them in an encrypted
// httpOnly cookie, and sends the customer to their portal.

const auth = require('../_lib/customer-auth.js');

module.exports = async function handler(req, res) {
  const q = req.query || {};

  if (q.error) {
    res.setHeader('Location', '/account?error=' + encodeURIComponent(String(q.error)));
    return res.status(302).end();
  }

  const stash = auth.readOauthCookie(req);
  if (!stash || !q.state || stash.state !== q.state || !q.code) {
    res.setHeader('Location', '/account?error=state_mismatch');
    return res.status(302).end();
  }

  try {
    const tokens = await auth.exchangeCode(String(q.code), stash.verifier);
    const session = auth.sessionFromTokens(tokens, null);
    res.setHeader('Set-Cookie', [
      auth.sessionCookie(session),
      auth.cookieString('hb_oauth', '', 0)
    ]);
    res.setHeader('Location', '/account');
    return res.status(302).end();
  } catch (err) {
    console.error('[auth/callback]', err && err.message);
    res.setHeader('Location', '/account?error=exchange_failed');
    return res.status(302).end();
  }
};
