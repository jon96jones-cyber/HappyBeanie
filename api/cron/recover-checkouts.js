// Abandoned-checkout recovery cron — replaces Shopify Messaging's automation
// so the email can be fully custom (api/_lib/lifecycle-email.js via Resend).
//
// Runs hourly (vercel.json crons). Each run emails checkouts abandoned
// 2–3 hours ago — a one-hour window per run, so every checkout is emailed
// exactly once and there is no state to store. Skipped: checkouts that
// completed, have no email, belong to wholesale accounts, or belong to
// anyone tagged no-recovery-email (the unsubscribe endpoint sets that tag).
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron
// invocations when the CRON_SECRET env var exists — set it. Without it we
// fall back to requiring Vercel's x-vercel-cron header.
//
// Env: SHOPIFY_ADMIN_TOKEN, RESEND_API_KEY, CRON_SECRET.
// Optional: RECOVERY_FROM (default 'Happy Beanie <hello@happybeanie.com>').

const lifecycle = require('../_lib/lifecycle-email.js');
const mailer = require('../_lib/mailer.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const FROM = process.env.RECOVERY_FROM || 'Happy Beanie <hello@happybeanie.com>';
const SITE = 'https://www.happybeanie.com';

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

const CHECKOUTS_Q = `query Recover($q: String!) {
  abandonedCheckouts(first: 50, query: $q) {
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

// Delegated so there is one signing scheme rather than a copy per caller —
// and so this inherits accepting a rotated secret. Still re-exported here
// because the unsubscribe endpoint has always reached for it by this name.
const unsubToken = mailer.unsubToken;
module.exports.unsubToken = unsubToken;

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

  try {
    const now = Date.now();
    const windowStart = now - 3 * 3600 * 1000;
    const windowEnd = now - 2 * 3600 * 1000;

    const out = await admin(token, CHECKOUTS_Q, {
      q: "created_at:>'" + new Date(now - 4 * 3600 * 1000).toISOString() + "'"
    });
    if (out.errors && out.errors.length) {
      console.error('[recover-checkouts] shopify:', JSON.stringify(out.errors));
      return res.status(200).json({ ok: false, error: 'shopify_query_failed', detail: out.errors[0].message });
    }
    const nodes = ((((out || {}).data || {}).abandonedCheckouts) || {}).nodes || [];

    let sent = 0, skipped = 0;
    const report = [];
    for (const c of nodes) {
      const created = new Date(c.createdAt).getTime();
      if (!(created >= windowStart && created < windowEnd)) { skipped++; continue; }
      if (c.completedAt) { skipped++; continue; }
      const email = ((c.customer || {}).email || '').toLowerCase();
      if (!email) { skipped++; continue; }
      const tags = ((c.customer || {}).tags || []).map(function (t) { return String(t).toLowerCase(); });
      // Wholesale accounts order deliberately at trade terms — no nudges.
      // no-recovery-email is the unsubscribe tag.
      if (tags.indexOf('wholesale') !== -1 || tags.indexOf('no-recovery-email') !== -1) { skipped++; continue; }
      if (!c.abandonedCheckoutUrl) { skipped++; continue; }

      const items = (((c.lineItems || {}).nodes) || []).map(function (li) {
        return {
          title: li.title,
          // The design shows a variant line under each title. Shopify's
          // variantTitle is "Default Title" for a single-variant product,
          // which is not something to print at anyone — fall back to the
          // quantity's own unit instead of an empty gap.
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

      // Through the shared mailer rather than its own fetch: one place that
      // talks to Resend, and naming the flow is what puts this on the campaign
      // desk alongside everything else.
      const sj = await mailer.send({
        from: FROM,
        to: email,
        flow: 'cart-recovery',
        step: '1',
        subject: lifecycle.subject('cart-recovery'),
        html: lifecycle('cart-recovery', t),
        text: lifecycle.text('cart-recovery', t),
        unsubUrl: unsubUrl
      });
      if (sj.ok) { sent++; report.push({ email: email, resend: sj.id }); }
      else {
        console.error('[recover-checkouts] resend:', sj.status || '', sj.error, sj.message || '');
        report.push({ email: email, error: 'send_failed' });
      }
    }

    console.log('[recover-checkouts] window', new Date(windowStart).toISOString(), '→', new Date(windowEnd).toISOString(),
      '·', nodes.length, 'fetched ·', sent, 'sent ·', skipped, 'skipped');
    return res.status(200).json({ ok: true, fetched: nodes.length, sent: sent, skipped: skipped, report: report });
  } catch (err) {
    console.error('[recover-checkouts] error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
}, { unsubToken: unsubToken });
