// GET /api/auth/me — lightweight signed-in probe for the site header.
//
// Answers { in: true|false } from the hb_session cookie. No Shopify round-trip
// on the hot path: a live access token answers immediately; an expired one is
// refreshed (and the refreshed cookie re-set) so long-lived sessions keep
// reading as signed in for their full 30-day cookie life.

const auth = require('../_lib/customer-auth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!auth.isConfigured()) return res.status(200).json({ in: false });
    const fresh = await auth.ensureFreshSession(req);
    if (!fresh) return res.status(200).json({ in: false });
    if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);
    return res.status(200).json({ in: true });
  } catch (e) {
    return res.status(200).json({ in: false });
  }
};
