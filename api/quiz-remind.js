// /api/quiz-remind — the eligibility screener's deferral list.
//
// POST { email, reason, months, species }  → remember one address, one date
// GET  ?cancel=<email>&t=<token>           → forget it again
//
// Only two screener outcomes are deferrals: a pet under twelve months, and one
// that is pregnant or nursing. Both stop being true on their own. Every other
// block — a fish allergy, pancreatitis, a compromised liver — is permanent, and
// promising to check back on those would be a lie.
//
// We keep an address, a reason and a date. No name, no answers, no pet profile.
// One email is ever sent, and the footer of it can delete the row.
//
// Env: DATABASE_URL. CRON_SECRET (or SHOPIFY_ADMIN_TOKEN) signs the cancel link.

const db = require('./_lib/analytics-db.js');
const mailer = require('./_lib/mailer.js');

const REASONS = { age: [3, 6, 9, 12], repro: [2, 3, 6] };
const SITE = 'https://www.happybeanie.com';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

// Deliberately conservative: one @, a dot in the domain, no spaces, sane length.
function cleanEmail(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s.length < 6 || s.length > 200) return null;
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(s)) return null;
  return s;
}

// Namespaced so a cancel token is never also an unsubscribe token. Signed with
// the current secret, accepted against that and the one it replaced — someone
// who was promised a reminder months ago must still be able to call it off.
function cancelToken(email) {
  return mailer.signedToken('quiz-remind:' + email);
}
function cancelTokenValid(email, token) {
  return mailer.signedTokenValid('quiz-remind:' + email, token);
}
module.exports.cancelToken = cancelToken;
module.exports.cancelTokenValid = cancelTokenValid;

function cancelUrl(email) {
  return SITE + '/api/quiz-remind?cancel=' + encodeURIComponent(email) + '&t=' + cancelToken(email);
}
module.exports.cancelUrl = cancelUrl;

function page(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>' + title + '</title></head>' +
    '<body style="margin:0; background:#17140F; color:#F5F0E6; font-family:\'DM Sans\',-apple-system,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; text-align:center; padding:24px;">' +
    '<div style="max-width:26em;"><div style="font-weight:700; font-size:26px; letter-spacing:-0.03em; margin-bottom:12px;">' + title + '</div>' +
    '<div style="font-size:15px; line-height:1.7; color:#B9AF9C;">' + body + '</div>' +
    '<a href="' + SITE + '/" style="display:inline-block; margin-top:26px; font-family:\'DM Mono\',monospace; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; padding:13px 24px; border-radius:2px; background:#F0C64B; color:#17140F; text-decoration:none;">Back to Happy Beanie</a></div></body></html>';
}

// The table lives in the analytics database and is created by the Live desk's
// "Set up storage" button. If someone reaches this first, build it on demand
// rather than dropping the address on the floor.
async function withSchema(run) {
  try {
    return await run();
  } catch (err) {
    if (!/relation .* does not exist/i.test((err && err.message) || '')) throw err;
    await db.ensureSchema();
    return await run();
  }
}

async function handleCancel(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  const q = req.query || {};
  const email = cleanEmail(q.cancel);
  const tok = String(q.t || '');

  // Constant-time compare, against the current signing secret and the one it
  // replaced — a reminder promised months ago must stay cancellable.
  const okToken = !!email && cancelTokenValid(email, tok);
  if (!okToken) {
    return res.status(400).send(page('That link didn’t check out',
      'The link looks incomplete — try it again from your email, or reply to us and we’ll take you off by hand.'));
  }
  if (!db.isConfigured()) {
    return res.status(200).send(page('You’re off the list',
      'We won’t send you a screener reminder.'));
  }
  try {
    const sql = db.sql();
    await withSchema(() => sql`update quiz_reminders
                                  set cancelled_at = now()
                                where email = ${email} and cancelled_at is null`);
  } catch (err) {
    console.error('[quiz-remind cancel]', err && err.message);
  }
  // Same answer either way — this page must never reveal whether an address
  // was on the list.
  return res.status(200).send(page('You’re off the list',
    'Your address is gone and no screener reminder will be sent. Nothing else was stored.'));
}

module.exports = Object.assign(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET' && (req.query || {}).cancel) return handleCancel(req, res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const b = readBody(req);
  const email = cleanEmail(b.email);
  const reason = String(b.reason || '');
  const allowed = REASONS[reason];
  const months = parseInt(b.months, 10);
  const species = b.species === 'cat' ? 'cat' : b.species === 'dog' ? 'dog' : null;

  if (!email) return res.status(400).json({ ok: false, error: 'bad_email' });
  if (!allowed) return res.status(400).json({ ok: false, error: 'bad_reason' });
  if (allowed.indexOf(months) === -1) return res.status(400).json({ ok: false, error: 'bad_window' });

  if (!db.isConfigured()) {
    // No store configured. Say so rather than pretending it was saved — a
    // silent success here is exactly the bug this whole feature exists to fix.
    console.error('[quiz-remind] DATABASE_URL is not set; address discarded');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  try {
    const sql = db.sql();
    // Asking again just moves the date and revives a cancelled row.
    await withSchema(() => sql`
      insert into quiz_reminders (email, reason, species, remind_on)
      values (${email}, ${reason}, ${species},
              (current_date + make_interval(months => ${months}))::date)
      on conflict (email, reason) do update set
        remind_on    = excluded.remind_on,
        species      = coalesce(excluded.species, quiz_reminders.species),
        cancelled_at = null,
        sent_at      = null,
        attempts     = 0,
        last_error   = null`);
    return res.status(200).json({ ok: true, months: months });
  } catch (err) {
    console.error('[quiz-remind]', err && err.message);
    return res.status(502).json({ ok: false, error: 'save_failed' });
  }
}, { cancelToken: cancelToken, cancelTokenValid: cancelTokenValid, cancelUrl: cancelUrl, REASONS: REASONS });
