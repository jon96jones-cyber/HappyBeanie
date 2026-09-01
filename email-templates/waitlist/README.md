# Happy Beanie — waitlist emails

Four send-ready HTML emails plus a single-file reference render.

```
emails_handoff/
├─ 01-welcome.html      Subj: You're on the list
├─ 02-formula.html      Subj: What actually goes in it
├─ 03-screener.html     Subj: Worth checking first
├─ 04-ready.html        Subj: It's ready
├─ preview-standalone.html   all four, images inlined, opens offline
└─ img/                 the five assets the four emails reference
```

**Which file to use:** the four numbered files are the deliverables — paste one into your ESP. `preview-standalone.html` is only for looking at all four at once; its base64 images make it unsuitable for sending (Gmail strips base64 `<img>` data URIs).

## Before sending

Images are referenced as `src="img/…"`. Recipients cannot read local files — upload `img/` to your CDN or ESP asset library and rewrite the five references to absolute `https://` URLs:

| file | assets referenced |
|---|---|
| all four | `img/hb-wordmark.png` (440×79, displayed 220×40) |
| 01 | `img/hero-welcome.jpg` (1200×620) |
| 02 | `img/hero-formula.jpg` (1200×560) |
| 03 | `img/hero-screener.jpg` (1200×620) |
| 04 | `img/hero-ready.jpg` (1200×805) |

Heroes are 2× so they stay sharp on retina; each is constrained to `width:100%; max-width:600px; height:auto`. Every image carries alt text, so the emails read correctly with images blocked — which is how a meaningful share of recipients will see them.

## Construction

- Nested `<table role="presentation">`, single column, 600px card centered in a 100% wrapper.
- **Every style inlined.** The `<head>` `<style>` block carries only the mobile media query — some clients drop it, so the emails must read correctly without it. They do.
- No JavaScript, no external stylesheets, no web fonts. Arial/Helvetica for body copy, Courier New for the mono kickers — the brand's DM Sans/DM Mono are not email-safe.
- Bulletproof CTAs: gold `<td bgcolor>` with `mso-padding-alt`, and a `display:block` `<a>` filling it. No image buttons, no styled `<button>`.
- `mso-line-height-rule:exactly` on every text cell, and an mso conditional forcing Arial, for Outlook's Word engine.
- Preheader: hidden `<div>` as the first body element, ~85 chars, previews next to the subject line.
- HTML is 10–19KB per file, well under Gmail's ~100KB clipping threshold.

## Palette

| token | value |
|---|---|
| ink | `#17140F` |
| gold | `#F0C64B` |
| body cream | `#FAF8F1` |
| footer cream | `#F2EEE3` |
| page | `#E8E1D2` |
| body text | `#4A4237` |
| muted | `#8A7F6E` |
| green (links) | `#43684E` |
| rule | `#E4DBC9` |

Hex, not `oklch()` — email clients don't reliably support modern color functions.

## Per-email modules

- **01 Welcome** — batch tracker: four stages on a dark card, gold bars for completed, "Blending" lit as current.
- **02 Formula** — the ten-ingredient profile from the product page: numbered 01–10 in two columns, tinted header strip, FDA disclaimer footer. Columns stack below 620px, where each would otherwise be ~150px wide.
- **03 Screener** — three of the eight screener questions as a form preview with a gold "2 min" badge.
- **04 Ready** — certificate strip: batch number, potency pass, publish date, over a signing-lab line.

## Notes

- Emails 01 and 02 keep a two-item "Worth knowing" list; 03 and 04 have none, per the last round of edits.
- The header wordmark was cropped from `assets/hb-logo.png` against a pixel-scanned bounding box. It sits on `#17140F` because the source art already does — it will not read on a light background.
- `02-formula.html` had its ingredient list corrected once already: an earlier draft listed green-lipped mussel and taurine (both **cat-only** inputs) under a dog heading. The current list is the ten from the product page's "what is inside" panel, which is species-neutral. If you fork these per species, that panel is the source of truth.
- Dark mode is unhandled beyond `<meta name="color-scheme">`. The cream backgrounds invert unpredictably in Outlook.com and some Gmail configurations. Worth a Litmus pass before a large send.
