# Happy Beanie — subscription email templates

On-brand HTML for the Shopify subscription notifications. These are **source files** —
they're not served by the site; you paste each into the Shopify admin.

## The set

| # | Email | Accent | Status |
|---|-------|--------|--------|
| 1 | New subscription | gold | ✅ `new-subscription.html` |
| 2 | Upcoming billing reminder | gold | ⏳ to build |
| 3 | Payment failed | clay | ⏳ to build |
| 4 | Card expiring | clay | ⏳ to build |
| 5 | Subscription paused | muted | ⏳ to build |
| 6 | Subscription resumed | green | ⏳ to build |
| 7 | Subscription cancelled | muted | ⏳ to build |

Build order: #1 is done as the proving template. Install + send a test first; once it
renders and the variables resolve, the other six drop in from the same shell.

## How to install one

1. Shopify admin → **Settings → Notifications**.
2. Open the matching subscription notification (e.g. **New subscription**).
3. Click **Edit code** (or **Edit</> **).
4. Replace the body with the file's contents.
5. Wire the `[[TOKENS]]` (below), **Save**, then **Send test** to yourself.

## Token → Liquid mapping

The static design is final. Only the `[[TOKENS]]` are dynamic — swap each for the Liquid
variable the template exposes. Shopify's editor shows the available variables for that
specific notification; the names below are the usual ones, but **confirm against what your
editor offers** and adjust if different.

| Token | Typical Liquid | Notes |
|-------|----------------|-------|
| `[[FIRST_NAME]]` | `{{ customer.first_name | default: "friend" }}` | falls back gracefully |
| `[[PRODUCT_NAME]]` | first line item's title | may be a `{% for line in ... %}` loop if multiple |
| `[[PRICE]]` | line/subscription price, money-filtered | e.g. `{{ price | money }}` |
| `[[DELIVERY_INTERVAL]]` | e.g. "Every month" | from the delivery policy |
| `[[SAVINGS]]` | the per-box discount, money-filtered | omit the box if not exposed |
| `[[NEXT_BILLING_DATE]]` | next billing/anchor date | `{{ ... | date: "%b %-d, %Y" }}` |
| `[[SHIPPING_ADDRESS]]` | shipping address, one line | |

> If a token's data isn't available in a given notification, delete that whole detail
> `<div>` box — the layout collapses cleanly.

## Notes
- **Fonts:** DM Sans/DM Mono render in clients that support web fonts (Apple/iOS Mail) and
  fall back to Helvetica/Arial elsewhere — standard email behaviour. Layout/colour are
  identical everywhere.
- **Manage link** points at `https://www.happybeanie.com/account`, which silent-SSO / the
  email pre-fill will sign the customer into.
- Tables + inline styles throughout for Gmail/Outlook compatibility; `border-radius`
  degrades to square corners in Outlook (acceptable).
