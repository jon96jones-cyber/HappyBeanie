// POST /api/account/subscription — manage a care plan from the portal.
// Body: { id: "gid://shopify/SubscriptionContract/…",
//         action: "cancel" | "skip" | "pause" | "resume" }
// Tokens stay in the httpOnly cookie; the browser never sees them.
// 401 means "show the signed-out view"; the front-end falls back to the desk
// email on anything else.

const auth = require('../_lib/customer-auth.js');

const CANCEL = 'mutation Cancel($id: ID!) { subscriptionContractCancel(subscriptionContractId: $id) ' +
  '{ contract { id status } userErrors { field message } } }';

// Pause stops billing and deliveries without losing the contract; activate
// picks it back up on the same cadence.
const PAUSE = 'mutation Pause($id: ID!) { subscriptionContractPause(subscriptionContractId: $id) ' +
  '{ contract { id status } userErrors { field message } } }';
const RESUME = 'mutation Resume($id: ID!) { subscriptionContractActivate(subscriptionContractId: $id) ' +
  '{ contract { id status } userErrors { field message } } }';

// "Skip" pushes the next billing attempt out by one delivery cycle.
const SKIP = 'mutation Skip($id: ID!, $date: DateTime!) { subscriptionBillingCycleSkip(billingCycleInput: ' +
  '{ contractId: $id, selector: { date: $date } }) { billingCycle { skipped } userErrors { field message } } }';

// The Customer Account API has no top-level subscriptionContract(id:) — list
// the customer's own contracts and match, which also proves ownership.
const CYCLE = 'query Cycle { customer { subscriptionContracts(first: 20) ' +
  '{ nodes { id status nextBillingDate } } } }';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function firstUserError(json, root) {
  const node = json && json.data && json.data[root];
  const errs = (node && node.userErrors) || [];
  return errs.length ? errs[0].message : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!auth.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const body = readBody(req);
  const id = String(body.id || '');
  const action = String(body.action || '');
  if (!id || ['cancel', 'skip', 'pause', 'resume'].indexOf(action) === -1) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }

  const fresh = await auth.ensureFreshSession(req);
  if (!fresh) {
    res.setHeader('Set-Cookie', auth.clearSessionCookies());
    return res.status(401).json({ ok: false, error: 'signed_out' });
  }
  if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);

  const at = fresh.session.at;

  const SIMPLE = {
    cancel: { q: CANCEL, root: 'subscriptionContractCancel' },
    pause: { q: PAUSE, root: 'subscriptionContractPause' },
    resume: { q: RESUME, root: 'subscriptionContractActivate' }
  };

  try {
    if (SIMPLE[action]) {
      const m = SIMPLE[action];
      const out = await auth.customerGraphql(at, m.q, { id: id });
      if (out.status === 401 || out.status === 403) {
        return res.status(401).json({ ok: false, error: 'signed_out' });
      }
      const msg = firstUserError(out.json, m.root);
      if (msg || (out.json && out.json.errors && out.json.errors.length)) {
        console.error('[account/subscription] ' + action + ':', msg || JSON.stringify(out.json.errors));
        return res.status(502).json({ ok: false, error: 'upstream', message: msg || undefined });
      }
      return res.status(200).json({ ok: true, action: action });
    }

    // Skip: find the upcoming billing cycle on the customer's own contract.
    const look = await auth.customerGraphql(at, CYCLE);
    if (look.status === 401 || look.status === 403) {
      return res.status(401).json({ ok: false, error: 'signed_out' });
    }
    const contracts = (look.json && look.json.data && look.json.data.customer &&
      look.json.data.customer.subscriptionContracts &&
      look.json.data.customer.subscriptionContracts.nodes) || [];
    const contract = contracts.find(function (c) { return c.id === id; });
    if (!contract) {
      return res.status(404).json({ ok: false, error: 'no_contract' });
    }
    if (!contract.nextBillingDate) {
      return res.status(502).json({ ok: false, error: 'upstream' });
    }

    const out = await auth.customerGraphql(at, SKIP, { id: id, date: contract.nextBillingDate });
    const msg = firstUserError(out.json, 'subscriptionBillingCycleSkip');
    if (msg || (out.json && out.json.errors && out.json.errors.length)) {
      console.error('[account/subscription] skip:', msg || JSON.stringify(out.json.errors));
      return res.status(502).json({ ok: false, error: 'upstream', message: msg || undefined });
    }
    return res.status(200).json({ ok: true, action: 'skip' });
  } catch (err) {
    console.error('[account/subscription]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
