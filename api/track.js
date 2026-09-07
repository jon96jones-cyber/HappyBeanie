// GET /api/track?o=<order number>&k=<signature> — the data behind /track, our
// own order-status page.
//
// Why this exists: Shopify's order-status page is the only thing a shipping
// email could link to when there was no carrier URL, and it lands the customer
// on shopify.com wearing Shop Pay's furniture. This serves the same facts from
// our own domain.
//
// The link is one-click from an email, so there is no password — the signature
// IS the credential:
//
//   k = HMAC-SHA256(order number, TRACK_SECRET), first 16 hex characters
//
// 64 bits, compared in constant time, and derived from a secret that never
// leaves the server. Shopify's notification templates mint the same value with
// Liquid's hmac_sha256 filter, so the emails it sends can link here directly:
//
//   /track?o={{ order_name | remove: '#' }}&k={{ order_name | remove: '#' | hmac_sha256: '<TRACK_SECRET>' | slice: 0, 16 }}
//
// The identifier is the ORDER NUMBER rather than Shopify's internal id, for
// one reason: order_name is present in every notification template Shopify
// ships, so the link cannot depend on a variable that turns out not to exist
// in that context. A guessable order number costs nothing — the signature is
// the credential, and forging one needs the secret.
//
// Anyone holding the link sees one order — the same bargain as Shopify's own
// order-status URL, which is likewise a bearer token in a link.
//
// Env: SHOPIFY_ADMIN_TOKEN (read_orders), TRACK_SECRET.

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
  if (!token || !process.env.TRACK_SECRET) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const q = req.query || {};
  // The order number as the email wrote it — digits only, so a stray '#'
  // or whitespace cannot change what gets signed.
  const orderNo = String(q.o || '').replace(/[^0-9]/g, '');
  const given = String(q.k || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!orderNo || given.length !== 16 || !sigOk(given, sign(orderNo))) {
    // One message for every failure — a wrong signature and a missing order
    // must look identical, or the endpoint becomes an order-number oracle.
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  try {
    const out = await admin(token, ORDER, { q: 'name:#' + orderNo });
    const nodes = (out.json && out.json.data && out.json.data.orders && out.json.data.orders.nodes) || [];
    const o = nodes[0];
    if (!o) return res.status(404).json({ ok: false, error: 'not_found' });

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
