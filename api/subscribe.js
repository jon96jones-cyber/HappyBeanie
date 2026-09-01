// POST /api/subscribe — the footer signup, which until now went nowhere.
//
// The form said "sign up to receive exclusive deals and first dibs on waitlist
// products", showed a success state, and dropped the address on the floor.
// This is where it lands instead.
//
// Consent is recorded on the Shopify customer, not in our own database, for
// three reasons: it is the legal record if anyone ever asks, it is what the
// unsubscribe endpoint writes back to, and it keeps one list rather than two
// that drift. Our database only ever holds what has already been sent.
//
// Single opt-in, which is what Shopify's own newsletter block does. The first
// email carries a one-click unsubscribe, which is the accepted remedy for
// someone typing an address that is not theirs. If deliverability ever calls
// for it, double opt-in is a confirmation step in front of this, not a rewrite.
//
// Env: SHOPIFY_ADMIN_TOKEN.

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';

// Deliberately loose: the job is to reject obvious typos and junk, not to
// adjudicate the RFC. Anything that survives this gets a real email sent to
// it, and a bounce is the honest test.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

// Each becomes a newsletter-<source> tag in Shopify, so the list stays
// segmentable by where the address was given. Keep this list closed — an
// unrecognised source falls back to 'footer' rather than minting a new tag
// from whatever the client happened to post.
const SOURCES = ['footer', 'waitlist', 'quiz', 'shop', 'popup'];

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

const FIND = 'query Find($q: String!) { customers(first: 1, query: $q) ' +
  '{ nodes { id tags emailMarketingConsent { marketingState } } } }';

const CREATE = 'mutation Create($input: CustomerInput!) { customerCreate(input: $input) ' +
  '{ customer { id } userErrors { field message } } }';

const CONSENT = 'mutation Consent($input: CustomerEmailMarketingConsentUpdateInput!) { ' +
  'customerEmailMarketingConsentUpdate(input: $input) { customer { id } userErrors { field message } } }';

const TAG_ADD = 'mutation Tag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) ' +
  '{ userErrors { message } } }';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function firstError(json, root) {
  const node = json && json.data && json.data[root];
  const errs = (node && node.userErrors) || [];
  return errs.length ? errs[0].message : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = readBody(req);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const source = SOURCES.indexOf(String(body.source)) !== -1 ? String(body.source) : 'footer';
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'bad_email' });
  }

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    console.error('[subscribe] SHOPIFY_ADMIN_TOKEN is not set.');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const consent = {
    marketingOptInLevel: 'SINGLE_OPT_IN',
    marketingState: 'SUBSCRIBED',
    consentUpdatedAt: new Date().toISOString()
  };

  try {
    const look = await admin(token, FIND, { q: 'email:' + email });
    const existing = (((((look.json || {}).data || {}).customers) || {}).nodes || [])[0];

    if (existing && existing.id) {
      // Already on the customer list — a buyer, or someone who signed up
      // before. Signing up again is an explicit opt back in, so it overrides
      // an earlier unsubscribe: they just asked, on a form, today.
      const up = await admin(token, CONSENT, {
        input: { customerId: existing.id, emailMarketingConsent: consent }
      });
      const msg = firstError(up.json, 'customerEmailMarketingConsentUpdate');
      if (msg) {
        console.error('[subscribe] consent:', msg);
        return res.status(502).json({ ok: false, error: 'upstream' });
      }
      // tagsAdd, never CustomerInput.tags — the latter replaces the whole set
      // and would strip a wholesale or ambassador tag off a real customer.
      await admin(token, TAG_ADD, { id: existing.id, tags: ['newsletter', 'newsletter-' + source] });
      return res.status(200).json({ ok: true, created: false });
    }

    const made = await admin(token, CREATE, {
      input: { email: email, emailMarketingConsent: consent, tags: ['newsletter', 'newsletter-' + source] }
    });
    const cmsg = firstError(made.json, 'customerCreate');
    if (cmsg) {
      // A race — two submissions of the same address at once. The other one
      // won, which is the outcome we wanted anyway.
      if (/taken|already/i.test(cmsg)) return res.status(200).json({ ok: true, created: false });
      console.error('[subscribe] create:', cmsg);
      return res.status(502).json({ ok: false, error: 'upstream' });
    }
    return res.status(200).json({ ok: true, created: true });
  } catch (err) {
    console.error('[subscribe]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
