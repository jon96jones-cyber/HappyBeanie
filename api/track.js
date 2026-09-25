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
  'popup_shown',
  'popup_fed',
  'popup_subscribed',
  'popup_declined',
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

// The screener's own option keys, one list per question. A run that names a
// key outside these is a hand-made body and is dropped, so the counted
// columns only ever hold values the desk knows how to read.
const QZ = {
  species: ['dog', 'cat'],
  age: ['under1', '1-6', '7-10', '11plus'],
  weight: { dog: ['u30', '30-75', '75-120', 'o120'], cat: ['u5', '5-12', 'o12'] },
  repro: ['no', 'yes', 'unsure'],
  allergies: ['none', 'fish', 'shellfish', 'mushroom', 'beef', 'chicken', 'organ'],
  meds: ['none', 'anticoag', 'immuno', 'sedative', 'thyroid', 'daily'],
  conditions: ['none', 'pancreatitis', 'liver', 'gi', 'urinary', 'kidney', 'autoimmune', 'diabetes'],
  surgery: ['no', 'yes'],
  verdict: ['ok', 'caution', 'block']
};
// Chews a day per weight band; a box is 30 chews. Same table as the site's
// hbDose, kept here so box_days is computed once, server side.
const DOSE = { u30: 0.5, '30-75': 1, '75-120': 1.5, o120: 2, u5: 0.5, '5-12': 1, o12: 1 };
function pick(list, v) { const s = String(v == null ? '' : v); return list.indexOf(s) !== -1 ? s : null; }
function pickMany(list, v) {
  const arr = Array.isArray(v) ? v : (v == null ? [] : [v]);
  const out = [];
  arr.slice(0, 12).forEach(function (x) { const s = pick(list, x); if (s && out.indexOf(s) === -1) out.push(s); });
  return out;
}
function screeningRow(r) {
  const runId = str(r.runId, 40);
  const species = pick(QZ.species, r.species);
  const verdict = pick(QZ.verdict, r.verdict);
  if (!runId || !/^[A-Za-z0-9_-]+$/.test(runId) || !species || !verdict) return null;
  const a = (r.answers && typeof r.answers === 'object') ? r.answers : {};
  const weight = pick(QZ.weight[species], species === 'dog' ? a.weightDog : a.weightCat);
  const answers = {
    species: species, age: pick(QZ.age, a.age), repro: pick(QZ.repro, a.repro), surgery: pick(QZ.surgery, a.surgery),
    allergies: pickMany(QZ.allergies, a.allergies), meds: pickMany(QZ.meds, a.meds), conditions: pickMany(QZ.conditions, a.conditions)
  };
  if (species === 'dog') answers.weightDog = weight; else answers.weightCat = weight;
  const flags = (Array.isArray(r.flags) ? r.flags : []).slice(0, 20).map(function (f) {
    const o = (f && typeof f === 'object') ? f : {};
    return { ing: str(o.ing, 80), level: String(o.level) === 'block' ? 'block' : 'caution' };
  }).filter(function (f) { return f.ing; });
  return {
    runId: runId, species: species, age: answers.age, weight: weight, repro: answers.repro,
    allergies: answers.allergies, meds: answers.meds, conditions: answers.conditions, surgery: answers.surgery,
    answers: answers, verdict: verdict, flags: flags, dose: str(r.dose, 60),
    boxDays: weight && DOSE[weight] ? Math.round(30 / DOSE[weight]) : null,
    version: str(r.version, 24)
  };
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
    // State and city as Vercel's edge derived them from the IP — the derived
    // place is stored, the address never is. The city arrives URI-encoded.
    const region = str(req.headers['x-vercel-ip-country-region'], 8);
    let city = str(req.headers['x-vercel-ip-city'], 120);
    try { if (city) city = decodeURIComponent(city); } catch (e) {}
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
    //
    // The three funnel flags are set on BOTH paths, and that matters. Beacons
    // are sendBeacon calls — separate requests, landing in separate function
    // invocations that race. A visit that opens on the product page fires
    // pageview and view_product together, and if the view_product beacon is
    // the one that wins the insert, a column list without it writes the row
    // with the flag false; the pageview then updates `false or false` and the
    // product view is gone for good. The desk reads these flags, so those
    // visits simply stopped appearing as having seen a product.
    await db.withSchema(() => sql`
      insert into sessions (
        session_id, visitor_id, landing_path, referrer,
        utm_source, utm_medium, utm_campaign, ref_code, device, country, region, city, pageviews, internal,
        viewed_product, added_to_cart, began_checkout
      ) values (
        ${sid}, ${vid}, ${path}, ${str(b.ref, 255)},
        ${str(utm.source, 120)}, ${str(utm.medium, 120)}, ${str(utm.campaign, 120)},
        ${str(b.refCode, 40)}, ${db.deviceOf(req.headers['user-agent'])}, ${country}, ${region}, ${city},
        ${name === 'pageview' ? 1 : 0}, ${internal},
        ${name === 'view_product'}, ${name === 'add_to_cart'}, ${name === 'begin_checkout'}
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

    // A completed screening also lands in full in the screenings table (the
    // events row above is the desk's count; this is the record). Whitelisted
    // field by field: the body is shaped by our own page, but the collector
    // is reachable by hand.
    if (name === 'quiz_verdict' && b.run && typeof b.run === 'object') {
      const run = screeningRow(b.run);
      if (run) {
        await db.withSchema(() => sql`
          insert into screenings (run_id, session_id, visitor_id, species, age_band, weight_band, repro,
                                  allergies, meds, conditions, surgery, answers, verdict, flags, dose,
                                  box_days, quiz_version, internal)
          values (${run.runId}, ${sid}, ${vid}, ${run.species}, ${run.age}, ${run.weight}, ${run.repro},
                  ${run.allergies}, ${run.meds}, ${run.conditions}, ${run.surgery}, ${JSON.stringify(run.answers)},
                  ${run.verdict}, ${JSON.stringify(run.flags)}, ${run.dose}, ${run.boxDays}, ${run.version}, ${internal})
          on conflict (run_id) do nothing`);
      }
    }

    return res.status(204).end();
  } catch (err) {
    // Analytics is never allowed to surface a failure to the storefront.
    console.error('[track]', err && err.message);
    return res.status(204).end();
  }
};
