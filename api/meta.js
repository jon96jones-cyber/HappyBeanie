// POST /api/meta — the Conversions API relay.
//
// The pixel in the page is the browser half of Meta's tracking; this is the
// server half. It matters because the browser half is the one that gets
// blocked: content blockers, iOS, a tab closed mid-request. Events sent from
// here cannot be blocked, so Meta sees the whole funnel rather than the share
// of it that survived the browser.
//
// The two halves send the SAME event twice on purpose. Each carries an
// event_id the page generated, and Meta collapses the pair into one — that is
// what `eventID` on the fbq call and `eventId` in this body are for. Without
// it every add-to-cart would count twice.
//
// Personal detail is hashed here, never in the page and never stored: an
// address arrives in the clear over HTTPS and leaves as SHA-256, which is the
// only form Meta accepts. The hash is what raises the match rate — it is how
// an anonymous browser hit becomes a known person in an audience.
//
// Env:
//   META_CAPI_TOKEN     — required. Events Manager → Settings → Conversions
//                         API → Generate access token. Without it this
//                         endpoint does nothing at all, quietly.
//   META_PIXEL_ID       — optional, defaults to the pixel in the page.
//   META_TEST_EVENT_CODE — optional. Set it while watching Events Manager →
//                         Test events, then remove it.
//   META_OWN_PURCHASE   — optional, and dangerous to set carelessly. Lets this
//                         relay accept Purchase from the Shopify custom pixel
//                         (see shopify/custom-pixel-purchase.js). Only set it
//                         once the Facebook & Instagram channel has stopped
//                         sending its own, or every order counts twice.
const crypto = require('crypto');

const GRAPH = 'https://graph.facebook.com/v21.0/';
const DEFAULT_PIXEL = '2580258509080253';

// Only events the site actually fires. A stray or spoofed body cannot invent
// event names in the account.
const NAMES = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'Lead', 'CompleteRegistration', 'Search', 'PageView'];

// Purchase is the exception, and it is off unless META_OWN_PURCHASE is set.
//
// Shopify's Facebook & Instagram channel sends its own Purchase from checkout,
// with an event_id this relay has no way to know. Two Purchases per order with
// different ids do not collapse — Meta counts both, revenue doubles, and every
// campaign optimises against a number that is not real. So the two sources are
// mutually exclusive: turn the channel's purchase tracking off first, then set
// this, in that order. Nothing here can detect the overlap for you.
const OWN_PURCHASE = 'Purchase';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}
function str(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max || 255) : null;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// Meta's normalisation rules, then SHA-256. Getting these wrong does not
// error, it just quietly fails to match, so they are worth being exact about:
// lower case, no spaces, email trimmed, ZIP to five digits, state and country
// as their short codes.
function hash(v) {
  if (!v) return null;
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}
function normEmail(v) { const s = str(v, 320); return s ? hash(s.toLowerCase()) : null; }
function normName(v) { const s = str(v, 80); return s ? hash(s.toLowerCase().replace(/[^a-zÀ-ɏ]/gi, '')) : null; }
function normCity(v) { const s = str(v, 80); return s ? hash(s.toLowerCase().replace(/\s+/g, '')) : null; }
function normState(v) { const s = str(v, 40); return s ? hash(s.toLowerCase().replace(/[^a-z]/gi, '').slice(0, 2)) : null; }
function normZip(v) { const s = str(v, 20); return s ? hash(s.replace(/[^0-9]/g, '').slice(0, 5)) : null; }
function normCountry(v) { const s = str(v, 8); return s ? hash(s.toLowerCase().slice(0, 2)) : null; }
function normPhone(v) { const s = str(v, 40); const d = s ? s.replace(/[^0-9]/g, '') : ''; return d.length >= 7 ? hash(d) : null; }

function cookie(req, key) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + key + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function clientIp(req) {
  const fwd = str(req.headers['x-forwarded-for'], 200) || '';
  return fwd.split(',')[0].trim() || null;
}

// The checkout half of this runs inside Shopify's custom-pixel sandbox, which
// is a different origin, so the browser preflights the request and drops the
// response without these.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const token = process.env.META_CAPI_TOKEN;
  // No token, no traffic to Meta. The page never waits on this either way, so
  // an unconfigured deploy behaves exactly like a configured one from the
  // storefront's side.
  //
  // It used to return silently, which made a disabled relay and a working one
  // identical in the logs — invocations with no errors read as success when
  // they actually meant nothing was being sent at all. Say it out loud.
  if (!token) {
    console.error('[meta-capi] META_CAPI_TOKEN is not set on this deployment — no events are reaching Meta');
    return res.status(204).end();
  }

  try {
    const b = readBody(req);
    const name = str(b.name, 40);
    const ownsPurchase = !!process.env.META_OWN_PURCHASE;
    const allowed = name === OWN_PURCHASE ? ownsPurchase : NAMES.indexOf(name) !== -1;
    if (!name || !allowed) {
      // Say why, once, rather than dropping it into the same silence as a
      // spoofed event name — a checkout wired up and quietly ignored looks
      // exactly like one that is working.
      if (name === OWN_PURCHASE) {
        console.warn('[meta-capi] Purchase received but META_OWN_PURCHASE is not set — ignoring. Turn off the Shopify channel\'s purchase tracking first, then set it.');
      }
      return res.status(204).end();
    }

    const user = {
      em: normEmail(b.em),
      ph: normPhone(b.ph),
      fn: normName(b.fn),
      ln: normName(b.ln),
      ct: normCity(b.ct),
      st: normState(b.st),
      zp: normZip(b.zp),
      country: normCountry(b.country || 'us'),
      external_id: b.external_id ? hash(String(b.external_id)) : null,
      client_ip_address: clientIp(req),
      client_user_agent: str(req.headers['user-agent'], 400),
      // The pixel's own cookies. fbc is how a click on an ad is tied to this
      // event; without it a server event cannot be attributed to the ad that
      // earned it.
      fbp: str(b.fbp, 200) || cookie(req, '_fbp'),
      fbc: str(b.fbc, 400) || cookie(req, '_fbc')
    };
    Object.keys(user).forEach(k => { if (!user[k]) delete user[k]; });

    const custom = {};
    if (num(b.value) !== null) { custom.value = num(b.value); custom.currency = str(b.currency, 8) || 'USD'; }
    if (b.content_ids) custom.content_ids = [].concat(b.content_ids).slice(0, 10).map(x => str(x, 80));
    if (b.content_name) custom.content_name = str(b.content_name, 120);
    if (b.content_type) custom.content_type = str(b.content_type, 40);
    if (num(b.num_items) !== null) custom.num_items = num(b.num_items);
    if (Array.isArray(b.contents)) {
      custom.contents = b.contents.slice(0, 10).map(c => ({
        id: str(c && c.id, 80), quantity: num(c && c.quantity) || 1, item_price: num(c && c.item_price)
      })).filter(c => c.id);
    }

    const event = {
      event_name: name,
      event_time: Math.floor(Date.now() / 1000),
      // Shared with the pixel's fbq call so Meta counts the pair once. A
      // Purchase carries the order name instead, which is stable: the pixel
      // can fire twice for one order — a refresh of the thank-you page, a
      // retry — and both copies collapse into one.
      event_id: str(b.eventId, 80) || crypto.randomUUID(),
      event_source_url: str(b.url, 500),
      action_source: 'website',
      user_data: user
    };
    if (Object.keys(custom).length) event.custom_data = custom;

    const payload = { data: [event] };
    if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

    const r = await fetch(GRAPH + (process.env.META_PIXEL_ID || DEFAULT_PIXEL) + '/events?access_token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      // Log the reason, never the token: the URL carries it, so only the
      // status and Meta's message go to the log.
      let why = '';
      try { const j = await r.json(); why = (j.error && (j.error.message || j.error.type)) || ''; } catch (e) {}
      console.error('[meta-capi]', name, r.status, why);
    } else {
      // One line per accepted event. Low volume, and it is the only positive
      // evidence the relay is alive — an absence of errors is not the same
      // thing, which is exactly how this went unnoticed the first time.
      console.log('[meta-capi] sent', name);
    }
    return res.status(204).end();
  } catch (err) {
    // Tracking never surfaces a failure to the storefront.
    console.error('[meta-capi]', err && err.message);
    return res.status(204).end();
  }
};
