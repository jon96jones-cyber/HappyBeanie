# Wholesale accounts — setup guide

This adds two things to the Happy Beanie site:

1. **Retail customer accounts** — "Account" links in the header, mobile menu, and footer
   that open your existing Shopify customer portal
   (`https://shopify.com/61033185344/account`). Customers sign in with an emailed code and
   get order history, shipment tracking, subscription management, and reorder — all hosted
   and kept in sync by Shopify. **Nothing to configure; this works as soon as the site deploys.**

2. **Wholesale (trade) accounts** — a branded application page at `/wholesale` that creates a
   `wholesale-pending` customer in Shopify with the applicant's business details. You approve
   in your admin, and approved customers get trade pricing automatically at checkout.

The wholesale intake needs **three one-time setup steps** that only you can do (they require
access to your Shopify admin and Vercel project). ~10 minutes total.

---

## Step 1 — Create a Shopify Admin API token

The `/api/wholesale-apply` function needs permission to create customers.

1. In your Shopify admin, go to **Settings → Apps and sales channels → Develop apps**.
2. Click **Allow custom app development** if prompted, then **Create an app**.
   Name it something like `Wholesale Intake`.
3. Open the app → **Configuration → Admin API integration → Configure**, and grant these scopes:
   - `write_customers`
   - `read_customers`
4. **Save**, then go to the **API credentials** tab and click **Install app**.
5. Reveal and copy the **Admin API access token** (it starts with `shpat_`).
   You'll only see it once — copy it now.

> This token is stored server-side in Vercel and is **never** exposed to the browser.

---

## Step 2 — Add the token to Vercel

1. In your Vercel dashboard, open this project → **Settings → Environment Variables**.
2. Add a variable:
   - **Name:** `SHOPIFY_ADMIN_TOKEN`
   - **Value:** the `shpat_…` token from Step 1
   - **Environments:** Production (and Preview, if you want it working on staging too)
3. Save, then **redeploy** (Deployments → latest → ⋯ → Redeploy) so the new variable takes effect.

Optional overrides (defaults are already correct for this store, so you usually don't need these):

| Variable | Default |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | `pxv2u2-kc.myshopify.com` |
| `SHOPIFY_ADMIN_API_VERSION` | `2025-07` |

Until `SHOPIFY_ADMIN_TOKEN` is set, the form shows a friendly "not configured yet" message
instead of failing silently.

---

## Step 3 — Wholesale pricing ✅ already configured

This is already set up on the store, so there's nothing to do here — it's documented for reference.

- **Customer segment:** `Wholesale accounts` — filter `customer_tags CONTAINS 'wholesale'`.
- **Automatic discount:** `Wholesale — 30% off (5+ boxes)`
  - 30% off all products, applied automatically at checkout
  - Eligibility: the `Wholesale accounts` segment only
  - Minimum: 5+ items in the cart (below 5, the customer pays retail)
  - One-time purchases only; does not combine with other product/order discounts

Anyone tagged `wholesale` sees trade pricing automatically once they have 5+ boxes in the cart;
everyone else pays retail.

**To change the rate or minimum:** Shopify admin → **Discounts** → open
*Wholesale — 30% off (5+ boxes)* → edit the value or the minimum-quantity requirement.

> A previous `WHOLESALE40` code discount was deactivated so it can't undercut these terms.
> Prefer a shareable code instead of automatic pricing? Create a **code** discount limited to
> the `Wholesale accounts` segment and email it to approved accounts.

---

## The approval workflow (your day-to-day)

When someone applies at `/wholesale`, a customer appears in **Customers** tagged
`wholesale-pending`, with all their business details in the customer **Notes** and in
`wholesale.*` **metafields** (company, business type, monthly volume, phone, tax ID, etc.).

To **approve**:
1. Open the customer, review their details.
2. **Remove** the `wholesale-pending` tag and **add** the `wholesale` tag.
3. (Optional) email them a welcome note — they can now sign in at the account portal and will
   get trade pricing automatically on their next order.

To **decline**: remove `wholesale-pending` (optionally add `wholesale-declined`) and, if you like,
send a quick email. No pricing is ever applied to a declined account.

> Tip: filter your Customers list by the `wholesale-pending` tag to see your review queue.

---

## Testing it end to end

1. Visit `/wholesale` on the deployed site and submit the form with test details.
2. You should see the "Application received" confirmation.
3. In Shopify admin → **Customers**, confirm a new customer exists tagged `wholesale-pending`
   with your test details in the notes.
4. Add the `wholesale` tag to that customer, then place a test order signed in as them to confirm
   the automatic discount applies.

If the form returns an error, check the Vercel **Deployment → Functions logs** for
`/api/wholesale-apply` — the most common cause is a missing or mis-scoped `SHOPIFY_ADMIN_TOKEN`.
