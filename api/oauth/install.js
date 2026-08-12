// /api/oauth/install — starts a ONE-TIME Admin API OAuth grant for the Happy
// Beanie custom app, so we can mint a permanent (offline, non-expiring) Admin
// API access token for the fulfillment desk.
//
// The new Dev Dashboard doesn't hand out a static shpat_ token like the old
// custom apps did — you have to complete an OAuth install to get one. You do
// this once, in a browser, while logged into Shopify admin:
//
//   1. Register https://www.happybeanie.com/api/oauth/callback as a redirect
//      URL on the app, and give the app the scopes listed below.
//   2. Add SHOPIFY_API_KEY (the app's Client ID) and SHOPIFY_API_SECRET
//      (the app's Secret) to the environment.
//   3. Visit /api/oauth/install → approve → the callback shows the token.
//
// state is signed with the app secret so the callback can verify it without
// any server-side storage.

const crypto = require('crypto');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';

// Read the queue + write fulfillments (mark shipped). read/write_orders lets us
// read the order list; the fulfillment-order scopes let fulfillmentCreate run.
const SCOPES = [
  'read_orders',
  'write_orders',
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
  'read_assigned_fulfillment_orders',
  'write_assigned_fulfillment_orders'
].join(',');

function redirectUri(req) {
  if (process.env.OAUTH_REDIRECT_URI) return process.env.OAUTH_REDIRECT_URI;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + host + '/api/oauth/callback';
}

module.exports = async function handler(req, res) {
  const key = process.env.SHOPIFY_API_KEY;
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!key || !secret) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(503).send('<p style="font-family:sans-serif;padding:40px">Set <b>SHOPIFY_API_KEY</b> (the app\'s Client ID) and <b>SHOPIFY_API_SECRET</b> (the app\'s Secret) in the environment first, then reload this page.</p>');
  }

  // Signed, self-verifying state (CSRF nonce). No server storage needed.
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', secret).update(nonce).digest('hex');
  const state = nonce + '.' + sig;

  res.setHeader('Set-Cookie', 'hb_oauth_state=' + state + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');

  const params = new URLSearchParams({
    client_id: key,
    scope: SCOPES,
    redirect_uri: redirectUri(req),
    state: state
    // No grant_options[]=per-user → offline, non-expiring token.
  });

  res.setHeader('Location', 'https://' + STORE_DOMAIN + '/admin/oauth/authorize?' + params.toString());
  return res.status(302).end();
};
