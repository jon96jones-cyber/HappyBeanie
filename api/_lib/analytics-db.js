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

function deviceOf(ua) {
  const s = String(ua || '').toLowerCase();
  if (/ipad|tablet/.test(s)) return 'tablet';
  if (/mobi|iphone|android/.test(s)) return 'mobile';
  return 'desktop';
}

const SCHEMA = [
  `create table if not exists sessions (
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
   )`,
  `create index if not exists sessions_last_seen_idx on sessions (last_seen desc)`,
  `create index if not exists sessions_first_seen_idx on sessions (first_seen desc)`,
  `create table if not exists events (
     id         bigserial primary key,
     ts         timestamptz not null default now(),
     session_id text not null,
     visitor_id text,
     name       text not null,
     path       text,
     species    text,
     value      numeric,
     meta       jsonb
   )`,
  `create index if not exists events_ts_idx on events (ts desc)`,
  `create index if not exists events_name_ts_idx on events (name, ts desc)`,
  `create index if not exists events_session_idx on events (session_id)`
];

async function ensureSchema() {
  const q = sql();
  for (const stmt of SCHEMA) await q.query(stmt);
  return SCHEMA.length;
}

module.exports = { sql, isConfigured, keyOk, visitorId, deviceOf, ensureSchema };
