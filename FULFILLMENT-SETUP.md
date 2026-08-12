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

## One-time setup (~5 min)

### 1. Give the Admin API token the fulfillment scopes
The desk reuses your existing `SHOPIFY_ADMIN_TOKEN` (the custom app from the wholesale
setup). Open that app in **Settings → Apps and sales channels → Develop apps →
[your app] → Configuration → Admin API scopes** and make sure these are granted:

- `read_orders`
- `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`
- `read_assigned_fulfillment_orders`, `write_assigned_fulfillment_orders`

**Save**, then re-install/update the app if prompted. (If the token can't read orders
or write fulfillments, the queue loads empty or shipping fails.)

### 2. Add the fulfillment key to Vercel
Project → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `FULFILLMENT_KEY` | any long random string (a password generator is fine) |

`SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_STORE_DOMAIN`, and `SHOPIFY_ADMIN_API_VERSION` are
already set from the wholesale setup — no change needed.

**Redeploy** so the variable takes effect.

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
