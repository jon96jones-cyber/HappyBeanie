// Vercel serverless function: POST /api/wholesale-apply
//
// Receives a wholesale application from /wholesale, creates (or tags) a customer
// in Shopify with the tag `wholesale-pending`, and stores the business details on
// the customer record so you can review and approve them in your Shopify admin.
//
// Required environment variables (set in Vercel → Project → Settings → Environment Variables):
//   SHOPIFY_ADMIN_TOKEN   - Admin API access token from a custom app (starts with "shpat_")
// Optional (sensible defaults for this store):
//   SHOPIFY_STORE_DOMAIN      - default: pxv2u2-kc.myshopify.com
//   SHOPIFY_ADMIN_API_VERSION - default: 2025-07
//
// The Admin token is used server-side only and is never exposed to the browser.

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const PENDING_TAG = 'wholesale-pending';

function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 500);
}

async function shopifyAdmin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
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

  // Body may arrive parsed (Vercel) or as a raw string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  // Honeypot: bots fill hidden fields. Pretend success, create nothing.
  if (clean(body.company_url, 200)) {
    return res.status(200).json({ ok: true });
  }

  const company = clean(body.company, 200);
  const firstName = clean(body.firstName, 100);
  const lastName = clean(body.lastName, 100);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 60);
  const businessType = clean(body.businessType, 100);
  const volume = clean(body.volume, 100);
  const website = clean(body.website, 300);
  const taxId = clean(body.taxId, 100);
  const address = clean(body.address, 400);
  const message = clean(body.message, 2000);

  if (!company || !firstName || !lastName || !email || !phone || !businessType || !volume) {
    return res.status(400).json({ ok: false, error: 'Please fill in all required fields.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    console.error('[wholesale-apply] SHOPIFY_ADMIN_TOKEN is not set.');
    return res.status(503).json({
      ok: false,
      error: 'Wholesale intake isn’t configured yet. Please email hello@happybeanie.com and we’ll set you up.'
    });
  }

  // A readable summary lands in the customer's admin note; structured copies go to metafields.
  const noteLines = [
    'WHOLESALE APPLICATION',
    'Company: ' + company,
    'Business type: ' + businessType,
    'Est. monthly volume: ' + volume,
    'Phone: ' + phone,
    website ? 'Website: ' + website : '',
    taxId ? 'Resale/EIN: ' + taxId : '',
    address ? 'Address: ' + address : '',
    message ? 'Notes: ' + message : ''
  ].filter(Boolean);
  const note = noteLines.join('\n');

  const metafields = [
    { namespace: 'wholesale', key: 'company', type: 'single_line_text_field', value: company },
    { namespace: 'wholesale', key: 'business_type', type: 'single_line_text_field', value: businessType },
    { namespace: 'wholesale', key: 'monthly_volume', type: 'single_line_text_field', value: volume },
    { namespace: 'wholesale', key: 'phone', type: 'single_line_text_field', value: phone },
    { namespace: 'wholesale', key: 'status', type: 'single_line_text_field', value: 'pending' }
  ];
  if (website) metafields.push({ namespace: 'wholesale', key: 'website', type: 'single_line_text_field', value: website });
  if (taxId) metafields.push({ namespace: 'wholesale', key: 'tax_id', type: 'single_line_text_field', value: taxId });
  if (address) metafields.push({ namespace: 'wholesale', key: 'address', type: 'multi_line_text_field', value: address });
  if (message) metafields.push({ namespace: 'wholesale', key: 'message', type: 'multi_line_text_field', value: message });

  const CREATE = 'mutation wholesaleCreate($input: CustomerInput!) {' +
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
      console.error('[wholesale-apply] Admin API errors:', JSON.stringify(created.json.errors));
      return res.status(502).json({ ok: false, error: 'We couldn’t submit your application right now. Please try again shortly or email hello@happybeanie.com.' });
    }

    const result = created.json.data && created.json.data.customerCreate;
    const userErrors = (result && result.userErrors) || [];

    if (result && result.customer && result.customer.id) {
      return res.status(200).json({ ok: true });
    }

    // Email already on file → tag the existing customer instead of failing.
    const taken = userErrors.some(function (e) {
      return /taken|already/i.test(e.message || '') || (e.field || []).join('.').indexOf('email') !== -1;
    });

    if (taken) {
      const tagged = await tagExistingByEmail(token, email, note);
      if (tagged) return res.status(200).json({ ok: true });
      // Existing customer but we couldn't retag — still acknowledge; the team will see them.
      return res.status(200).json({ ok: true });
    }

    console.error('[wholesale-apply] userErrors:', JSON.stringify(userErrors));
    const first = userErrors[0] && userErrors[0].message;
    return res.status(400).json({ ok: false, error: first || 'We couldn’t submit your application. Please check your details and try again.' });
  } catch (err) {
    console.error('[wholesale-apply] Unexpected error:', err && err.message);
    return res.status(502).json({ ok: false, error: 'We couldn’t reach our system right now. Please try again shortly or email hello@happybeanie.com.' });
  }
};

// Look up a customer by email and add the pending tag + append the application note.
async function tagExistingByEmail(token, email, note) {
  const FIND = 'query findCustomer($q: String!) {' +
    ' customers(first: 1, query: $q) { edges { node { id note } } } }';
  const found = await shopifyAdmin(token, FIND, { q: 'email:' + email });
  const edges = found.json && found.json.data && found.json.data.customers && found.json.data.customers.edges;
  if (!edges || !edges.length) return false;
  const node = edges[0].node;
  const id = node.id;

  const TAG = 'mutation addTag($id: ID!, $tags: [String!]!) {' +
    ' tagsAdd(id: $id, tags: $tags) { userErrors { message } } }';
  await shopifyAdmin(token, TAG, { id: id, tags: [PENDING_TAG] });

  const combinedNote = (node.note ? node.note + '\n\n' : '') + note;
  const UPDATE = 'mutation updateNote($input: CustomerInput!) {' +
    ' customerUpdate(input: $input) { userErrors { message } } }';
  await shopifyAdmin(token, UPDATE, { input: { id: id, note: combinedNote } });

  return true;
}
