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
      return res.status(200).json({ ok: true, campaigns: rows });
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
    return res.status(200).json({
      ok: true,
      flow: flow,
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
