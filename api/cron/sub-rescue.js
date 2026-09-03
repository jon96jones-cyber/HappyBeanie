// The cancellation confirmation — one quiet email when a Subscribe & Save is
// cancelled. See the 'rescue' step in api/_lib/postpurchase-email.js.
//
// TRANSACTIONAL, per the Setup_29 handoff: it confirms an action the
// customer took, so it sends regardless of marketing consent — no consent
// gate, no tag gate. The 90-day cap below is what stops a twitchy contract
// record from repeating it.
//
// Cancellations only, on purpose. Failed renewal payments are Shopify's to
// chase: its native subscription dunning already emails those, and that is
// its side of the transactional line — piling ours on top would duplicate it.
//
// Shopify has no "cancelled since" filter on contracts, so this pages the
// contract list and keeps the ones whose status is CANCELLED and whose
// record moved inside the lookback. updatedAt moves on any change, not just
// cancellation, so the send log is what makes this exact: one rescue email
// per address per 90 days, however often their contract record twitches.
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Env: SHOPIFY_ADMIN_TOKEN, RESEND_API_KEY, DATABASE_URL, CRON_SECRET.

const db = require('../_lib/analytics-db.js');
const mailer = require('../_lib/mailer.js');
const pp = require('../_lib/postpurchase-email.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const FROM = process.env.RESEND_FROM || 'Happy Beanie <hello@happybeanie.com>';

const DAY = 24 * 60 * 60 * 1000;
const LOOKBACK = 3 * DAY;      // a daily run plus slack for an outage
const CONTACT_GAP = 90 * DAY;  // one rescue per address in this span
const BATCH = 40;

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

const CONTRACTS_Q = `query Rescue($after: String) {
  subscriptionContracts(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      status updatedAt
      customer { email }
    }
  }
}`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  const secret = process.env.CRON_SECRET;
  const authed = secret
    ? (req.headers && req.headers['authorization']) === 'Bearer ' + secret
    : !!(req.headers && req.headers['x-vercel-cron']);
  if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'not_configured' });
  if (!db.isConfigured()) return res.status(503).json({ ok: false, error: 'no_database' });

  const sql = db.sql();
  const now = Date.now();

  try {
    const dueSet = {};
    let after = null;
    for (let pageN = 0; pageN < 5; pageN++) {
      const out = await admin(token, CONTRACTS_Q, { after: after });
      if (out.errors && out.errors.length) {
        console.error('[sub-rescue] shopify:', JSON.stringify(out.errors));
        return res.status(200).json({ ok: false, error: 'shopify_query_failed', detail: out.errors[0].message });
      }
      const c = (((out || {}).data || {}).subscriptionContracts) || {};
      (c.nodes || []).forEach(function (n) {
        if (n.status !== 'CANCELLED') return;
        if (new Date(n.updatedAt).getTime() < now - LOOKBACK) return;
        // Transactional: the only gate is having an address to confirm to.
        const email = String(((n.customer || {}).email) || '').toLowerCase();
        if (!email) return;
        dueSet[email] = true;
      });
      if (!c.pageInfo || !c.pageInfo.hasNextPage) break;
      after = c.pageInfo.endCursor;
    }

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
