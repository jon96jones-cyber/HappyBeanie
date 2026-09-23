// GET /api/admin/subscriptions — every subscription contract we know of.
//
// Shopify will not let a custom app read subscription contracts (the scope
// cannot be granted to an app made in the admin, and the contracts belong to
// the Shopify Subscriptions app), so this reads our own log instead: the
// events Shopify Flow posts to api/hooks/subscription.js. A contract's
// current state is its newest event; its payment history is its
// payment_failed and payment_succeeded events.
//
// ?status=ACTIVE|PAUSED|CANCELLED|EXPIRED|FAILED   filter (default: all)
// ?q=<text>                                        customer email or name
//
// Two ways in, both read-only:
//   1. The desk key, `x-analytics-key` — the Live desk's key, shared on
//      purpose (same concern, one secret). This is the browser path.
//   2. A request that arrived on one of this project's *.vercel.app
//      deployment hosts. Deployment Protection on this project is set to
//      "all deployments except custom domains", so a request can only reach
//      this function on such a host after Vercel Authentication has passed:
//      the caller is a member of the Vercel team. On that path email
//      addresses are masked; the name and the contract are what a diagnosis
//      needs.
//
// Env: DATABASE_URL, ANALYTICS_KEY.

const db = require('../_lib/analytics-db.js');

const STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'];
const LIMIT = 300;

function protectedHost(req) {
  if (process.env.VERCEL !== '1') return false;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase().split(':')[0];
  return /\.vercel\.app$/.test(host);
}

function mask(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? '***' : '';
  return s.charAt(0) + '***' + s.slice(at);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const keyed = !!process.env.ANALYTICS_KEY && db.keyOk(req, 'x-analytics-key', 'ANALYTICS_KEY');
  const viaHost = !keyed && protectedHost(req);
  if (!keyed && !viaHost) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!db.isConfigured()) return res.status(503).json({ ok: false, error: 'no_database', message: 'DATABASE_URL is not set.' });

  const q = req.query || {};
  const status = STATUSES.indexOf(String(q.status || '').toUpperCase()) === -1 ? null : String(q.status).toUpperCase();
  const text = String(q.q || '').trim().slice(0, 120).toLowerCase() || null;
  const like = text ? '%' + text.replace(/[%_\\]/g, ' ') + '%' : null;

  try {
    const sql = db.sql();
    const [latest, attempts, total] = await db.withSchema(() => Promise.all([
      // Newest event per contract is its current state. Name, email and
      // product are taken from the newest event that carried them, since a
      // payment event may name only the contract.
      // A payment event carries no status and often no name, so each of
      // those comes from the newest event that did carry it.
      sql`with current as (
             select distinct on (contract_id) contract_id, received_at, event
               from subscription_events order by contract_id, received_at desc),
           state as (
             select distinct on (contract_id) contract_id, status
               from subscription_events where status is not null order by contract_id, received_at desc),
           nb as (
             select distinct on (contract_id) contract_id, next_billing_date
               from subscription_events where next_billing_date is not null order by contract_id, received_at desc),
           who as (
             select distinct on (contract_id) contract_id, customer_email, customer_name, product, origin_order
               from subscription_events
              where customer_email is not null or customer_name is not null or product is not null
              order by contract_id, received_at desc),
           born as (select contract_id, min(received_at) as first_seen from subscription_events group by 1)
           select c.contract_id, c.received_at, c.event, s.status, nb.next_billing_date,
                  w.customer_email, w.customer_name, w.product, w.origin_order, b.first_seen
             from current c
             left join state s on s.contract_id = c.contract_id
             left join nb on nb.contract_id = c.contract_id
             left join who w on w.contract_id = c.contract_id
             left join born b on b.contract_id = c.contract_id
            where (${status}::text is null or s.status = ${status})
              and (${like}::text is null or lower(coalesce(w.customer_email, '')) like ${like} or lower(coalesce(w.customer_name, '')) like ${like})
            order by c.received_at desc
            limit ${LIMIT}`,

      // The last three payment results per contract.
      sql`select contract_id, received_at, event, error_code, error_message
            from (select *, row_number() over (partition by contract_id order by received_at desc) as rn
                    from subscription_events
                   where event in ('payment_failed', 'payment_succeeded')) t
           where rn <= 3
           order by contract_id, received_at desc`,

      sql`select status, count(*) as n
            from (select distinct on (contract_id) contract_id, status from subscription_events
                   where status is not null order by contract_id, received_at desc) s
           group by 1`
    ]));

    const byContract = {};
    attempts.forEach(function (a) {
      (byContract[a.contract_id] = byContract[a.contract_id] || []).push({
        at: a.received_at, ok: a.event === 'payment_succeeded',
        errorCode: a.error_code || null, errorMessage: a.error_message || null
      });
    });
    const counts = {};
    STATUSES.forEach(function (s) { counts[s] = 0; });
    total.forEach(function (r) { if (r.status) counts[r.status] = Number(r.n || 0); });

    return res.status(200).json({
      ok: true,
      source: 'flow',
      via: keyed ? 'key' : 'deployment',
      filter: { status: status, q: text },
      counts: counts,
      total: latest.length,
      truncated: latest.length >= LIMIT,
      contracts: latest.map(function (r) {
        return {
          id: r.contract_id,
          status: r.status,
          lastEvent: r.event,
          createdAt: r.first_seen, updatedAt: r.received_at,
          nextBillingDate: r.next_billing_date || null,
          lastPaymentStatus: (byContract[r.contract_id] || [])[0] ? ((byContract[r.contract_id][0].ok) ? 'SUCCEEDED' : 'FAILED') : null,
          customer: { name: r.customer_name || '', email: viaHost ? mask(r.customer_email) : (r.customer_email || '') },
          product: r.product || '',
          originOrder: r.origin_order || null,
          attempts: byContract[r.contract_id] || []
        };
      })
    });
  } catch (err) {
    console.error('[admin/subscriptions]', err && err.message);
    return res.status(502).json({ ok: false, error: 'query_failed', message: err && err.message });
  }
};
