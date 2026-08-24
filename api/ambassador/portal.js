// /api/ambassador/portal — the signed-in ambassador's own dashboard.
//
// POST { payoutMethod } — saves how they want to be paid (a PayPal email or
// Venmo handle, max 200 chars). Deliberately NOT bank account details: raw
// ACH numbers never touch this stack. Stored in the ambassador.payout_method
// metafield and shown on the admin desk beside their balance.
//
// GET — dashboard data:
//
// Auth is the customer's session cookie (same as the account portal). The
// customer's tags prove ambassador status and carry their code + rate; the
// Admin token then computes THEIR numbers server-side:
//
// { ok: true, code, pct, link,
//   stats: { orders, sales, earned, orders30, sales30, earned30,
//            paidTotal, balance },
//   recent: [{ name, date, subtotal, commission }] }
//
// Sales are net subtotals of non-cancelled, non-refunded orders that used
// their code. paidTotal comes from the ambassador.paid_total metafield the
// desk writes when a payout is recorded; balance = earned − paidTotal.

const auth = require('../_lib/customer-auth.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const SITE = 'https://www.happybeanie.com';

async function admin(query, variables) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return null;
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

const ORDERS_Q = `query AmbOrders($q: String!) {
  orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) {
    nodes {
      name createdAt cancelledAt displayFinancialStatus
      currentSubtotalPriceSet { shopMoney { amount } }
    }
  }
}`;

const PAID_Q = `query AmbPaid($q: String!) {
  customers(first: 1, query: $q) {
    nodes {
      id
      paid: metafield(namespace: "ambassador", key: "paid_total") { value }
      payout: metafield(namespace: "ambassador", key: "payout_method") { value }
    }
  }
}`;

const MF_SET = `mutation SetMf($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!auth.isConfigured()) return res.status(200).json({ ok: false, error: 'not_signed_in' });
    const fresh = await auth.ensureFreshSession(req);
    if (!fresh) return res.status(200).json({ ok: false, error: 'not_signed_in' });
    if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);

    // Who am I, per my own session — tags carry the terms, email keys the
    // payout metafield lookup.
    const out = await auth.customerGraphql(fresh.session.at,
      'query { customer { tags emailAddress { emailAddress } } }');
    const cust = ((out.json && out.json.data && out.json.data.customer) || {});
    const tags = cust.tags || [];
    const email = ((cust.emailAddress || {}).emailAddress || '').toLowerCase();

    const isAmb = tags.some(function (t) { return String(t).toLowerCase() === 'ambassador'; });
    let code = null, pct = null;
    tags.forEach(function (t) {
      let m = String(t).match(/^amb-code-(.+)$/);
      if (m) code = m[1].toUpperCase();
      m = String(t).match(/^amb-pct-(\d+)$/);
      if (m) pct = parseInt(m[1], 10);
    });
    if (!isAmb || !code) return res.status(200).json({ ok: false, error: 'not_ambassador' });

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};
      const method = String(body.payoutMethod || '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      // Refuse anything that looks like bank details — this field is for a
      // PayPal email or Venmo handle only.
      if (/\d{9,}/.test(method.replace(/\D/g, ''))) {
        return res.status(200).json({ ok: false, error: 'no_bank_details',
          message: 'That looks like a bank account number — please enter a PayPal email or Venmo handle instead. We never store bank details.' });
      }
      const pj = await admin(PAID_Q, { q: 'email:' + email });
      const node = (((((pj || {}).data || {}).customers) || {}).nodes || [])[0];
      if (!node || !node.id) return res.status(200).json({ ok: false, error: 'not_found' });
      const setOut = await admin(MF_SET, { metafields: [
        { ownerId: node.id, namespace: 'ambassador', key: 'payout_method', type: 'single_line_text_field', value: method || '—' }
      ] });
      const errs = [].concat(((((setOut || {}).data || {}).metafieldsSet) || {}).userErrors || []).concat((setOut || {}).errors || []);
      if (errs.length) return res.status(200).json({ ok: false, error: 'save_failed' });
      return res.status(200).json({ ok: true, payoutMethod: method });
    }

    // Their orders, by their code.
    let orders = 0, sales = 0, orders30 = 0, sales30 = 0;
    const recent = [];
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    try {
      const oj = await admin(ORDERS_Q, { q: 'discount_code:' + code });
      const nodes = ((((oj || {}).data || {}).orders) || {}).nodes || [];
      nodes.forEach(function (o) {
        if (o.cancelledAt) return;
        if (String(o.displayFinancialStatus).toUpperCase() === 'REFUNDED') return;
        const amt = parseFloat((((o.currentSubtotalPriceSet || {}).shopMoney) || {}).amount || '0') || 0;
        orders += 1; sales += amt;
        if (new Date(o.createdAt).getTime() >= cutoff) { orders30 += 1; sales30 += amt; }
        if (recent.length < 12) {
          recent.push({
            name: o.name,
            date: o.createdAt,
            subtotal: Math.round(amt * 100) / 100,
            commission: pct ? Math.round(amt * pct) / 100 : null
          });
        }
      });
    } catch (e) { /* stats stay zero — the portal still renders */ }

    // Paid-to-date, recorded by the desk.
    let paidTotal = 0, payoutMethod = '';
    try {
      const pj = await admin(PAID_Q, { q: 'email:' + email });
      const node = (((((pj || {}).data || {}).customers) || {}).nodes || [])[0];
      paidTotal = parseFloat(((node || {}).paid || {}).value || '0') || 0;
      payoutMethod = ((node || {}).payout || {}).value || '';
      if (payoutMethod === '—') payoutMethod = '';
    } catch (e) {}

    const earned = pct ? Math.round(sales * pct) / 100 : 0;
    const earned30 = pct ? Math.round(sales30 * pct) / 100 : 0;

    return res.status(200).json({
      ok: true,
      code: code,
      pct: pct,
      payoutMethod: payoutMethod,
      link: SITE + '/?ref=' + encodeURIComponent(code),
      stats: {
        orders: orders, sales: Math.round(sales * 100) / 100, earned: earned,
        orders30: orders30, sales30: Math.round(sales30 * 100) / 100, earned30: earned30,
        paidTotal: Math.round(paidTotal * 100) / 100,
        balance: Math.round((earned - paidTotal) * 100) / 100
      },
      recent: recent
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'internal' });
  }
};
