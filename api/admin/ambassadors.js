// /api/admin/ambassadors — the ambassador desk.
//
// GET  → { ok, pending: [...], approved: [...] }
//        pending: tag:ambassador-pending applications
//        approved: tag:ambassador accounts with their code, commission tier,
//        and sales pulled live from orders that used their code (order count,
//        net sales, commission owed — all-time and last 30 days).
//
// POST { action: 'approve', customerId, firstName, email, code, buyerPct, commissionPct }
//        Creates the public discount code (buyerPct% off, once per customer),
//        moves tags pending → ambassador + amb-pct-NN + amb-code-CODE, and
//        sends the approval email with code + link.
// POST { action: 'set_tier', customerId, firstName, email, code, commissionPct }
//        Swaps the amb-pct tag and emails the new rate. The code is untouched.
// POST { action: 'decline', customerId }
//        Removes the pending tag. No email — decline how you like, by hand.
//
// Auth: shared secret in `x-ambassador-key` vs AMBASSADOR_KEY, falling back to
// WHOLESALE_KEY so the existing desk key works day one.
//
// Env: SHOPIFY_ADMIN_TOKEN, AMBASSADOR_KEY (or WHOLESALE_KEY), RESEND_API_KEY.
// Optional: AMBASSADOR_FROM (default 'Happy Beanie <hello@happybeanie.com>'),
//           AMBASSADOR_SENDER (default 'Jon').

const crypto = require('crypto');
const buildEmail = require('../_lib/ambassador-email.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const FROM = process.env.AMBASSADOR_FROM || 'Happy Beanie <hello@happybeanie.com>';
const SITE = 'https://www.happybeanie.com';

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

const PENDING_Q = `query AmbPending {
  customers(first: 50, query: "tag:ambassador-pending") {
    nodes {
      id firstName lastName email note createdAt
      instagram: metafield(namespace: "ambassador", key: "instagram") { value }
      tiktok: metafield(namespace: "ambassador", key: "tiktok") { value }
      otherChannel: metafield(namespace: "ambassador", key: "other_channel") { value }
      audience: metafield(namespace: "ambassador", key: "audience") { value }
      why: metafield(namespace: "ambassador", key: "why") { value }
    }
  }
}`;

const APPROVED_Q = `query AmbApproved {
  customers(first: 100, query: "tag:ambassador") {
    nodes {
      id firstName lastName email tags createdAt
      instagram: metafield(namespace: "ambassador", key: "instagram") { value }
      tiktok: metafield(namespace: "ambassador", key: "tiktok") { value }
      audience: metafield(namespace: "ambassador", key: "audience") { value }
    }
  }
}`;

const ORDERS_Q = `query AmbOrders($q: String!) {
  orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id name createdAt cancelledAt displayFinancialStatus
      currentSubtotalPriceSet { shopMoney { amount } }
    }
  }
}`;

const CODES_Q = `query AmbCodes {
  codeDiscountNodes(first: 100) {
    nodes {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic { title status codes(first: 1) { nodes { code } } }
      }
    }
  }
}`;

const CODE_CREATE = `mutation CodeCreate($d: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $d) { userErrors { field message } }
}`;

const CUST_TAGS = `query CustTags($id: ID!) { customer(id: $id) { tags } }`;
const TAGS_REMOVE = `mutation TagsRemove($id: ID!, $t: [String!]!) {
  tagsRemove(id: $id, tags: $t) { userErrors { message } }
}`;
const TAGS_ADD = `mutation TagsAdd($id: ID!, $t: [String!]!) {
  tagsAdd(id: $id, tags: $t) { userErrors { message } }
}`;
const MF_SET = `mutation SetMf($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}`;

function keyOk(req) {
  const expected = String(process.env.AMBASSADOR_KEY || process.env.WHOLESALE_KEY || '');
  if (!expected) return false;
  const given = String((req.headers && req.headers['x-ambassador-key']) || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function ambInfoFromTags(tags) {
  let pct = null, code = null;
  (tags || []).forEach(function (t) {
    let m = String(t).match(/^amb-pct-(\d+)$/);
    if (m) pct = parseInt(m[1], 10);
    m = String(t).match(/^amb-code-(.+)$/);
    if (m) code = m[1];
  });
  return { pct: pct, code: code };
}

// Public one-per-customer code: buyerPct% off everything, no minimum, works on
// one-time and subscription first orders, open to all customers.
function ambCodeInput(code, buyerPct) {
  return {
    title: 'Ambassador — ' + code + ' (' + buyerPct + '% off)',
    code: code,
    startsAt: new Date().toISOString(),
    customerSelection: { all: true },
    customerGets: {
      value: { percentage: buyerPct / 100 },
      items: { all: true },
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: true
    },
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    appliesOncePerCustomer: true
  };
}

// Sales for one code: sum of non-cancelled order subtotals, all-time and
// 30-day. The discount code on the order IS the attribution — no extra
// tracking infrastructure.
async function salesForCode(token, code) {
  const out = await admin(token, ORDERS_Q, { q: 'discount_code:' + code });
  const nodes = ((((out.json || {}).data || {}).orders) || {}).nodes || [];
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  let all = 0, all30 = 0, count = 0, count30 = 0;
  nodes.forEach(function (o) {
    if (o.cancelledAt) return;
    if (String(o.displayFinancialStatus).toUpperCase() === 'REFUNDED') return;
    const amt = parseFloat((((o.currentSubtotalPriceSet || {}).shopMoney) || {}).amount || '0') || 0;
    all += amt; count += 1;
    if (new Date(o.createdAt).getTime() >= cutoff) { all30 += amt; count30 += 1; }
  });
  return { orders: count, sales: all, orders30: count30, sales30: all30, capped: nodes.length === 100 };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!keyOk(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'not_configured', message: 'SHOPIFY_ADMIN_TOKEN is not set.' });

  try {
    if (req.method === 'GET') {
      const [p, a] = await Promise.all([admin(token, PENDING_Q), admin(token, APPROVED_Q)]);
      const mf = function (f) { return f && f.value ? f.value : ''; };

      const pending = (((((p.json || {}).data) || {}).customers || {}).nodes || []).map(function (c) {
        return {
          id: c.id, firstName: c.firstName || '', lastName: c.lastName || '', email: c.email || '',
          createdAt: c.createdAt,
          instagram: mf(c.instagram), tiktok: mf(c.tiktok), otherChannel: mf(c.otherChannel),
          audience: mf(c.audience), why: mf(c.why), note: c.note || ''
        };
      });

      const approvedNodes = (((((a.json || {}).data) || {}).customers || {}).nodes || [])
        .filter(function (c) {
          // tag:ambassador search also matches ambassador-pending — keep only
          // accounts carrying the exact approved tag.
          return (c.tags || []).some(function (t) { return String(t).toLowerCase() === 'ambassador'; });
        });

      const approved = [];
      for (const c of approvedNodes) {
        const info = ambInfoFromTags(c.tags);
        let stats = null;
        if (info.code) {
          try { stats = await salesForCode(token, info.code); } catch (e) { stats = null; }
        }
        approved.push({
          id: c.id, firstName: c.firstName || '', lastName: c.lastName || '', email: c.email || '',
          instagram: mf(c.instagram), tiktok: mf(c.tiktok), audience: mf(c.audience),
          code: info.code, pct: info.pct,
          link: info.code ? SITE + '/?ref=' + encodeURIComponent(info.code) : null,
          stats: stats
        });
      }

      return res.status(200).json({ ok: true, pending: pending, approved: approved });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    if (body.action === 'decline') {
      const id = String(body.customerId || '');
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const out = await admin(token, TAGS_REMOVE, { id: id, t: ['ambassador-pending'] });
      const errs = [].concat((((out.json.data || {}).tagsRemove) || {}).userErrors || []).concat(out.json.errors || []);
      if (errs.length) return res.status(200).json({ ok: false, error: 'tag_failed', message: errs[0].message || 'Could not remove the pending tag.' });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'set_tier') {
      const id = String(body.customerId || '');
      const firstName = String(body.firstName || '').slice(0, 100);
      const email = String(body.email || '').slice(0, 200);
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
      const pct = parseInt(body.commissionPct, 10);
      if (!id || !email || !firstName || !code || !(pct >= 5 && pct <= 50)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'Commission must be a whole number between 5 and 50.' });
      }
      const tag = 'amb-pct-' + pct;
      const ct = await admin(token, CUST_TAGS, { id: id });
      const curTags = ((((ct.json.data || {}).customer) || {}).tags) || [];
      const oldTiers = curTags.filter(function (t) { return /^amb-pct-\d+$/.test(t) && t !== tag; });
      if (oldTiers.length) await admin(token, TAGS_REMOVE, { id: id, t: oldTiers });
      if (curTags.indexOf(tag) === -1) {
        const ta = await admin(token, TAGS_ADD, { id: id, t: [tag] });
        const taErrs = [].concat((((ta.json.data || {}).tagsAdd) || {}).userErrors || []).concat(ta.json.errors || []);
        if (taErrs.length) return res.status(200).json({ ok: false, error: 'tag_failed', message: taErrs[0].message || 'Could not set the tier tag.' });
      }
      const sender = String(process.env.AMBASSADOR_SENDER || process.env.WHOLESALE_SENDER || 'Jon').slice(0, 100);
      const t = { firstName: firstName, code: code, link: SITE + '/?ref=' + encodeURIComponent(code), buyerPct: 10, commissionPct: pct, senderName: sender };
      const sent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
        body: JSON.stringify({
          from: FROM, to: [email], reply_to: 'hello@happybeanie.com',
          subject: 'Your new Happy Beanie ambassador rate',
          html: buildEmail.retier(t), text: buildEmail.retierText(t)
        })
      });
      const sj = await sent.json().catch(function () { return {}; });
      if (!sent.ok || !sj.id) {
        return res.status(200).json({ ok: true, warning: 'tier_set_email_failed', pct: pct,
          message: 'The ' + pct + '% rate is live, but the email did not send.' });
      }
      return res.status(200).json({ ok: true, emailId: sj.id, pct: pct });
    }

    // Default action: approve.
    const id = String(body.customerId || '');
    const firstName = String(body.firstName || '').slice(0, 100);
    const email = String(body.email || '').slice(0, 200);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
    const buyerPct = parseInt(body.buyerPct, 10) || 10;
    const commissionPct = parseInt(body.commissionPct, 10);
    if (!id || !email || !firstName || !code || code.length < 3) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'Code must be at least 3 letters/numbers.' });
    }
    if (!(buyerPct >= 5 && buyerPct <= 50) || !(commissionPct >= 5 && commissionPct <= 50)) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'Both percentages must be whole numbers between 5 and 50.' });
    }

    // 1. Create the public code unless it already exists.
    const cOut = await admin(token, CODES_Q);
    const cNodes = ((((cOut.json || {}).data || {}).codeDiscountNodes) || {}).nodes || [];
    const codeExists = cNodes.some(function (n) {
      const cd = n.codeDiscount || {};
      return ((((cd.codes || {}).nodes || [])[0] || {}).code) === code;
    });
    if (!codeExists) {
      const dc = await admin(token, CODE_CREATE, { d: ambCodeInput(code, buyerPct) });
      const dcErrs = [].concat((((dc.json.data || {}).discountCodeBasicCreate) || {}).userErrors || []).concat(dc.json.errors || []);
      if (dcErrs.length) {
        console.error('[admin/ambassadors] code create:', JSON.stringify(dcErrs));
        return res.status(200).json({ ok: false, error: 'discount_failed', message: 'Could not create the code: ' + (dcErrs[0].message || '') });
      }
    }

    // 2. Tags: pending off; ambassador + tier + code on.
    const ct = await admin(token, CUST_TAGS, { id: id });
    const curTags = ((((ct.json.data || {}).customer) || {}).tags) || [];
    const drop = curTags.filter(function (t) {
      return t === 'ambassador-pending' || (/^amb-pct-\d+$/.test(t) && t !== 'amb-pct-' + commissionPct) || (/^amb-code-/.test(t) && t !== 'amb-code-' + code);
    });
    if (drop.length) await admin(token, TAGS_REMOVE, { id: id, t: drop });
    const add = ['ambassador', 'amb-pct-' + commissionPct, 'amb-code-' + code].filter(function (t) { return curTags.indexOf(t) === -1; });
    if (add.length) {
      const ta = await admin(token, TAGS_ADD, { id: id, t: add });
      const taErrs = [].concat((((ta.json.data || {}).tagsAdd) || {}).userErrors || []).concat(ta.json.errors || []);
      if (taErrs.length) {
        console.error('[admin/ambassadors] tags:', JSON.stringify(taErrs));
        return res.status(200).json({ ok: false, error: 'tag_failed', message: 'The code exists but the account could not be tagged: ' + (taErrs[0].message || '') });
      }
    }

    // 3. Record status + code on the customer record.
    try {
      await admin(token, MF_SET, { metafields: [
        { ownerId: id, namespace: 'ambassador', key: 'status', type: 'single_line_text_field', value: 'approved' },
        { ownerId: id, namespace: 'ambassador', key: 'code', type: 'single_line_text_field', value: code }
      ] });
    } catch (e) {}

    // 4. Approval email with code + link.
    const sender = String(process.env.AMBASSADOR_SENDER || process.env.WHOLESALE_SENDER || 'Jon').slice(0, 100);
    const t = { firstName: firstName, code: code, link: SITE + '/?ref=' + encodeURIComponent(code), buyerPct: buyerPct, commissionPct: commissionPct, senderName: sender };
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
      body: JSON.stringify({
        from: FROM, to: [email], reply_to: 'hello@happybeanie.com',
        subject: 'You’re in — your Happy Beanie ambassador code',
        html: buildEmail(t), text: buildEmail.text(t)
      })
    });
    const sj = await sent.json().catch(function () { return {}; });
    if (!sent.ok || !sj.id) {
      console.error('[admin/ambassadors] resend:', sent.status, JSON.stringify(sj));
      return res.status(200).json({ ok: true, warning: 'approved_email_failed', code: code,
        message: 'The account is approved and the code is live, but the email did not send.' });
    }
    console.log('[admin/ambassadors] approved', email, 'code', code, commissionPct + '%', '· resend', sj.id);
    return res.status(200).json({ ok: true, emailId: sj.id, code: code, link: t.link });
  } catch (err) {
    console.error('[admin/ambassadors] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'internal', message: String(err && err.message || err) });
  }
};
