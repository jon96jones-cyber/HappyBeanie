// The welcome sequence's scheduler — decides, once a day, who is due which of
// the three emails. See api/_lib/welcome-email.js for what they say.
//
// AUDIENCE: Shopify customers whose marketing consent is SUBSCRIBED, however
// they consented — the popup, the footer, or the checkbox at Shopify's
// checkout. That single definition is the point: a buyer who opted in at
// checkout gets the same welcome as a popup signup, with no separate flow.
// Excluded: wholesale accounts, anyone tagged no-marketing-email.
//
// TIMING: windows keyed to when consent was given, not a ladder. Days are
// CALENDAR days in Scottsdale (UTC-7, no DST), not elapsed 24-hour blocks —
// so step 1 goes out on the 8am run the morning after signup, whether the
// signup was yesterday at 7am or yesterday at 11pm.
//
//   step 1 · days 1–4     step 2 · days 5–11     step 3 · days 12–18
//
// A missed window is skipped forever rather than sent late — nobody five
// weeks in should get "welcome!", and the first run after this deploys must
// not carpet-bomb the existing list. That is also why there is no state
// table: the windows plus the send log ARE the state. email_sends is checked
// per address before sending, so re-runs and overlapping windows can never
// send a step twice.
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Env: SHOPIFY_ADMIN_TOKEN, RESEND_API_KEY, DATABASE_URL, CRON_SECRET.

const db = require('../_lib/analytics-db.js');
const mailer = require('../_lib/mailer.js');
const welcome = require('../_lib/welcome-email.js');
const discount = require('../_lib/discount.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const FROM = process.env.RESEND_FROM || 'Happy Beanie <hello@happybeanie.com>';

const DAY = 24 * 60 * 60 * 1000;
// Scottsdale's clock, which never moves for DST — calendar days are counted
// against it so "day 1" is literally the morning after signup.
const TZ_OFFSET = 7 * 60 * 60 * 1000;
// [step, first day, last day] — inclusive of first, exclusive after last.
const WINDOWS = [
  ['1', 1, 4],
  ['2', 5, 11],
  ['3', 12, 18]
];
const BATCH = 80;

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

// updated_at moves whenever the customer record changes, consent included, so
// anyone whose consent could put them inside a window is inside this net.
const CUSTOMERS_Q = `query Welcome($q: String!, $after: String) {
  customers(first: 100, query: $q, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      email tags
      emailMarketingConsent { marketingState consentUpdatedAt }
    }
  }
}`;

function stepDue(consentAt, now) {
  const days = Math.floor((now - TZ_OFFSET) / DAY) - Math.floor((consentAt - TZ_OFFSET) / DAY);
  for (const w of WINDOWS) {
    if (days >= w[1] && days <= w[2]) return w[0];
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  const secret = process.env.CRON_SECRET;
  const authed = secret
    ? (req.headers && req.headers['authorization']) === 'Bearer ' + secret
    : !!(req.headers && req.headers['x-vercel-cron']);
  if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'not_configured' });
  // The send log is the only thing standing between a re-run and a duplicate
  // email. No database, no sends.
  if (!db.isConfigured()) return res.status(503).json({ ok: false, error: 'no_database' });

  const sql = db.sql();
  const now = Date.now();

  try {
    // Everyone whose record moved inside the sequence's horizon, plus a day
    // of slack for clock skew between us and Shopify.
    const horizon = new Date(now - 20 * DAY).toISOString();
    const due = [];
    let after = null;
    for (let pageN = 0; pageN < 5; pageN++) {
      const out = await admin(token, CUSTOMERS_Q, { q: "updated_at:>'" + horizon + "'", after: after });
      if (out.errors && out.errors.length) {
        console.error('[send-welcome] shopify:', JSON.stringify(out.errors));
        return res.status(200).json({ ok: false, error: 'shopify_query_failed', detail: out.errors[0].message });
      }
      const c = (((out || {}).data || {}).customers) || {};
      (c.nodes || []).forEach(function (n) {
        const email = String(n.email || '').toLowerCase();
        const consent = n.emailMarketingConsent || {};
        if (!email) return;
        if (consent.marketingState !== 'SUBSCRIBED') return;
        const at = new Date(consent.consentUpdatedAt || 0).getTime();
        if (!at) return;
        const tags = (n.tags || []).map(function (t) { return String(t).toLowerCase(); });
        if (tags.indexOf('wholesale') !== -1 || tags.indexOf('no-marketing-email') !== -1) return;
        const step = stepDue(at, now);
        if (step) due.push({ email: email, step: step });
      });
      if (!c.pageInfo || !c.pageInfo.hasNextPage) break;
      after = c.pageInfo.endCursor;
    }

    if (!due.length) return res.status(200).json({ ok: true, due: 0, sent: 0, skipped: 0 });

    // One query answers "which welcome steps has each of these people already
    // had", so the loop below never asks the database per person.
    const emails = due.map(function (d) { return d.email; });
    // Only successful sends count as "already had it": a failed attempt left
    // a failure row, and tomorrow's run should try again — the window closing
    // is what bounds the retries, never more than the window's width in days.
    const sentRows = await db.withSchema(function () {
      return sql`select email, step from email_sends
                  where flow = 'welcome' and status = 'sent' and email = any(${emails})`;
    });
    const already = {};
    sentRows.forEach(function (r) { already[r.email + '|' + r.step] = true; });

    // Their live code, if they hold one — the emails carry it as a quiet strip.
    const grants = await db.withSchema(function () {
      return sql`select email, code, expires_at from discount_grants
                  where email = any(${emails})`;
    });
    const grantOf = {};
    grants.forEach(function (g) {
      if (!g.expires_at || new Date(g.expires_at).getTime() > now) grantOf[g.email] = g;
    });

    let sent = 0, skipped = 0, failed = 0;
    for (const d of due.slice(0, BATCH)) {
      if (already[d.email + '|' + d.step]) { skipped++; continue; }
      const g = grantOf[d.email];
      const unsubUrl = mailer.unsubUrl(d.email, 'marketing');
      const t = {
        code: g ? g.code : null,
        expiresLabel: g && g.expires_at ? discount.expiryLabel(new Date(g.expires_at)) : null,
        unsubUrl: unsubUrl
      };
      const out = await mailer.send({
        from: FROM,
        to: d.email,
        flow: 'welcome',
        step: d.step,
        subject: welcome.subject(d.step),
        html: welcome(d.step, t),
        text: welcome.text(d.step, t),
        unsubUrl: unsubUrl
      });
      if (out.ok) sent++;
      else {
        // mailer.record wrote the failure row; tomorrow's run retries it,
        // and the window closing bounds how long that can go on.
        failed++;
        console.error('[send-welcome]', d.email, 'step', d.step, out.error, out.status || '', out.message || '');
      }
    }

    console.log('[send-welcome]', due.length, 'in window ·', sent, 'sent ·', skipped, 'already had it ·', failed, 'failed');
    return res.status(200).json({ ok: true, due: due.length, sent: sent, skipped: skipped, failed: failed });
  } catch (err) {
    console.error('[send-welcome] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
};
