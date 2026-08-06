// /api/admin/bandana-queue — the review desk behind the bandana reward.
//
// Auth: a shared secret in the `x-review-key` header, compared against
// BANDANA_REVIEW_KEY. Not a login system — one key, kept off the page.
//
// GET                          → { ok, claims: [{ id, name, email, photo, note, submittedAt, status }] }
// POST { id, action: 'approve' | 'reject' }
//   approve → creates a single-use 15% discount code, writes it to the customer's
//             `bandana.code`, sets status `approved`, swaps the tag
//   reject  → sets status `rejected`, swaps the tag, no code
//
// Everything lives on the Shopify customer record, so the admin remains the
// source of truth — this endpoint is a convenience view over it.

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const PERCENT = 0.15;
const EXPIRES_DAYS = 30;

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

const LIST = 'query Queue($q: String!) { customers(first: 50, query: $q, sortKey: UPDATED_AT, reverse: true) ' +
  '{ nodes { id firstName lastName tags email ' +
  'metafields(first: 10, namespace: "bandana") { nodes { key value } } } } }';

const CUSTOMER = 'query One($id: ID!) { customer(id: $id) { id firstName lastName email tags ' +
  'metafields(first: 10, namespace: "bandana") { nodes { key value } } } }';

const DISCOUNT = 'mutation Code($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $input) ' +
  '{ codeDiscountNode { id } userErrors { field message } } }';

const SAVE = 'mutation Save($input: CustomerInput!) { customerUpdate(input: $input) ' +
  '{ customer { id } userErrors { field message } } }';

function mapMetafields(conn) {
  const list = (conn && conn.nodes) || conn || [];
  const out = {};
  list.forEach(function (m) { if (m && m.key) out[m.key] = m.value; });
  return out;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function makeCode(customerId) {
  const tail = String(customerId).split('/').pop().slice(-4);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'BANDANA15-' + tail + rand;
}

function firstError(json, root) {
  const node = json && json.data && json.data[root];
  const errs = (node && node.userErrors) || [];
  return errs.length ? errs[0].message : null;
}

// Header-only (a ?key= querystring would end up in access logs), compared in
// constant time via digest so length and content differences don't leak.
const crypto = require('crypto');
function keyOk(req) {
  const expected = process.env.BANDANA_REVIEW_KEY;
  if (!expected) return false;
  const given = String((req.headers && (req.headers['x-review-key'] || req.headers['X-Review-Key'])) || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token || !process.env.BANDANA_REVIEW_KEY) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  if (!keyOk(req)) {
    return res.status(401).json({ ok: false, error: 'bad_key' });
  }

  try {
    if (req.method === 'GET') {
      const which = String((req.query && req.query.status) || 'pending');
      const q = which === 'all'
        ? 'tag:bandana-pending OR tag:bandana-approved OR tag:bandana-rejected'
        : 'tag:bandana-' + which;
      const out = await admin(token, LIST, { q: q });
      const nodes = (out.json && out.json.data && out.json.data.customers &&
        out.json.data.customers.nodes) || [];
      const claims = nodes.map(function (n) {
        const mf = mapMetafields(n.metafields);
        return {
          id: n.id,
          name: [n.firstName, n.lastName].filter(Boolean).join(' '),
          email: n.email || '',
          photo: mf.photo || null,
          note: mf.note || '',
          submittedAt: mf.submitted_at || null,
          status: mf.status || 'pending',
          code: mf.code || null
        };
      });
      return res.status(200).json({ ok: true, claims: claims });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const body = readBody(req);
    const id = String(body.id || '');
    const action = String(body.action || '');
    if (!id || (action !== 'approve' && action !== 'reject')) {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }

    const look = await admin(token, CUSTOMER, { id: id });
    const customer = look.json && look.json.data && look.json.data.customer;
    if (!customer) return res.status(404).json({ ok: false, error: 'no_customer' });
    const mf = mapMetafields(customer.metafields);

    const keepTags = (customer.tags || []).filter(function (t) {
      return String(t).toLowerCase().indexOf('bandana-') !== 0;
    });

    if (action === 'reject') {
      const saved = await admin(token, SAVE, {
        input: {
          id: id,
          tags: keepTags.concat(['bandana-rejected']),
          metafields: [{ namespace: 'bandana', key: 'status', type: 'single_line_text_field', value: 'rejected' }]
        }
      });
      const msg = firstError(saved.json, 'customerUpdate');
      if (msg) return res.status(502).json({ ok: false, error: 'upstream', message: msg });
      return res.status(200).json({ ok: true, status: 'rejected' });
    }

    // Approve — reuse an existing code rather than minting a second one.
    if (mf.code) {
      return res.status(200).json({ ok: true, status: 'approved', code: mf.code });
    }

    const code = makeCode(id);
    const now = new Date();
    const ends = new Date(now.getTime() + EXPIRES_DAYS * 86400000);
    const made = await admin(token, DISCOUNT, {
      input: {
        title: 'Bandana reward — ' + (customer.email || id),
        code: code,
        startsAt: now.toISOString(),
        endsAt: ends.toISOString(),
        appliesOncePerCustomer: true,
        usageLimit: 1,
        customerSelection: { customers: { add: [id] } },
        customerGets: {
          value: { percentage: PERCENT },
          items: { all: true }
        }
      }
    });
    const dmsg = firstError(made.json, 'discountCodeBasicCreate');
    if (dmsg) {
      console.error('[admin/bandana-queue] discount:', dmsg);
      return res.status(502).json({ ok: false, error: 'upstream', message: dmsg });
    }

    const saved = await admin(token, SAVE, {
      input: {
        id: id,
        tags: keepTags.concat(['bandana-approved']),
        metafields: [
          { namespace: 'bandana', key: 'status', type: 'single_line_text_field', value: 'approved' },
          { namespace: 'bandana', key: 'code', type: 'single_line_text_field', value: code }
        ]
      }
    });
    const msg = firstError(saved.json, 'customerUpdate');
    if (msg) return res.status(502).json({ ok: false, error: 'upstream', message: msg });

    return res.status(200).json({ ok: true, status: 'approved', code: code });
  } catch (err) {
    console.error('[admin/bandana-queue]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
