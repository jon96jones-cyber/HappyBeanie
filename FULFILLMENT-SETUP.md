# Fulfillment desk — setup guide

A live compounding-and-shipping queue for your supplier at **`/admin/fulfillment`**.
No Shopify login — they open one URL, enter a key, and see every paid order waiting
to be made and shipped. Marking one shipped records the tracking in Shopify **and**
fires the customer's branded shipping-confirmation email.

Subscription renewals appear here automatically — they're just orders.

## What the supplier sees

For each paid, unfulfilled order: order number, when it was placed, the customer,
each **line item** (name, variant, quantity, SKU, a subscription badge, and any
**personalization** captured at checkout), the **shipping address**, and any order
note. A tracking field + carrier dropdown + **"Mark shipped →"** button per order.

## One-time setup — DONE (Aug 2026)

This store runs on Shopify's new **Dev Dashboard**, which doesn't hand out static
Admin tokens. The working setup (completed):

1. The **Happy Beanie** app (client ID `69fd8f7a…`) carries the scopes, released as
   a version via `shopify app deploy` from `~/hb-app/shopify.app.toml` on Jon's Mac
   (browser can't edit versions). Scopes include `read/write_orders`,
   `read/write_customers`, `read/write_discounts`, and the four
   merchant-managed + assigned fulfillment-order scopes.
2. The permanent Admin token was minted by the one-time OAuth connect flow on the
   site itself — see `FULFILLMENT-CONNECT.md` (`/api/oauth/install` →
   approve → token shown once).
3. Vercel env vars: `SHOPIFY_ADMIN_TOKEN` (the OAuth token), `SHOPIFY_API_KEY` /
   `SHOPIFY_API_SECRET` (the app's Client ID / Secret), `FULFILLMENT_KEY`
   (the desk's gate key).

**To change scopes later:** edit the toml, rerun
`npx -y @shopify/cli@latest app deploy --allow-updates` (needs an App automation
token from the app's Settings), then re-run `/api/oauth/install` and save the new
token into `SHOPIFY_ADMIN_TOKEN`.

**To rotate desk access:** change `FULFILLMENT_KEY` in Vercel and redeploy — the
old key stops working immediately.

### 3. Hand the supplier the link + key
- URL: `https://www.happybeanie.com/admin/fulfillment`
- Key: the `FULFILLMENT_KEY` value

The key lives only in their browser tab (never in the URL or the page source). To
rotate access, change `FULFILLMENT_KEY` and redeploy — the old key stops working.

## The day-to-day flow

1. Order comes in (new purchase **or** a subscription renewal) → it appears in the queue.
2. Supplier compounds the box, ships it, enters the **tracking number + carrier**, hits
   **Mark shipped →**.
3. Shopify records the fulfillment and emails the customer the branded **Shipping
   confirmation** with a working track link. The order drops off the queue.

The page auto-refreshes every 45 seconds, so new orders surface on their own.

## Testing

1. Open `/admin/fulfillment`, enter the key → the queue loads paid, unfulfilled orders.
2. On a test order, enter a tracking number + carrier → **Mark shipped**.
3. Confirm the order shows fulfilled in Shopify admin and the shipping-confirmation
   email arrives.

> If the queue says "not configured," the env vars aren't set yet. "That key was not
> accepted" → the key doesn't match `FULFILLMENT_KEY`. Empty queue with orders present
> → the Admin token is missing the fulfillment-order scopes (step 1).

## Want instant alerts instead of watching the page?
The dashboard polls every 45s. If you'd rather the supplier get a **push/email the
moment an order lands**, we can add an `orders/create` webhook that pings them — ask
and I'll wire it in.
