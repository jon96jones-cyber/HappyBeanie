// GET /api/admin/subscriptions — every subscription contract, read-only.
//
// The account portal can only see a customer's own contracts and the rescue
// cron only reads status and email, so until now nobody could answer "is
// that subscription cancelled, and why?" without opening the Shopify admin.
// This lists them all from the Admin API with what matters when a renewal
// goes wrong: status, next billing date, the last payment result, and the
// most recent billing attempts with Shopify's error code and message.
//
// ?status=ACTIVE|PAUSED|CANCELLED|EXPIRED|FAILED   filter (default: all)
// ?q=<text>                                        customer email or name
//
// Two ways in, both read-only:
//   1. The desk key, `x-analytics-key` — the Live desk's key, shared on
//      purpose (same concern, one secret). This is the browser path.
//   2. A request that arrived on one of this project's *.vercel.app
//      deployment hosts. Deployment Protection on this project is set to
//      "all deployments except custom domains", so a request can only reach
//      this function on such a host after Vercel Authentication has passed:
//      the caller is a member of the Vercel team. That is how a signed-in
//      Vercel session — including the operator's own tooling — can read
//      the list without a key ever appearing in a URL. On that path email
//      addresses are masked; the name and the contract are what a
//      diagnosis needs. If protection were ever switched off, this path
//      would still expose only masked addresses, but switch it back on.
//
// Env: SHOPIFY_ADMIN_TOKEN, ANALYTICS_KEY.

const db = require('../_lib/analytics-db.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'];
const PAGE = 50;
const MAX_PAGES = 4;

const Q = `query Subs($after: String, $q: String) {
  subscriptionContracts(first: ${PAGE}, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id status createdAt updatedAt nextBillingDate lastPaymentStatus
      customer { id displayName email }
      billingPolicy { interval intervalCount }
      originOrder { name }
      lines(first: 3) { nodes { title variantTitle quantity currentPrice { amount currencyCode } } }
      billingAttempts(first: 3, reverse: true) {
        nodes { id createdAt ready errorCode errorMessage order { name } }
      }
    }
  }
}`;

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

function protectedHost(req) {
  if (process.env.VERCEL !== '1') return false;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase().split(':')[0];
  return /\.vercel\.app$/.test(host);
}

function mask(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? '***' : '';
  return s.charAt(0) + '***' + s.slice(at);
}

function gid(id) { return String(id || '').split('/').pop(); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const keyed = !!process.env.ANALYTICS_KEY && db.keyOk(req, 'x-analytics-key', 'ANALYTICS_KEY');
  const viaHost = !keyed && protectedHost(req);
  if (!keyed && !viaHost) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'not_configured', message: 'SHOPIFY_ADMIN_TOKEN is not set.' });

  const q = req.query || {};
  const status = STATUSES.indexOf(String(q.status || '').toUpperCase()) === -1 ? '' : String(q.status).toUpperCase();
  const text = String(q.q || '').trim().slice(0, 120);
  // Shopify's contract search understands status:, and free text matches the
  // customer. Quotes are stripped so the text cannot break out of the term.
  const terms = [];
  if (status) terms.push('status:' + status);
  if (text) terms.push('"' + text.replace(/["\\]/g, ' ') + '"');
  const search = terms.join(' ') || null;

  try {
    const contracts = [];
    let after = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const out = await admin(token, Q, { after: after, q: search });
      if (out.errors && out.errors.length) {
        console.error('[admin/subscriptions] shopify:', JSON.stringify(out.errors).slice(0, 400));
        return res.status(502).json({ ok: false, error: 'shopify_query_failed', message: out.errors[0].message });
      }
      const c = (((out || {}).data || {}).subscriptionContracts) || {};
      (c.nodes || []).forEach(function (n) { contracts.push(n); });
      if (!c.pageInfo || !c.pageInfo.hasNextPage) break;
      after = c.pageInfo.endCursor;
    }

    const counts = {};
    STATUSES.forEach(function (s) { counts[s] = 0; });
    const rows = contracts.map(function (n) {
      counts[n.status] = (counts[n.status] || 0) + 1;
      const cust = n.customer || {};
      const line = ((n.lines || {}).nodes || [])[0] || {};
      const attempts = ((n.billingAttempts || {}).nodes || []).map(function (a) {
        return {
          at: a.createdAt, ready: !!a.ready,
          errorCode: a.errorCode || null, errorMessage: a.errorMessage || null,
          order: (a.order && a.order.name) || null
        };
      });
      return {
        id: gid(n.id),
        status: n.status,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        nextBillingDate: n.nextBillingDate || null,
        lastPaymentStatus: n.lastPaymentStatus || null,
        customer: {
          id: gid(cust.id),
          name: cust.displayName || '',
          email: viaHost ? mask(cust.email) : (cust.email || '')
        },
        every: n.billingPolicy ? (n.billingPolicy.intervalCount + ' ' + String(n.billingPolicy.interval || '').toLowerCase()) : '',
        product: [line.title, line.variantTitle].filter(Boolean).join(' · '),
        price: line.currentPrice ? Number(line.currentPrice.amount) : null,
        originOrder: (n.originOrder && n.originOrder.name) || null,
        attempts: attempts
      };
    });

    return res.status(200).json({
      ok: true,
      via: keyed ? 'key' : 'deployment',
      filter: { status: status || null, q: text || null },
      counts: counts,
      total: rows.length,
      truncated: contracts.length >= PAGE * MAX_PAGES,
      contracts: rows
    });
  } catch (err) {
    console.error('[admin/subscriptions]', err && err.message);
    return res.status(502).json({ ok: false, error: 'unreachable', message: err && err.message });
  }
};
