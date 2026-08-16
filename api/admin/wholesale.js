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
  approved: customers(first: 100, query: "tag:wholesale-approved", sortKey: UPDATED_AT, reverse: true) {
    nodes {
      id firstName lastName email note updatedAt tags
      company: metafield(namespace: "wholesale", key: "company") { value }
      businessType: metafield(namespace: "wholesale", key: "business_type") { value }
      priceDog: metafield(namespace: "wholesale", key: "price_dog") { value }
      priceCat: metafield(namespace: "wholesale", key: "price_cat") { value }
      minOrder: metafield(namespace: "wholesale", key: "min_order") { value }
    }
  }
  recent: customers(first: 5, sortKey: UPDATED_AT, reverse: true) {
    nodes { email tags updatedAt }
  }
}`;

// Record the prices quoted to an account (approval or reprice) on the customer
// so the desk pre-fills them next time. Best-effort — never blocks the send.
async function storeQuotedPrices(token, customerId, priceDog, priceCat, minOrder) {
  const SET = 'mutation setQuote($m: [MetafieldsSetInput!]!) {' +
    ' metafieldsSet(metafields: $m) { userErrors { field message } } }';
  const m = [
    { ownerId: customerId, namespace: 'wholesale', key: 'price_dog', type: 'single_line_text_field', value: priceDog },
    { ownerId: customerId, namespace: 'wholesale', key: 'price_cat', type: 'single_line_text_field', value: priceCat },
    { ownerId: customerId, namespace: 'wholesale', key: 'min_order', type: 'single_line_text_field', value: minOrder }
  ];
  const out = await admin(token, SET, { m: m });
  const errs = []
    .concat((((out.json.data || {}).metafieldsSet) || {}).userErrors || [])
    .concat(out.json.errors || []);
  if (errs.length) console.error('[admin/wholesale] quote store:', JSON.stringify(errs));
}

const DISCOUNTS = `query TradeDiscount {
  automaticDiscountNodes(first: 20) {
    nodes {
      id
      automaticDiscount {
        __typename
        ... on DiscountAutomaticBasic {
          title status summary
          minimumRequirement { ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } }
          customerGets { value { ... on DiscountPercentage { percentage } } }
        }
      }
    }
  }
}`;

const CODES_Q = `query CodeDiscounts {
  codeDiscountNodes(first: 50) {
    nodes {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title status
          minimumRequirement { ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } }
          customerGets { value { ... on DiscountPercentage { percentage } } }
          codes(first: 1) { nodes { code } }
        }
      }
    }
  }
}`;
const CODE_CREATE = `mutation CodeCreate($d: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $d) { userErrors { field message } }
}`;
const CODE_UPDATE = `mutation CodeUpdate($id: ID!, $d: DiscountCodeBasicInput!) {
  discountCodeBasicUpdate(id: $id, basicCodeDiscount: $d) { userErrors { field message } }
}`;
const AUTO_DEACTIVATE = `mutation AutoOff($id: ID!) {
  discountAutomaticDeactivate(id: $id) { userErrors { field message } }
}`;

const SEGMENTS_Q = `query Segments { segments(first: 100) { edges { node { id name query } } } }`;
const SEG_CREATE = `mutation SegCreate($name: String!, $q: String!) {
  segmentCreate(name: $name, query: $q) { segment { id } userErrors { field message } }
}`;
const CUST_TAGS = `query CustTags($id: ID!) { customer(id: $id) { tags } }`;
const TAGS_REMOVE = `mutation TagsRemove($id: ID!, $t: [String!]!) {
  tagsRemove(id: $id, tags: $t) { userErrors { message } }
}`;
const TAGS_ADD = `mutation TagsAdd($id: ID!, $t: [String!]!) {
  tagsAdd(id: $id, tags: $t) { userErrors { message } }
}`;

function tierPctFromTags(tags) {
  for (var i = 0; i < (tags || []).length; i++) {
    const m = String(tags[i]).match(/^wholesale-pct-(\d+)$/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function usd(n) {
  const r = Math.round(n * 100) / 100;
  return '$' + (r % 1 === 0 ? String(r) : r.toFixed(2));
}

// Find the STORE-WIDE wholesale discount. Preferred: the WHOLESALE baseline
// CODE discount (the site auto-applies it at checkout for wholesale accounts).
// Legacy: the old automatic discount ("Wholesale — …", kind 'automatic') from
// before the code migration — reported so the desk can migrate it.
async function findTradeDiscount(token) {
  const cOut = await admin(token, CODES_Q);
  const cNodes = ((cOut.json.data || {}).codeDiscountNodes || {}).nodes || [];
  const cHit = cNodes.filter(function (n) {
    const d = n.codeDiscount || {};
    const code = (((d.codes || {}).nodes || [])[0] || {}).code || '';
    return code === 'WHOLESALE';
  })[0];
  if (cHit) {
    const d = cHit.codeDiscount;
    return {
      kind: 'code',
      id: cHit.id,
      title: d.title,
      status: d.status,
      summary: '',
      pct: ((d.customerGets || {}).value || {}).percentage || 0,
      minQty: parseInt(((d.minimumRequirement || {}).greaterThanOrEqualToQuantity) || '0', 10) || 0
    };
  }
  const out = await admin(token, DISCOUNTS);
  const nodes = ((out.json.data || {}).automaticDiscountNodes || {}).nodes || [];
  const hit = nodes.filter(function (n) {
    const t = ((n.automaticDiscount || {}).title) || '';
    return /wholesale|trade/i.test(t) && !/tier/i.test(t) && String((n.automaticDiscount || {}).status).toUpperCase() === 'ACTIVE';
  })[0];
  if (!hit) return { error: (out.json.errors || [])[0] ? out.json.errors[0].message : null };
  const d = hit.automaticDiscount;
  return {
    kind: 'automatic',
    id: hit.id,
    title: d.title,
    status: d.status,
    summary: d.summary || '',
    pct: ((d.customerGets || {}).value || {}).percentage || 0,
    minQty: parseInt(((d.minimumRequirement || {}).greaterThanOrEqualToQuantity) || '0', 10) || 0
  };
}

// Find (or create) the segment whose query contains the given tag literal.
async function ensureSegment(token, name, tag) {
  const sOut = await admin(token, SEGMENTS_Q);
  const segs = (((sOut.json.data || {}).segments || {}).edges || []).map(function (e) { return e.node; });
  const seg = segs.filter(function (s) { return (s.query || '').indexOf("'" + tag + "'") !== -1; })[0];
  if (seg) return { seg: seg };
  const sc = await admin(token, SEG_CREATE, { name: name, q: "customer_tags CONTAINS '" + tag + "'" });
  const scErrs = []
    .concat((((sc.json.data || {}).segmentCreate) || {}).userErrors || [])
    .concat(sc.json.errors || []);
  const created = (((sc.json.data || {}).segmentCreate) || {}).segment;
  if (!created || scErrs.length) return { error: (scErrs[0] && scErrs[0].message) || 'segment create failed' };
  return { seg: created };
}

// Build the input for a wholesale code discount (baseline or tier).
function codeDiscountInput(title, code, pct, minQty, segmentId) {
  return {
    title: title,
    code: code,
    startsAt: new Date().toISOString(),
    customerSelection: { customerSegments: { add: [segmentId] } },
    customerGets: {
      value: { percentage: pct / 100 },
      items: { all: true },
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: false
    },
    minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: String(minQty) } },
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    appliesOncePerCustomer: false
  };
}

// Ensure the TRADE<pct> tier code discount (and its segment) exists.
// Returns { created: true } | { existed: true } | { error }.
async function ensureTierDiscount(token, pct, minQty) {
  const tag = 'wholesale-pct-' + pct;
  const code = 'TRADE' + pct;
  const cOut = await admin(token, CODES_Q);
  const cNodes = ((cOut.json.data || {}).codeDiscountNodes || {}).nodes || [];
  const exists = cNodes.some(function (n) {
    const cd = n.codeDiscount || {};
    return ((((cd.codes || {}).nodes || [])[0] || {}).code) === code;
  });
  if (exists) return { existed: true };
  const segR = await ensureSegment(token, 'Wholesale tier ' + pct + '%', tag);
  if (segR.error) return { error: 'segment: ' + segR.error };
  const dc = await admin(token, CODE_CREATE, {
    d: codeDiscountInput('Wholesale tier — ' + pct + '% (' + minQty + '+ boxes)', code, pct, minQty, segR.seg.id)
  });
  const dcErrs = []
    .concat((((dc.json.data || {}).discountCodeBasicCreate) || {}).userErrors || [])
    .concat(dc.json.errors || []);
  if (dcErrs.length) return { error: dcErrs[0].message || 'discount create failed' };
  return { created: true };
}

// Migrate the legacy automatic wholesale discount to the WHOLESALE baseline
// code (same %, same minimum unless overridden), then deactivate the automatic
// so it can never double-apply or leak to non-wholesale shoppers.
async function migrateBaseline(token, legacy, pct, minQty) {
  const segR = await ensureSegment(token, 'Wholesale accounts', 'wholesale');
  if (segR.error) return { error: 'segment: ' + segR.error };
  const title = 'Wholesale — trade pricing (' + minQty + '+ boxes)';
  const cr = await admin(token, CODE_CREATE, { d: codeDiscountInput(title, 'WHOLESALE', pct, minQty, segR.seg.id) });
  const crErrs = []
    .concat((((cr.json.data || {}).discountCodeBasicCreate) || {}).userErrors || [])
    .concat(cr.json.errors || []);
  if (crErrs.length) return { error: 'code create: ' + (crErrs[0].message || 'failed') };
  if (legacy && legacy.id) {
    const off = await admin(token, AUTO_DEACTIVATE, { id: legacy.id });
    const offErrs = []
      .concat((((off.json.data || {}).discountAutomaticDeactivate) || {}).userErrors || [])
      .concat(off.json.errors || []);
    if (offErrs.length) return { warning: 'The code discount is live, but the old automatic discount could not be deactivated: ' + (offErrs[0].message || '') + ' — deactivate it by hand in Shopify admin → Discounts.' };
  }
  return {};
}

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
      // its live status + terms so the desk shows whether the checkout side of
      // an approval actually works — and can edit the terms in place.
      let discount = null;
      try {
        const d = await findTradeDiscount(token);
        discount = (d && d.id)
          ? { found: true, kind: d.kind, title: d.title, status: d.status, summary: d.summary,
              pct: d.pct, minQty: d.minQty,
              boxPrice: Math.round(115 * (1 - d.pct) * 100) / 100 }
          : { found: false, error: d && d.error };

        // Leak check: if the code baseline exists but the OLD automatic
        // wholesale discount is still active, it hands 30% to any shopper
        // with 5+ boxes. Surface it with a one-click deactivate.
        if (discount.found && discount.kind === 'code') {
          const aOut = await admin(token, DISCOUNTS);
          const aNodes = ((aOut.json.data || {}).automaticDiscountNodes || {}).nodes || [];
          const leak = aNodes.filter(function (n) {
            const ad = n.automaticDiscount || {};
            return /wholesale|trade/i.test(ad.title || '') && !/tier/i.test(ad.title || '')
              && String(ad.status).toUpperCase() === 'ACTIVE';
          })[0];
          if (leak) discount.legacy = { title: leak.automaticDiscount.title };
        }

        // Tier ladder: which TRADE<NN> code discounts exist and are active.
        const lOut = await admin(token, CODES_Q);
        const lNodes = ((lOut.json.data || {}).codeDiscountNodes || {}).nodes || [];
        discount.tiers = lNodes.map(function (n) {
          const cd = n.codeDiscount || {};
          const code = ((((cd.codes || {}).nodes || [])[0]) || {}).code || '';
          const m = code.match(/^TRADE(\d+)$/);
          if (!m) return null;
          return { pct: parseInt(m[1], 10), active: String(cd.status).toUpperCase() === 'ACTIVE' };
        }).filter(Boolean).sort(function (a, b) { return a.pct - b.pct; });
      } catch (e) { /* probe only — never block the queue */ }

      // Approved accounts, for the desk's Approved tab (reprice emails).
      const approved = ((out.json.data.approved || {}).nodes || []).map(function (c) {
        const p = parseNoteApp(c.note);
        return {
          id: c.id,
          firstName: c.firstName || '',
          lastName: c.lastName || '',
          email: c.email || '',
          updatedAt: c.updatedAt,
          company: mf(c.company) || p.company,
          businessType: mf(c.businessType) || p.businessType,
          priceDog: mf(c.priceDog),
          priceCat: mf(c.priceCat),
          minOrder: mf(c.minOrder),
          tierPct: tierPctFromTags(c.tags)
        };
      });

      // Diagnostic feed: the last few touched customer records with their tags,
      // shown by the desk when the queue is empty so "form submitted but nothing
      // here" is debuggable at a glance (tag missing vs search-index lag).
      const recent = ((out.json.data.recent || {}).nodes || []).map(function (c) {
        return { email: c.email || '(no email)', tags: c.tags || [], updatedAt: c.updatedAt };
      });
      return res.status(200).json({ ok: true, apps: apps, approved: approved, recent: recent, resend: resendInfo, discount: discount, emailReady: !!process.env.RESEND_API_KEY });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const body = readBody(req);

    // Trade-pricing editor: writes the percentage + minimum straight to the
    // Shopify automatic discount. The site (product card, cart preview,
    // checkout) all read that discount live, so one save updates everything.
    if (body.action === 'update_pricing') {
      const pct = Number(body.pct);
      const minQty = parseInt(body.minQty, 10);
      if (!(pct >= 1 && pct <= 90) || !(minQty >= 1 && minQty <= 999)) {
        return res.status(400).json({ ok: false, error: 'bad_request',
          message: 'Discount must be 1–90% and the minimum 1–999 boxes.' });
      }
      const d = await findTradeDiscount(token);
      if (!d || !d.id) {
        // Nothing exists yet — create the baseline code discount from scratch.
        const mig = await migrateBaseline(token, null, pct, minQty);
        if (mig.error) return res.status(200).json({ ok: false, error: 'update_failed', message: mig.error });
        return res.status(200).json({ ok: true, migrated: true, warning: mig.warning });
      }
      if (d.kind === 'automatic') {
        // Legacy automatic discount → migrate to the WHOLESALE baseline code
        // at the requested terms, and deactivate the automatic.
        const mig = await migrateBaseline(token, d, pct, minQty);
        if (mig.error) return res.status(200).json({ ok: false, error: 'update_failed', message: mig.error });
        return res.status(200).json({ ok: true, migrated: true, warning: mig.warning });
      }
      const upd = await admin(token, CODE_UPDATE, {
        id: d.id,
        d: {
          title: 'Wholesale — trade pricing (' + minQty + '+ boxes)',
          customerGets: { value: { percentage: pct / 100 }, items: { all: true } },
          minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: String(minQty) } }
        }
      });
      const uErrs = []
        .concat((((upd.json.data || {}).discountCodeBasicUpdate) || {}).userErrors || [])
        .concat(upd.json.errors || []);
      if (uErrs.length) {
        console.error('[admin/wholesale] pricing update:', JSON.stringify(uErrs));
        return res.status(200).json({ ok: false, error: 'update_failed',
          message: uErrs[0].message || 'Shopify rejected the update.' });
      }
      return res.status(200).json({ ok: true });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ ok: false, error: 'email_not_configured',
        message: 'Add RESEND_API_KEY in Vercel first — approvals must send the email.' });
    }

    // Kill the leftover automatic wholesale discount (post-migration leak).
    if (body.action === 'deactivate_legacy') {
      const aOut = await admin(token, DISCOUNTS);
      const aNodes = ((aOut.json.data || {}).automaticDiscountNodes || {}).nodes || [];
      const leak = aNodes.filter(function (n) {
        const ad = n.automaticDiscount || {};
        return /wholesale|trade/i.test(ad.title || '') && !/tier/i.test(ad.title || '')
          && String(ad.status).toUpperCase() === 'ACTIVE';
      })[0];
      if (!leak) return res.status(200).json({ ok: true, already: true });
      const off = await admin(token, AUTO_DEACTIVATE, { id: leak.id });
      const offErrs = []
        .concat((((off.json.data || {}).discountAutomaticDeactivate) || {}).userErrors || [])
        .concat(off.json.errors || []);
      if (offErrs.length) {
        console.error('[admin/wholesale] legacy off:', JSON.stringify(offErrs));
        return res.status(200).json({ ok: false, error: 'deactivate_failed', message: offErrs[0].message || 'Shopify refused.' });
      }
      return res.status(200).json({ ok: true });
    }

    // Pre-create one tier's discount + segment without touching any customer —
    // the desk loops this over a range (e.g. 31–44%) to fill the tier ladder.
    if (body.action === 'prepare_tier') {
      const pPct = parseInt(body.pct, 10);
      if (!(pPct >= 5 && pPct <= 90)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'Tier must be 5–90.' });
      }
      let pBase = await findTradeDiscount(token);
      if (pBase && pBase.kind === 'automatic') {
        const mig = await migrateBaseline(token, pBase, Math.round((pBase.pct || 0.3) * 100), (pBase.minQty || 5));
        if (mig.error) return res.status(200).json({ ok: false, error: 'migrate_failed', message: mig.error });
        pBase = await findTradeDiscount(token);
      }
      const pMinQty = (pBase && pBase.minQty) || 5;
      const r = await ensureTierDiscount(token, pPct, pMinQty);
      if (r.error) return res.status(200).json({ ok: false, error: 'tier_failed', message: r.error });
      return res.status(200).json({ ok: true, pct: pPct, created: !!r.created, existed: !!r.existed });
    }

    // Per-account tier: bigger accounts, bigger discounts. Ensures a
    // "Wholesale tier — NN%" automatic discount exists (scoped to a segment
    // matching the wholesale-pct-NN tag), moves the account onto that tag, and
    // emails them the new pricing. Checkout applies the largest eligible
    // discount, so a tier above the store-wide rate wins for that account.
    if (body.action === 'set_tier') {
      const tCustomerId = String(body.customerId || '');
      const tFirst = String(body.firstName || '').slice(0, 100);
      const tCompany = String(body.company || '').slice(0, 200);
      const tEmail = String(body.email || '').slice(0, 200);
      const tPct = parseInt(body.pct, 10);
      if (!tCustomerId || !tEmail || !tFirst || !tCompany || !(tPct >= 5 && tPct <= 90)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'Tier must be a whole number between 5 and 90.' });
      }
      let base = await findTradeDiscount(token);
      const tMinQty = (base && base.minQty) || 5;
      // Tiers ride on code discounts; a legacy automatic baseline would clash
      // with them at checkout (non-combinable), so migrate it first.
      if (base && base.kind === 'automatic') {
        const mig = await migrateBaseline(token, base, Math.round((base.pct || 0.3) * 100), tMinQty);
        if (mig.error) return res.status(200).json({ ok: false, error: 'migrate_failed',
          message: 'Could not migrate the baseline discount to the code system first: ' + mig.error });
      }
      const tTag = 'wholesale-pct-' + tPct;

      // 1. Ensure the tier code discount exists in Shopify.
      const tierR = await ensureTierDiscount(token, tPct, tMinQty);
      if (tierR.error) {
        console.error('[admin/wholesale] tier:', tierR.error);
        return res.status(200).json({ ok: false, error: 'discount_failed',
          message: 'Could not create the tier discount: ' + tierR.error });
      }

      // 2. Move the account onto the tier tag (off any previous tier).
      const ct = await admin(token, CUST_TAGS, { id: tCustomerId });
      const curTags = ((((ct.json.data || {}).customer) || {}).tags) || [];
      const oldTiers = curTags.filter(function (t) { return /^wholesale-pct-\d+$/.test(t) && t !== tTag; });
      if (oldTiers.length) await admin(token, TAGS_REMOVE, { id: tCustomerId, t: oldTiers });
      if (curTags.indexOf(tTag) === -1) {
        const ta = await admin(token, TAGS_ADD, { id: tCustomerId, t: [tTag] });
        const taErrs = []
          .concat((((ta.json.data || {}).tagsAdd) || {}).userErrors || [])
          .concat(ta.json.errors || []);
        if (taErrs.length) {
          console.error('[admin/wholesale] tier tag:', JSON.stringify(taErrs));
          return res.status(200).json({ ok: false, error: 'tag_failed',
            message: 'The tier discount exists but the account could not be tagged: ' + (taErrs[0].message || '') });
        }
      }

      // 3. Record the quote + email the new pricing.
      const tPrice = usd(115 * (1 - tPct / 100));
      const tMinOrder = tMinQty + ' boxes';
      try { await storeQuotedPrices(token, tCustomerId, tPrice, tPrice, tMinOrder); } catch (e) {}
      const tSender = String(process.env.WHOLESALE_SENDER || 'Jon').slice(0, 100);
      const tHtml = buildEmail.reprice({ firstName: tFirst, company: tCompany, priceDog: tPrice, priceCat: tPrice, minOrder: tMinOrder, senderName: tSender });
      const tSent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
        body: JSON.stringify({
          from: FROM, to: [tEmail], reply_to: 'hello@happybeanie.com',
          subject: 'Your new Happy Beanie trade pricing', html: tHtml
        })
      });
      const tJson = await tSent.json().catch(function () { return {}; });
      if (!tSent.ok || !tJson.id) {
        console.error('[admin/wholesale] resend tier:', tSent.status, JSON.stringify(tJson));
        return res.status(200).json({ ok: true, warning: 'tier_set_email_failed', pct: tPct, price: tPrice,
          message: 'The ' + tPct + '% tier is live for this account, but the email did not send — use Email new pricing to retry.' });
      }
      console.log('[admin/wholesale] tier set', tPct + '%', 'for', tEmail, '· resend', tJson.id);
      return res.status(200).json({ ok: true, emailId: tJson.id, pct: tPct, price: tPrice });
    }

    // Pricing-update email for an already-approved account. No tag changes —
    // sends the reprice variant and records the quoted prices on the customer.
    if (body.action === 'reprice_email') {
      const rId = String(body.customerId || '');
      const rFirst = String(body.firstName || '').slice(0, 100);
      const rCompany = String(body.company || '').slice(0, 200);
      const rEmail = String(body.email || '').slice(0, 200);
      const rDog = String(body.priceDog || '').slice(0, 20);
      const rCat = String(body.priceCat || '').slice(0, 20);
      const rMin = String(body.minOrder || '').slice(0, 60);
      const rSender = String(process.env.WHOLESALE_SENDER || 'Jon').slice(0, 100);
      if (!rId || !rEmail || !rFirst || !rCompany || !rDog || !rCat || !rMin) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'All fields are required.' });
      }
      const rHtml = buildEmail.reprice({ firstName: rFirst, company: rCompany, priceDog: rDog, priceCat: rCat, minOrder: rMin, senderName: rSender });
      const rSent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
        body: JSON.stringify({
          from: FROM,
          to: [rEmail],
          reply_to: 'hello@happybeanie.com',
          subject: 'Your new Happy Beanie trade pricing',
          html: rHtml
        })
      });
      const rJson = await rSent.json().catch(function () { return {}; });
      if (!rSent.ok || !rJson.id) {
        console.error('[admin/wholesale] resend reprice:', rSent.status, JSON.stringify(rJson));
        return res.status(502).json({ ok: false, error: 'email_failed',
          message: (rJson && rJson.message) || ('Email service returned ' + rSent.status) });
      }
      console.log('[admin/wholesale] reprice accepted', rJson.id, 'to', rEmail);
      try { await storeQuotedPrices(token, rId, rDog, rCat, rMin); } catch (e) {}
      return res.status(200).json({ ok: true, emailId: rJson.id });
    }
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

    // Record what this account was quoted, so the Approved tab pre-fills it.
    try { await storeQuotedPrices(token, customerId, priceDog, priceCat, minOrder); } catch (e) {}

    return res.status(200).json({ ok: true, emailId: sentJson.id });
  } catch (err) {
    console.error('[admin/wholesale]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};

module.exports.parseNoteApp = parseNoteApp; // exposed for tests
