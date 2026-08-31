// /api/account/quiz — eligibility screenings saved to the signed-in customer.
//
// The screener on /quiz runs entirely in the browser and its result dies with
// the tab. This is the only place it becomes durable, which is the whole
// reason an account is worth making at the end of it.
//
// GET                                  → { ok, screenings: [...] }
// POST   { screening: {...} }          → prepends one, returns the saved list
// PATCH  { id, name }                  → names a screening ("Rosie")
// DELETE ?id=...                       → removes one
//
// Storage is the customer's own record — a `quiz.screenings` JSON metafield —
// so it travels with them across devices and is visible in the Shopify admin
// alongside their orders. Identity always comes from the session cookie, never
// from the request body: the Customer Account API names the customer, the
// Admin API reads and writes their metafield (metafields are an Admin-side
// connection; the customer token cannot write them).
//
// Nothing here re-runs the screener. The verdict and flags are a snapshot of
// what the browser computed on the date it was taken, stored next to the
// answers that produced them and always shown with that date — a rule change
// later must not silently rewrite what someone was told.

const auth = require('../_lib/customer-auth.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';

// Five is well past what a household needs and keeps the metafield small.
const MAX_SCREENINGS = 5;
const MAX_BYTES = 60000;

const ME = 'query Me { customer { id } }';

const READ = 'query Saved($id: ID!) { customer(id: $id) { id ' +
  'metafields(first: 10, namespace: "quiz") { nodes { key value } } } }';

const SAVE = 'mutation Save($input: CustomerInput!) { customerUpdate(input: $input) ' +
  '{ customer { id } userErrors { field message } } }';

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

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

function text(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

const SPECIES = ['dog', 'cat'];
const VERDICTS = ['ok', 'caution', 'block'];
const AGES = ['under1', '1-6', '7-10', '11plus'];

// Whitelist everything. The body is shaped by our own page, but this endpoint
// is reachable by hand, and whatever lands here is stored on a real customer
// record and rendered back into the portal.
function clean(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const species = SPECIES.indexOf(String(s.species)) !== -1 ? String(s.species) : null;
  const verdict = VERDICTS.indexOf(String(s.verdict)) !== -1 ? String(s.verdict) : null;
  if (!species || !verdict) return null;

  const flags = (Array.isArray(s.flags) ? s.flags : []).slice(0, 20).map(function (f) {
    const o = (f && typeof f === 'object') ? f : {};
    return {
      level: String(o.level) === 'block' ? 'block' : 'caution',
      ing: text(o.ing, 80),
      note: text(o.note, 300),
      srcs: (Array.isArray(o.srcs) ? o.srcs : []).slice(0, 10).map(function (x) { return text(x, 120); }).filter(Boolean)
    };
  }).filter(function (f) { return f.ing; });

  const answers = {};
  const src = (s.answers && typeof s.answers === 'object') ? s.answers : {};
  Object.keys(src).slice(0, 30).forEach(function (k) {
    const key = text(k, 40);
    if (!key) return;
    const v = src[k];
    if (Array.isArray(v)) {
      answers[key] = v.slice(0, 20).map(function (x) { return text(x, 60); }).filter(Boolean);
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      answers[key] = text(v, 60);
    }
  });

  return {
    id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: text(s.name, 40),
    species: species,
    age: AGES.indexOf(String(s.age)) !== -1 ? String(s.age) : '',
    verdict: verdict,
    dose: text(s.dose, 60),
    flags: flags,
    answers: answers,
    // Server clock only — a client-supplied date could backdate a screening
    // and make stale advice look current.
    savedAt: new Date().toISOString()
  };
}

function parseList(value) {
  let list = null;
  try { list = JSON.parse(value || '[]'); } catch (e) { list = null; }
  if (!Array.isArray(list)) return [];
  return list.filter(function (s) { return s && typeof s === 'object' && s.id; }).slice(0, MAX_SCREENINGS);
}

async function writeList(token, customerId, list) {
  const value = JSON.stringify(list);
  if (value.length > MAX_BYTES) return { error: 'too_large' };
  const out = await admin(token, SAVE, {
    input: {
      id: customerId,
      metafields: [{ namespace: 'quiz', key: 'screenings', type: 'json', value: value }]
    }
  });
  const errs = (out.json && out.json.data && out.json.data.customerUpdate &&
    out.json.data.customerUpdate.userErrors) || [];
  if (errs.length) {
    console.error('[account/quiz] save:', JSON.stringify(errs));
    return { error: 'upstream', message: errs[0].message };
  }
  return { ok: true };
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
    console.error('[account/quiz] SHOPIFY_ADMIN_TOKEN is not set.');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  let customerId = null;
  try {
    const me = await auth.customerGraphql(fresh.session.at, ME);
    if (me.status === 401 || me.status === 403) {
      return res.status(401).json({ ok: false, error: 'signed_out' });
    }
    customerId = me.json && me.json.data && me.json.data.customer && me.json.data.customer.id;
  } catch (err) {
    console.error('[account/quiz] session lookup:', err && err.message);
  }
  if (!customerId) return res.status(401).json({ ok: false, error: 'signed_out' });

  try {
    const existing = await admin(token, READ, { id: customerId });
    const mf = mapMetafields(existing.json && existing.json.data && existing.json.data.customer &&
      existing.json.data.customer.metafields);
    const list = parseList(mf.screenings);

    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, screenings: list });
    }

    if (req.method === 'POST') {
      const screening = clean(readBody(req).screening);
      if (!screening) return res.status(400).json({ ok: false, error: 'bad_request' });

      // Re-taking the screener for the same animal replaces that result rather
      // than stacking a near-identical one — the portal should show what is
      // true now, not a history of the same pet.
      const kept = list.filter(function (s) { return s.species !== screening.species; });
      // A name already given to that animal survives the re-take.
      const prior = list.filter(function (s) { return s.species === screening.species; })[0];
      if (prior && prior.name && !screening.name) screening.name = text(prior.name, 40);

      const next = [screening].concat(kept).slice(0, MAX_SCREENINGS);
      const w = await writeList(token, customerId, next);
      if (w.error) return res.status(w.error === 'too_large' ? 413 : 502).json({ ok: false, error: w.error, message: w.message });
      return res.status(200).json({ ok: true, screenings: next, saved: screening.id });
    }

    if (req.method === 'PATCH') {
      const body = readBody(req);
      const id = text(body.id, 40);
      const name = text(body.name, 40);
      if (!id || !list.some(function (s) { return s.id === id; })) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      const next = list.map(function (s) { return s.id === id ? Object.assign({}, s, { name: name }) : s; });
      const w = await writeList(token, customerId, next);
      if (w.error) return res.status(502).json({ ok: false, error: w.error, message: w.message });
      return res.status(200).json({ ok: true, screenings: next });
    }

    if (req.method === 'DELETE') {
      const id = text((req.query && req.query.id) || readBody(req).id, 40);
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const next = list.filter(function (s) { return s.id !== id; });
      if (next.length === list.length) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      const w = await writeList(token, customerId, next);
      if (w.error) return res.status(502).json({ ok: false, error: w.error, message: w.message });
      return res.status(200).json({ ok: true, screenings: next });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[account/quiz]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
