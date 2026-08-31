// POST /api/track — the collector behind the analytics desk.
//
// The site beacons one small JSON body per thing that happens. This never
// answers with anything the page waits on: it always returns 204, swallows its
// own errors, and is fired with navigator.sendBeacon, so a slow or broken
// analytics store can never slow down or break the storefront.
//
// Heartbeats only bump the session's last_seen — they are what makes
// "visitors right now" true, and writing a row for each would bloat the log
// for no reason.
//
// Env: DATABASE_URL (auto-set by the Vercel/Neon integration).
// Optional: ANALYTICS_SALT — rotates the pseudonymous visitor hash.

const db = require('./_lib/analytics-db.js');

// Only events we actually chart. Anything else is dropped, so a stray or
// spoofed beacon cannot invent event types in the log.
const NAMES = [
  'pageview',
  'view_product',
  'add_to_cart',
  'begin_checkout',
  'quiz_start',
  'quiz_verdict',
  'heartbeat'
];

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}
function str(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max || 255);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = async function handler(req, res) {
  // Beacons are fire-and-forget; the browser ignores this, but be explicit.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!db.isConfigured()) return res.status(204).end();

  try {
    const b = readBody(req);
    const sid = str(b.sid, 64);
    const name = str(b.name, 32);
    if (!sid || !name || NAMES.indexOf(name) === -1) return res.status(204).end();

    const sql = db.sql();
    const vid = db.visitorId(req);
    const path = str(b.path, 255);
    const country = str(req.headers['x-vercel-ip-country'], 8);
    // Our own traffic, from either signal: the server recognising the address,
    // or the page telling us (opted-out browser, or a preview deployment).
    // Labelled, never dropped — so a test still proves it registered.
    const internal = db.isInternal(req) || b.internal === true;

    if (name === 'heartbeat') {
      await db.withSchema(() => sql`update sessions
                   set last_seen = now(), visitor_id = coalesce(visitor_id, ${vid}),
                       internal = sessions.internal or ${internal}
                 where session_id = ${sid}`);
      return res.status(204).end();
    }

    const utm = b.utm || {};
    // First beacon of a visit writes the acquisition detail; later ones only
    // move last_seen forward, so the landing page and source stay as they were.
    await db.withSchema(() => sql`
      insert into sessions (
        session_id, visitor_id, landing_path, referrer,
        utm_source, utm_medium, utm_campaign, ref_code, device, country, pageviews, internal
      ) values (
        ${sid}, ${vid}, ${path}, ${str(b.ref, 255)},
        ${str(utm.source, 120)}, ${str(utm.medium, 120)}, ${str(utm.campaign, 120)},
        ${str(b.refCode, 40)}, ${db.deviceOf(req.headers['user-agent'])}, ${country},
        ${name === 'pageview' ? 1 : 0}, ${internal}
      )
      on conflict (session_id) do update set
        last_seen      = now(),
        pageviews      = sessions.pageviews + ${name === 'pageview' ? 1 : 0},
        viewed_product = sessions.viewed_product or ${name === 'view_product'},
        added_to_cart  = sessions.added_to_cart  or ${name === 'add_to_cart'},
        began_checkout = sessions.began_checkout or ${name === 'begin_checkout'},
        ref_code       = coalesce(sessions.ref_code, ${str(b.refCode, 40)}),
        internal       = sessions.internal or ${internal}`);

    await db.withSchema(() => sql`
      insert into events (session_id, visitor_id, name, path, species, value, meta, internal)
      values (${sid}, ${vid}, ${name}, ${path}, ${str(b.species, 16)}, ${num(b.value)},
              ${b.meta ? JSON.stringify(b.meta).slice(0, 2000) : null}, ${internal})`);

    return res.status(204).end();
  } catch (err) {
    // Analytics is never allowed to surface a failure to the storefront.
    console.error('[track]', err && err.message);
    return res.status(204).end();
  }
};
