# Handoff: Happy Beanie lifecycle emails (3)

Three redesigned emails, each for a **different** campaign. `campaigns.json` is the
machine-readable version of this file — read it first if you are wiring these up
programmatically.

| # | File | Campaign / flow | Trigger | Where it goes |
|---|------|-----------------|---------|---------------|
| 01 | `01-screener-recheck.html` | Eligibility screener — age recheck | Screener declined on age AND pet now ≥ 12 months | Its own one-shot flow. Not part of welcome. |
| 02 | `02-cart-recovery.html` | Abandoned checkout | Checkout started, not completed | Email 1 of the abandoned-checkout flow, +4h |
| 03 | `03-welcome-code.html` | Welcome / popup signup | `hb:subscribe` from the email-capture popup | Email 0 of the welcome flow — sends immediately, **before** the existing `emails/01-welcome.html` → `04-ready.html` series |

## About these files

Unlike most design handoffs, these are **not** references to be rebuilt in a
framework. They are table-based, inline-styled HTML email documents intended to be
pasted into the ESP (Klaviyo / Customer.io / Braze / SendGrid) as the template body
for the campaign named above. The only work needed is:

1. Upload `img/` to your asset CDN and rewrite the two `src` paths to absolute HTTPS URLs. **Email clients cannot load relative paths.**
2. Replace the `{{ … }}` placeholders with your ESP's real merge syntax (see below).
3. Wire the trigger, delay, and send limits from the table above.

The design source of truth is `reference/Lifecycle Emails.dc.html` — a browser
prototype showing all three side by side. Use it to check spacing and colour if a
client renders something oddly; do not ship it.

## Fidelity

High-fidelity. Colours, type, and spacing are final. Keep the 600px width, the 40px
side padding, the 3px yellow rule under the brand bar, and the single yellow pill CTA
per email.

## Merge placeholders

Written in Liquid-ish `{{ snake_case }}` form as a neutral placeholder — map each to
your ESP.

**All emails:** `unsubscribe_url` / `forget_url` / `cart_optout_url` (per-email opt-out link).

**01 screener recheck**
- `screened_at` — date the contact originally ran the screener (rendered as "Sep 2025")
- `today` — send date (rendered as "Sep 2026")
- `screener_url`

**02 cart recovery**
- `first_name` — used in the headline; supply a fallback ("there") or the headline reads oddly
- `item.title`, `item.variant`, `item.quantity`, `item.line_total` — the row marked `<!-- REPEAT this row per line item -->` is the loop body; the subtotal row sits outside it
- `cart_subtotal`, `checkout_url`

**03 welcome code**
- `discount_code` — must be unique per contact, single-use, 10% off, valid on subscriptions and both formulas
- `discount_expires_at`, `shop_url`, `screener_url`

## Assets

| File | Size | Notes |
|------|------|-------|
| `img/hb-wordmark.png` | 2973×487, transparent | Cream wordmark for the dark brand bar. Rendered at 159×26. Cut from `assets/hb-logo.png`, which ships baked onto a dark rectangle. |
| `img/hero-cart.jpg` | 1200×660 | Cart email hero, pre-cropped from `assets/product-dog.webp` at 50%/28% so the dog's head is not clipped. Rendered at 600×330. **Email clients do not support `object-fit`, so never swap this for an uncropped photo.** |

Both need absolute HTTPS URLs before send. Alt text is already written on both.

## Design tokens

Ink `#17140F` · paper `#FAF8F1` · page `#DED5C4` · footer `#F2EEE3` · panel `#F4EFE2`
hairline `#E0D6C3` · yellow `#F0C64B` (hover `#E9B72E`) · green `#43684E` · rust `#A4442F`
body `#4A4237` · muted `#8A7F6E`

Headline: DM Sans 700, 38–40px/40–42px, −0.042em.
Body: DM Sans 400, 15.5–16px/25–26px.
Label: DM Mono, 9.5–11px, 0.16–0.22em, uppercase.
Button: DM Mono 500, 12.5px, 0.2em, uppercase, 19px/24px padding, 999px radius.

Webfonts load via a Google Fonts `<link>` (Apple Mail, iOS, some webmail) and fall
back to Arial / Courier New. Outlook is forced to Arial by an `mso` conditional —
expected and fine.

## Rendering notes

- `.sm-pad`, `.sm-h1`, `.sm-stack`, `.sm-code` in `<head>` handle ≤620px. Gmail keeps them; clients that strip `<style>` still read correctly from the inline styles.
- The two-column then/now table in email 01 and the line-item table in 02 stack via `.sm-stack`.
- Border-radius on the CTA degrades to a square button in Outlook. Accepted.
- Preheader text is the hidden div immediately after `<body>`; it differs per email.

## Compliance

Each footer already carries a distinct opt-out label and the Scottsdale mailing
address is on email 03. Add the postal address to 01 and 02 as well if your
jurisdiction requires it on every send — there is room on the last footer line.
