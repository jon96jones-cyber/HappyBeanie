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

const CODES_Q = `query TradeCodes {
  codeDiscountNodes(first: 50) {
    nodes {
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

const AUTOS_Q = `query TradeDiscount {
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

async function adminQuery(query) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return null;
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query })
  });
  return res.json().catch(function () { return {}; });
}

function terms(d) {
  const pct = ((d.customerGets || {}).value || {}).percentage;
  if (typeof pct !== 'number' || pct <= 0) return null;
  const minQty = parseInt(((d.minimumRequirement || {}).greaterThanOrEqualToQuantity) || '0', 10) || 0;
  return { pct: pct, minQty: minQty, title: d.title };
}

// Baseline trade terms. Preferred: the WHOLESALE baseline code (the cart
// attaches its code at checkout). Legacy fallback: the pre-migration automatic
// discount, which self-applies at checkout, so code stays null.
async function tradeTerms() {
  const cJson = await adminQuery(CODES_Q);
  const cNodes = (((cJson || {}).data || {}).codeDiscountNodes || {}).nodes || [];
  const cHit = cNodes
    .map(function (n) { return n.codeDiscount || {}; })
    .filter(function (d) {
      const code = ((((d.codes || {}).nodes || [])[0]) || {}).code || '';
      return code === 'WHOLESALE' && String(d.status).toUpperCase() === 'ACTIVE';
    })[0];
  if (cHit) {
    const t = terms(cHit);
    if (t) { t.code = 'WHOLESALE'; return t; }
  }
  const aJson = await adminQuery(AUTOS_Q);
  const aNodes = (((aJson || {}).data || {}).automaticDiscountNodes || {}).nodes || [];
  const aHit = aNodes
    .map(function (n) { return n.automaticDiscount || {}; })
    .filter(function (d) {
      return /wholesale|trade/i.test(d.title || '') && !/tier/i.test(d.title || '')
        && String(d.status).toUpperCase() === 'ACTIVE';
    })[0];
  if (!aHit) return null;
  const t = terms(aHit);
  if (t) t.code = null;
  return t;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!auth.isConfigured()) return res.status(200).json({ in: false });
    const fresh = await auth.ensureFreshSession(req);
    if (!fresh) return res.status(200).json({ in: false });
    if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);

    // Wholesale + ambassador status from the customer's own record.
    let wholesale = false;
    let tierPct = null;
    let ambassador = null;
    try {
      const out = await auth.customerGraphql(fresh.session.at, 'query { customer { tags } }');
      const tags = ((out.json && out.json.data && out.json.data.customer) || {}).tags || [];
      wholesale = tags.some(function (t) { return String(t).toLowerCase() === 'wholesale'; });
      for (let i = 0; i < tags.length; i++) {
        const m = String(tags[i]).match(/^wholesale-pct-(\d+)$/);
        if (m) { tierPct = parseInt(m[1], 10); break; }
      }
      // Ambassador terms ride on tags too: amb-pct-NN (commission) and
      // amb-code-CODE (their public discount code) — set by the desk.
      if (tags.some(function (t) { return String(t).toLowerCase() === 'ambassador'; })) {
        let ambPct = null, ambCode = null;
        tags.forEach(function (t) {
          let m = String(t).match(/^amb-pct-(\d+)$/);
          if (m) ambPct = parseInt(m[1], 10);
          m = String(t).match(/^amb-code-(.+)$/);
          if (m) ambCode = m[1];
        });
        if (ambCode) {
          ambassador = { pct: ambPct, code: ambCode,
            link: 'https://www.happybeanie.com/?ref=' + encodeURIComponent(ambCode) };
        }
      }
    } catch (e) { /* probe only — signed-in still stands */ }

    if (!wholesale) return res.status(200).json({ in: true, wholesale: false, ambassador: ambassador });

    let trade = null;
    try { trade = await tradeTerms(); } catch (e) {}
    // A tier overrides the store-wide percentage for this account — the cart
    // attaches the tier's TRADE<NN> code at checkout, which is restricted to
    // this account's segment. The minimum stays the store-wide one.
    if (tierPct) {
      trade = {
        pct: tierPct / 100,
        minQty: (trade && trade.minQty) || 5,
        title: 'Wholesale tier — ' + tierPct + '%',
        code: 'TRADE' + tierPct
      };
    }
    return res.status(200).json({ in: true, wholesale: true, trade: trade, ambassador: ambassador });
  } catch (e) {
    return res.status(200).json({ in: false });
  }
};
