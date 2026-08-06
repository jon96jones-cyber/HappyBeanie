// /api/account/bandana — the bandana photo reward, manual-review queue.
//
// GET   → { ok, status: 'none'|'pending'|'approved'|'rejected', code, photo }
// POST  → { image: <data URL>, note } → stores the photo and marks the claim pending
//
// Where submissions live, so they can be reviewed:
//   • the photo is uploaded to Shopify Files (Content → Files in the admin)
//   • the claim is written to the CUSTOMER record as `bandana.*` metafields
//     (status / photo / note / submitted_at) plus a `bandana-pending` tag
//   • so the review queue is simply: Shopify admin → Customers → filter by
//     tag `bandana-pending`, open the customer, look at the photo URL
//
// Approving is a manual step in the admin: create a single-use discount code,
// write it to `bandana.code`, set `bandana.status` to `approved`, and swap the
// tag to `bandana-approved`. The portal then shows the customer their code.

const auth = require('../_lib/customer-auth.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

const ME = 'query Me { customer { id emailAddress { emailAddress } firstName } }';

// Server-side mirror of the UI gate: the reward unlocks once an order has
// actually been delivered, so a hand-rolled POST can't jump the queue.
const DELIVERED = 'query Delivered { customer { orders(first: 30) { nodes { id ' +
  'fulfillments(first: 5) { nodes { status latestShipmentStatus } } } } } }';

const TAG_ADD = 'mutation TagAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) ' +
  '{ userErrors { message } } }';

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

// Admin API metafields are a connection (identifiers-style reads are the
// Customer Account API only).
const READ = 'query Claim($id: ID!) { customer(id: $id) { id ' +
  'metafields(first: 10, namespace: "bandana") { nodes { key value } } } }';

const STAGE = 'mutation Stage($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) ' +
  '{ stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }';

const FILE_CREATE = 'mutation FileCreate($files: [FileCreateInput!]!) { fileCreate(files: $files) ' +
  '{ files { id fileStatus preview { image { url } } } userErrors { field message } } }';

const SAVE = 'mutation Save($input: CustomerInput!) { customerUpdate(input: $input) ' +
  '{ customer { id } userErrors { field message } } }';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function mapMetafields(conn) {
  const list = (conn && conn.nodes) || conn || [];
  const out = {};
  list.forEach(function (m) { if (m && m.key) out[m.key] = m.value; });
  return out;
}

function parseDataUrl(str) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(String(str || ''));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!TYPES[mime]) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return null;
  return { mime: mime, ext: TYPES[mime], buf: buf };
}

// Staged upload → Shopify Files. Returns the CDN url of the stored image.
async function uploadPhoto(token, customerId, file) {
  const name = 'bandana-' + customerId.split('/').pop() + '-' + Date.now() + '.' + file.ext;

  const staged = await admin(token, STAGE, {
    input: [{ filename: name, mimeType: file.mime, resource: 'FILE', httpMethod: 'POST' }]
  });
  const target = staged.json && staged.json.data && staged.json.data.stagedUploadsCreate &&
    staged.json.data.stagedUploadsCreate.stagedTargets &&
    staged.json.data.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error('staged_upload_failed');

  const form = new FormData();
  (target.parameters || []).forEach(function (p) { form.append(p.name, p.value); });
  form.append('file', new Blob([file.buf], { type: file.mime }), name);
  const put = await fetch(target.url, { method: 'POST', body: form });
  if (!put.ok) throw new Error('staged_put_failed: ' + put.status);

  const created = await admin(token, FILE_CREATE, {
    files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: 'Bandana reward submission' }]
  });
  const node = created.json && created.json.data && created.json.data.fileCreate &&
    created.json.data.fileCreate.files && created.json.data.fileCreate.files[0];
  const url = node && node.preview && node.preview.image && node.preview.image.url;
  // fileCreate is async on Shopify's side; the resourceUrl is a usable fallback.
  return url || target.resourceUrl;
}

module.exports = async function handler(req, res) {
  if (!auth.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const fresh = await auth.ensureFreshSession(req);
  if (!fresh) {
    res.setHeader('Set-Cookie', auth.clearSessionCookies());
    return res.status(401).json({ ok: false, error: 'signed_out' });
  }
  if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    console.error('[account/bandana] SHOPIFY_ADMIN_TOKEN is not set.');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  // Identify the signed-in customer from their own session, never from the body.
  let customerId = null;
  try {
    const me = await auth.customerGraphql(fresh.session.at, ME);
    if (me.status === 401 || me.status === 403) {
      return res.status(401).json({ ok: false, error: 'signed_out' });
    }
    customerId = me.json && me.json.data && me.json.data.customer && me.json.data.customer.id;
  } catch (err) {
    console.error('[account/bandana] session lookup:', err && err.message);
  }
  if (!customerId) return res.status(401).json({ ok: false, error: 'signed_out' });

  try {
    const existing = await admin(token, READ, { id: customerId });
    const mf = mapMetafields(existing.json && existing.json.data && existing.json.data.customer &&
      existing.json.data.customer.metafields);
    const status = mf.status || 'none';

    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, status: status, code: mf.code || null, photo: mf.photo || null });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // One claim per customer.
    if (status === 'pending' || status === 'approved') {
      return res.status(409).json({ ok: false, error: 'already_claimed', status: status, code: mf.code || null });
    }

    // Eligibility: at least one order fulfilled and delivered.
    const hist = await auth.customerGraphql(fresh.session.at, DELIVERED);
    const orders = (hist.json && hist.json.data && hist.json.data.customer &&
      hist.json.data.customer.orders && hist.json.data.customer.orders.nodes) || [];
    const hasDelivered = orders.some(function (o) {
      return ((o.fulfillments && o.fulfillments.nodes) || []).some(function (f) {
        return /delivered/i.test(String(f.latestShipmentStatus || f.status || ''));
      });
    });
    if (!hasDelivered) {
      return res.status(403).json({ ok: false, error: 'not_eligible' });
    }

    const body = readBody(req);
    const file = parseDataUrl(body.image);
    if (!file) {
      return res.status(400).json({ ok: false, error: 'bad_image' });
    }
    const note = String(body.note || '').slice(0, 300);

    const photoUrl = await uploadPhoto(token, customerId, file);

    // tagsAdd, never CustomerInput.tags — the latter REPLACES the whole tag
    // set and would strip e.g. a wholesale customer's pricing tag.
    await admin(token, TAG_ADD, { id: customerId, tags: ['bandana-pending'] });

    const saved = await admin(token, SAVE, {
      input: {
        id: customerId,
        metafields: [
          { namespace: 'bandana', key: 'status', type: 'single_line_text_field', value: 'pending' },
          { namespace: 'bandana', key: 'photo', type: 'single_line_text_field', value: photoUrl },
          { namespace: 'bandana', key: 'submitted_at', type: 'single_line_text_field', value: new Date().toISOString() }
        ].concat(note ? [{ namespace: 'bandana', key: 'note', type: 'multi_line_text_field', value: note }] : [])
      }
    });
    const errs = (saved.json && saved.json.data && saved.json.data.customerUpdate &&
      saved.json.data.customerUpdate.userErrors) || [];
    if (errs.length) {
      console.error('[account/bandana] save:', JSON.stringify(errs));
      return res.status(502).json({ ok: false, error: 'upstream', message: errs[0].message });
    }

    return res.status(200).json({ ok: true, status: 'pending', photo: photoUrl });
  } catch (err) {
    console.error('[account/bandana]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
