// Shopify custom pixel — the Purchase half of Meta attribution.
//
// NOT loaded by this repo. Paste it into Shopify admin:
//   Settings → Customer events → Add custom pixel → name it "Meta Purchase (CAPI)"
//   → paste → Permissions: Analytics + Marketing → Save → Connect.
//
// ─────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE CONNECTING IT
//
// Shopify's Facebook & Instagram channel already sends its own Purchase from
// checkout. If both are running, Meta gets two Purchase events per order with
// different event_ids, does not collapse them, and counts both: revenue
// doubles and every campaign optimises against a number that is not real.
//
// So, in this order:
//   1. Turn off purchase tracking in the Facebook & Instagram channel.
//   2. Set META_OWN_PURCHASE=1 in Vercel, and redeploy — env vars bind at
//      build time, so without a redeploy nothing changes.
//   3. Connect this pixel.
//
// Until step 2 the relay logs the Purchase and drops it, so connecting this
// early is harmless but does nothing.
// ─────────────────────────────────────────────────────────────────────────────
//
// What it is for: the _fbc cookie holds the id of the ad click that earned the
// sale, and it is scoped to happybeanie.com. The order is placed on Shopify's
// domain, where that cookie does not exist — which is why purchases came back
// with a match quality of zero and could not be attributed to any ad. The
// storefront now sends the ids over as cart attributes; this reads them back.

const ENDPOINT = 'https://www.happybeanie.com/api/meta';

analytics.subscribe('checkout_completed', (event) => {
  try {
    const co = (event.data && event.data.checkout) || {};

    // The ids the storefront attached to the cart at cartCreate. Absent for an
    // order that did not come from an ad click, which is fine and expected —
    // Meta still matches on the hashed contact details below.
    const attr = {};
    (co.attributes || []).forEach((a) => { if (a && a.key) attr[a.key] = a.value; });

    const addr = co.billingAddress || co.shippingAddress || {};

    // The order name rather than a random id, so a refreshed thank-you page or
    // a retry sends the same event_id and Meta collapses the copies.
    const orderRef = (co.order && co.order.id) || co.token || '';

    const contents = (co.lineItems || []).map((li) => ({
      id: String((li.variant && li.variant.id) || (li.variant && li.variant.sku) || li.id || ''),
      quantity: li.quantity || 1,
      item_price: li.variant && li.variant.price ? Number(li.variant.price.amount) : undefined
    })).filter((c) => c.id);

    const body = {
      name: 'Purchase',
      eventId: 'order_' + orderRef,
      url: (event.context && event.context.document && event.context.document.location
            && event.context.document.location.href) || '',

      value: co.totalPrice ? Number(co.totalPrice.amount) : undefined,
      currency: (co.currencyCode) || (co.totalPrice && co.totalPrice.currencyCode) || 'USD',
      contents: contents,
      num_items: contents.reduce((n, c) => n + (c.quantity || 1), 0),
      content_type: 'product',

      // Hashed server-side by the relay, never here. These are what Meta
      // matches on when there is no click id, so they carry the match rate on
      // organic and email orders too.
      em: co.email || (co.order && co.order.customer && co.order.customer.email) || undefined,
      ph: co.phone || addr.phone || undefined,
      fn: addr.firstName || undefined,
      ln: addr.lastName || undefined,
      ct: addr.city || undefined,
      st: addr.provinceCode || addr.province || undefined,
      zp: addr.zip || undefined,
      country: addr.countryCode || 'us',

      // The whole point of the exercise.
      fbc: attr._fbc || undefined,
      fbp: attr._fbp || undefined
    };

    // A cross-origin POST out of the pixel sandbox. keepalive so it survives
    // the page being navigated away from; the relay answers 204 and the pixel
    // never waits on it either way.
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      mode: 'cors'
    }).catch(() => {});
  } catch (e) {
    // Tracking never breaks a checkout.
  }
});
