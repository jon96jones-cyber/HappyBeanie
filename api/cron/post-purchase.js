// The post-purchase emails' scheduler — daily, right after the welcome run.
// See api/_lib/postpurchase-email.js for what they say.
//
//   checkin     · order aged 7–10 days,  first order        · once ever
//   milestone   · order aged 1–4 days,   second-plus order  · once ever
//   halfway     · order aged 21–24 days, no subscription    · once ever
//   halfway-sub · order aged 21–24 days, active subscriber  · once ever
//
// milestone fires on the first morning after the second order — the Setup_29
// handoff wants the thank-you close to the reorder, not a week later.
//
// halfway splits on subscription state: the pitch for one-time buyers, the
// same design re-cut as reassurance (next jar scheduled, next billing date
// shown) for people already on Subscribe & Save. Once ever means the
// subscriber version lands in their first month only — it explains how the
// schedule works, it is not a monthly newsletter.
//
// Ages are calendar days on Scottsdale's clock, same as the welcome cron.
// The windows are a few days wide so a failed send retries; past the window
// it is skipped forever — nobody should get "one week in" a month late.
//
// halfway is the Subscribe & Save pitch, so it skips anyone who already
// holds a subscription contract, and any order big enough to be the 4-month
// bundle — "halfway through the jar" is a 30-day box's timeline.
//
// One email per address per run: if two steps are due at once (a reorder at
// day 7 while the first box sits at day 21), the higher-priority one goes
// today and the other keeps its window for tomorrow's run.
//
// AUDIENCE: buyers whose marketing consent is SUBSCRIBED, minus wholesale
// and no-marketing-email tags — the same gate as every marketing flow.
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
const TZ_OFFSET = 7 * 60 * 60 * 1000;   // Scottsdale, never moves for DST
const BUNDLE_FLOOR = 250;               // subtotal at/above this = 4-month bundle
const BATCH = 60;

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

const ORDERS_Q = `query PostPurchase($q: String!, $after: String) {
  orders(first: 100, query: $q, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      currentSubtotalPriceSet { shopMoney { amount } }
      customer {
        email tags numberOfOrders
        emailMarketingConsent { marketingState }
        subscriptionContracts(first: 3) { nodes { status nextBillingDate } }
      }
    }
  }
}`;

function calDays(thenAt, now) {
  return Math.floor((now - TZ_OFFSET) / DAY) - Math.floor((thenAt - TZ_OFFSET) / DAY);
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
  if (!db.isConfigured()) return res.status(503).json({ ok: false, error: 'no_database' });

  const sql = db.sql();
  const now = Date.now();

  try {
    // Every order young enough to matter — the widest window plus slack.
    const horizon = new Date(now - 26 * DAY).toISOString();
    const orders = [];
    let after = null;
    for (let pageN = 0; pageN < 5; pageN++) {
      const out = await admin(token, ORDERS_Q, { q: "created_at:>'" + horizon + "'", after: after });
      if (out.errors && out.errors.length) {
        console.error('[post-purchase] shopify:', JSON.stringify(out.errors));
        return res.status(200).json({ ok: false, error: 'shopify_query_failed', detail: out.errors[0].message });
      }
      const o = (((out || {}).data || {}).orders) || {};
      (o.nodes || []).forEach(function (n) { orders.push(n); });
      if (!o.pageInfo || !o.pageInfo.hasNextPage) break;
      after = o.pageInfo.endCursor;
    }

    // Classify: which step, if any, does each order put its buyer in line for.
    // Priority: milestone (they reordered) > checkin > the halfway pair.
    const RANK = { milestone: 1, checkin: 2, halfway: 3, 'halfway-sub': 3 };
    const dueOf = {};
    orders.forEach(function (o) {
      const c = o.customer;
      const email = String((c && c.email) || '').toLowerCase();
      if (!email) return;
      const consent = c.emailMarketingConsent;
      if (!consent || consent.marketingState !== 'SUBSCRIBED') return;
      const tags = (c.tags || []).map(function (t) { return String(t).toLowerCase(); });
      if (tags.indexOf('wholesale') !== -1 || tags.indexOf('no-marketing-email') !== -1) return;

      const age = calDays(new Date(o.createdAt).getTime(), now);
      const nOrders = parseInt(c.numberOfOrders, 10) || 0;
      let step = null, chews = null, renews = null;
      if (age >= 1 && age <= 4 && nOrders >= 2) step = 'milestone';
      else if (age >= 7 && age <= 10 && nOrders <= 1) step = 'checkin';
      else if (age >= 21 && age <= 24) {
        const subtotal = parseFloat((((o.currentSubtotalPriceSet || {}).shopMoney || {}).amount) || '0');
        const active = ((c.subscriptionContracts || {}).nodes || []).filter(function (s) { return s.status === 'ACTIVE'; });
        if (subtotal < BUNDLE_FLOOR) {
          step = active.length ? 'halfway-sub' : 'halfway';
          // The design's jar counter: 30 chews minus the days since the box
          // arrived (~5 transit days after the order), never below 1.
          chews = Math.max(1, Math.min(30, 30 - (age - 5)));
          const next = active.map(function (s) { return s.nextBillingDate; })
            .filter(Boolean).sort()[0];
          if (next) {
            renews = new Date(next).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Phoenix' });
          }
        }
      }
      if (!step) return;
      if (!dueOf[email] || RANK[step] < dueOf[email].rank) dueOf[email] = { step: step, chews: chews, renews: renews, rank: RANK[step] };
    });

    const emails = Object.keys(dueOf);
    if (!emails.length) return res.status(200).json({ ok: true, due: 0, sent: 0, skipped: 0 });

    // Once ever per step per address — the send log is the state.
    const sentRows = await db.withSchema(function () {
      return sql`select email, step from email_sends
                  where flow = 'post-purchase' and status = 'sent' and email = any(${emails})`;
    });
    const already = {};
    sentRows.forEach(function (r) { already[r.email + '|' + r.step] = true; });

    let sent = 0, skipped = 0, failed = 0;
    for (const email of emails.slice(0, BATCH)) {
      const step = dueOf[email].step;
      if (already[email + '|' + step]) { skipped++; continue; }
      const unsubUrl = mailer.unsubUrl(email, 'marketing');
      const t = { unsubUrl: unsubUrl, chewsRemaining: dueOf[email].chews, renewsOn: dueOf[email].renews };
      const out = await mailer.send({
        from: FROM,
        to: email,
        flow: 'post-purchase',
        step: step,
        subject: pp.subject(step),
        html: pp(step, t),
        text: pp.text(step, t),
        unsubUrl: unsubUrl
      });
      if (out.ok) sent++;
      else {
        failed++;   // the window's width bounds the retries
        console.error('[post-purchase]', email, step, out.error, out.status || '', out.message || '');
      }
    }

    console.log('[post-purchase]', emails.length, 'due ·', sent, 'sent ·', skipped, 'already had it ·', failed, 'failed');
    return res.status(200).json({ ok: true, due: emails.length, sent: sent, skipped: skipped, failed: failed });
  } catch (err) {
    console.error('[post-purchase] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
};
