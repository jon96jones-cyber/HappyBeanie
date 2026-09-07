// GET /api/order-status?o=<order number>&e=<email> — the data behind /track,
// our own order-status page.
//
// NOT /api/track. That path belongs to the analytics collector and always
// has; pointing this endpoint at it silently replaced the collector and every
// beacon from the site started coming back 405, so the live desk went blank.
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
// (that is the page; the page calls this endpoint)
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

// Fulfillment carries no "latest shipment status" field — the carrier's own
// history lives in events, and the milestones it has crossed are the
// deliveredAt / inTransitAt stamps. displayStatus is the summary word.
const ORDER = `query Track($q: String!) {
  orders(first: 1, query: $q) {
    nodes {
      name
      email
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
        deliveredAt
        inTransitAt
        trackingInfo { number url company }
        events(first: 25, sortKey: HAPPENED_AT, reverse: true) {
          nodes { happenedAt status message city province country estimatedDeliveryAt }
        }
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

// Shopify's statuses, said the way a person would. Anything we have not seen
// before falls through to a title-cased version of the enum rather than a
// phrase we invented for it. Covers both FulfillmentDisplayStatus and
// FulfillmentEventStatus — they overlap, and neither has a term the other
// would read wrongly.
const STATUS_WORDS = {
  SUBMITTED: 'Handed to the carrier',
  LABEL_PRINTED: 'Label printed',
  LABEL_PURCHASED: 'Label printed',
  LABEL_VOIDED: 'Label voided',
  CONFIRMED: 'Confirmed by the carrier',
  CARRIER_PICKED_UP: 'Picked up by the carrier',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  ATTEMPTED_DELIVERY: 'Delivery attempted',
  READY_FOR_PICKUP: 'Ready for pickup',
  DELAYED: 'Delayed',
  DELIVERED: 'Delivered',
  NOT_DELIVERED: 'Not delivered',
  FAILURE: 'The carrier reported a problem',
  CANCELED: 'Cancelled',
  // With no carrier scan yet, "Fulfilled" is Shopify's word, not a sentence
  // anyone wants to read about their own parcel.
  FULFILLED: 'On its way',
  MARKED_AS_FULFILLED: 'On its way'
};

// Statuses that mean the box has not left the building yet, so the page can
// tell "made, waiting for the carrier" apart from "moving".
const PRE_TRANSIT = { SUBMITTED: 1, LABEL_PRINTED: 1, LABEL_PURCHASED: 1, LABEL_VOIDED: 1 };

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
}

function words(status) {
  if (!status) return '';
  return STATUS_WORDS[status] || titleCase(status);
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
    if (out.json && out.json.errors) {
      console.error('[order-status] graphql', JSON.stringify(out.json.errors).slice(0, 400));
      return res.status(502).json({ ok: false, error: 'upstream' });
    }
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
      const events = ((f.events && f.events.nodes) || []);
      const latest = events[0] || null;
      // The carrier decides once it has spoken: displayStatus can still read
      // DELIVERED while the last scan says the box is in transit, and the page
      // must not announce an arrival the carrier hasn't.
      const state = (latest && latest.status) || f.displayStatus || null;
      return {
        shippedAt: f.createdAt,
        status: words(state) || 'On its way',
        delivered: !!(f.deliveredAt || state === 'DELIVERED'),
        deliveredAt: f.deliveredAt || null,
        // Anything before the first movement scan is still sitting with us.
        moving: !!(f.inTransitAt || (state && !PRE_TRANSIT[state])),
        estimatedDelivery: f.estimatedDeliveryAt || (latest && latest.estimatedDeliveryAt) || null,
        tracking: t.number ? { number: t.number, url: t.url || null, company: t.company || null } : null,
        // The carrier's own history, as scans. City and state only — the same
        // restraint the shipping address gets.
        scans: events.map(function (ev) {
          return {
            at: ev.happenedAt,
            what: ev.message || words(ev.status),
            where: [ev.city, ev.province].filter(Boolean).join(', ')
          };
        }).filter(function (s) { return !!s.what; })
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
    console.error('[order-status]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
