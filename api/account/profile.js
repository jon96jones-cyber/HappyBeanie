// POST /api/account/profile — set the customer's name.
// New accounts arrive through Shopify's hosted email-code sign-in with no name,
// so the portal collects it once and saves it here. Body: { name } or
// { firstName, lastName }. Tokens stay in the httpOnly cookie; the browser
// never sees them. 401 means "show the signed-out view".

const auth = require('../_lib/customer-auth.js');

const UPDATE = 'mutation UpdateName($input: CustomerUpdateInput!) { ' +
  'customerUpdate(input: $input) { customer { firstName lastName } ' +
  'userErrors { field message } } }';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!auth.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const body = readBody(req);
  let firstName = String(body.firstName || '').trim().slice(0, 40);
  let lastName = String(body.lastName || '').trim().slice(0, 40);
  // Also accept a single "name" field and split on the first space.
  if (!firstName && body.name) {
    const parts = String(body.name).trim().split(/\s+/);
    firstName = (parts.shift() || '').slice(0, 40);
    lastName = parts.join(' ').slice(0, 40);
  }
  if (!firstName) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }

  const fresh = await auth.ensureFreshSession(req);
  if (!fresh) {
    res.setHeader('Set-Cookie', auth.clearSessionCookies());
    return res.status(401).json({ ok: false, error: 'signed_out' });
  }
  if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);

  const input = { firstName: firstName };
  if (lastName) input.lastName = lastName;

  try {
    const out = await auth.customerGraphql(fresh.session.at, UPDATE, { input: input });
    if (out.status === 401 || out.status === 403) {
      return res.status(401).json({ ok: false, error: 'signed_out' });
    }
    const node = out.json && out.json.data && out.json.data.customerUpdate;
    const errs = (node && node.userErrors) || [];
    if (errs.length || (out.json && out.json.errors && out.json.errors.length)) {
      console.error('[account/profile]', errs.length ? JSON.stringify(errs) : JSON.stringify(out.json.errors));
      return res.status(502).json({ ok: false, error: 'upstream', message: errs.length ? errs[0].message : undefined });
    }
    const cust = (node && node.customer) || {};
    return res.status(200).json({ ok: true, firstName: cust.firstName || firstName, lastName: cust.lastName || lastName });
  } catch (err) {
    console.error('[account/profile]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
