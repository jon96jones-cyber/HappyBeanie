// Abandoned-checkout recovery — three touches, not one.
//
//   1 · 45 minutes after they left
//   2 · 24 hours
//   3 · 48 hours, and then we stop
//
// The previous version was stateless: each run swept a single one-hour window
// and every checkout was emailed exactly once, so nothing had to be
// remembered. A ladder cannot work that way — rung two has to know rung one
// happened — so each checkout now gets a row in cart_recovery and the run
// works out which rung, if any, is due.
//
// SCHEDULE: this wants to run every 15 minutes. A 45-minute first touch is
// only as punctual as the interval that checks for it, and on a once-a-day
// schedule touch 1 arrives up to 24 hours late, which is not a recovery email
// any more. See vercel.json — the crons there are what actually decides this.
//
// The run is idempotent and safe to call as often as you like: it sends a rung
// only once, and only when the elapsed time has passed.
//
// Skipped: checkouts that completed, have no email, belong to wholesale
// accounts, or belong to anyone tagged no-recovery-email (the unsubscribe
// endpoint sets that tag).
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations
// when the CRON_SECRET env var exists — set it. Without it we fall back to
// requiring Vercel's x-vercel-cron header.
//
// Env: SHOPIFY_ADMIN_TOKEN, RESEND_API_KEY, CRON_SECRET, DATABASE_URL.
// Optional: RECOVERY_FROM (default 'Happy Beanie <hello@happybeanie.com>').

const lifecycle = require('../_lib/lifecycle-email.js');
const mailer = require('../_lib/mailer.js');
const db = require('../_lib/analytics-db.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const FROM = process.env.RECOVERY_FROM || 'Happy Beanie <hello@happybeanie.com>';
const SITE = 'https://www.happybeanie.com';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// The ladder. Each rung sends once, at or after its delay, and carries its own
// subject — the design handoff's instruction for extra touches was to reuse the
// email and change only the subject line.
const RUNGS = [
  { step: 1, after: 45 * MIN, subject: 'Your box is still packed' },
  { step: 2, after: 24 * HOUR, subject: 'Still packed, still yours' },
  { step: 3, after: 48 * HOUR, subject: 'We’ll stop reminding you after this' }
];

const LAST = RUNGS[RUNGS.length - 1];

// How far back to ask Shopify for carts. Comfortably past the final rung so a
// checkout is still in the answer when its 48-hour touch comes due.
const LOOKBACK = 54 * HOUR;

// A cart first seen already older than this never gets rung one. Without it,
// the first run after a deploy or an outage would fire touch 1 at every cart
// from the past two days at once — people would receive a "you just left"
// email about a cart they abandoned on Tuesday.
const STALE_ON_ARRIVAL = 3 * HOUR;

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

const CHECKOUTS_Q = `query Recover($q: String!) {
  abandonedCheckouts(first: 100, query: $q) {
    nodes {
      id createdAt completedAt abandonedCheckoutUrl
      totalPriceSet { shopMoney { amount } }
      customer { email firstName tags }
      lineItems(first: 20) {
        nodes {
          title quantity variantTitle
          image { url }
          originalTotalPriceSet { shopMoney { amount } }
        }
      }
    }
  }
}`;

function usd(n) {
  return '$' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Shopify gives every line a variantTitle, and for a product with one variant
// that string is the literal "Default Title". Printing it would be worse than
// printing nothing.
function variantOf(li) {
  const v = String((li && li.variantTitle) || '').trim();
  if (!v || /^default title$/i.test(v)) return 'One box';
  return v;
}

// The highest rung whose delay has passed. Null while the cart is younger than
// 45 minutes — which is most of them, most of the time.
function rungDue(ageMs, sentStep) {
  let due = null;
  for (const r of RUNGS) {
    if (ageMs >= r.after && r.step > sentStep) due = r;
  }
  // If two rungs came due between runs — a long outage — send only the later
  // one. Nobody wants yesterday's nudge and today's arriving together.
  return due;
}

// Delegated so there is one signing scheme rather than a copy per caller —
// and so this inherits accepting a rotated secret. Still re-exported here
// because the unsubscribe endpoint has always reached for it by this name.
const unsubToken = mailer.unsubToken;

module.exports = Object.assign(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  // Only Vercel's cron scheduler gets to trigger sends.
  const secret = process.env.CRON_SECRET;
  const authed = secret
    ? (req.headers && req.headers['authorization']) === 'Bearer ' + secret
    : !!(req.headers && req.headers['x-vercel-cron']);
  if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'not_configured' });
  // The ladder is the state, and without somewhere to keep it every run would
  // start from scratch and re-send rung one forever. Refuse rather than spam.
  if (!db.isConfigured()) return res.status(503).json({ ok: false, error: 'no_database' });

  const sql = db.sql();

  try {
    const now = Date.now();
    const out = await admin(token, CHECKOUTS_Q, {
      q: "created_at:>'" + new Date(now - LOOKBACK).toISOString() + "'"
    });
    if (out.errors && out.errors.length) {
      console.error('[recover-checkouts] shopify:', JSON.stringify(out.errors));
      return res.status(200).json({ ok: false, error: 'shopify_query_failed', detail: out.errors[0].message });
    }
    const nodes = ((((out || {}).data || {}).abandonedCheckouts) || {}).nodes || [];

    let sent = 0, skipped = 0, closed = 0, adopted = 0;
    const report = [];

    for (const c of nodes) {
      const id = String(c.id || '');
      const email = ((c.customer || {}).email || '').toLowerCase();
      const abandonedAt = new Date(c.createdAt);
      if (!id || !email || isNaN(abandonedAt)) { skipped++; continue; }

      // Anything that disqualifies the cart closes its row so later runs stop
      // looking at it, rather than being re-evaluated every fifteen minutes.
      const tags = ((c.customer || {}).tags || []).map(function (t) { return String(t).toLowerCase(); });
      let stop = null;
      if (c.completedAt) stop = 'ordered';
      else if (!c.abandonedCheckoutUrl) stop = 'no_checkout_url';
      else if (tags.indexOf('wholesale') !== -1) stop = 'wholesale';
      else if (tags.indexOf('no-recovery-email') !== -1) stop = 'unsubscribed';

      const ageMs = now - abandonedAt.getTime();

      // First sight of this cart. A cart already past STALE_ON_ARRIVAL is
      // adopted at the top of the ladder without sending, so a restart never
      // produces a burst of late "you just left" emails.
      const stale = ageMs > STALE_ON_ARRIVAL;
      const rows = await db.withSchema(function () {
        return sql`
          insert into cart_recovery (checkout_id, email, abandoned_at, step, done_at, done_reason)
          values (${id}, ${email}, ${abandonedAt.toISOString()},
                  ${stale ? LAST.step : 0},
                  ${stop ? new Date(now).toISOString() : (stale ? new Date(now).toISOString() : null)},
                  ${stop || (stale ? 'stale_on_arrival' : null)})
          on conflict (checkout_id) do update
            set email = excluded.email,
                done_at = coalesce(cart_recovery.done_at, ${stop ? new Date(now).toISOString() : null}),
                done_reason = coalesce(cart_recovery.done_reason, ${stop})
          returning step, done_at, xmax = 0 as inserted`;
      });
      const row = rows[0] || {};
      if (row.inserted && stale && !stop) adopted++;
      if (row.done_at) { if (stop) closed++; else skipped++; continue; }

      const rung = rungDue(ageMs, row.step || 0);
      if (!rung) { skipped++; continue; }

      const items = (((c.lineItems || {}).nodes) || []).map(function (li) {
        return {
          title: li.title,
          variant: variantOf(li),
          quantity: li.quantity,
          line_total: usd(parseFloat((((li.originalTotalPriceSet || {}).shopMoney) || {}).amount || '0'))
        };
      });
      const unsubUrl = SITE + '/api/unsubscribe?e=' + encodeURIComponent(email) + '&t=' + unsubToken(email);
      const t = {
        // The design uses the name in the headline, so a blank one reads
        // oddly — the handoff asks for a fallback and this is it.
        first_name: ((c.customer || {}).firstName || '').trim() || 'there',
        items: items,
        cart_subtotal: usd(parseFloat((((c.totalPriceSet || {}).shopMoney) || {}).amount || '0')),
        checkout_url: c.abandonedCheckoutUrl,
        cart_optout_url: unsubUrl
      };

      const sj = await mailer.send({
        from: FROM,
        to: email,
        flow: 'cart-recovery',
        step: String(rung.step),
        subject: rung.subject,
        html: lifecycle('cart-recovery', t),
        text: lifecycle.text('cart-recovery', t),
        unsubUrl: unsubUrl
      });

      if (sj.ok) {
        // Recorded before anything else can throw, so a crash below can never
        // cause the same rung to be sent twice.
        await db.withSchema(function () {
          return sql`update cart_recovery
                        set step = ${rung.step},
                            last_sent_at = now(),
                            done_at = ${rung.step >= LAST.step ? new Date(now).toISOString() : null},
                            done_reason = ${rung.step >= LAST.step ? 'ladder_finished' : null}
                      where checkout_id = ${id}`;
        });
        sent++;
        report.push({ email: email, step: rung.step, resend: sj.id });
      } else {
        // Left unrecorded on purpose: the next run retries this rung rather
        // than skipping straight past it to the next one.
        console.error('[recover-checkouts] resend step', rung.step, sj.status || '', sj.error, sj.message || '');
        report.push({ email: email, step: rung.step, error: 'send_failed' });
      }
    }

    console.log('[recover-checkouts]', nodes.length, 'fetched ·', sent, 'sent ·',
      adopted, 'adopted stale ·', closed, 'closed ·', skipped, 'not due');
    return res.status(200).json({
      ok: true, fetched: nodes.length, sent: sent, adopted: adopted,
      closed: closed, skipped: skipped, report: report
    });
  } catch (err) {
    console.error('[recover-checkouts] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
}, { unsubToken: unsubToken, RUNGS: RUNGS });
