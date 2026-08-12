// /api/oauth/callback — completes the one-time Admin API OAuth grant.
// Verifies the request came from Shopify (HMAC), matches our store and the
// signed state cookie, exchanges the code for a permanent offline Admin API
// access token, then shows it once for pasting into SHOPIFY_ADMIN_TOKEN.

const crypto = require('crypto');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';

// Shopify signs the callback query params: drop hmac (and legacy signature),
// sort the rest by key, join key=value with &, HMAC-SHA256 with the app secret.
function hmacOk(params, secret) {
  const given = String(params.hmac || '');
  const msg = Object.keys(params)
    .filter(function (k) { return k !== 'hmac' && k !== 'signature'; })
    .sort()
    .map(function (k) { return k + '=' + params[k]; })
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  try {
    return given.length === digest.length &&
      crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(given, 'utf8'));
  } catch (e) { return false; }
}

function page(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + '</title>' +
    '<style>body{margin:0;background:#17140F;color:#F5F0E6;font-family:ui-sans-serif,-apple-system,sans-serif;' +
    'display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}' +
    '.card{max-width:640px;background:#1D1913;border:1px solid #3a352b;border-radius:12px;padding:34px 36px}' +
    'h1{font-size:22px;letter-spacing:-.02em;margin:0 0 14px}p{color:#c9bfae;line-height:1.6;font-size:15px;margin:0 0 14px}' +
    'code{display:block;word-break:break-all;background:#0f0d09;border:1px solid #3a352b;border-radius:8px;' +
    'padding:16px;font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#F2CE59;margin:8px 0 18px}' +
    'b{color:#F5F0E6}.ok{color:#7EB38C}.err{color:#E07A5F}ol{color:#c9bfae;line-height:1.8;font-size:14px;padding-left:20px}' +
    '</style></head><body><div class="card">' + body + '</div></body></html>';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const key = process.env.SHOPIFY_API_KEY;
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!key || !secret) {
    return res.status(503).send(page('Not configured', '<h1 class="err">Not configured</h1><p>Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET, then start again at /api/oauth/install.</p>'));
  }

  let params;
  try {
    const u = new URL(req.url, 'https://' + (req.headers['x-forwarded-host'] || req.headers.host));
    params = Object.fromEntries(u.searchParams.entries());
  } catch (e) {
    return res.status(400).send(page('Bad request', '<h1 class="err">Bad request</h1><p>Could not read the callback parameters.</p>'));
  }

  const shop = String(params.shop || '');
  const code = String(params.code || '');
  const state = String(params.state || '');

  if (shop !== STORE_DOMAIN || !/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    return res.status(400).send(page('Unexpected store', '<h1 class="err">Unexpected store</h1><p>This callback was for a different store than expected.</p>'));
  }
  if (!hmacOk(params, secret)) {
    return res.status(400).send(page('Verification failed', '<h1 class="err">Verification failed</h1><p>The request signature did not check out. Start again at <b>/api/oauth/install</b>.</p>'));
  }

  // State: must match the signed cookie and carry a valid signature.
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|;\s*)hb_oauth_state=([^;]+)/);
  const cookieState = m ? decodeURIComponent(m[1]) : '';
  const parts = state.split('.');
  const nonce = parts[0] || '';
  const sig = parts[1] || '';
  const expectSig = crypto.createHmac('sha256', secret).update(nonce).digest('hex');
  if (!state || state !== cookieState || sig !== expectSig) {
    return res.status(400).send(page('Session mismatch', '<h1 class="err">Session mismatch</h1><p>The security token didn\'t match. Start again at <b>/api/oauth/install</b> in the same browser.</p>'));
  }

  // Exchange the code for a permanent offline access token.
  let token = '', scope = '';
  try {
    const r = await fetch('https://' + shop + '/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: key, client_secret: secret, code: code })
    });
    const j = await r.json().catch(function () { return {}; });
    token = j.access_token || '';
    scope = j.scope || '';
    if (!token) {
      return res.status(502).send(page('Exchange failed', '<h1 class="err">Token exchange failed</h1><p>Shopify did not return a token. Response: <code>' + String(JSON.stringify(j)).replace(/</g, '&lt;') + '</code></p><p>Double-check the app\'s Secret in SHOPIFY_API_SECRET, then retry <b>/api/oauth/install</b>.</p>'));
    }
  } catch (e) {
    return res.status(502).send(page('Exchange error', '<h1 class="err">Token exchange error</h1><p>' + String(e && e.message).replace(/</g, '&lt;') + '</p>'));
  }

  // Clear the state cookie and show the token once.
  res.setHeader('Set-Cookie', 'hb_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  return res.status(200).send(page('Connected', [
    '<h1 class="ok">✓ Connected to Shopify</h1>',
    '<p>Here is your permanent Admin API token. Copy it now — it won\'t be shown again.</p>',
    '<code>' + String(token).replace(/</g, '&lt;') + '</code>',
    '<p><b>Granted scopes:</b> ' + String(scope).replace(/</g, '&lt;') + '</p>',
    '<p><b>Finish in Vercel:</b></p>',
    '<ol><li>Settings → Environment Variables → <b>SHOPIFY_ADMIN_TOKEN</b> → paste this value → Save.</li>' +
    '<li>Deployments → newest → ⋯ → <b>Redeploy</b>.</li>' +
    '<li>Open <b>/admin/fulfillment</b> — the queue should load.</li></ol>'
  ].join('')));
};
