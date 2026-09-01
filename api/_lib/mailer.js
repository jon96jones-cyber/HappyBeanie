// One place that talks to Resend.
//
// The recovery cron and the screener-reminder cron each hand-rolled this — the
// fetch, the List-Unsubscribe header, the error shape. A third flow would have
// been a third copy, so it lives here now.
//
// Callers own their own retry and their own record of what was sent. This
// sends once and reports honestly what happened; it never throws for a send
// failure, because a marketing email failing must not take a cron down.
//
// Env: RESEND_API_KEY. Optional RESEND_FROM.

const crypto = require('crypto');

const SITE = 'https://www.happybeanie.com';
const FROM = process.env.RESEND_FROM || 'Happy Beanie <hello@happybeanie.com>';
const REPLY_TO = 'hello@happybeanie.com';

// The signature over an address, unchanged from the scheme the recovery emails
// have been using — every unsubscribe link already in someone's inbox must
// keep working, so this stays email-only with no purpose mixed in.
function unsubToken(email) {
  const secret = process.env.CRON_SECRET || process.env.SHOPIFY_ADMIN_TOKEN || '';
  return crypto.createHmac('sha256', secret).update(String(email).toLowerCase()).digest('hex').slice(0, 32);
}

// purpose picks which list the opt-out applies to. Left off, the endpoint
// treats it as cart recovery, which is what the old links mean.
function unsubUrl(email, purpose) {
  return SITE + '/api/unsubscribe?e=' + encodeURIComponent(email) +
    '&t=' + unsubToken(email) + (purpose ? '&p=' + encodeURIComponent(purpose) : '');
}

// Marketing mail carries a campaign; transactional mail does not. Anything
// with a campaign gets tagged so Resend's own reporting can separate them.
async function send(opts) {
  const to = String((opts && opts.to) || '').trim();
  if (!to) return { ok: false, error: 'no_recipient' };
  if (!process.env.RESEND_API_KEY) {
    console.error('[mailer] RESEND_API_KEY is not set.');
    return { ok: false, error: 'not_configured' };
  }

  const body = {
    from: opts.from || FROM,
    to: [to],
    reply_to: opts.replyTo || REPLY_TO,
    subject: opts.subject,
    html: opts.html
  };
  if (opts.text) body.text = opts.text;
  // One-click opt-out in the client chrome, not only in the footer. Gmail and
  // Apple Mail surface this, and its absence is itself a spam signal.
  if (opts.unsubUrl) body.headers = { 'List-Unsubscribe': '<' + opts.unsubUrl + '>' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(function () { return {}; });
    if (res.ok && json.id) return { ok: true, id: json.id };
    console.error('[mailer]', res.status, JSON.stringify(json).slice(0, 300));
    return { ok: false, error: 'send_failed', status: res.status, message: (json && json.message) || null };
  } catch (err) {
    console.error('[mailer]', err && err.message);
    return { ok: false, error: 'unreachable', message: err && err.message };
  }
}

module.exports = { send: send, unsubToken: unsubToken, unsubUrl: unsubUrl, SITE: SITE, FROM: FROM };
