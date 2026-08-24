// Vercel serverless function: POST /api/ambassador-apply
//
// Receives an ambassador application from /ambassador, creates (or tags) a
// customer in Shopify with the tag `ambassador-pending`, and stores the
// creator details on the record so the desk at /admin/ambassadors can review
// and approve them.
//
// Same shape as /api/wholesale-apply — one intake, one pending tag, structured
// metafields plus a readable note.
//
// Env: SHOPIFY_ADMIN_TOKEN. Optional: SHOPIFY_STORE_DOMAIN,
// SHOPIFY_ADMIN_API_VERSION.

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const PENDING_TAG = 'ambassador-pending';

function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 500);
}

async function shopifyAdmin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  // Honeypot — bots fill hidden fields. Pretend success, create nothing.
  if (clean(body.hb_extra, 200)) {
    console.warn('[ambassador-apply] honeypot tripped — dropping submission for', clean(body.email, 200));
    return res.status(200).json({ ok: true });
  }

  const firstName = clean(body.firstName, 100);
  const lastName = clean(body.lastName, 100);
  const email = clean(body.email, 200).toLowerCase();
  const instagram = clean(body.instagram, 200).replace(/^@/, '');
  const tiktok = clean(body.tiktok, 200).replace(/^@/, '');
  const otherChannel = clean(body.otherChannel, 300);
  const audience = clean(body.audience, 100);
  const why = clean(body.why, 2000);

  if (!firstName || !lastName || !email || !audience || !why) {
    return res.status(400).json({ ok: false, error: 'Please fill in all required fields.' });
  }
  if (!instagram && !tiktok && !otherChannel) {
    return res.status(400).json({ ok: false, error: 'Tell us at least one place you post — Instagram, TikTok, or another channel.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    console.error('[ambassador-apply] SHOPIFY_ADMIN_TOKEN is not set.');
    return res.status(503).json({
      ok: false,
      error: 'Applications aren’t open just yet. Please email hello@happybeanie.com and we’ll add you to the list.'
    });
  }

  const noteLines = [
    'AMBASSADOR APPLICATION',
    instagram ? 'Instagram: @' + instagram : '',
    tiktok ? 'TikTok: @' + tiktok : '',
    otherChannel ? 'Other: ' + otherChannel : '',
    'Audience: ' + audience,
    'Why: ' + why
  ].filter(Boolean);
  const note = noteLines.join('\n');

  const metafields = [
    { namespace: 'ambassador', key: 'audience', type: 'single_line_text_field', value: audience },
    { namespace: 'ambassador', key: 'status', type: 'single_line_text_field', value: 'pending' },
    { namespace: 'ambassador', key: 'why', type: 'multi_line_text_field', value: why }
  ];
  if (instagram) metafields.push({ namespace: 'ambassador', key: 'instagram', type: 'single_line_text_field', value: instagram });
  if (tiktok) metafields.push({ namespace: 'ambassador', key: 'tiktok', type: 'single_line_text_field', value: tiktok });
  if (otherChannel) metafields.push({ namespace: 'ambassador', key: 'other_channel', type: 'single_line_text_field', value: otherChannel });

  const CREATE = 'mutation ambassadorCreate($input: CustomerInput!) {' +
    ' customerCreate(input: $input) {' +
    '  customer { id }' +
    '  userErrors { field message }' +
    ' } }';

  try {
    const created = await shopifyAdmin(token, CREATE, {
      input: {
        firstName: firstName,
        lastName: lastName,
        email: email,
        note: note,
        tags: [PENDING_TAG],
        metafields: metafields
      }
    });

    if (created.json.errors) {
      console.error('[ambassador-apply] Admin API errors:', JSON.stringify(created.json.errors));
      return res.status(502).json({ ok: false, error: 'We couldn’t submit your application right now. Please try again shortly or email hello@happybeanie.com.' });
    }

    const result = created.json.data && created.json.data.customerCreate;
    const userErrors = (result && result.userErrors) || [];

    if (result && result.customer && result.customer.id) {
      return res.status(200).json({ ok: true });
    }

    const taken = userErrors.some(function (e) {
      return /taken|already/i.test(e.message || '') || (e.field || []).join('.').indexOf('email') !== -1;
    });

    if (taken) {
      const tagged = await tagExistingByEmail(token, email, note, metafields);
      if (tagged) return res.status(200).json({ ok: true });
      console.error('[ambassador-apply] existing-email retag failed for', email);
      return res.status(502).json({ ok: false, error: 'We couldn’t attach your application to your account. Please email hello@happybeanie.com.' });
    }

    console.error('[ambassador-apply] userErrors:', JSON.stringify(userErrors));
    const first = userErrors[0] && userErrors[0].message;
    return res.status(400).json({ ok: false, error: first || 'We couldn’t submit your application. Please check your details and try again.' });
  } catch (err) {
    console.error('[ambassador-apply] Unexpected error:', err && err.message);
    return res.status(502).json({ ok: false, error: 'We couldn’t reach our system right now. Please try again shortly or email hello@happybeanie.com.' });
  }
};

// Same contract as the wholesale intake: success only when the pending tag
// actually landed, because an untagged application never reaches the desk.
async function tagExistingByEmail(token, email, note, metafields) {
  const FIND = 'query findCustomer($q: String!) {' +
    ' customers(first: 1, query: $q) { edges { node { id note } } } }';
  const found = await shopifyAdmin(token, FIND, { q: 'email:' + email });
  const edges = found.json && found.json.data && found.json.data.customers && found.json.data.customers.edges;
  if (!edges || !edges.length) {
    console.error('[ambassador-apply] email taken but lookup found no customer:', email);
    return false;
  }
  const node = edges[0].node;
  const id = node.id;

  const TAG = 'mutation addTag($id: ID!, $tags: [String!]!) {' +
    ' tagsAdd(id: $id, tags: $tags) { userErrors { message } } }';
  const tagged = await shopifyAdmin(token, TAG, { id: id, tags: [PENDING_TAG] });
  const tagErrs = []
    .concat((((tagged.json.data || {}).tagsAdd) || {}).userErrors || [])
    .concat(tagged.json.errors || []);
  if (tagErrs.length) {
    console.error('[ambassador-apply] tagsAdd failed for', email, JSON.stringify(tagErrs));
    return false;
  }

  const combinedNote = (node.note ? node.note + '\n\n' : '') + note;
  const UPDATE = 'mutation updateNote($input: CustomerInput!) {' +
    ' customerUpdate(input: $input) { userErrors { message } } }';
  const updated = await shopifyAdmin(token, UPDATE, { input: { id: id, note: combinedNote } });
  const noteErrs = []
    .concat((((updated.json.data || {}).customerUpdate) || {}).userErrors || [])
    .concat(updated.json.errors || []);
  if (noteErrs.length) console.error('[ambassador-apply] note update failed for', email, JSON.stringify(noteErrs));

  if (metafields && metafields.length) {
    const SET = 'mutation setMf($metafields: [MetafieldsSetInput!]!) {' +
      ' metafieldsSet(metafields: $metafields) { userErrors { field message } } }';
    const setOut = await shopifyAdmin(token, SET, {
      metafields: metafields.map(function (m) {
        return { ownerId: id, namespace: m.namespace, key: m.key, type: m.type, value: m.value };
      })
    });
    const mfErrs = []
      .concat((((setOut.json.data || {}).metafieldsSet) || {}).userErrors || [])
      .concat(setOut.json.errors || []);
    if (mfErrs.length) console.error('[ambassador-apply] metafieldsSet failed for', email, JSON.stringify(mfErrs));
  }

  return true;
}
