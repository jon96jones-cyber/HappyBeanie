# Happy Beanie — branded email templates

On-brand HTML for the Shopify order + subscription notifications. These are **source
files** — they aren't served by the site; you paste each into the Shopify admin
(**Settings → Notifications → [template] → Edit code**), then **Send test** to yourself.

## The set

| File | Shopify notification | Accent | Liquid |
|------|----------------------|--------|--------|
| `order-confirmation.html` | **Order confirmation** (every order incl. 1st subscription order) | green | real, near drop-in |
| `new-subscription.html` | New subscription (contract created) | green | `[[TOKENS]]` |
| `upcoming-billing.html` | Upcoming billing / payment reminder | gold | `[[TOKENS]]` |
| `payment-failed.html` | Subscription payment failure | clay | `[[TOKENS]]` |
| `card-expiring.html` | Credit card / payment method expiring | clay | `[[TOKENS]]` |
| `paused.html` | Subscription paused | muted | `[[TOKENS]]` |
| `resumed.html` | Subscription resumed | green | `[[TOKENS]]` |
| `cancelled.html` | Subscription cancelled | muted | `[[TOKENS]]` |
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

## `[[TOKENS]]` for the subscription emails

The subscription notifications' Liquid schema isn't publicly documented, so those bits are
`[[TOKENS]]`. Replace each with the variable the **editor lists for that notification**
(names below are the usual ones — confirm and adjust). If a token has no matching variable,
delete its whole detail `<div>` box; the layout collapses cleanly.

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
