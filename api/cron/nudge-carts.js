// The on-site cart nudge — the flow Shopify structurally cannot run for this
// store. Its "abandoned cart" automation watches carts inside Shopify, and
// this site's cart lives in the page until the checkout click. /api/cart-note
// parks the cart whenever it changes and the email is known; this cron,
// every 15 minutes, nudges the ones that went quiet.
//
//   30 minutes of inactivity tags the cart as left; the email goes out an
//   hour after that tag — one send, the cart-recovery design, linking to
//   /cart. The cron's 15-minute cadence is what keeps the hour honest.
//
// One nudge per parked cart. A later cart CHANGE re-arms it, but never more
// than one nudge per address per 14 days — the cap the design handoff set for
// recovery contact. And the nudge yields to the checkout ladder: anyone who
// reached checkout is already being walked down three rungs, and a fourth
// email about the same boxes is how unsubscribes happen.
//
// CONSENT IS DECIDED HERE, NOT AT PARKING TIME. The row was written by an
// unauthenticated endpoint; before sending, the address must be a Shopify
// customer whose marketing consent is SUBSCRIBED and who is neither wholesale
// nor tagged no-marketing-email. A row that fails the gate is closed, not
// retried forever. An order newer than the cart's last touch closes it too —
// they bought; the cart did its job.
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Env: SHOPIFY_ADMIN_TOKEN, RESEND_API_KEY, DATABASE_URL, CRON_SECRET.

const db = require('../_lib/analytics-db.js');
const mailer = require('../_lib/mailer.js');
const lifecycle = require('../_lib/lifecycle-email.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const FROM = process.env.RECOVERY_FROM || 'Happy Beanie <hello@happybeanie.com>';
const SITE = 'https://www.happybeanie.com';

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const QUIET = 90 * MIN;      // 30 min idle = left, email an hour after the tag
const TOO_OLD = 5 * DAY;     // a cart parked longer than this is stale, not warm
const CONTACT_GAP = 14 * DAY;// max one nudge per address in this span
const BATCH = 30;

// The site's price book, restated server-side so a forged POST cannot put
// invented prices in an email. Index = plan: one-time / subscribe / bundle.
const PRICE = [115, 99, 297];
const PLAN_LABEL = ['One-time · 30-day supply', 'Subscribe & save · 30-day supply', 'Buy 3 get 1 free · 4 months'];

function usd(n) {
  return '$' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

// One round trip per candidate: their consent and their latest order together.
const GATE_Q = `query CartGate($q: String!) {
  customers(first: 1, query: $q) {
    nodes {
      tags
      emailMarketingConsent { marketingState }
      lastOrder { createdAt }
    }
  }
}`;

const unsubToken = mailer.unsubToken;

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
    const rows = await db.withSchema(function () {
      return sql`select email, dog, cat, plan_dog, plan_cat, updated_at, emailed_at
                   from open_carts
                  where closed_at is null
                    and updated_at <= ${new Date(now - QUIET).toISOString()}
                    and updated_at >= ${new Date(now - TOO_OLD).toISOString()}
                    and (emailed_at is null
                         or (updated_at > emailed_at
                             and emailed_at < ${new Date(now - CONTACT_GAP).toISOString()}))
                  order by updated_at
                  limit ${BATCH}`;
    });

    let sent = 0, closed = 0, skipped = 0;
    const close = function (email, why) {
      closed++;
      return db.withSchema(function () {
        return sql`update open_carts set closed_at = now(), closed_why = ${why}
                    where email = ${email}`;
      });
    };

    for (const c of rows) {
      // The checkout ladder outranks the nudge: a recent cart-recovery send
      // means they got past the cart on their own and are already being
      // walked back to a real Shopify checkout.
      const ladder = await db.withSchema(function () {
        return sql`select 1 from email_sends
                    where email = ${c.email} and flow = 'cart-recovery'
                      and sent_at > ${new Date(now - 3 * DAY).toISOString()}
                    limit 1`;
      });
      if (ladder.length) { await close(c.email, 'in_checkout_ladder'); continue; }

      const out = await admin(token, GATE_Q, { q: 'email:' + c.email });
      if (out.errors && out.errors.length) {
        console.error('[nudge-carts] shopify:', JSON.stringify(out.errors));
        skipped++; continue;   // transient — the next run retries
      }
      const cust = ((((out || {}).data || {}).customers || {}).nodes || [])[0];
      const consent = cust && cust.emailMarketingConsent;
      const tags = ((cust && cust.tags) || []).map(function (t) { return String(t).toLowerCase(); });

      if (!cust || !consent || consent.marketingState !== 'SUBSCRIBED') { await close(c.email, 'no_consent'); continue; }
      if (tags.indexOf('wholesale') !== -1) { await close(c.email, 'wholesale'); continue; }
      if (tags.indexOf('no-marketing-email') !== -1) { await close(c.email, 'unsubscribed'); continue; }
      const ordered = cust.lastOrder && new Date(cust.lastOrder.createdAt).getTime() > new Date(c.updated_at).getTime();
      if (ordered) { await close(c.email, 'ordered'); continue; }

      // Items rebuilt from the price book — never from anything a browser sent.
      const items = [];
      if (c.dog > 0) items.push({ title: 'Happy Beans for Dogs', variant: PLAN_LABEL[c.plan_dog] || PLAN_LABEL[0], quantity: c.dog, line_total: usd((PRICE[c.plan_dog] || PRICE[0]) * c.dog) });
      if (c.cat > 0) items.push({ title: 'Happy Beans for Cats', variant: PLAN_LABEL[c.plan_cat] || PLAN_LABEL[0], quantity: c.cat, line_total: usd((PRICE[c.plan_cat] || PRICE[0]) * c.cat) });
      if (!items.length) { await close(c.email, 'emptied'); continue; }
      const subtotal = usd(items.reduce(function (n, i) { return n + parseFloat(i.line_total.slice(1).replace(/,/g, '')); }, 0));

      const unsubUrl = SITE + '/api/unsubscribe?e=' + encodeURIComponent(c.email) + '&t=' + unsubToken(c.email);
      const t = {
        first_name: 'there',
        items: items,
        cart_subtotal: subtotal,
        // Their cart lives in their browser, so the link goes to the cart
        // page, where this device's cart is waiting exactly as they left it.
        checkout_url: SITE + '/cart?utm_source=email&utm_medium=lifecycle&utm_campaign=cart_nudge',
        cart_optout_url: unsubUrl
      };

      const sj = await mailer.send({
        from: FROM,
        to: c.email,
        flow: 'cart-nudge',
        step: '1',
        subject: 'Your box is still packed',
        html: lifecycle('cart-recovery', t),
        text: lifecycle.text('cart-recovery', t),
        unsubUrl: unsubUrl
      });
      if (sj.ok) {
        sent++;
        await db.withSchema(function () {
          return sql`update open_carts set emailed_at = now() where email = ${c.email}`;
        });
      } else {
        skipped++;   // left open; the next run retries
        console.error('[nudge-carts] resend:', sj.status || '', sj.error, sj.message || '');
      }
    }

    console.log('[nudge-carts]', rows.length, 'due ·', sent, 'sent ·', closed, 'closed ·', skipped, 'deferred');
    return res.status(200).json({ ok: true, due: rows.length, sent: sent, closed: closed, skipped: skipped });
  } catch (err) {
    console.error('[nudge-carts] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
};
