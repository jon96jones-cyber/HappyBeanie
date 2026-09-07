// Happy Beanie order numbers — HB-385443 and up.
//
// Shopify's order counter is its own: it starts at 1001, increments by one,
// and nothing in the Admin API or the admin UI can move it. Customising the
// prefix is a Plus feature and this store is on Basic, so `orderNumberFormatPrefix`
// stays "#" whatever we do.
//
// So the HB series is a presentation of Shopify's, not a replacement for it.
// One offset does the whole job, and because Shopify still counts by one, so
// does the HB number:
//
//   #1004  ->  HB-385442     the last order placed before the switch
//   #1005  ->  HB-385443     the first order to carry an HB number
//
// Shopify's own surfaces — the admin, packing slips, its order-status page —
// keep saying #1005. Anything we render ourselves says HB-385443. When you are
// looking up a customer's order in the Shopify admin, subtract the offset.
//
// Old links still work: an order number below the offset cannot be an HB
// number, so it is read as a raw Shopify number. Customers holding a
// confirmation email that says #1004 are not locked out.

const PREFIX = 'HB-';
const OFFSET = 384438;

// Digits only, so "HB-385442", "hb 385442" and "385442" all land the same way.
function digits(input) {
  return String(input == null ? '' : input).replace(/[^0-9]/g, '');
}

// What the customer types -> the number Shopify knows the order by.
// Returns null when there is nothing usable in the input.
function toShopify(input) {
  const n = parseInt(digits(input), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Above the offset it is an HB number; below it, a raw Shopify number from
  // before the switch. The two ranges cannot overlap.
  return n > OFFSET ? n - OFFSET : n;
}

// The Shopify order name (#1005, or 1005) -> what we show a customer.
function toDisplay(shopifyName) {
  const n = parseInt(digits(shopifyName), 10);
  if (!Number.isFinite(n) || n <= 0) return String(shopifyName || '');
  return PREFIX + (n + OFFSET);
}

module.exports = { PREFIX, OFFSET, digits, toShopify, toDisplay };
