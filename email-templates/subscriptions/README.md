# Happy Beanie — branded email templates

On-brand HTML for the Shopify order + subscription notifications. These are **source
files** — they aren't served by the site; you paste each into the Shopify admin
(**Settings → Notifications → [template] → Edit code**), then **Send test** to yourself.

## The set

| File | Shopify notification | Accent | Liquid |
|------|----------------------|--------|--------|
| `order-confirmation.html` | **Order confirmation** (every order incl. 1st subscription order) | green | real, near drop-in |
| `new-subscription.html` | New subscription (contract created) | green | **wired** — real Liquid, paste as-is |
| `upcoming-billing.html` | Upcoming order / payment reminder | gold | **wired** — real Liquid, paste as-is |
| `payment-failed.html` | Subscription payment failure (after dunning; branches on `status_after_dunning`) | clay | **wired** — real Liquid, paste as-is |
| `skipped.html` | Subscription skipped | muted | **wired** — real Liquid, paste as-is |
| `card-expiring.html` | Credit card / payment method expiring | clay | `[[TOKENS]]` — NOT wired; do not install until wired from its default |
| `paused.html` | Subscription paused | muted | **wired** — real Liquid, paste as-is |
| `resumed.html` | Subscription resumed | green | **wired** — real Liquid, paste as-is |
| `cancelled.html` | Subscription cancelled | muted | **wired** — real Liquid, paste as-is |
| `shipping-confirmation.html` | **Shipping confirmation** (every shipment) | green | real Liquid |
| `order-canceled.html` | **Order canceled** | muted | real Liquid |
| `refund-notification.html` | **Refund notification** | muted | real Liquid + `[[REFUND_AMOUNT]]` |
| `shipping-update.html` | **Shipping update** | gold | real Liquid |
| `out-for-delivery.html` | **Out for delivery** | green | real Liquid |
| `delivered.html` | **Delivered** | green | real Liquid |

> Not every store has every subscription notification. If a template has no matching
> notification in your admin, just skip that file.

## How to install one

1. Shopify admin → **Settings → Notifications**.
2. Open the matching notification → **Edit code**.
3. Replace the body with the file's contents.
4. Wire any `[[TOKENS]]` (below), **Save**, then **Send test**.

## Order confirmation — no tokens

`order-confirmation.html` uses **standard Shopify order Liquid** (`customer.first_name`,
a `subtotal_line_items` loop, `subtotal_price` / `shipping_price` / `total_price`,
`shipping_address`, and `line.selling_plan_allocation.selling_plan.name` for the plan).
It should render as-is. The only thing to verify on **Send test**: that the selling-plan
line shows for subscription items — if your Shopify version exposes that under a different
field, tell me the name and I'll adjust.

## Wired subscription templates

The subscription templates marked **wired** carry real Liquid taken from Shopify's own
default templates (pasted from the admin on 2026-09-06), so they install as-is: paste,
Save, **Send test**. The schema is the `subscription_contract_billing_cycle` object
(line_items, total_price, billing_frequency, product_names, shipping/billing_address,
payment_instrument, customer_self_serve_url, update_payment_method_url; dates are
`billing_attempt_expected_date` on upcoming/skipped and `next_billing_date` on
resumed/skipped — the names differ per notification, don't guess). Anything the defaults
didn't prove sits behind an `if`-guard with a clean fallback, so a missing value collapses
its box instead of printing broken text.

**Never install a template that still contains `[[TOKENS]]`** — Shopify sends the
brackets literally (this happened once, on upcoming-billing). Wire it from that
notification's default first. Remaining: `card-expiring.html` and the
`[[REFUND_AMOUNT]]` in `refund-notification.html`.

Legacy token mapping, kept for the unwired files:

| Token | Typical Liquid | Used in |
|-------|----------------|---------|
| `[[FIRST_NAME]]` | `{{ customer.first_name \| default: "friend" }}` | new-sub, resumed |
| `[[PRODUCT_NAME]]` | subscription line / product title | most |
| `[[PRICE]]` / `[[AMOUNT]]` | price, money-filtered (`\| money`) | new-sub, upcoming, payment-failed |
| `[[DELIVERY_INTERVAL]]` | e.g. "Every month" | new-sub |
| `[[SAVINGS]]` | per-box discount (`\| money`) | new-sub |
| `[[NEXT_BILLING_DATE]]` | next billing date (`\| date: "%b %-d, %Y"`) | new-sub, resumed |
| `[[CHARGE_DATE]]` | upcoming charge date | upcoming-billing |
| `[[SHIPPING_ADDRESS]]` | one-line shipping address | new-sub |
| `[[CARD_BRAND]]` / `[[CARD_LAST4]]` | card brand + last 4 | payment-failed, card-expiring |
| `[[CARD_EXPIRY]]` | card expiry (MM/YY) | card-expiring |
| `[[REFUND_AMOUNT]]` | `{{ amount \| money }}` (refund notification) | refund |

**Shipping confirmation** uses `fulfillment.fulfillment_line_items` (each with `.line_item`
and `.quantity`), `fulfillment.tracking_company` / `tracking_number` / `tracking_url`, and
`order_status_url` as the track-button fallback. On Send test, confirm the item list +
tracking block render; if your Shopify version names the fulfillment line items differently,
tell me and I'll adjust.

## Notes

- **Fonts:** DM Sans/DM Mono where the client supports web fonts (Apple/iOS Mail), clean
  fallback to Helvetica/Arial elsewhere (Gmail, Outlook). Layout + colour are identical.
- **Semantic accent:** green = confirmed/positive, gold = neutral heads-up, clay = a problem
  to fix, muted = paused/ended. The gold top-rule is the brand constant; problem emails use a
  clay rule + clay "Update payment/card" button.
- **All CTAs** point to `https://www.happybeanie.com/account` (silent-SSO / email pre-fill
  signs the customer straight in).
- Tables + inline styles for Gmail/Outlook; `border-radius` degrades to square in Outlook (fine).
