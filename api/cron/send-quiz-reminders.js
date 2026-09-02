// Sends the eligibility screener's deferral reminders — one email, months
// after someone was told their pet was not eligible yet, on the date they
// chose. Runs daily; a day's backlog is normally zero or a handful.
//
// A row is only ever sent once. Failures record the reason and retry on later
// runs up to MAX_ATTEMPTS, after which the row is left alone rather than
// hammering a dead address forever.
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations
// when CRON_SECRET exists — set it. Without it the endpoint refuses to run,
// so a missing secret can never leave this open to the internet.
//
// Env: DATABASE_URL, RESEND_API_KEY, CRON_SECRET.

const db = require('../_lib/analytics-db.js');
const remind = require('../quiz-remind.js');
const buildEmail = require('../_lib/quiz-reminder-email.js');
const mailer = require('../_lib/mailer.js');

const SITE = 'https://www.happybeanie.com';
const FROM = process.env.RESEND_FROM || 'Happy Beanie <hello@happybeanie.com>';
const BATCH = 50;
const MAX_ATTEMPTS = 3;

async function send(row) {
  const cancelUrl = remind.cancelUrl(row.email);
  const quizUrl = SITE + '/quiz?utm_source=email&utm_medium=lifecycle&utm_campaign=screener_reminder';
  // Through the shared mailer, so this lands on the campaign desk. The throw
  // on failure is kept — the caller counts on it to mark the row unsent and
  // retry tomorrow rather than silently dropping the reminder.
  const out = await mailer.send({
    from: FROM,
    to: row.email,
    flow: 'quiz-reminder',
    // The reason IS the step here: a blocked screener and an age-gated one are
    // different emails, and the desk should not merge them into one line.
    step: String(row.reason || '1'),
    subject: buildEmail.subject(row.reason),
    html: buildEmail({ reason: row.reason, species: row.species, quizUrl: quizUrl, cancelUrl: cancelUrl }),
    text: buildEmail.text({ reason: row.reason, species: row.species, quizUrl: quizUrl, cancelUrl: cancelUrl }),
    unsubUrl: cancelUrl
  });
  if (!out.ok) throw new Error(out.message || (out.error + ' ' + (out.status || '')));
  return out.id || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ ok: false, error: 'no_cron_secret' });
  if ((req.headers && req.headers['authorization']) !== 'Bearer ' + secret) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!db.isConfigured()) return res.status(503).json({ ok: false, error: 'no_database' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ ok: false, error: 'no_resend_key' });

  const sql = db.sql();
  let due;
  try {
    due = await sql`select id, email, reason, species
                      from quiz_reminders
                     where sent_at is null
                       and cancelled_at is null
                       and attempts < ${MAX_ATTEMPTS}
                       and remind_on <= current_date
                     order by remind_on
                     limit ${BATCH}`;
  } catch (err) {
    // No table yet simply means nobody has ever deferred. Not an error.
    if (/relation .* does not exist/i.test((err && err.message) || '')) {
      return res.status(200).json({ ok: true, due: 0, sent: 0, failed: 0 });
    }
    console.error('[send-quiz-reminders]', err && err.message);
    return res.status(502).json({ ok: false, error: 'query_failed' });
  }

  let sent = 0, failed = 0;
  for (const row of due) {
    try {
      await send(row);
      // Marked sent before anything else can go wrong below, so a crash mid
      // loop can never cause the same address to be emailed twice.
      await sql`update quiz_reminders
                   set sent_at = now(), attempts = attempts + 1, last_error = null
                 where id = ${row.id}`;
      sent++;
    } catch (err) {
      failed++;
      const msg = String((err && err.message) || 'unknown').slice(0, 300);
      console.error('[send-quiz-reminders] id=' + row.id, msg);
      await sql`update quiz_reminders
                   set attempts = attempts + 1, last_error = ${msg}
                 where id = ${row.id}`.catch(function () {});
    }
  }

  return res.status(200).json({ ok: true, due: due.length, sent: sent, failed: failed });
};
