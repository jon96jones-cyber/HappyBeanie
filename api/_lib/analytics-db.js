// Shared plumbing for the first-party analytics store (Neon Postgres).
//
// Two tables do all the work:
//   events   — the raw log, one row per thing that happened.
//   sessions — one row per visit, kept current so "visitors right now" is a
//              single indexed lookup instead of a scan over every event.
//
// No cookies anywhere. A session id lives in sessionStorage (gone when the tab
// closes) and the visitor id is a one-way hash of IP + user agent + a salt that
// rotates daily, so yesterday's hashes cannot be matched to today's. That keeps
// this out of consent-banner territory and off the "tracking cookie" list in
// the privacy policy.

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

let _sql = null;
function sql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('no_database_url');
  _sql = neon(url);
  return _sql;
}
function isConfigured() {
  return !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

// Desk auth, same shape as the ambassador desk: its own key, compared in
// constant time over a digest so length never leaks.
function keyOk(req, headerName, envName) {
  const want = process.env[envName] || '';
  if (!want) return false;
  const got = String(req.headers[headerName] || '');
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

// Daily-rotating pseudonymous visitor id. Not reversible, not stable past
// midnight UTC — enough to count people twice in a day, useless for anything else.
function visitorId(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || '');
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.ANALYTICS_SALT || 'hb-analytics';
  return crypto.createHash('sha256').update(ip + '|' + ua + '|' + day + '|' + salt)
    .digest('hex').slice(0, 24);
}

// Is this request our own? INTERNAL_IPS is a comma-separated list of the
// addresses we browse and test from. The address is compared and discarded —
// it is never written anywhere, exactly like the one behind visitorId.
//
// This is deliberately not the whole answer. A home IP is a dynamic lease, so
// it goes stale without warning, and a phone on cellular sits behind carrier
// NAT on an address shared with thousands of strangers — adding that would
// mislabel them as us. So the page can also mark its own beacons (see the
// opt-out flag in index.html), and either signal is enough.
function isInternal(req) {
  const list = String(process.env.INTERNAL_IPS || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!list.length) return false;
  const ip = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  if (!ip) return false;
  return list.indexOf(ip) !== -1;
}

function deviceOf(ua) {
  const s = String(ua || '').toLowerCase();
  if (/ipad|tablet/.test(s)) return 'tablet';
  if (/mobi|iphone|android/.test(s)) return 'mobile';
  return 'desktop';
}

// Written as tagged templates because that is the driver's only call form —
// neon() returns a template tag, with no .query() for raw strings.
async function ensureSchema() {
  const q = sql();
  await q`create table if not exists sessions (
     session_id   text primary key,
     visitor_id   text,
     first_seen   timestamptz not null default now(),
     last_seen    timestamptz not null default now(),
     landing_path text,
     referrer     text,
     utm_source   text,
     utm_medium   text,
     utm_campaign text,
     ref_code     text,
     device       text,
     country      text,
     pageviews    integer not null default 0,
     viewed_product  boolean not null default false,
     added_to_cart   boolean not null default false,
     began_checkout  boolean not null default false
   )`;
  await q`create index if not exists sessions_last_seen_idx on sessions (last_seen desc)`;
  await q`create index if not exists sessions_first_seen_idx on sessions (first_seen desc)`;
  await q`create table if not exists events (
     id         bigserial primary key,
     ts         timestamptz not null default now(),
     session_id text not null,
     visitor_id text,
     name       text not null,
     path       text,
     species    text,
     value      numeric,
     meta       jsonb
   )`;
  await q`create index if not exists events_ts_idx on events (ts desc)`;
  await q`create index if not exists events_name_ts_idx on events (name, ts desc)`;
  await q`create index if not exists events_session_idx on events (session_id)`;

  // Our own testing, kept but labelled. Added after the fact, so existing rows
  // default to false — everything recorded before this is treated as real,
  // which is the safe direction: it can only ever over-count visitors.
  await q`alter table sessions add column if not exists internal boolean not null default false`;
  await q`alter table events   add column if not exists internal boolean not null default false`;
  await q`create index if not exists sessions_internal_idx on sessions (internal, first_seen desc)`;

  // Screener deferrals. Someone whose pet is only temporarily ineligible —
  // under twelve months, or pregnant/nursing — can ask to be told when that
  // window closes. One row per person per reason; the cron sends one email.
  await q`create table if not exists quiz_reminders (
     id          bigserial primary key,
     email       text not null,
     reason      text not null,
     species     text,
     remind_on   date not null,
     created_at  timestamptz not null default now(),
     sent_at     timestamptz,
     cancelled_at timestamptz,
     attempts    integer not null default 0,
     last_error  text
   )`;
  // One live reminder per address per reason — asking twice just moves the date.
  await q`create unique index if not exists quiz_reminders_email_reason_idx
          on quiz_reminders (email, reason)`;
  await q`create index if not exists quiz_reminders_due_idx
          on quiz_reminders (remind_on) where sent_at is null and cancelled_at is null`;

  // What has already gone out, so a sequence can be re-run without emailing
  // anyone twice. The recovery cron gets away with no state by only ever
  // looking at a one-hour window; a multi-step flow cannot, because step 2 has
  // to know step 1 happened. The unique index is the guarantee — a second
  // attempt at the same step collides rather than sending.
  await q`create table if not exists email_sends (
     id         bigserial primary key,
     email      text not null,
     flow       text not null,
     step       text not null,
     sent_at    timestamptz not null default now(),
     provider_id text
   )`;
  await q`create unique index if not exists email_sends_once_idx
          on email_sends (email, flow, step)`;
  await q`create index if not exists email_sends_flow_idx on email_sends (flow, sent_at desc)`;

  // Added for the campaign desk. A failed send is the row that matters most —
  // "they never got it" is otherwise indistinguishable from "we never tried" —
  // so status and error are recorded alongside the successes. `sends` counts
  // repeats, because the unique index above deliberately keeps one row per
  // person per step and a resend would otherwise be invisible.
  await q`alter table email_sends add column if not exists status  text not null default 'sent'`;
  await q`alter table email_sends add column if not exists error   text`;
  await q`alter table email_sends add column if not exists subject text`;
  await q`alter table email_sends add column if not exists sends   integer not null default 1`;
  await q`create index if not exists email_sends_status_idx on email_sends (flow, status)`;

  // One discount per address, remembered. Without this, signing up twice mints
  // a second single-use code, and the form is open to anyone who wants an
  // unlimited supply of them. Storing the code also means someone who lost the
  // email gets the same one back rather than another live discount.
  await q`create table if not exists discount_grants (
     email      text primary key,
     code       text not null,
     expires_at timestamptz,
     created_at timestamptz not null default now()
   )`;

  // One row per abandoned checkout, because the recovery ladder has three
  // rungs and rung two has to know rung one happened. The old cron got away
  // with no state by only ever looking at a single one-hour window; three
  // touches over two days cannot.
  //
  // Keyed on the checkout rather than the address: the same person abandoning
  // a second cart next month is a new cart and starts the ladder again.
  await q`create table if not exists cart_recovery (
     checkout_id  text primary key,
     email        text not null,
     abandoned_at timestamptz not null,
     step         integer not null default 0,
     last_sent_at timestamptz,
     done_at      timestamptz,
     done_reason  text,
     first_seen   timestamptz not null default now()
   )`;
  await q`create index if not exists cart_recovery_open_idx
          on cart_recovery (abandoned_at) where done_at is null`;

  // The on-site cart, parked. Shopify never sees this cart — it lives in the
  // page and only becomes a Shopify object at the checkout click — so cart
  // abandonment before checkout is ours to notice or nobody's. One row per
  // address (the site has two products; counts and plans are the whole cart),
  // written by /api/cart-note whenever the cart changes and the visitor's
  // email is known, read by the nudge cron.
  await q`create table if not exists open_carts (
     email       text primary key,
     dog         integer not null default 0,
     cat         integer not null default 0,
     plan_dog    integer not null default 0,
     plan_cat    integer not null default 0,
     updated_at  timestamptz not null default now(),
     emailed_at  timestamptz,
     closed_at   timestamptz,
     closed_why  text,
     created_at  timestamptz not null default now()
   )`;
  await q`create index if not exists open_carts_due_idx
          on open_carts (updated_at) where closed_at is null`;

  // Where visitors are, for the desk's map. Vercel derives these from the IP
  // at its edge and hands them over as request headers — we store the derived
  // place (state and city) and let the address itself go, same bargain as
  // visitorId above. Coarse on purpose: a state colours a map; an IP is PII.
  await q`alter table sessions add column if not exists region text`;
  await q`alter table sessions add column if not exists city   text`;
  return 19;
}

// Run a query, and if it fails only because the schema is behind the code,
// bring the schema up and try once more.
//
// This exists because ensureSchema() runs from one button in the Live desk, so
// a deploy that adds a column lands with the database still on the old shape.
// The collector swallows its own errors by design — analytics must never break
// the storefront — which means that gap loses beacons silently until someone
// notices the desk is broken. Healing on the failing request closes it.
async function withSchema(run) {
  try {
    return await run();
  } catch (err) {
    const m = (err && err.message) || '';
    if (!/(column|relation)\b.*does not exist/i.test(m)) throw err;
    await ensureSchema();
    return await run();
  }
}

module.exports = { sql, isConfigured, keyOk, visitorId, deviceOf, isInternal, ensureSchema, withSchema };
