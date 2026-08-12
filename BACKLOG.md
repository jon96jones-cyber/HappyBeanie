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
