// /api/admin/wholesale — the trade-approval desk.
//
// GET  → { ok, apps: [...] }        pending applications (tag:wholesale-pending)
// POST { customerId, priceDog, priceCat, minOrder }
//      (email sign-off name comes from WHOLESALE_SENDER, default 'Jon')
//      → flips tags to approved, then fires the branded approval email via
//        Resend with the account's pricing filled in. One click, done.
//
// Auth: shared secret in `x-wholesale-key` vs WHOLESALE_KEY (same model as the
// fulfillment desk, separate key — the supplier must not see applications).
//
// Env: SHOPIFY_ADMIN_TOKEN (read/write_customers), WHOLESALE_KEY,
//      RESEND_API_KEY (from resend.com; sender domain must be verified).
// Optional: WHOLESALE_FROM (default 'Happy Beanie <hello@happybeanie.com>').

const crypto = require('crypto');
const buildEmail = require('../_lib/wholesale-email.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const FROM = process.env.WHOLESALE_FROM || 'Happy Beanie <hello@happybeanie.com>';

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

const PENDING = `query Pending {
  customers(first: 50, query: "tag:wholesale-pending") {
    nodes {
      id firstName lastName email note createdAt updatedAt
      company: metafield(namespace: "wholesale", key: "company") { value }
      businessType: metafield(namespace: "wholesale", key: "business_type") { value }
      volume: metafield(namespace: "wholesale", key: "monthly_volume") { value }
      phone: metafield(namespace: "wholesale", key: "phone") { value }
      website: metafield(namespace: "wholesale", key: "website") { value }
    }
  }
  recent: customers(first: 5, sortKey: UPDATED_AT, reverse: true) {
    nodes { email tags updatedAt }
  }
}`;

const DISCOUNTS = `query TradeDiscount {
  automaticDiscountNodes(first: 20) {
    nodes {
      automaticDiscount {
        __typename
        ... on DiscountAutomaticBasic { title status summary }
      }
    }
  }
}`;

const APPROVE_TAGS = `mutation Approve($id: ID!, $add: [String!]!, $remove: [String!]!) {
  tagsAdd(id: $id, tags: $add) { userErrors { message } }
  tagsRemove(id: $id, tags: $remove) { userErrors { message } }
}`;

function keyOk(req) {
  const expected = process.env.WHOLESALE_KEY;
  if (!expected) return false;
  const given = String((req.headers && req.headers['x-wholesale-key']) || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function mf(node) { return node && node.value ? node.value : ''; }

// Applications from customers who already existed in Shopify live only in the
// customer note (the apply endpoint appends a "WHOLESALE APPLICATION" block) —
// their wholesale.* metafields may be empty. Parse the latest block out of the
// note so the desk card renders the same either way.
function parseNoteApp(note) {
  const i = String(note || '').lastIndexOf('WHOLESALE APPLICATION');
  const seg = i === -1 ? '' : String(note).slice(i);
  function pick(re) { const m = seg.match(re); return m ? m[1].trim() : ''; }
  return {
    found: i !== -1,
    company: pick(/^Company:\s*(.+)$/m),
    businessType: pick(/^Business type:\s*(.+)$/m),
    volume: pick(/^Est\. monthly volume:\s*(.+)$/m),
    phone: pick(/^Phone:\s*(.+)$/m),
    website: pick(/^Website:\s*(.+)$/m),
    // Lines the meta grid does not surface stay visible in the note block.
    extra: seg.split('\n').filter(function (l) { return /^(Address|Resale\/EIN|Notes):/.test(l); }).join('\n')
  };
}

module.exports = async function handler(req, res) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token || !process.env.WHOLESALE_KEY) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  if (!keyOk(req)) {
    return res.status(401).json({ ok: false, error: 'bad_key' });
  }

  try {
    if (req.method === 'GET') {
      const out = await admin(token, PENDING);
      if (out.status === 401 || out.status === 403) {
        return res.status(200).json({ ok: false, error: 'token_rejected' });
      }
      const gqlErrors = (out.json && out.json.errors) || [];
      if (gqlErrors.length || !out.json.data) {
        console.error('[admin/wholesale]', JSON.stringify(gqlErrors));
        return res.status(200).json({ ok: false, error: 'read_failed', message: (gqlErrors[0] && gqlErrors[0].message) || 'Shopify read error' });
      }
      const apps = (out.json.data.customers.nodes || []).map(function (c) {
        const p = parseNoteApp(c.note);
        const fromNote = !mf(c.company) && p.found;
        return {
          id: c.id,
          firstName: c.firstName || '',
          lastName: c.lastName || '',
          email: c.email || '',
          // For a retagged existing customer, createdAt is when the account was
          // first made — updatedAt (the retag/note write) is the application time.
          appliedAt: fromNote ? (c.updatedAt || c.createdAt) : c.createdAt,
          company: mf(c.company) || p.company,
          businessType: mf(c.businessType) || p.businessType,
          volume: mf(c.volume) || p.volume,
          phone: mf(c.phone) || p.phone,
          website: mf(c.website) || p.website,
          note: p.found ? p.extra : (c.note || ''),
          emailReady: !!process.env.RESEND_API_KEY
        };
      });
      // Email-pipe probe: ask Resend (with the key Vercel actually holds) what
      // domains its team can send from. A key pointing at the wrong team, or an
      // unverified domain, shows up here instead of as a mystery failed send.
      let resendInfo = null;
      if (process.env.RESEND_API_KEY) {
        try {
          const rd = await fetch('https://api.resend.com/domains', {
            headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY }
          });
          const rdJson = await rd.json().catch(function () { return {}; });
          if (rd.ok) {
            resendInfo = { reachable: true, domains: (rdJson.data || []).map(function (d) { return { name: d.name, status: d.status }; }) };
          } else {
            resendInfo = { reachable: false, message: rdJson.message || ('Resend returned ' + rd.status) };
          }
        } catch (e) {
          resendInfo = { reachable: false, message: 'Could not reach Resend.' };
        }
      }

      // Trade-pricing probe: find the wholesale automatic discount and report
      // its live status + summary (value, minimum, eligibility) so the desk
      // shows whether the checkout side of an approval actually works.
      let discount = null;
      try {
        const dOut = await admin(token, DISCOUNTS);
        const dNodes = ((dOut.json.data || {}).automaticDiscountNodes || {}).nodes || [];
        const hits = dNodes
          .map(function (n) { return n.automaticDiscount || {}; })
          .filter(function (d) { return /wholesale|trade/i.test(d.title || ''); });
        discount = hits.length
          ? { found: true, title: hits[0].title, status: hits[0].status, summary: hits[0].summary || '' }
          : { found: false };
        if (!dNodes.length && (dOut.json.errors || []).length) {
          discount = { found: false, error: dOut.json.errors[0].message };
        }
      } catch (e) { /* probe only — never block the queue */ }

      // Diagnostic feed: the last few touched customer records with their tags,
      // shown by the desk when the queue is empty so "form submitted but nothing
      // here" is debuggable at a glance (tag missing vs search-index lag).
      const recent = ((out.json.data.recent || {}).nodes || []).map(function (c) {
        return { email: c.email || '(no email)', tags: c.tags || [], updatedAt: c.updatedAt };
      });
      return res.status(200).json({ ok: true, apps: apps, recent: recent, resend: resendInfo, discount: discount, emailReady: !!process.env.RESEND_API_KEY });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ ok: false, error: 'email_not_configured',
        message: 'Add RESEND_API_KEY in Vercel first — approvals must send the email.' });
    }

    const body = readBody(req);
    const customerId = String(body.customerId || '');
    const firstName = String(body.firstName || '').slice(0, 100);
    const company = String(body.company || '').slice(0, 200);
    const email = String(body.email || '').slice(0, 200);
    const priceDog = String(body.priceDog || '').slice(0, 20);
    const priceCat = String(body.priceCat || '').slice(0, 20);
    const minOrder = String(body.minOrder || '').slice(0, 60);
    // The email's sign-off name — server-supplied (the desk no longer asks).
    const senderName = String(process.env.WHOLESALE_SENDER || 'Jon').slice(0, 100);
    if (!customerId || !email || !firstName || !company || !priceDog || !priceCat || !minOrder) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'All fields are required.' });
    }

    // 1. Send the email FIRST — if it fails we leave the application pending,
    //    so a broken send can never strand an approved-but-unnotified account.
    const html = buildEmail({ firstName: firstName, company: company, priceDog: priceDog, priceCat: priceCat, minOrder: minOrder, senderName: senderName });
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        reply_to: 'hello@happybeanie.com',
        subject: "You're approved — Happy Beanie trade pricing inside",
        html: html
      })
    });
    const sentJson = await sent.json().catch(function () { return {}; });
    if (!sent.ok || !sentJson.id) {
      console.error('[admin/wholesale] resend:', sent.status, JSON.stringify(sentJson));
      return res.status(502).json({ ok: false, error: 'email_failed',
        message: (sentJson && sentJson.message) || ('Email service returned ' + sent.status) });
    }
    console.log('[admin/wholesale] resend accepted', sentJson.id, 'to', email);

    // 2. Flip the tags. If this half fails the email is already out — report
    //    it so the tag can be fixed by hand rather than double-sending.
    const tagged = await admin(token, APPROVE_TAGS, {
      id: customerId,
      add: ['wholesale', 'wholesale-approved'],
      remove: ['wholesale-pending']
    });
    const tErrs = []
      .concat(((tagged.json.data || {}).tagsAdd || {}).userErrors || [])
      .concat(((tagged.json.data || {}).tagsRemove || {}).userErrors || [])
      .concat(tagged.json.errors || []);
    if (tErrs.length) {
      console.error('[admin/wholesale] tag:', JSON.stringify(tErrs));
      return res.status(200).json({ ok: true, warning: 'email_sent_tags_failed', emailId: sentJson.id,
        message: 'The email went out, but the Shopify tags did not update — flip wholesale-pending → wholesale-approved by hand for ' + email + '.' });
    }

    return res.status(200).json({ ok: true, emailId: sentJson.id });
  } catch (err) {
    console.error('[admin/wholesale]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};

module.exports.parseNoteApp = parseNoteApp; // exposed for tests
