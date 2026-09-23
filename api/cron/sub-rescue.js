// The cancellation confirmation — one quiet email when a Subscribe & Save is
// cancelled. See the 'rescue' step in api/_lib/postpurchase-email.js.
//
// TRANSACTIONAL, per the Setup_29 handoff: it confirms an action the
// customer took, so it sends regardless of marketing consent — no consent
// gate, no tag gate. The 90-day cap below is what stops a twitchy contract
// record from repeating it.
//
// Cancellations the customer chose, only. This used to page the Admin API's
// contract list, which Shopify refuses to a custom app — so it failed every
// morning and never sent a thing. It reads our own log now: the events
// Shopify Flow posts to api/hooks/subscription.js. A cancellation that
// followed a failed payment is skipped: that customer did not choose to
// leave, Shopify's own card reminders are already talking to them, and a
// "sorry you cancelled" note would read as if we had not noticed.
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Env: RESEND_API_KEY, DATABASE_URL, CRON_SECRET.

const db = require('../_lib/analytics-db.js');
const mailer = require('../_lib/mailer.js');
const pp = require('../_lib/postpurchase-email.js');

const FROM = process.env.RESEND_FROM || 'Happy Beanie <hello@happybeanie.com>';

const DAY = 24 * 60 * 60 * 1000;
const LOOKBACK = 3 * DAY;       // a daily run plus slack for an outage
const PAYMENT_SHADOW = 14 * DAY; // a failed payment this recent owns the cancellation
const CONTACT_GAP = 90 * DAY;    // one rescue per address in this span
const BATCH = 40;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  const secret = process.env.CRON_SECRET;
  const authed = secret
    ? (req.headers && req.headers['authorization']) === 'Bearer ' + secret
    : !!(req.headers && req.headers['x-vercel-cron']);
  if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!db.isConfigured()) return res.status(503).json({ ok: false, error: 'no_database' });

  const sql = db.sql();
  const now = Date.now();

  try {
    // Cancellations inside the lookback, minus any whose contract had a
    // failed payment in the fortnight before. The address comes from the
    // newest event of that contract that carried one — a cancellation
    // event posted with only the contract id still reaches the customer.
    const rows = await db.withSchema(() => sql`
      select c.contract_id,
             (select lower(w.customer_email) from subscription_events w
               where w.contract_id = c.contract_id and w.customer_email is not null
               order by w.received_at desc limit 1) as email
        from subscription_events c
       where c.event = 'cancelled'
         and c.received_at > ${new Date(now - LOOKBACK).toISOString()}::timestamptz
         and not exists (
           select 1 from subscription_events f
            where f.contract_id = c.contract_id and f.event = 'payment_failed'
              and f.received_at > c.received_at - (${PAYMENT_SHADOW / 1000})::int * interval '1 second'
              and f.received_at <= c.received_at + interval '1 minute')`);

    const dueSet = {};
    rows.forEach(function (r) { if (r.email) dueSet[r.email] = true; });
    const emails = Object.keys(dueSet);
    if (!emails.length) return res.status(200).json({ ok: true, due: 0, sent: 0, skipped: 0 });

    const recent = await db.withSchema(function () {
      return sql`select email from email_sends
                  where flow = 'sub-rescue' and status = 'sent'
                    and sent_at > ${new Date(now - CONTACT_GAP).toISOString()}
                    and email = any(${emails})`;
    });
    const cooling = {};
    recent.forEach(function (r) { cooling[r.email] = true; });

    let sent = 0, skipped = 0, failed = 0;
    for (const email of emails.slice(0, BATCH)) {
      if (cooling[email]) { skipped++; continue; }
      const unsubUrl = mailer.unsubUrl(email, 'marketing');
      const out = await mailer.send({
        from: FROM,
        to: email,
        flow: 'sub-rescue',
        step: '1',
        subject: pp.subject('rescue'),
        html: pp('rescue', { unsubUrl: unsubUrl }),
        text: pp.text('rescue', { unsubUrl: unsubUrl }),
        unsubUrl: unsubUrl
      });
      if (out.ok) sent++;
      else {
        failed++;   // the 3-day lookback gives a failed send two more mornings
        console.error('[sub-rescue]', email, out.error, out.status || '', out.message || '');
      }
    }

    console.log('[sub-rescue]', emails.length, 'due ·', sent, 'sent ·', skipped, 'cooling off ·', failed, 'failed');
    return res.status(200).json({ ok: true, due: emails.length, sent: sent, skipped: skipped, failed: failed });
  } catch (err) {
    console.error('[sub-rescue] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
};
