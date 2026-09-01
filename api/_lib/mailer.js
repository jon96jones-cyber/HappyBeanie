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

// Every key a live link could have been signed with, newest first.
//
// The signing key used to be "CRON_SECRET, or SHOPIFY_ADMIN_TOKEN if that is
// unset". That made setting CRON_SECRET for the first time a silent one-way
// door: every unsubscribe link already in an inbox would stop validating, and
// the person clicking it would be told their link was broken. An opt-out link
// is the one link that must never fail.
//
// So signing uses the first entry and verification accepts any of them. Old
// links keep working, new links use the new key, and the secret is rotatable.
function secrets() {
  const out = [];
  if (process.env.CRON_SECRET) out.push(process.env.CRON_SECRET);
  if (process.env.SHOPIFY_ADMIN_TOKEN) out.push(process.env.SHOPIFY_ADMIN_TOKEN);
  return out.length ? out.filter((s, i) => out.indexOf(s) === i) : [''];
}

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
}

// Compared through a digest so neither length nor content differences leak.
function sameToken(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// The signature over an address, unchanged in shape from the scheme the
// recovery emails have been using — email-only, no purpose mixed in.
function unsubToken(email) {
  return sign(secrets()[0], String(email).toLowerCase());
}

function unsubTokenValid(email, token) {
  const addr = String(email).toLowerCase();
  return secrets().some(function (s) { return sameToken(sign(s, addr), token); });
}

// The same two-key treatment for any other signed link. The payload is
// namespaced by the caller, so a token for one purpose is not one for another.
function signedToken(payload) { return sign(secrets()[0], payload); }
function signedTokenValid(payload, token) {
  return secrets().some(function (s) { return sameToken(sign(s, payload), token); });
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

module.exports = {
  send: send,
  unsubToken: unsubToken, unsubTokenValid: unsubTokenValid, unsubUrl: unsubUrl,
  signedToken: signedToken, signedTokenValid: signedTokenValid,
  SITE: SITE, FROM: FROM
};
