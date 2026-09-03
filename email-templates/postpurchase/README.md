# Handoff: Happy Beanie lifecycle emails (4)

Four redesigned emails, each for a **different** campaign. `campaigns.json` is the
machine-readable version of this file — read it first if you are wiring these up
programmatically. File numbers 04–07 match the design prototype's numbering.

| # | File | Campaign / flow | Trigger | Delay | Where it goes |
|---|------|-----------------|---------|-------|---------------|
| 04 | `04-day7-checkin.html` | Post-purchase check-in | First order fulfilled | +7 days | Email 1 of post-purchase education. First orders only. |
| 05 | `05-halfway-jar.html` | One-time → subscription conversion | One-time 30-day box fulfilled AND no active subscription | +21 days | Standalone conversion flow. Never to active subscribers. |
| 06 | `06-second-order.html` | Second-order milestone / review ask | `order_count == 2`, fulfilled | immediate | Standalone loyalty flow. The only review ask in the lifecycle. |
| 07 | `07-cancellation-confirmed.html` | Cancellation confirmation | Subscription cancelled | immediate | **Transactional.** Sends regardless of marketing consent. |

## About these files

These are **not** references to be rebuilt in a framework. They are table-based,
inline-styled HTML email documents intended to be pasted into the ESP (Klaviyo /
Customer.io / Braze / SendGrid) as the template body for the campaign named above.
The only work needed is:

1. Upload `img/` to your asset CDN and rewrite every `src` to an absolute HTTPS URL. **Email clients cannot load relative paths.**
2. Replace the `{{ … }}` placeholders with your ESP's real merge syntax (see below).
3. Wire the trigger, delay, suppression, and send limits from the table above and `campaigns.json`.

The design source of truth is `reference/Lifecycle Emails.dc.html` — a browser
prototype of the designs. Use it to check spacing and colour if a client renders
something oddly; do not ship it.

## Fidelity

High-fidelity. Colours, type, and spacing are final. Keep the 600px width, the 40px
side padding, the 3px yellow rule under the dark hero (04), and **one** CTA per email.

Three things in the prototype are impossible in email and were converted, not dropped —
do not "fix" them back:

- **Absolutely positioned art** (04's dog, 07's paw) → pre-composited PNGs in a second
  table column, baked onto their own background colour. Those columns carry `.sm-hide`
  and vanish under 620px, so the copy must stand alone. It does.
- **`filter`, `opacity`, `transform`** (05's 30-chew counter) → one flat
  `img/jar-counter.png`.
- **`object-fit`** (06's hero) → pre-cropped to exactly 600×254.

## Merge placeholders

Written in Liquid-ish `{{ snake_case }}` form as a neutral placeholder — map each to
your ESP.

**All emails:** `unsubscribe_url` / `box_optout_url` — the per-email opt-out link.

**04 day-7 check-in** — `research_url`

**05 halfway jar** — `chews_remaining`, `chews_total`, `one_time_price`, `subscribe_price`, `subscribe_url`, `box_optout_url`

**06 second order** — `share_url` (deep-link the review/UGC form with contact + order pre-filled)

**07 cancellation** — `restart_url` (must resume the same plan at the same price with no re-onboarding — the copy promises it)

## Per-email gotchas

- **04** — first orders only; do not fire on repeat purchases. The footer promises a
  same-day human reply, so reply-to must be a monitored inbox.
- **05** — `img/jar-counter.png` is **fixed artwork** showing 15 of 30 taken. The count
  line above it is dynamic. Send at a different day and the picture disagrees with the
  number: keep the 21-day delay, or commission more counter frames. Prices are merge
  vars so they follow the live price list (design shows $115 struck / $99). Exit the
  flow the moment a subscription is created.
- **06** — one send per contact, ever. Suppress anyone who already left a review.
- **07** — transactional: send even to unsubscribed contacts. It is the only email with
  an **outlined** CTA and a **dark** footer; that quiet tone is deliberate.

## Assets

| File | Size | Used by | Notes |
|------|------|---------|-------|
| `img/hb-wordmark.png` | 2973×487, transparent | 04 | Cream wordmark for the dark brand bar. Rendered 146×24. |
| `img/hb-wordmark-ink.png` | 292×48 | 05, 06, 07 | Ink wordmark for the cream brand bar. Rendered 146×24. |
| `img/day7-dog-dark.png` | 316×652 | 04 | Dog cutout flattened onto ink `#17140F`, bottom 22px trimmed as in the design. Rendered 158×326. **Must sit on an ink cell** or the seam shows. |
| `img/jar-counter.png` | 1040×152 | 05 | 30 chews, top row at 16%, on `#EBE3D1` with the grid pattern baked in. Rendered 520×76, fluid on mobile. |
| `img/hero-boxes.png` | 1200×508 | 06 | Pre-cropped at 50%/44%. Rendered 600×254. |
| `img/paw-watermark.png` | 400×400 | 07 | Paw at 8% opacity, rotated 11°, flattened onto paper `#FAF8F1`. Rendered 200×200. **Must sit on a paper cell.** |

All are 2× for retina. Every one needs an absolute HTTPS URL before send. Alt text is
already written (decorative art carries `alt=""` on purpose).

## Design tokens

Ink `#17140F` · paper `#FAF8F1` · page `#DED5C4` · footer `#F2EEE3` · panel `#F4EFE2`
counter panel `#EBE3D1` · hairline `#E0D6C3` · yellow `#F0C64B` (hover `#E9B72E`)
green `#43684E` · green-on-ink `#8FBF9F` · rust `#A4442F` · body `#4A4237` · muted `#8A7F6E`
body-on-ink `#B9AF9C`

Headline: DM Sans 700, 38–40px/39–41px, −0.042em.
Body: DM Sans 400, 15.5–16px/25–26px.
Label: DM Mono, 9.5–11px, 0.16–0.22em, uppercase.
Button: DM Mono 500, 12.5px, 0.2em, uppercase, 19px/24px padding, 999px radius
(18px + 1px ink border for 07's outlined variant).

Webfonts load via a Google Fonts `<link>` (Apple Mail, iOS, some webmail) and fall
back to Arial / Courier New. Outlook is forced to Arial by an `mso` conditional —
expected and fine.

## Rendering notes

- `.sm-pad`, `.sm-h1`, `.sm-stack`, `.sm-hide`, `.sm-full` in `<head>` handle ≤620px.
  Gmail keeps them; clients that strip `<style>` still read correctly from the inline
  styles.
- The price comparison (05) and the label/value row (07) stack via `.sm-stack`.
- Border-radius on the CTA degrades to a square button in Outlook. Accepted.
- 07's status dot is a 6px table cell with `border-radius` — Outlook renders it square.
  Accepted.
- Preheader text is the hidden div immediately after `<body>`; it differs per email.

## Compliance

All four carry the Scottsdale mailing address and an opt-out link in the footer. 07 is
transactional and exempt from the opt-out requirement, but keeps the link anyway.
