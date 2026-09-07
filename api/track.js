// GET /api/track?o=<order number>&e=<email> — the data behind /track, our own
// order-status page.
//
// Why this exists: Shopify's order-status page is the only thing a shipping
// email could link to when there was no carrier URL, and it lands the customer
// on shopify.com wearing Shop Pay's furniture. This serves the same facts from
// our own domain.
//
// Proving who you are costs the customer nothing: the link carries the order
// number and the email the order was placed with, and the server checks the
// pair against Shopify. Knowing an order number is easy — they run in
// sequence — but knowing which address goes with it is not, which is the same
// bargain every "look up my order" form on the web makes.
//
// Shopify's notification templates need no secret and no setup to build it:
//
//   /track?o={{ order_name | remove: '#' }}&e={{ email | default: customer.email | url_encode }}
//
// A signed link still works too — k=HMAC-SHA256(order number, TRACK_SECRET)
// truncated to 16 hex — for anywhere we send mail ourselves and would rather
// not put an address in a URL. Either credential opens the page; neither is
// required to be present when the other is.
//
// Env: SHOPIFY_ADMIN_TOKEN (read_orders). TRACK_SECRET is optional and only
// needed for the signed variant.

const crypto = require('crypto');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';

const ORDER = `query Track($q: String!) {
  orders(first: 1, query: $q) {
    nodes {
    name
    processedAt
    displayFulfillmentStatus
    cancelledAt
    shippingAddress { name city provinceCode zip country }
    lineItems(first: 25) {
      nodes { title quantity variantTitle image { url } }
    }
    fulfillments(first: 10) {
      id
      createdAt
      displayStatus
      estimatedDeliveryAt
      latestShipmentStatus
      trackingInfo { number url company }
    }
    }
  }
}`;

function sign(orderId) {
  return crypto.createHmac('sha256', String(process.env.TRACK_SECRET))
    .update(String(orderId)).digest('hex').slice(0, 16);
}

// Constant-time compare that cannot throw on a length mismatch.
function sigOk(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

// Shopify's shipment statuses, said the way a person would. Anything we have
// not seen before falls through to the fulfillment's own display status rather
// than inventing a phrase for it.
const SHIPMENT_WORDS = {
  LABEL_PRINTED: 'Label printed',
  LABEL_PURCHASED: 'Label printed',
  ATTEMPTED_DELIVERY: 'Delivery attempted',
  READY_FOR_PICKUP: 'Ready for pickup',
  CONFIRMED: 'Picked up by the carrier',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  FAILURE: 'The carrier reported a problem'
};

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  // TRACK_SECRET is optional — it only enables the signed variant.
  if (!token) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const q = req.query || {};
  // The order number as the email wrote it — digits only, so a stray '#'
  // or whitespace cannot change what gets checked.
  const orderNo = String(q.o || '').replace(/[^0-9]/g, '');
  const claimedEmail = String(q.e || '').trim().toLowerCase().slice(0, 200);
  const given = String(q.k || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  // A signature is proof on its own; an email has to be checked against the
  // order once we have it.
  const signed = !!(process.env.TRACK_SECRET && given.length === 16 && orderNo && sigOk(given, sign(orderNo)));
  if (!orderNo || (!signed && !claimedEmail)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  try {
    const out = await admin(token, ORDER, { q: 'name:#' + orderNo });
    const nodes = (out.json && out.json.data && out.json.data.orders && out.json.data.orders.nodes) || [];
    const o = nodes[0];
    // One answer for every failure — a wrong email, a wrong signature and an
    // order that does not exist must look identical, or the endpoint becomes
    // a way to test which addresses shop here.
    if (!o) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!signed && String(o.email || '').trim().toLowerCase() !== claimedEmail) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    const fulfillments = (o.fulfillments || []).map(function (f) {
      const t = (f.trackingInfo || [])[0] || {};
      return {
        shippedAt: f.createdAt,
        // With no carrier scan yet, "Fulfilled" is Shopify's word, not a
        // sentence anyone wants to read about their own parcel.
        status: f.latestShipmentStatus
          ? (SHIPMENT_WORDS[f.latestShipmentStatus] || titleCase(f.latestShipmentStatus))
          : (f.displayStatus === 'DELIVERED' ? 'Delivered' : 'On its way'),
        // When the carrier has spoken, the carrier decides — displayStatus can
        // still read DELIVERED while the last scan says the box is in transit,
        // and the page must not announce an arrival the carrier hasn't.
        delivered: f.latestShipmentStatus
          ? f.latestShipmentStatus === 'DELIVERED'
          : f.displayStatus === 'DELIVERED',
        estimatedDelivery: f.estimatedDeliveryAt || null,
        tracking: t.number ? { number: t.number, url: t.url || null, company: t.company || null } : null
      };
    });
    const a = o.shippingAddress || {};

    return res.status(200).json({
      ok: true,
      order: {
        name: o.name,
        placedAt: o.processedAt,
        cancelled: !!o.cancelledAt,
        fulfillment: titleCase(o.displayFulfillmentStatus),
        // Enough of the address to confirm it is going to the right place,
        // without restating the street to whoever holds a forwarded link.
        shipTo: [a.name, [a.city, a.provinceCode, a.zip].filter(Boolean).join(' '), a.country]
          .filter(Boolean).join(' · '),
        items: ((o.lineItems && o.lineItems.nodes) || []).map(function (li) {
          return {
            title: li.title,
            variant: (li.variantTitle && li.variantTitle !== 'Default Title') ? li.variantTitle : '',
            qty: li.quantity,
            image: (li.image && li.image.url) || ''
          };
        }),
        shipments: fulfillments
      }
    });
  } catch (err) {
    console.error('[track]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
