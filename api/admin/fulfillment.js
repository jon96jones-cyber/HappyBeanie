// /api/admin/fulfillment — the supplier's compounding + shipping desk.
//
// Auth: a shared secret in the `x-fulfillment-key` header, compared against
// FULFILLMENT_KEY. One key, kept off the page — same model as the bandana desk.
//
// GET  → { ok, orders: [{ orderName, placedAt, financial, customer, address,
//          note, fulfillmentOrderId, items: [{ title, variant, qty, sku,
//          subscription, image, properties: [{name, value}] }] }] }
//   Lists PAID, OPEN, UNFULFILLED orders — the live make-and-ship queue.
//   Subscription renewals show up here automatically (they're just orders).
//
// POST { fulfillmentOrderId, trackingNumber, trackingCompany }
//   → creates the fulfillment with tracking and notifyCustomer: true, which
//     marks the order shipped AND fires the branded Shipping-confirmation email.
//
// Requires SHOPIFY_ADMIN_TOKEN to hold read_orders + the fulfillment-order
// scopes (read/write merchant-managed + assigned fulfillment orders).

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

const QUEUE = 'query Queue { orders(first: 40, query: "fulfillment_status:unfulfilled AND status:open AND financial_status:paid", sortKey: CREATED_AT) ' +
  '{ nodes { id name createdAt displayFinancialStatus note ' +
  'customer { firstName lastName } ' +
  'shippingAddress { name address1 address2 city provinceCode zip country phone } ' +
  'fulfillmentOrders(first: 5) { nodes { id status ' +
  'lineItems(first: 25) { nodes { remainingQuantity ' +
  'lineItem { title variantTitle sku sellingPlan { name } image { url } customAttributes { key value } } } } } } } }';

const FULFILL = 'mutation Fulfill($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) ' +
  '{ fulfillment { id status } userErrors { field message } } }';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function fmtAddress(a) {
  if (!a) return '';
  const l2 = a.address2 ? ' ' + a.address2 : '';
  return [
    a.name,
    (a.address1 || '') + l2,
    [a.city, a.provinceCode, a.zip].filter(Boolean).join(' '),
    a.country
  ].filter(Boolean).join('\n');
}

// Line-item properties: keep the human ones (pet name, personalization), drop
// Shopify's internal underscore-prefixed attributes.
function visibleProps(attrs) {
  return (attrs || [])
    .filter(function (p) { return p && p.key && String(p.key).charAt(0) !== '_' && p.value; })
    .map(function (p) { return { name: p.key, value: p.value }; });
}

const crypto = require('crypto');
function keyOk(req) {
  const expected = process.env.FULFILLMENT_KEY;
  if (!expected) return false;
  const given = String((req.headers && (req.headers['x-fulfillment-key'] || req.headers['X-Fulfillment-Key'])) || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token || !process.env.FULFILLMENT_KEY) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  if (!keyOk(req)) {
    return res.status(401).json({ ok: false, error: 'bad_key' });
  }

  try {
    if (req.method === 'GET') {
      const out = await admin(token, QUEUE);
      // Surface the real reason the read failed instead of showing an empty
      // queue: a token without read_orders / fulfillment scopes, an invalid
      // token (401), or a throttle all otherwise look identical to "no orders."
      const gqlErrors = (out.json && out.json.errors) || [];
      const noData = !out.json || !out.json.data;
      if (out.status === 401 || out.status === 403) {
        return res.status(200).json({ ok: false, error: 'token_rejected', status: out.status,
          message: 'Shopify rejected the Admin token (' + out.status + '). Regenerate it and update SHOPIFY_ADMIN_TOKEN.' });
      }
      if (gqlErrors.length || noData) {
        const first = gqlErrors[0] || {};
        const code = (first.extensions && first.extensions.code) || '';
        const msg = first.message || 'Unknown read error';
        return res.status(200).json({ ok: false, error: 'read_failed', code: code,
          message: (code === 'ACCESS_DENIED' || /access denied/i.test(msg))
            ? 'The Admin token is missing order/fulfillment permissions (' + msg + ').'
            : ('Shopify read error: ' + msg) });
      }
      const nodes = (out.json && out.json.data && out.json.data.orders && out.json.data.orders.nodes) || [];
      const orders = nodes.map(function (o) {
        // The OPEN fulfillment order is the one the supplier acts on.
        const fo = ((o.fulfillmentOrders && o.fulfillmentOrders.nodes) || [])
          .find(function (f) { return f.status === 'OPEN' || f.status === 'IN_PROGRESS'; })
          || (o.fulfillmentOrders && o.fulfillmentOrders.nodes && o.fulfillmentOrders.nodes[0]);
        const items = ((fo && fo.lineItems && fo.lineItems.nodes) || []).map(function (li) {
          const l = li.lineItem || {};
          return {
            title: l.title || '',
            variant: (l.variantTitle && l.variantTitle !== 'Default Title') ? l.variantTitle : '',
            qty: li.remainingQuantity,
            sku: l.sku || '',
            subscription: (l.sellingPlan && l.sellingPlan.name) || '',
            image: (l.image && l.image.url) || '',
            properties: visibleProps(l.customAttributes)
          };
        }).filter(function (i) { return i.qty > 0; });
        return {
          orderName: o.name,
          placedAt: o.createdAt,
          financial: o.displayFinancialStatus,
          customer: [o.customer && o.customer.firstName, o.customer && o.customer.lastName].filter(Boolean).join(' '),
          address: fmtAddress(o.shippingAddress),
          note: o.note || '',
          fulfillmentOrderId: fo && fo.id,
          items: items
        };
      }).filter(function (o) { return o.fulfillmentOrderId && o.items.length; });
      return res.status(200).json({ ok: true, orders: orders });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const body = readBody(req);
    const fulfillmentOrderId = String(body.fulfillmentOrderId || '');
    const trackingNumber = String(body.trackingNumber || '').trim();
    const trackingCompany = String(body.trackingCompany || '').trim();
    if (!fulfillmentOrderId || !trackingNumber) {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }

    const tracking = { number: trackingNumber };
    if (trackingCompany) tracking.company = trackingCompany; // Shopify derives the tracking URL for known carriers

    const out = await admin(token, FULFILL, {
      fulfillment: {
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fulfillmentOrderId }],
        trackingInfo: tracking,
        notifyCustomer: true
      }
    });
    const node = out.json && out.json.data && out.json.data.fulfillmentCreate;
    const errs = (node && node.userErrors) || [];
    if (errs.length || (out.json && out.json.errors && out.json.errors.length)) {
      const msg = errs.length ? errs[0].message : JSON.stringify(out.json.errors);
      console.error('[admin/fulfillment] fulfill:', msg);
      return res.status(502).json({ ok: false, error: 'upstream', message: errs.length ? errs[0].message : undefined });
    }
    return res.status(200).json({ ok: true, status: (node.fulfillment && node.fulfillment.status) || 'SUCCESS' });
  } catch (err) {
    console.error('[admin/fulfillment]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
