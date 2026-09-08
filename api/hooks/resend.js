// POST /api/hooks/resend — Resend's delivery and engagement events.
//
// Every send already writes a row to email_sends carrying Resend's own message
// id in provider_id (see api/_lib/mailer.js). This endpoint is the return
// path: Resend posts what happened to the message afterwards, and we stamp the
// row it belongs to.
//
// A word on what "opened" is worth, because the campaign desk shows it and it
// is the number most likely to be misread. Apple Mail Privacy Protection
// fetches every remote image the moment a message arrives on the device,
// whether or not a person ever looks at it. Those fetches are indistinguishable
// from a real open, so the open rate is partly a measure of how many recipients
// use Apple Mail. Gmail proxies images through its own cache, which registers
// too. A click is a person; an open is a hint.
//
// Bounces and complaints are the events that actually protect the sending
// domain, which is why they are recorded with the same care.
//
// Auth: Svix signature over the raw body, against RESEND_WEBHOOK_SECRET. The
// endpoint is public, so an unsigned or badly signed request must be rejected
// before it can touch the log — otherwise anyone who guesses a message id can
// invent engagement.
//
// Env: DATABASE_URL, RESEND_WEBHOOK_SECRET (the whsec_... from Resend).

const crypto = require('crypto');
const db = require('../_lib/analytics-db.js');

// Vercel parses JSON before the handler sees it, which destroys the exact bytes
// the signature covers — re-serialising a parsed object does not reproduce them,
// so the parser is turned off for this route (see the config export at the
// bottom) and the stream is read directly. The string and Buffer branches are
// there because a runtime that hands the body over already read is not an error.
function rawBody(req) {
  return new Promise(function (resolve, reject) {
    if (typeof req.body === 'string') return resolve(req.body);
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function timingEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// Svix signs "<id>.<timestamp>.<body>" with the base64 secret that follows
// the whsec_ prefix. svix-signature carries a space-separated list so a secret
// can be rotated without dropping events; any one match is enough.
function signatureOk(secret, headers, body) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigs = String(headers['svix-signature'] || '').split(' ').filter(Boolean);
  if (!id || !ts || !sigs.length) return false;

  // A signature stays valid forever without this, so a captured request could
  // be replayed indefinitely.
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(ts, 10));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key)
    .update(id + '.' + ts + '.' + body).digest('base64');
  return sigs.some(function (s) {
    const part = s.indexOf(',') > -1 ? s.slice(s.indexOf(',') + 1) : s;
    return timingEqual(part, expected);
  });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[resend-hook] RESEND_WEBHOOK_SECRET is not set.');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  let raw;
  try {
    raw = await rawBody(req);
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'unreadable' });
  }
  if (!signatureOk(secret, req.headers || {}, raw)) {
    return res.status(401).json({ ok: false, error: 'bad_signature' });
  }

  let evt;
  try { evt = JSON.parse(raw); } catch (e) { return res.status(400).json({ ok: false, error: 'bad_json' }); }

  const type = String((evt && evt.type) || '');
  const id = String((evt && evt.data && evt.data.email_id) || '');
  // Resend retries anything that is not 2xx. An event for a message we have no
  // row for — a transactional send, or one from before this table — is not a
  // failure, so it is accepted and dropped rather than retried forever.
  if (!id) return res.status(200).json({ ok: true, ignored: 'no_email_id' });
  if (!db.isConfigured()) return res.status(200).json({ ok: true, ignored: 'no_db' });

  try {
    const sql = db.sql();
    let updated = 0;

    // Counts use coalesce(...) + 1 rather than a bare increment so an event
    // arriving before the column has a value still lands on 1.
    await db.withSchema(async function () {
      let rows = [];
      if (type === 'email.delivered') {
        rows = await sql`update email_sends set delivered_at = coalesce(delivered_at, now())
                         where provider_id = ${id} returning id`;
      } else if (type === 'email.opened') {
        rows = await sql`update email_sends
                            set opened_at  = coalesce(opened_at, now()),
                                open_count = coalesce(open_count, 0) + 1
                         where provider_id = ${id} returning id`;
      } else if (type === 'email.clicked') {
        // A click implies an open even when the open pixel never loaded, which
        // is the common case for anyone blocking remote images.
        rows = await sql`update email_sends
                            set clicked_at  = coalesce(clicked_at, now()),
                                click_count = coalesce(click_count, 0) + 1,
                                opened_at   = coalesce(opened_at, now())
                         where provider_id = ${id} returning id`;
      } else if (type === 'email.bounced') {
        rows = await sql`update email_sends
                            set bounced_at = coalesce(bounced_at, now()), status = 'bounced'
                         where provider_id = ${id} returning id`;
      } else if (type === 'email.complained') {
        rows = await sql`update email_sends
                            set complained_at = coalesce(complained_at, now()), status = 'complained'
                         where provider_id = ${id} returning id`;
      }
      updated = rows.length;
    });

    return res.status(200).json({ ok: true, type: type, matched: updated });
  } catch (err) {
    // A 500 makes Resend retry, which is what we want for a transient database
    // problem — the event is not lost.
    console.error('[resend-hook]', type, err && err.message);
    return res.status(500).json({ ok: false, error: 'store_failed' });
  }
};

module.exports = handler;
// Without this Vercel's Node runtime parses application/json into req.body and
// consumes the stream, leaving nothing to verify the Svix signature against.
module.exports.config = { api: { bodyParser: false } };
