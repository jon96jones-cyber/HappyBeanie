// GET /api/account/data — server-side proxy that returns everything the portal
// dashboard needs in one call. Tokens stay in the httpOnly cookie; the browser
// never sees them. 401 means "show the signed-out view".

const auth = require('../_lib/customer-auth.js');

const QUERY = 'query AccountData { customer { id firstName lastName ' +
  'emailAddress { emailAddress } phoneNumber { phoneNumber } creationDate tags ' +
  'defaultAddress { id formatted } addresses(first: 10) { nodes { id formatted } } ' +
  'orders(first: 20, sortKey: PROCESSED_AT, reverse: true) { nodes { id name processedAt ' +
  'financialStatus totalPrice { amount currencyCode } statusPageUrl ' +
  'lineItems(first: 10) { nodes { title quantity } } ' +
  'fulfillments(first: 5) { nodes { status latestShipmentStatus ' +
  'trackingInformation { number url company } } } } } ' +
  'subscriptionContracts(first: 10) { nodes { id status nextBillingDate ' +
  'deliveryPolicy { interval intervalCount { count } } } } } }';

module.exports = async function handler(req, res) {
  if (!auth.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const fresh = await auth.ensureFreshSession(req);
  if (!fresh) {
    res.setHeader('Set-Cookie', auth.clearSessionCookies());
    return res.status(401).json({ ok: false, error: 'signed_out' });
  }
  if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);

  try {
    const out = await auth.customerGraphql(fresh.session.at, QUERY);
    if (out.status === 401 || out.status === 403) {
      return res.status(401).json({ ok: false, error: 'signed_out' });
    }
    if (out.json && out.json.errors && out.json.errors.length) {
      console.error('[account/data] graphql errors:', JSON.stringify(out.json.errors));
    }
    const customer = out.json && out.json.data && out.json.data.customer;
    if (!customer) {
      return res.status(502).json({ ok: false, error: 'upstream' });
    }
    return res.status(200).json({ ok: true, customer: customer });
  } catch (err) {
    console.error('[account/data]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
