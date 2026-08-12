# Connect the fulfillment desk to Shopify (one-time)

Your store is on Shopify's new **Dev Dashboard**, which doesn't hand out a
static `shpat_…` Admin token. Instead you complete a one-time OAuth "install"
that mints a **permanent** token. Do this once and you're done forever.

You'll need the app's **Client ID** and **Secret** (Dev Dashboard → Happy Beanie
app → Settings → Credentials).

---

## Step 1 — Add the app's redirect URL + fulfillment scopes

In the Dev Dashboard, open the **Happy Beanie** app → create a **new version**
(or edit the config) and set:

**Redirect / allowed callback URL** — add exactly:
```
https://www.happybeanie.com/api/oauth/callback
```

**Scopes** — keep everything that's there and add these four (the app already
has `read_orders` / `write_orders`):
```
read_merchant_managed_fulfillment_orders
write_merchant_managed_fulfillment_orders
read_assigned_fulfillment_orders
write_assigned_fulfillment_orders
```

**Release** the version.

## Step 2 — Add the app credentials to Vercel

Project → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `SHOPIFY_API_KEY` | the app's **Client ID** |
| `SHOPIFY_API_SECRET` | the app's **Secret** |

`FULFILLMENT_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_API_VERSION` are
already set. **Redeploy** so the two new variables take effect.

## Step 3 — Run the one-time connect

While logged into Shopify admin in the same browser, visit:
```
https://www.happybeanie.com/api/oauth/install
```

You'll see Shopify's "Install app" approval screen → click **Install**. You'll
land on a success page showing your **permanent Admin API token**. Copy it.

## Step 4 — Save the token

Vercel → **Settings → Environment Variables → `SHOPIFY_ADMIN_TOKEN`** → paste the
token → Save → **Redeploy**.

Open `https://www.happybeanie.com/admin/fulfillment`, enter your `FULFILLMENT_KEY`,
and the queue loads. Done — the token never expires.

---

### If something goes wrong
- **"Verification failed" / "Session mismatch"** on the callback → start again at
  `/api/oauth/install` in the same browser (don't open the callback URL directly).
- **"Token exchange failed"** → the `SHOPIFY_API_SECRET` doesn't match the app's
  Secret. Re-copy it and retry.
- **Approval screen errors about redirect URI** → the redirect URL in Step 1
  doesn't exactly match `https://www.happybeanie.com/api/oauth/callback`.
- **Queue still empty after saving the token** → the desk now reports the real
  reason on screen (missing scope vs. rejected token); tell me what it says.
