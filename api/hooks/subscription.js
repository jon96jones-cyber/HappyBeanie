// POST /api/hooks/subscription — subscription contract events from Shopify Flow.
//
// Shopify will not let a custom app read subscription contracts: the scope
// cannot be granted to an app made in the admin, and the contracts belong to
// the Shopify Subscriptions app anyway. Flow, though, sees every one of that
// app's events and can send an HTTP request on each. Four workflows in the
// admin (created, payment failed, cancelled, paused/resumed) post here, and
// this becomes the only record of contracts we hold. The subscriptions desk
// and the rescue cron read it; nothing here writes back to Shopify.
//
// Body (JSON, built by the Flow action's Liquid template — docs/shopify-flow-
// subscriptions.md has the exact text):
//   { event: "created" | "payment_failed" | "payment_succeeded" | "cancelled"
//            | "paused" | "resumed" | "expired" | "failed",
//     contract: { id, status, customer_email, customer_name, product,
//                 next_billing_date, origin_order },
//     attempt:  { error_code, error_message } }
// Only event and contract.id are required. Everything else is kept if sent.
//
// Auth: shared secret in `x-flow-key` against FLOW_KEY, compared in constant
// time. The endpoint is public, so an unkeyed request must be refused before
// it can write: otherwise anyone could invent a cancellation and trigger a
// rescue email. Flow retries on non-2xx, so a duplicate of the same event for
// the same contract inside a minute is acknowledged and dropped.
//
// Env: DATABASE_URL, FLOW_KEY.

const db = require('../_lib/analytics-db.js');

const EVENTS = ['created', 'payment_failed', 'payment_succeeded', 'cancelled', 'paused', 'resumed', 'expired', 'failed'];
const ALIAS = { canceled: 'cancelled', cancel: 'cancelled', billing_failed: 'payment_failed', billing_attempt_failed: 'payment_failed',
  billing_succeeded: 'payment_succeeded', billing_attempt_succeeded: 'payment_succeeded', activated: 'resumed', active: 'resumed', create: 'created' };
// The status a contract is in after an event, when Flow did not say.
const IMPLIED = { created: 'ACTIVE', payment_succeeded: 'ACTIVE', cancelled: 'CANCELLED', paused: 'PAUSED', resumed: 'ACTIVE', expired: 'EXPIRED', failed: 'FAILED' };
const STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'];

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return null; }
}
function str(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').trim();
  return s ? s.slice(0, max || 255) : null;
}
function when(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}
// "gid://shopify/SubscriptionContract/123" and "123" name the same contract.
function contractId(v) {
  const s = str(v, 120);
  return s ? s.split('/').pop() : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.FLOW_KEY) return res.status(503).json({ ok: false, error: 'not_configured', message: 'FLOW_KEY is not set.' });
  if (!db.keyOk(req, 'x-flow-key', 'FLOW_KEY')) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!db.isConfigured()) return res.status(503).json({ ok: false, error: 'no_database' });

  const body = readBody(req);
  if (!body) return res.status(400).json({ ok: false, error: 'bad_json' });

  // "Subscription contract created", "subscription_cancelled" and "created"
  // all mean the same thing; Flow's trigger names are long.
  let event = String(body.event || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
    .replace(/^subscription_(contract_)?/, '').replace(/^contract_/, '');
  event = ALIAS[event] || event;
  if (EVENTS.indexOf(event) === -1) return res.status(400).json({ ok: false, error: 'bad_event', allowed: EVENTS });

  const c = body.contract || {};
  const a = body.attempt || {};
  const id = contractId(c.id || body.contract_id);
  if (!id) return res.status(400).json({ ok: false, error: 'no_contract_id' });

  let status = str(c.status, 20);
  status = status ? status.toUpperCase() : null;
  if (STATUSES.indexOf(status) === -1) status = IMPLIED[event] || null;

  const row = {
    event: event, contract_id: id, status: status,
    customer_email: (str(c.customer_email || c.email, 200) || '').toLowerCase() || null,
    customer_name: str(c.customer_name || c.name, 120),
    product: str(c.product, 200),
    next_billing_date: when(c.next_billing_date),
    origin_order: str(c.origin_order, 40),
    error_code: str(a.error_code, 80),
    error_message: str(a.error_message, 400)
  };

  try {
    const sql = db.sql();
    const dup = await db.withSchema(() => sql`
      select id from subscription_events
       where contract_id = ${id} and event = ${event} and received_at > now() - interval '1 minute'
       limit 1`);
    if (dup.length) return res.status(200).json({ ok: true, duplicate: true });

    await db.withSchema(() => sql`
      insert into subscription_events
        (event, contract_id, status, customer_email, customer_name, product, next_billing_date, origin_order, error_code, error_message, raw)
      values
        (${row.event}, ${row.contract_id}, ${row.status}, ${row.customer_email}, ${row.customer_name}, ${row.product},
         ${row.next_billing_date}, ${row.origin_order}, ${row.error_code}, ${row.error_message},
         ${JSON.stringify(body).slice(0, 4000)})`);
    return res.status(200).json({ ok: true, event: event, contract: id, status: status });
  } catch (err) {
    console.error('[hooks/subscription]', err && err.message);
    // A 5xx makes Flow retry later, which is what a database blip deserves.
    return res.status(502).json({ ok: false, error: 'store_failed' });
  }
};
