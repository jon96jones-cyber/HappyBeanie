// POST /api/cart-note — the site parking its cart for the nudge cron.
//
// Called by the page whenever the cart changes AND the visitor's email is
// known (they subscribed here before, so the browser holds hb-email). Shopify
// cannot see this cart at all — it lives in the page and only becomes a
// Shopify object at the checkout click — so this endpoint is the only witness
// to a cart walked away from before checkout.
//
// Body: { email, dog, cat, planDog, planCat }
//   counts 0-99, plans 0-2 (one-time / subscribe / bundle).
//   dog+cat = 0 closes the row: an emptied cart is a decision, not a lapse.
//
// The endpoint stores claims; it sends nothing. Whether the address may be
// MARKETED to is decided at send time by the cron, against Shopify's consent
// record — so a forged POST for someone else's address parks a row that then
// fails the consent gate, and the 14-day cap bounds the worst case even for
// an address that has consent. See api/cron/nudge-carts.js.
//
// Env: DATABASE_URL.

const db = require('./_lib/analytics-db.js');

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function count(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(99, Math.max(0, n)) : 0;
}
function plan(v) {
  const n = parseInt(v, 10);
  return n === 1 || n === 2 ? n : 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  // Quietly a no-op without a database: parking a cart is a nicety, and the
  // page must never see an error for it.
  if (!db.isConfigured()) return res.status(200).json({ ok: true, parked: false });

  const b = readBody(req);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'bad_email' });

  const dog = count(b.dog), cat = count(b.cat);
  const planDog = plan(b.planDog), planCat = plan(b.planCat);
  const sql = db.sql();

  try {
    if (dog + cat === 0) {
      await db.withSchema(function () {
        return sql`update open_carts
                      set closed_at = now(), closed_why = 'emptied'
                    where email = ${email} and closed_at is null`;
      });
      return res.status(200).json({ ok: true, parked: false });
    }

    // A change to the cart reopens a closed row and restarts its clock —
    // adding a box back after emptying is a new cart, not the old lapse.
    await db.withSchema(function () {
      return sql`insert into open_carts (email, dog, cat, plan_dog, plan_cat)
                 values (${email}, ${dog}, ${cat}, ${planDog}, ${planCat})
                 on conflict (email) do update
                   set dog = excluded.dog, cat = excluded.cat,
                       plan_dog = excluded.plan_dog, plan_cat = excluded.plan_cat,
                       updated_at = now(), closed_at = null, closed_why = null`;
    });
    return res.status(200).json({ ok: true, parked: true });
  } catch (err) {
    console.error('[cart-note]', err && err.message);
    // Same principle: the cart page must never break over bookkeeping.
    return res.status(200).json({ ok: true, parked: false });
  }
};
