// POST /api/faq-ask — the FAQ carousel's "Ask us directly" form.
//
// The form told people "a pharmacist reads every one of these" and then
// dropped the question on the floor: it dispatched an hb:faq-ask event that
// nothing listened to. Questions land in the hello@ inbox now, with reply-to
// set to the asker so answering is one Reply click. The from stays our own
// verified address — Resend will not send as an arbitrary visitor address,
// and reply-to is the honest place for it anyway.
//
// Transactional one-off: no flow name, so the mailer keeps it out of the
// campaign desk's send log.

const mailer = require('./_lib/mailer.js');

const TO = 'hello@happybeanie.com';

// Same deliberately loose shape the subscribe endpoint uses.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

// Question and page are visitor-typed text headed into an HTML email read by
// a person with an inbox; escape everything interpolated.
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = readBody(req);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const question = String(body.question || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const page = String(body.page || '').slice(0, 120);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'bad_email' });
  if (question.length < 4) return res.status(400).json({ ok: false, error: 'bad_question' });

  const html =
    '<div style="font-family: sans-serif; font-size: 15px; line-height: 1.6; color: #17140F;">' +
    '<p style="margin: 0 0 4px;"><b>New question from the site FAQ</b></p>' +
    '<p style="margin: 0 0 16px; color: #6A6055; font-size: 13px;">From ' + esc(email) +
    (page ? ' · asked on ' + esc(page) : '') + '</p>' +
    '<blockquote style="margin: 0; padding: 12px 16px; border-left: 3px solid #E0C64B; background: #FCFAF4;">' +
    esc(question) + '</blockquote>' +
    '<p style="margin: 16px 0 0; color: #6A6055; font-size: 13px;">Reply to this email to answer them directly.</p>' +
    '</div>';

  const sent = await mailer.send({
    to: TO,
    replyTo: email,
    subject: 'New question from the site FAQ',
    html: html,
    text: 'New question from the site FAQ\nFrom: ' + email + (page ? '\nPage: ' + page : '') +
      '\n\n' + question + '\n\nReply to this email to answer them directly.'
  });

  if (!sent.ok) {
    // not_configured means the env is missing, everything else is Resend
    // having a moment; either way the visitor deserves the retry message,
    // not a fake success.
    return res.status(sent.error === 'not_configured' ? 503 : 502)
      .json({ ok: false, error: sent.error || 'send_failed' });
  }
  return res.status(200).json({ ok: true });
};
