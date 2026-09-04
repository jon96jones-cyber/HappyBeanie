// /api/admin/analytics — the numbers behind the analytics desk.
//
// GET  → { ok, live, today, series, topPages, topSources, funnel, recent }
//        live:   visitors in the last 5 minutes, and what they are doing
//        today:  sessions / pageviews / product views / carts / checkouts
//        series: daily rollup for the requested window (?days=7|30|90)
//        funnel: visit → product → cart → checkout for that window
//
// POST { action: 'init' } → creates the tables. Safe to run repeatedly.
//
// Auth: shared secret in `x-analytics-key` vs ANALYTICS_KEY — its own key,
// deliberately not shared with the ambassador or fulfillment desks.
//
// Env: DATABASE_URL (auto-set by the Vercel/Neon integration), ANALYTICS_KEY.

const db = require('../_lib/analytics-db.js');

const LIVE_WINDOW = "5 minutes";

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}
function n(v) { return Number(v || 0); }

// Accepts an ISO timestamp from the desk only if it is real, not in the
// future, and not absurdly old — so a hand-edited URL cannot make the desk
// scan the whole table.
function isoWithin(v, maxDaysBack) {
  if (!v) return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() > now + 86400000) return null;
  if (d.getTime() < now - maxDaysBack * 86400000) return null;
  return d.toISOString();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.ANALYTICS_KEY) {
    return res.status(503).json({ ok: false, error: 'not_configured', message: 'ANALYTICS_KEY is not set on this deployment.' });
  }
  if (!db.keyOk(req, 'x-analytics-key', 'ANALYTICS_KEY')) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!db.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'no_database', message: 'DATABASE_URL is not set — connect the Neon database in Vercel.' });
  }

  try {
    if (req.method === 'POST') {
      const body = readBody(req);
      if (body.action !== 'init') return res.status(400).json({ ok: false, error: 'bad_action' });
      const count = await db.ensureSchema();
      return res.status(200).json({ ok: true, initialized: count });
    }
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

    const sql = db.sql();
    const q = req.query || {};
    const days = Math.min(90, Math.max(1, parseInt(q.days, 10) || 7));

    // The desk sends both window edges as absolute timestamps computed in the
    // viewer's own timezone, so "today" means their calendar day rather than
    // UTC's — in Arizona those differ by seven hours. Falls back to the
    // server's own reckoning if the params are missing or implausible.
    // A custom range also sends `until` (exclusive); absent means "now".
    const since = isoWithin(q.since, 400) || new Date(Date.now() - days * 86400000).toISOString();
    const until = isoWithin(q.until, 400) || null;
    const dayStart = isoWithin(q.dayStart, 2);
    // Our own testing is labelled at collection and hidden here by default.
    // ?internal=1 puts it back, so a test can still be seen to have landed.
    const inc = q.internal === '1';

    const [live, today, series, topPages, topSources, funnel, recent, popup] = await db.withSchema(() => Promise.all([
      sql`select
            count(*) filter (where last_seen > now() - interval '5 minutes')                      as visitors_now,
            count(*) filter (where last_seen > now() - interval '5 minutes' and added_to_cart)    as active_carts,
            count(*) filter (where last_seen > now() - interval '5 minutes' and began_checkout)   as checking_out
          from sessions
          where (${inc} or not internal)`,

      sql`select
            count(*)                                    as sessions,
            coalesce(sum(pageviews), 0)                 as pageviews,
            count(*) filter (where viewed_product)      as product_views,
            count(*) filter (where added_to_cart)       as carts,
            count(*) filter (where began_checkout)      as checkouts
          from sessions
          where first_seen >= coalesce(${dayStart}::timestamptz, date_trunc('day', now()))
            and (${inc} or not internal)`,

      sql`select to_char(date_trunc('day', first_seen), 'YYYY-MM-DD') as day,
                 count(*)                               as sessions,
                 coalesce(sum(pageviews), 0)            as pageviews,
                 count(*) filter (where added_to_cart)  as carts
          from sessions
          where first_seen >= ${since}::timestamptz
            and (${until}::timestamptz is null or first_seen < ${until}::timestamptz)
            and (${inc} or not internal)
          group by 1 order by 1`,

      sql`select coalesce(path, '(unknown)') as path, count(*) as views
          from events
          where name = 'pageview' and ts >= ${since}::timestamptz
            and (${until}::timestamptz is null or ts < ${until}::timestamptz)
            and (${inc} or not internal)
          group by 1 order by views desc limit 10`,

      sql`select
            coalesce(nullif(utm_source, ''),
                     case when referrer is null or referrer = '' then '(direct)'
                          else split_part(split_part(referrer, '://', 2), '/', 1) end) as source,
            count(*) as sessions,
            count(*) filter (where added_to_cart) as carts
          from sessions
          where first_seen >= ${since}::timestamptz
            and (${until}::timestamptz is null or first_seen < ${until}::timestamptz)
            and (${inc} or not internal)
          group by 1 order by sessions desc limit 10`,

      sql`select
            count(*)                                as visits,
            count(*) filter (where viewed_product)  as product,
            count(*) filter (where added_to_cart)   as cart,
            count(*) filter (where began_checkout)  as checkout
          from sessions
          where first_seen >= ${since}::timestamptz
            and (${until}::timestamptz is null or first_seen < ${until}::timestamptz)
            and (${inc} or not internal)`,

      sql`select to_char(ts, 'HH24:MI') as at, name, path, species, value
          from events
          where name <> 'heartbeat' and (${inc} or not internal)
          order by ts desc limit 25`,

      sql`select
            count(distinct session_id) filter (where name = 'popup_shown')      as shown,
            count(distinct session_id) filter (where name = 'popup_fed')        as fed,
            count(distinct session_id) filter (where name = 'popup_subscribed') as subscribed,
            count(distinct session_id) filter (where name = 'popup_declined' and species = 'feed')  as declined_feed,
            count(distinct session_id) filter (where name = 'popup_declined' and species = 'email') as declined_email
          from events
          where name like 'popup%' and ts >= ${since}::timestamptz
            and (${until}::timestamptz is null or ts < ${until}::timestamptz)
            and (${inc} or not internal)`
    ]));

    const l = live[0] || {}, t = today[0] || {}, f = funnel[0] || {};
    return res.status(200).json({
      ok: true,
      days: days,
      since: since,
      until: until,
      live: {
        visitorsNow: n(l.visitors_now),
        activeCarts: n(l.active_carts),
        checkingOut: n(l.checking_out)
      },
      today: {
        sessions: n(t.sessions), pageviews: n(t.pageviews),
        productViews: n(t.product_views), carts: n(t.carts), checkouts: n(t.checkouts)
      },
      series: series.map(function (r) {
        return { day: r.day, sessions: n(r.sessions), pageviews: n(r.pageviews), carts: n(r.carts) };
      }),
      topPages: topPages.map(function (r) { return { path: r.path, views: n(r.views) }; }),
      topSources: topSources.map(function (r) {
        return { source: r.source, sessions: n(r.sessions), carts: n(r.carts) };
      }),
      funnel: {
        visits: n(f.visits), product: n(f.product), cart: n(f.cart), checkout: n(f.checkout)
      },
      popup: (function (p) {
        return { shown: n(p.shown), fed: n(p.fed), subscribed: n(p.subscribed),
                 declinedFeed: n(p.declined_feed), declinedEmail: n(p.declined_email) };
      })(popup[0] || {}),
      recent: recent.map(function (r) {
        return { at: r.at, name: r.name, path: r.path, species: r.species, value: r.value };
      })
    });
  } catch (err) {
    const msg = (err && err.message) || 'unknown';
    console.error('[admin/analytics]', msg);
    // A missing table is the one failure with an obvious fix, so name it.
    if (/relation .* does not exist/i.test(msg)) {
      return res.status(409).json({ ok: false, error: 'no_tables', message: 'Tables are not created yet — run Set up storage.' });
    }
    return res.status(502).json({ ok: false, error: 'query_failed', message: msg });
  }
};
