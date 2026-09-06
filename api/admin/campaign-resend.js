// POST /api/admin/campaign-resend — resend a signup email, optionally to a
// corrected address.
//
// The desk sees a recipient who typo'd their own address (icloud.comc) and
// needs two things: send them their email at the address they meant, and stop
// counting the phantom. Rather than re-implementing the signup side effects,
// this drives the public /api/subscribe with the corrected address — Shopify
// consent, the one-code-per-address grant, the send itself and the desk log
// all happen exactly as if the person had typed it right the first time.
//
// Only the signup flows resend this way; sequenced campaigns (welcome, cart,
// post-purchase) belong to their crons and their timing, so they refuse.
//
// When the address was corrected, the old row leaves email_sends: it was
// never a person, and the desk counts people.
//
// Auth: x-analytics-key against ANALYTICS_KEY, like the rest of the desk.

const db = require('../_lib/analytics-db.js');

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
const RESENDABLE = { 'popup-code': 'popup', 'research-pack': 'research' };

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!db.keyOk(req, 'x-analytics-key', 'ANALYTICS_KEY')) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = readBody(req);
  const flow = String(body.flow || '');
  const source = RESENDABLE[flow];
  if (!source) return res.status(400).json({ ok: false, error: 'flow_not_resendable' });

  const oldEmail = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const target = String(body.newEmail || body.email || '').trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(target)) return res.status(400).json({ ok: false, error: 'bad_email' });

  let j = {};
  try {
    const r = await fetch('https://www.happybeanie.com/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: target, source: source })
    });
    j = await r.json().catch(function () { return {}; });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'unreachable', message: e && e.message });
  }
  if (!j.ok) return res.status(502).json({ ok: false, error: 'resend_failed', detail: j.error || null });

  const corrected = oldEmail && target !== oldEmail;
  if (corrected && db.isConfigured()) {
    try {
      const sql = db.sql();
      await db.withSchema(function () {
        return sql`delete from email_sends where email = ${oldEmail} and flow = ${flow}`;
      });
    } catch (e) {
      // The resend already happened; a lingering phantom row is a cosmetic
      // problem, not a reason to report failure.
      console.error('[campaign-resend] cleanup:', e && e.message);
    }
  }

  return res.status(200).json({
    ok: true,
    target: target,
    corrected: corrected,
    emailed: j.emailed !== false,
    why: j.why || null
  });
};
