# Subscription events from Shopify Flow

Shopify will not let a custom app read subscription contracts, so the site
learns about them from Shopify Flow instead. Each workflow below fires on an
event from the Shopify Subscriptions app and sends one HTTP request to the
site. The subscriptions desk (`/admin/subscriptions`) and the cancellation
rescue email both read from what arrives here.

## One-time setup

1. **Make a secret.** Any long random string (30+ characters). It is the only
   thing standing between the internet and the log, so treat it like a
   password. You will paste it in two places and nowhere else.
2. **Vercel:** Project → Settings → Environment Variables → add `FLOW_KEY`
   with that value, Production. Then Deployments → latest → Redeploy, so the
   running functions pick it up.
3. **Shopify:** Apps → Flow → Create workflow, four times, as below.

Every workflow uses the same action:

- **Action:** Send HTTP request
- **Method:** POST
- **URL:** `https://www.happybeanie.com/api/hooks/subscription`
- **Headers:**
  - `Content-Type` = `application/json`
  - `x-flow-key` = the secret from step 1

Only the trigger and the body change. Flow's body editor accepts Liquid; the
`| json` filter is what makes each value safe to drop into JSON.

## Workflow 1 — created

- **Trigger:** Subscription contract created (from the Shopify Subscriptions app)
- **Body:**

```liquid
{
  "event": "created",
  "contract": {
    "id": {{ subscriptionContract.id | json }},
    "status": {{ subscriptionContract.status | json }},
    "customer_email": {{ subscriptionContract.customer.email | json }},
    "customer_name": {{ subscriptionContract.customer.displayName | json }},
    "product": {{ subscriptionContract.lines.first.title | json }},
    "next_billing_date": {{ subscriptionContract.nextBillingDate | json }},
    "origin_order": {{ subscriptionContract.originOrder.name | json }}
  }
}
```

## Workflow 2 — payment failed

- **Trigger:** Subscription billing attempt failed
- **Body:**

```liquid
{
  "event": "payment_failed",
  "contract": {
    "id": {{ subscriptionBillingAttempt.subscriptionContract.id | json }},
    "customer_email": {{ subscriptionBillingAttempt.subscriptionContract.customer.email | json }},
    "customer_name": {{ subscriptionBillingAttempt.subscriptionContract.customer.displayName | json }}
  },
  "attempt": {
    "error_code": {{ subscriptionBillingAttempt.errorCode | json }},
    "error_message": {{ subscriptionBillingAttempt.errorMessage | json }}
  }
}
```

If the Subscriptions app also offers a **billing attempt succeeded** trigger,
add it as a fifth workflow with `"event": "payment_succeeded"` and the same
contract block (no `attempt`). It is what lets the desk show a green "last
payment succeeded".

## Workflow 3 — cancelled

- **Trigger:** Subscription contract cancelled
- **Body:** the Workflow 1 body with `"event": "cancelled"`.

## Workflow 4 — paused and resumed

Two triggers, one shape:

- **Trigger:** Subscription contract paused → body as Workflow 1 with `"event": "paused"`
- **Trigger:** Subscription contract resumed (or activated) → `"event": "resumed"`

## Notes

- Variable names come from Flow's own picker. If a name above is not offered
  for your trigger (Shopify renames things), pick the equivalent from the
  picker; the site only needs `event` and `contract.id`, everything else is
  kept if sent.
- The site answers 200 for a good event, 200 with `duplicate: true` if the
  same event for the same contract arrives twice inside a minute, 401 for a
  wrong key, 400 for a body it cannot read. Flow shows the response under the
  workflow's run history, which is the place to look if the desk stays empty.
- Nothing here writes back to Shopify. Cancelling, pausing and retry rules
  stay in the Subscriptions app.
