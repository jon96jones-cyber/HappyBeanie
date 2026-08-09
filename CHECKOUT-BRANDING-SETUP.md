# Checkout branding — setup guide

This is the real-world version of the checkout preview. It takes the Shopify checkout
(the page after **Continue to payment**) and dresses it in Happy Beanie's identity —
logo, colours, fonts, buttons — using only what the **Basic** plan actually allows, plus
an on-brand `checkout.happybeanie.com` address in the browser bar.

There are three separate jobs, in the order you'd do them:

1. **Brand the checkout** (logo, colours, fonts) — Settings → Checkout.
2. **Put checkout on `checkout.happybeanie.com`** — Settings → Domains.
3. **Turn on Shop Pay / Apple Pay** so most buyers never type a card — Settings → Payments.

~20 minutes total. Everything below is done in the Shopify admin; no code or deploy needed.

> **Store:** Happy Beanie · `pxv2u2-kc.myshopify.com` · **Basic** plan.

---

## First, the honest limits of the Basic plan

Shopify has **two** tiers of checkout customisation, and it matters which one we're on:

| | What it controls | Plans |
|---|---|---|
| **Checkout style editor** (Settings → Checkout) | Logo, colour scheme, heading + body font, button colour | **All plans, incl. Basic** ✅ |
| **Checkout Branding API** / advanced editor | Per-section colour *roles*, corner radius, custom layout, extra sections, mono numerals, background images per block | **Plus only** ❌ |

So on Basic we can make the checkout unmistakably *Happy Beanie* — our mark, our cream-and-ink
palette, our DM Sans type, our button. What we **can't** do on Basic is rearrange the sections,
restyle individual blocks, or add custom fields — that structure is Shopify's, and moving it is
Plus or headless territory. (This corrects the earlier note that implied per-block backgrounds and
button *shape* were ours on Basic — the colours and fonts are; the fine-grained per-section control
is Plus.)

That's the trade the preview was showing. For a subscription box, the Basic branding + the checkout
subdomain + Shop Pay gets ~90% of the way for essentially free.

---

## Job 1 — Brand the checkout

Shopify admin → **Settings → Checkout** → **Customize** (opens the checkout editor).

### 1a. Logo

- In the editor's left panel, open the **Logo** (header) section.
- Upload the bean-dot mark. Use `assets/email-logo.png` from this repo (already square,
  transparent, CDN-ready) or export a fresh PNG of the header mark.
- Position: **left**. Size: **Medium** (nudge to Small if it crowds on mobile).

### 1b. Colours

Open the **Colors** section and enter these hex values — pulled directly from the live site so
checkout matches `happybeanie.com` exactly:

| Editor field | Value | What it is |
|---|---|---|
| Background / main area | `#F5F0E6` | Warm cream (page background) |
| Accent (links, selected states) | `#325E3F` | Brand green |
| Button | `#25452F` | Deep green — the "Pay now" button |
| Button label / text | `#FCFAF4` | Off-white on the button |
| Body & heading text | `#17140F` | Near-black warm ink |

Notes:
- The **order-summary panel** on Basic follows the same scheme; it can't be given its own dark
  background per-block the way the mockup showed (that's the Plus per-section role). The cream +
  ink combo above still reads as ours.
- Want the checkout CTA to *pop* more than the site's own green? Swap the **Button** to the brand
  gold `#F2CE59` with button text `#17140F`. Either is on-brand — green matches the site, gold
  draws the eye. Pick one and keep it consistent.

### 1c. Typography

Open **Typography**. Checkout offers a **heading** font and a **body** font, both from Shopify
Fonts (which includes the Google Fonts library):

- **Heading font:** `DM Sans` — pick a heavier weight (Medium/600) for headings.
- **Body font:** `DM Sans` — Regular (400).

> The mono accents (`DM Mono` order numbers on the site) are a per-component detail that Basic's
> checkout editor doesn't expose — checkout body text will be DM Sans throughout. That's fine; the
> family still ties it to the site.

### 1d. Save

Click **Save** (top right). Then **Preview** to see it on a real draft checkout. Reaching an actual
checkout to eyeball it: add a box to the cart on the live site → **Checkout** → **Continue to
payment**. Compare against the published preview.

---

## Job 2 — Put checkout on `checkout.happybeanie.com`

Right now checkout runs on `pxv2u2-kc.myshopify.com`. Because our storefront (`happybeanie.com`) is
a **custom site on Vercel**, not the Shopify online store, the clean pattern — the same one Shopify
documents for headless storefronts — is:

- **`happybeanie.com`** keeps pointing at Vercel (the site). *Don't touch this.*
- **`checkout.happybeanie.com`** points at Shopify and becomes Shopify's **primary** domain, so
  every checkout URL shows that address.

### Steps

1. **At your DNS provider** (wherever `happybeanie.com`'s DNS lives — likely the same place the
   Vercel records are), add a record for the subdomain:
   - **Type:** `CNAME`
   - **Name / host:** `checkout`
   - **Value / target:** `shops.myshopify.com`
   - (Leave all existing `happybeanie.com` / `www` records untouched — those are Vercel's.)

2. **In Shopify admin → Settings → Domains → Connect existing domain**, enter
   `checkout.happybeanie.com`. Shopify verifies the CNAME above (allow a little DNS propagation time).

3. Once connected, for **`checkout.happybeanie.com`**:
   - Set **Target** to **Online Store**.
   - Set the domain type to **Primary**.

   This makes Shopify serve checkout from the subdomain — buyers see `checkout.happybeanie.com` in
   the address bar, on the SSL cert, and in emails, instead of the `myshopify.com` URL.

> Only the **subdomain** points to Shopify. The apex `happybeanie.com` stays with Vercel, so the
> storefront is unaffected. Shopify auto-provisions the SSL certificate for the subdomain.

After this goes live, update the site's **Checkout** link/button (and any hardcoded
`pxv2u2-kc.myshopify.com/cart` or checkout URLs) to use `checkout.happybeanie.com` so the honest
domain shows from the first click. Search the repo for the current checkout URL before flipping it.

---

## Job 3 — Turn on Shop Pay & Apple Pay (accelerated checkout)

This is the highest-leverage step: most buyers then finish in one tap and never see a card form at
all — so the branded-form work above matters less, and conversion goes up.

Shopify admin → **Settings → Payments**:

1. **Shop Pay** — under **Shopify Payments**, click **Manage** → enable **Shop Pay**. (Requires
   Shopify Payments to be active, which it already is if you're taking cards.)
2. **Apple Pay / Google Pay** — in the same **Supported payment methods / Wallets** area, ensure
   **Apple Pay** and **Google Pay** are checked. Apple Pay needs no cert upload; Shopify handles
   domain registration for the checkout domain automatically.
3. **Accelerated checkout buttons** — Settings → Checkout → **Checkout buttons / Express checkout**:
   turn on the express buttons so Shop Pay / Apple Pay / Google Pay appear at the **top of checkout**
   and on the cart.

To make the Shop Pay header itself carry our brand: **Settings → General → Brand assets → Manage**
— upload the logo and set the brand colours there too, so the Shop Pay wallet screen matches.

---

## Quick checklist

- [ ] Logo uploaded, positioned left (Settings → Checkout → Customize)
- [ ] Colours entered: bg `#F5F0E6`, accent `#325E3F`, button `#25452F`, button text `#FCFAF4`, text `#17140F`
- [ ] Fonts set to DM Sans (heading + body)
- [ ] Saved + previewed a real checkout, compared to the site
- [ ] `checkout` CNAME → `shops.myshopify.com` added at DNS
- [ ] `checkout.happybeanie.com` connected in Shopify, set Target = Online Store, **Primary**
- [ ] Site's checkout link updated to `checkout.happybeanie.com`
- [ ] Shop Pay enabled; Apple Pay + Google Pay checked; express buttons on
- [ ] Brand assets (logo + colours) set in Settings → General for the Shop Pay header

---

## If you ever want the *full* mockup (per-section layout, dark summary panel, mono numerals)

That needs one of:
- **Shopify Plus** — unlocks the Checkout Branding API / advanced editor used in the preview, or
- **Headless checkout** (Hydrogen / custom) — total control, significant build.

For a subscription box on Basic, neither is worth it yet. Branding + subdomain + Shop Pay is the
90% win; revisit Plus only if checkout volume justifies the ~10× plan cost.
