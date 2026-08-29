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
    const days = Math.min(90, Math.max(1, parseInt(req.query && req.query.days, 10) || 7));

    const [live, today, series, topPages, topSources, funnel, recent] = await Promise.all([
      sql`select
            count(*) filter (where last_seen > now() - interval '5 minutes')                      as visitors_now,
            count(*) filter (where last_seen > now() - interval '5 minutes' and added_to_cart)    as active_carts,
            count(*) filter (where last_seen > now() - interval '5 minutes' and began_checkout)   as checking_out
          from sessions`,

      sql`select
            count(*)                                    as sessions,
            coalesce(sum(pageviews), 0)                 as pageviews,
            count(*) filter (where viewed_product)      as product_views,
            count(*) filter (where added_to_cart)       as carts,
            count(*) filter (where began_checkout)      as checkouts
          from sessions
          where first_seen >= date_trunc('day', now())`,

      sql`select to_char(date_trunc('day', first_seen), 'YYYY-MM-DD') as day,
                 count(*)                               as sessions,
                 coalesce(sum(pageviews), 0)            as pageviews,
                 count(*) filter (where added_to_cart)  as carts
          from sessions
          where first_seen >= now() - (${days} || ' days')::interval
          group by 1 order by 1`,

      sql`select coalesce(path, '(unknown)') as path, count(*) as views
          from events
          where name = 'pageview' and ts >= now() - (${days} || ' days')::interval
          group by 1 order by views desc limit 10`,

      sql`select
            coalesce(nullif(utm_source, ''),
                     case when referrer is null or referrer = '' then '(direct)'
                          else split_part(split_part(referrer, '://', 2), '/', 1) end) as source,
            count(*) as sessions,
            count(*) filter (where added_to_cart) as carts
          from sessions
          where first_seen >= now() - (${days} || ' days')::interval
          group by 1 order by sessions desc limit 10`,

      sql`select
            count(*)                                as visits,
            count(*) filter (where viewed_product)  as product,
            count(*) filter (where added_to_cart)   as cart,
            count(*) filter (where began_checkout)  as checkout
          from sessions
          where first_seen >= now() - (${days} || ' days')::interval`,

      sql`select to_char(ts, 'HH24:MI') as at, name, path, species, value
          from events
          where name <> 'heartbeat'
          order by ts desc limit 25`
    ]);

    const l = live[0] || {}, t = today[0] || {}, f = funnel[0] || {};
    return res.status(200).json({
      ok: true,
      days: days,
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
