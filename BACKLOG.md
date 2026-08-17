# Backlog — saved for later

Items parked for a future session.

## Supplier "new order" instant ping
The fulfillment desk (`/admin/fulfillment`) auto-refreshes every 45s. Optional upgrade:
push an **instant** alert to the supplier the moment an order (or subscription renewal)
lands, via an `orders/create` webhook → forward to their channel.

**Blocked on:** the supplier's chosen channel + one piece of info —
- Branded email → the supplier's email address
- Slack / Discord → an incoming-webhook URL
- SMS → phone number + a Twilio account (SID/token)
- Their own software → an endpoint URL + auth token

**Fastest no-build alternative** (may make this unnecessary): add the supplier's email to
**Shopify → Settings → Notifications → Staff notifications → New order** — instant email
per order, zero code.

_Status: waiting on supplier channel + destination._

## Vet telemedicine network — consult referral
Let pet owners talk to a licensed vet, on their phone, about whether Happy Beanie
suits their pet. **Decided model: the pet owner pays the vet directly (one-time fee);
Happy Beanie pays nothing and takes nothing.**

**Why that model:** a vet paid by the owner has no stake in the sale, so the consult is
credible and the FTC/endorsement exposure largely disappears. Keep it that way —
**no money flows in either direction**, including no per-referral fee back to us
(fee-splitting with licensed professionals is restricted in some states, and any
kickback re-creates the conflict we just removed).

**The constraint that shapes the build — VCPR.** A vet cannot give patient-specific
advice without a Veterinarian-Client-Patient Relationship, and most states still
require an in-person exam to establish one (a minority allow it remotely; the list
changes). "Is this right for my pet" is patient-specific, i.e. telemedicine, not
teletriage. Get a veterinary-law attorney to build a state matrix before signing.

**Where it goes (the key insight):** not in the purchase path — asking someone to pay a
third party before buying is a conversion killer. Put it where it is already earned:
the eligibility screener's **"check with your vet" outcomes** (chamomile + sedatives,
carnitine + seizure meds, pregnancy). Those are currently dead ends for a motivated
buyer. Second placement: the account portal, as a support benefit for existing customers.

**Ask the network for** (all cheap for them, so achievable with no fee):
- discounted rate for Happy Beanie customers — highest-value ask, marketable benefit
- pre-filled intake via URL params (species, weight, age, current meds)
- tracking parameter for attribution
- monthly aggregate outcomes report (suitable / not / needs follow-up), even anonymized
- price disclosed before handoff + written scope-of-service we can quote
- browser-based video, no app install (verify iOS Safari)
- which states they are licensed in, how they route by state, how they document VCPR
- malpractice insurance and who carries liability; medical-record ownership and access
- emergency escalation protocol; data processing agreement

**Expect the light version:** with no revenue flowing, networks will offer a co-branded
link and a tracking param, not SSO/webhooks. Build our side vendor-neutral so swapping
networks is config, not a rebuild.

**Prerequisite:** retire the "world's most powerful anti-aging pet supplement" claim
(currently in the hello@ email signature). No licensed network will attach their name
to it, and it will surface in their diligence.

**Our build when it's time:** consult record keyed to our customer/pet IDs, trigger on
flagged screener outcomes, pre-filled intake payload, attribution + funnel analytics
(booked → completed → outcome → purchase → retention), plus telehealth consent,
scope-of-service and privacy page updates.

_Status: strategy agreed, parked until Jon selects a network._
