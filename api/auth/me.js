// GET /api/auth/me — signed-in probe for the site header and cart.
//
// { in: false }                                — no session
// { in: true, wholesale: false }               — signed-in retail customer
// { in: true, wholesale: true, trade: {...} }  — wholesale account; trade holds
//     the LIVE terms of the store's wholesale automatic discount
//     ({ pct, minQty, title }) read from Shopify, so what the cart displays is
//     exactly what checkout will charge. trade is null if the discount is
//     missing or inactive.
//
// The wholesale check reads the customer's own tags via the Customer Account
// API (their session token — no admin data exposed). The discount terms are
// read with the Admin token but contain nothing sensitive (they appear at
// checkout anyway).

const auth = require('../_lib/customer-auth.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';

const DISCOUNTS = `query TradeDiscount {
  automaticDiscountNodes(first: 20) {
    nodes {
      automaticDiscount {
        __typename
        ... on DiscountAutomaticBasic {
          title status
          minimumRequirement { ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } }
          customerGets { value { ... on DiscountPercentage { percentage } } }
        }
      }
    }
  }
}`;

async function tradeTerms() {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return null;
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: DISCOUNTS })
  });
  const json = await res.json().catch(function () { return {}; });
  const nodes = (((json.data || {}).automaticDiscountNodes) || {}).nodes || [];
  const hit = nodes
    .map(function (n) { return n.automaticDiscount || {}; })
    .filter(function (d) {
      return /wholesale|trade/i.test(d.title || '') && String(d.status).toUpperCase() === 'ACTIVE';
    })[0];
  if (!hit) return null;
  const pct = ((hit.customerGets || {}).value || {}).percentage;
  if (typeof pct !== 'number' || pct <= 0) return null;
  const minQty = parseInt(((hit.minimumRequirement || {}).greaterThanOrEqualToQuantity) || '0', 10) || 0;
  return { pct: pct, minQty: minQty, title: hit.title };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!auth.isConfigured()) return res.status(200).json({ in: false });
    const fresh = await auth.ensureFreshSession(req);
    if (!fresh) return res.status(200).json({ in: false });
    if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);

    // Wholesale status from the customer's own record.
    let wholesale = false;
    try {
      const out = await auth.customerGraphql(fresh.session.at, 'query { customer { tags } }');
      const tags = ((out.json && out.json.data && out.json.data.customer) || {}).tags || [];
      wholesale = tags.some(function (t) { return String(t).toLowerCase() === 'wholesale'; });
    } catch (e) { /* probe only — signed-in still stands */ }

    if (!wholesale) return res.status(200).json({ in: true, wholesale: false });

    let trade = null;
    try { trade = await tradeTerms(); } catch (e) {}
    return res.status(200).json({ in: true, wholesale: true, trade: trade });
  } catch (e) {
    return res.status(200).json({ in: false });
  }
};
