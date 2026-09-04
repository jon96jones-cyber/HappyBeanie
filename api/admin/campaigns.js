// GET /api/admin/campaigns — what has been emailed, grouped by campaign.
//
// Reads email_sends, which api/_lib/mailer.js writes on every send that names
// a flow. One row per person per step, by the unique index on that table: the
// question this desk answers is "did this person get this email", not "how many
// times did we try", and the sends counter carries the repeats.
//
// Two shapes:
//   (no flow)   the campaign list — one line per flow, with totals
//   ?flow=x     the sends inside one, newest first, paginated
//
// Auth: x-analytics-key against ANALYTICS_KEY, the same key the Live desk
// uses. Deliberately not a new secret — it is the same concern (reading our
// own data) and a second key is a second thing to lose.
//
// Env: DATABASE_URL, ANALYTICS_KEY.

const db = require('../_lib/analytics-db.js');

const PAGE = 100;

// Every campaign the site knows how to send, whether or not it has ever sent.
//
// email_sends is a log, so on its own this desk can only show history — a
// campaign that is wired and waiting looks identical to one that does not
// exist. That is the wrong answer to "what campaigns do I have", so the list
// is this catalogue with the log joined onto it, not the log alone.
//
// Kept by hand, next to nothing that enforces it, so it can drift: a flow
// found in the log but missing here is reported as 'unlisted' rather than
// dropped, which is the failure that would actually lose data.
//
//   live   — wired to a trigger and sending
//   draft  — the emails exist, nothing calls them yet
const CATALOG = [
  {
    flow: 'popup-code',
    name: 'Popup code',
    status: 'live',
    what: 'The discount code, sent the moment someone joins the list. One code per address, for life.',
    trigger: 'On signup, from the popup or the footer'
  },
  {
    flow: 'cart-recovery',
    name: 'Cart recovery',
    status: 'live',
    what: 'Three nudges to anyone who reached checkout and left without paying — at 45 minutes, 24 hours and 48 hours.',
    // The rungs are only as punctual as the schedule that checks for them, so
    // the desk names the interval rather than the intent. Change this line
    // whenever vercel.json's cron changes.
    trigger: 'Steps 1–3 at 45 min, 24 h and 48 h — as punctual as the cron interval allows'
  },
  {
    flow: 'quiz-reminder',
    name: 'Screener reminder',
    status: 'live',
    what: 'Nudges people who started the screener and did not finish it.',
    trigger: 'Daily 16:00 UTC'
  },
  {
    flow: 'welcome',
    name: 'Welcome sequence',
    status: 'live',
    what: 'Three emails after consent — the ritual, the screener, the research. Reaches every consented subscriber, checkout opt-ins included.',
    trigger: 'Steps 1–3 in windows at days 1–4, 5–11 and 12–18 · daily 15:00 UTC'
  },
  {
    flow: 'cart-nudge',
    name: 'Cart nudge',
    status: 'live',
    what: 'One reminder when a known subscriber parks a cart on the site and never reaches checkout — the cart Shopify cannot see.',
    trigger: 'Left at 30 min idle, email an hour later · checked every 15 min · max one per address per 14 days'
  },
  {
    flow: 'research-pack',
    name: 'Research pack',
    status: 'live',
    what: 'Six published studies in plain English, sent to anyone who asks for the research — the first-touch popup’s offer. No code attached.',
    trigger: 'On signup from the research popup, instantly'
  },
  {
    flow: 'post-purchase',
    name: 'Post-purchase',
    status: 'live',
    what: 'Buyer emails: the week-one check-in, the halfway email (Subscribe & Save pitch for one-timers, next-jar reassurance for subscribers), and the review ask right after a second order. Each once ever.',
    trigger: 'Milestone at order age 1–4 days (second order), check-in at 7–10 (first), halfway pair at 21–24 · daily 15:30 UTC'
  },
  {
    flow: 'sub-rescue',
    name: 'Subscription rescue',
    status: 'live',
    what: 'The quiet confirmation when a Subscribe & Save is cancelled — transactional, so it sends regardless of marketing consent. Failed payments stay with Shopify’s own dunning.',
    trigger: 'Contract cancelled within 3 days · daily 15:45 UTC · max one per address per 90 days'
  }
];

function catalogOf(flow) {
  for (let i = 0; i < CATALOG.length; i++) if (CATALOG[i].flow === flow) return CATALOG[i];
  return null;
}

// Catalogue first, log joined on. Sorted so the ones doing something are at
// the top: anything that has sent, most recent first, then live-but-quiet,
// then drafts.
function merge(rows) {
  const stats = {};
  rows.forEach(function (r) { stats[r.flow] = r; });

  const listed = CATALOG.map(function (c) {
    const s = stats[c.flow];
    delete stats[c.flow];
    return {
      flow: c.flow, name: c.name, status: c.status, what: c.what, trigger: c.trigger,
      people: s ? s.people : 0,
      attempts: s ? s.attempts : 0,
      delivered: s ? s.delivered : 0,
      failed: s ? s.failed : 0,
      steps: s ? s.steps : 0,
      first_at: s ? s.first_at : null,
      last_at: s ? s.last_at : null
    };
  });

  // Anything in the log we forgot to catalogue still has to appear.
  const extra = Object.keys(stats).map(function (f) {
    const s = stats[f];
    return {
      flow: f, name: null, status: 'unlisted', what: null,
      trigger: 'Sending, but not listed in the desk catalogue',
      people: s.people, attempts: s.attempts, delivered: s.delivered, failed: s.failed,
      steps: s.steps, first_at: s.first_at, last_at: s.last_at
    };
  });

  // 1-based on purpose: `rank[s] || 9` would read a legitimate 0 as missing
  // and sort live campaigns last.
  const rank = { live: 1, unlisted: 2, draft: 3 };
  return listed.concat(extra).sort(function (a, b) {
    if (!!a.last_at !== !!b.last_at) return a.last_at ? -1 : 1;
    if (a.last_at && b.last_at) return new Date(b.last_at) - new Date(a.last_at);
    return (rank[a.status] || 9) - (rank[b.status] || 9);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!db.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured', message: 'DATABASE_URL is not set on this deployment.' });
  }
  if (!process.env.ANALYTICS_KEY) {
    return res.status(503).json({ ok: false, error: 'not_configured', message: 'ANALYTICS_KEY is not set on this deployment.' });
  }
  if (!db.keyOk(req, 'x-analytics-key', 'ANALYTICS_KEY')) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const p = req.query || {};
  const flow = String(p.flow || '').trim().slice(0, 120);
  const search = String(p.q || '').trim().toLowerCase().slice(0, 200);
  const offset = Math.max(0, parseInt(p.offset, 10) || 0);
  const sql = db.sql();

  try {
    // ---------------------------------------------------------- the list
    if (!flow) {
      const rows = await db.withSchema(function () {
        return sql`
          select flow,
                 count(*)::int                                      as people,
                 coalesce(sum(sends), 0)::int                       as attempts,
                 count(*) filter (where status = 'sent')::int       as delivered,
                 count(*) filter (where status = 'failed')::int     as failed,
                 count(distinct step)::int                          as steps,
                 min(sent_at)                                       as first_at,
                 max(sent_at)                                       as last_at
          from email_sends
          group by flow
          order by max(sent_at) desc`;
      });
      return res.status(200).json({ ok: true, campaigns: merge(rows), recorded: rows.length });
    }

    // -------------------------------------------------------- one campaign
    // The step breakdown is its own query rather than derived in the browser,
    // because the rows below are a page and the breakdown must count all of
    // them — otherwise page two silently reports different totals.
    const [steps, totals, rows] = await db.withSchema(function () {
      return Promise.all([
        sql`select step,
                   count(*)::int                                  as people,
                   count(*) filter (where status = 'failed')::int as failed,
                   max(sent_at)                                   as last_at
            from email_sends where flow = ${flow}
            group by step order by max(sent_at) desc`,
        sql`select count(*)::int                                  as people,
                   count(*) filter (where status = 'failed')::int as failed
            from email_sends where flow = ${flow}
              and (${search} = '' or email like ${'%' + search + '%'})`,
        sql`select email, step, status, error, subject, sends, sent_at, provider_id
            from email_sends
            where flow = ${flow}
              and (${search} = '' or email like ${'%' + search + '%'})
            order by sent_at desc
            limit ${PAGE} offset ${offset}`
      ]);
    });

    const total = (totals[0] || {}).people || 0;
    const meta = catalogOf(flow);
    return res.status(200).json({
      ok: true,
      flow: flow,
      // So the drill-in reads the same as the row that was clicked, including
      // for a campaign that has not sent anything yet.
      name: meta ? meta.name : null,
      status: meta ? meta.status : 'unlisted',
      what: meta ? meta.what : null,
      trigger: meta ? meta.trigger : null,
      searching: !!search,
      steps: steps,
      total: total,
      failed: (totals[0] || {}).failed || 0,
      offset: offset,
      pageSize: PAGE,
      more: offset + rows.length < total,
      sends: rows
    });
  } catch (err) {
    console.error('[campaigns]', err && err.message);
    return res.status(500).json({ ok: false, error: 'query_failed', message: (err && err.message) || null });
  }
};
