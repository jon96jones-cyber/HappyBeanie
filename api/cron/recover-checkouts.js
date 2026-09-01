// Abandoned-checkout recovery cron — replaces Shopify Messaging's automation
// so the email can be fully custom (api/_lib/recovery-email.js via Resend).
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

const buildEmail = require('../_lib/recovery-email.js');
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
          title quantity
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
          quantity: li.quantity,
          price: usd(parseFloat((((li.originalTotalPriceSet || {}).shopMoney) || {}).amount || '0')),
          image: ((li.image || {}).url) || null
        };
      });
      const subtotal = usd(parseFloat((((c.totalPriceSet || {}).shopMoney) || {}).amount || '0'));
      const t = {
        firstName: (c.customer || {}).firstName || '',
        items: items,
        subtotal: subtotal,
        url: c.abandonedCheckoutUrl,
        unsubUrl: SITE + '/api/unsubscribe?e=' + encodeURIComponent(email) + '&t=' + unsubToken(email)
      };

      const sr = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
        body: JSON.stringify({
          from: FROM, to: [email], reply_to: 'hello@happybeanie.com',
          subject: 'Your bean’s box is still here',
          html: buildEmail(t), text: buildEmail.text(t),
          headers: { 'List-Unsubscribe': '<' + t.unsubUrl + '>' }
        })
      });
      const sj = await sr.json().catch(function () { return {}; });
      if (sr.ok && sj.id) { sent++; report.push({ email: email, resend: sj.id }); }
      else {
        console.error('[recover-checkouts] resend:', sr.status, JSON.stringify(sj));
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
