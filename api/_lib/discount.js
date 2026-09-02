// Mints a discount code that belongs to exactly one subscriber and dies when
// they use it.
//
// The popup used to hand everyone the same BEAN10. A shared code leaks — it
// ends up on a coupon site within weeks, and from then on anyone gets 10% off
// forever. "One use per customer" does not fix that; it only stops each
// stranger using it twice. A code that is unique to one address and capped at a
// single redemption is worthless the moment it is posted anywhere.
//
// SHAPE: one Shopify discount per code, rather than one discount carrying many
// redeem codes. The bulk-code route is tidier in the admin, but Shopify's
// usageLimit is documented as a limit on "the discount", and whether that means
// per-code or across every code of a multi-code discount decides whether this
// works at all — get it wrong one way and every code is reusable forever, get
// it wrong the other and the first redemption kills the campaign for everyone.
// One code per discount makes usageLimit:1 mean exactly one thing. The cost is
// a row per subscriber in the Discounts list, which is a real but recoverable
// annoyance; the alternative failure modes are neither.
//
// Env:
//   SHOPIFY_ADMIN_TOKEN        required
//   POPUP_DISCOUNT_PCT         default 0.10
//   POPUP_CODE_DAYS            default 90 — must outlast the batch it is meant
//                              for, or people take the offer and cannot use it
//   POPUP_CODE_PREFIX          default BEAN10

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';

const PCT = Math.min(1, Math.max(0, Number(process.env.POPUP_DISCOUNT_PCT || 0.10)));
const DAYS = Math.max(1, parseInt(process.env.POPUP_CODE_DAYS || '90', 10) || 90);
const PREFIX = String(process.env.POPUP_CODE_PREFIX || 'BEAN10').toUpperCase().replace(/[^A-Z0-9]/g, '');

// No 0/O/1/I/L/5/S. These get read off a screen and typed into a checkout by
// hand, and a code that is only wrong because of the font is a support email.
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';

const CREATE = `
mutation NewCode($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode { id }
    userErrors { field message }
  }
}`;

function randomCode() {
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return PREFIX + '-' + out;
}

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { ok: res.ok, status: res.status, json: json };
}

function expiresAt() {
  return new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000);
}

// Human form of the expiry, for the email and the popup: "2 December 2026".
function expiryLabel(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Returns { ok, code, expires, expiresLabel } or { ok:false, error }.
// Never throws: a subscriber whose code could not be minted must still end up
// on the list, because the address is the thing we cannot get back.
async function mint(email) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return { ok: false, error: 'not_configured' };

  const ends = expiresAt();
  const code = randomCode();
  const input = {
    title: 'Popup ' + Math.round(PCT * 100) + '% — ' + String(email || '').slice(0, 120),
    code: code,
    startsAt: new Date().toISOString(),
    endsAt: ends.toISOString(),
    customerSelection: { all: true },
    // One redemption, total, for this discount — and this discount has exactly
    // one code. appliesOncePerCustomer is belt and braces for the window where
    // two carts are in flight at once.
    usageLimit: 1,
    appliesOncePerCustomer: true,
    customerGets: {
      value: { percentage: PCT },
      items: { all: true }
    },
    // Must not stack with an ambassador or wholesale code. Those are already
    // margin the store has given away, and 10% on top of them was never the
    // offer. Shipping is left combinable because it is not a price discount.
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true }
  };

  try {
    const r = await admin(token, CREATE, { basicCodeDiscount: input });
    const node = r.json && r.json.data && r.json.data.discountCodeBasicCreate;
    const errs = (node && node.userErrors) || [];
    if (errs.length) {
      console.error('[discount] userErrors:', JSON.stringify(errs).slice(0, 300));
      return { ok: false, error: 'rejected', message: errs[0].message };
    }
    if (!node || !node.codeDiscountNode) {
      console.error('[discount] no node:', JSON.stringify(r.json).slice(0, 300));
      return { ok: false, error: 'upstream', status: r.status };
    }
    return { ok: true, code: code, expires: ends.toISOString(), expiresLabel: expiryLabel(ends) };
  } catch (err) {
    console.error('[discount]', err && err.message);
    return { ok: false, error: 'unreachable' };
  }
}

module.exports = { mint: mint, expiryLabel: expiryLabel, PCT: PCT, DAYS: DAYS, PREFIX: PREFIX };
