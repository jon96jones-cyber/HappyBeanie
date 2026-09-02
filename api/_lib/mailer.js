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

// Writes the attempt to email_sends, so the campaign desk can show what went
// where. Only when the caller names a flow — transactional one-offs are not
// campaigns and do not belong in that log.
//
// Swallows everything. A marketing email must not fail because a logging table
// is unreachable, and the send has already happened by the time this runs.
// Awaited rather than fired and forgotten: on a serverless runtime, work left
// pending when the response returns is killed, so an unawaited insert is a
// silently empty desk.
async function record(opts, result) {
  if (!opts || !opts.flow) return;
  try {
    const db = require('./analytics-db.js');
    if (!db.isConfigured()) return;
    const q = db.sql();
    const step = String(opts.step || '1');
    const status = result.ok ? 'sent' : 'failed';
    const err = result.ok ? null : [result.error, result.status, result.message].filter(Boolean).join(' ').slice(0, 300);
    await db.withSchema(function () {
      // One row per person per step, by the unique index. A repeat updates it
      // and bumps the counter rather than adding a row the index would reject.
      return q`insert into email_sends (email, flow, step, provider_id, status, error, subject)
               values (${String(opts.to).toLowerCase()}, ${String(opts.flow)}, ${step},
                       ${result.id || null}, ${status}, ${err}, ${String(opts.subject || '').slice(0, 300)})
               on conflict (email, flow, step) do update set
                 sent_at = now(),
                 sends = email_sends.sends + 1,
                 provider_id = excluded.provider_id,
                 status = excluded.status,
                 error = excluded.error,
                 subject = excluded.subject`;
    });
  } catch (e) {
    console.error('[mailer] could not record send:', e && e.message);
  }
}

// Marketing mail carries a campaign; transactional mail does not. Anything
// with a campaign gets tagged so Resend's own reporting can separate them.
async function send(opts) {
  const to = String((opts && opts.to) || '').trim();
  if (!to) return { ok: false, error: 'no_recipient' };
  if (!process.env.RESEND_API_KEY) {
    console.error('[mailer] RESEND_API_KEY is not set.');
    const bad = { ok: false, error: 'not_configured' };
    await record(opts, bad);
    return bad;
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
  // One-click opt-out in the client chrome. Gmail's bulk-sender rules ask for
  // the -Post header alongside the link, and its absence counts against
  // placement even below their volume threshold. api/unsubscribe.js has no
  // method check and reads only the query string, so it answers the POST that
  // this advertises exactly as it answers the click.
  if (opts.unsubUrl) {
    body.headers = {
      'List-Unsubscribe': '<' + opts.unsubUrl + '>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(function () { return {}; });
    if (res.ok && json.id) {
      const out = { ok: true, id: json.id };
      await record(opts, out);
      return out;
    }
    console.error('[mailer]', res.status, JSON.stringify(json).slice(0, 300));
    const bad = { ok: false, error: 'send_failed', status: res.status, message: (json && json.message) || null };
    await record(opts, bad);
    return bad;
  } catch (err) {
    console.error('[mailer]', err && err.message);
    const bad = { ok: false, error: 'unreachable', message: err && err.message };
    await record(opts, bad);
    return bad;
  }
}

module.exports = {
  send: send,
  unsubToken: unsubToken, unsubTokenValid: unsubTokenValid, unsubUrl: unsubUrl,
  signedToken: signedToken, signedTokenValid: signedTokenValid,
  SITE: SITE, FROM: FROM
};
