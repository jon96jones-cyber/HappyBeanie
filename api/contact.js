// POST /api/contact — the contact page's form.
//
// The form used to wait 900ms, invent a ticket number and show the "sent"
// card without sending anything. Messages land in the hello@ inbox now,
// with reply-to set to the sender so answering is one Reply click. The
// from stays our own verified address — Resend will not send as an
// arbitrary visitor address, and reply-to is the honest place for it.
//
// The ticket number is minted here and put in the subject, so a reply from
// the inbox and the card the visitor saw carry the same reference. It is a
// reference, not a lookup key: nothing is stored.
//
// Transactional one-off: no flow name, so the mailer keeps it out of the
// campaign desk's send log.

const crypto = require('crypto');
const mailer = require('./_lib/mailer.js');

const TO = 'hello@happybeanie.com';
const TOPICS = ['Dosing help', 'Look up a lot', 'Order issue', 'Vet or clinic', 'Wholesale'];
const VET = 3;

// Same deliberately loose shape the subscribe endpoint uses.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

// Everything below is visitor-typed text headed into an HTML email read by
// a person with an inbox; escape everything interpolated.
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function ticket(vet) {
  return (vet ? 'VET-' : 'HB-') + (2000 + crypto.randomInt(8000));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = readBody(req);
  // Honeypot: bots fill hidden fields. Pretend success, send nothing.
  if (clean(body.hb_extra, 200)) return res.status(200).json({ ok: true, ticket: ticket(false) });

  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const message = clean(body.message, 4000);
  const topicIdx = TOPICS.indexOf(clean(body.topic, 40));
  const topic = topicIdx === -1 ? 'General' : TOPICS[topicIdx];
  const vet = topicIdx === VET;
  const clinic = vet ? clean(body.clinic, 200) : '';
  const license = vet ? clean(body.license, 60) : '';
  const page = clean(body.page, 120);

  if (name.length < 2) return res.status(400).json({ ok: false, error: 'bad_name' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'bad_email' });
  if (message.length < 5) return res.status(400).json({ ok: false, error: 'bad_message' });

  const ref = ticket(vet);
  const facts = [
    ['From', name + ' <' + email + '>'],
    ['Topic', topic],
    clinic ? ['Practice', clinic] : null,
    license ? ['License', license] : null,
    page ? ['Sent from', page] : null
  ].filter(Boolean);

  const html =
    '<div style="font-family: sans-serif; font-size: 15px; line-height: 1.6; color: #17140F;">' +
    '<p style="margin: 0 0 4px;"><b>New message from the contact page</b> · ' + esc(ref) + '</p>' +
    '<table style="border-collapse: collapse; margin: 0 0 16px; font-size: 13px; color: #6A6055;">' +
    facts.map(function (f) {
      return '<tr><td style="padding: 2px 14px 2px 0; white-space: nowrap;">' + esc(f[0]) + '</td><td style="padding: 2px 0; color: #17140F;">' + esc(f[1]) + '</td></tr>';
    }).join('') +
    '</table>' +
    '<blockquote style="margin: 0; padding: 12px 16px; border-left: 3px solid #E0C64B; background: #FCFAF4; white-space: pre-wrap;">' +
    esc(message) + '</blockquote>' +
    '<p style="margin: 16px 0 0; color: #6A6055; font-size: 13px;">Reply to this email to answer them directly.</p>' +
    '</div>';

  const text = 'New message from the contact page · ' + ref + '\n' +
    facts.map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') +
    '\n\n' + message + '\n\nReply to this email to answer them directly.';

  const sent = await mailer.send({
    to: TO,
    replyTo: email,
    subject: '[' + topic + '] ' + name + ' · ' + ref,
    html: html,
    text: text
  });

  if (!sent.ok) {
    // not_configured means the env is missing, everything else is Resend
    // having a moment; either way the visitor deserves the retry message,
    // not a fake success.
    return res.status(sent.error === 'not_configured' ? 503 : 502)
      .json({ ok: false, error: sent.error || 'send_failed' });
  }
  return res.status(200).json({ ok: true, ticket: ref });
};
