# Custom account portal — setup guide

The site now has a fully custom-designed customer portal at **`/account`** — sign-in,
order history with live tracking, subscription status, addresses, and wholesale account
status — all in the Happy Beanie design. Shopify remains the backend: the portal reads
everything through the **Customer Account API**, so orders, tracking, and subscriptions
are always in sync with your admin.

How it works: "Sign in with email" sends the customer through Shopify's secure
passwordless step (email + 6-digit code — this one screen is Shopify-hosted and can be
branded in your admin), then straight back to `/account` where everything they see is
your design. Tokens are held in an encrypted, httpOnly cookie and never touch browser
JavaScript; all API calls are proxied server-side.

**Preview the dashboard design without signing in:** open `/account?demo=1`.

The portal needs a one-time credential setup (~5 minutes) that only you can do.

---

## Step 1 — Get Customer Account API credentials

1. In Shopify admin, go to **Sales channels → Headless** and open your storefront.
   (You already have this channel — it powers the site's checkout.)
2. Open **Customer Account API settings**.
3. Set the client type to **Confidential**.
4. From **Credentials**, copy the **Client ID** and **Client secret**.
5. Under **Application setup**, add:
   - **Callback URI:** `https://www.happybeanie.com/api/auth/callback`
   - **JavaScript origin:** `https://www.happybeanie.com`
   - **Logout URI:** `https://www.happybeanie.com/account`

## Step 2 — Add the credentials to Vercel

In Vercel → project **happy-beanie** → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `SHOPIFY_CUSTOMER_CLIENT_ID` | Client ID from Step 1 |
| `SHOPIFY_CUSTOMER_CLIENT_SECRET` | Client secret from Step 1 |
| `COOKIE_SECRET` | Any long random string (32+ characters — a password generator is fine) |

Optional overrides (defaults already correct): `SHOPIFY_STORE_DOMAIN`
(`pxv2u2-kc.myshopify.com`), `SHOPIFY_SHOP_ID` (`61033185344`),
`SHOPIFY_CUSTOMER_REDIRECT_URI`.

Then **redeploy** so the variables take effect.

## Step 3 — Brand the one Shopify-hosted screen

Shopify admin → **Settings → Customer accounts** — upload your logo and set brand
colors so the email/code screen matches the site.

---

## Until setup is done

The portal page renders fine, but "Sign in with email" returns to `/account` with a
friendly "portal isn't connected yet" message. Nothing breaks.

## Behavior notes

- **Sign-up = first sign-in.** A new customer entering their email + code gets an
  account automatically; no separate registration form is needed.
- **Wholesale:** customers tagged `wholesale` see a gold "Wholesale account — 30% off
  on 5+ boxes" badge; `wholesale-pending` shows "application under review".
- **Sign out** clears the portal session and also ends the Shopify SSO session.
- Order tracking numbers/links appear as soon as fulfillments have tracking info.

## Troubleshooting

- Sign-in loops back with an error → check the Vercel function logs for
  `/api/auth/callback`; the usual cause is a Callback URI mismatch (must be exactly
  `https://www.happybeanie.com/api/auth/callback`) or a wrong client secret.
- `not_configured` message → one of the three environment variables is missing.
