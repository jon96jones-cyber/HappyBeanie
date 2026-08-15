// /api/admin/wholesale — the trade-approval desk.
//
// GET  → { ok, apps: [...] }        pending applications (tag:wholesale-pending)
// POST { customerId, priceDog, priceCat, minOrder, senderName }
//      → flips tags to approved, then fires the branded approval email via
//        Resend with the account's pricing filled in. One click, done.
//
// Auth: shared secret in `x-wholesale-key` vs WHOLESALE_KEY (same model as the
// fulfillment desk, separate key — the supplier must not see applications).
//
// Env: SHOPIFY_ADMIN_TOKEN (read/write_customers), WHOLESALE_KEY,
//      RESEND_API_KEY (from resend.com; sender domain must be verified).
// Optional: WHOLESALE_FROM (default 'Happy Beanie <hello@happybeanie.com>').

const crypto = require('crypto');
const buildEmail = require('../_lib/wholesale-email.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
const FROM = process.env.WHOLESALE_FROM || 'Happy Beanie <hello@happybeanie.com>';

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  const json = await res.json().catch(function () { return {}; });
  return { status: res.status, json: json };
}

const PENDING = `query Pending {
  customers(first: 50, query: "tag:wholesale-pending") {
    nodes {
      id firstName lastName email note createdAt
      company: metafield(namespace: "wholesale", key: "company") { value }
      businessType: metafield(namespace: "wholesale", key: "business_type") { value }
      volume: metafield(namespace: "wholesale", key: "monthly_volume") { value }
      phone: metafield(namespace: "wholesale", key: "phone") { value }
      website: metafield(namespace: "wholesale", key: "website") { value }
    }
  }
}`;

const APPROVE_TAGS = `mutation Approve($id: ID!, $add: [String!]!, $remove: [String!]!) {
  tagsAdd(id: $id, tags: $add) { userErrors { message } }
  tagsRemove(id: $id, tags: $remove) { userErrors { message } }
}`;

function keyOk(req) {
  const expected = process.env.WHOLESALE_KEY;
  if (!expected) return false;
  const given = String((req.headers && req.headers['x-wholesale-key']) || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function mf(node) { return node && node.value ? node.value : ''; }

module.exports = async function handler(req, res) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token || !process.env.WHOLESALE_KEY) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  if (!keyOk(req)) {
    return res.status(401).json({ ok: false, error: 'bad_key' });
  }

  try {
    if (req.method === 'GET') {
      const out = await admin(token, PENDING);
      if (out.status === 401 || out.status === 403) {
        return res.status(200).json({ ok: false, error: 'token_rejected' });
      }
      const gqlErrors = (out.json && out.json.errors) || [];
      if (gqlErrors.length || !out.json.data) {
        console.error('[admin/wholesale]', JSON.stringify(gqlErrors));
        return res.status(200).json({ ok: false, error: 'read_failed', message: (gqlErrors[0] && gqlErrors[0].message) || 'Shopify read error' });
      }
      const apps = (out.json.data.customers.nodes || []).map(function (c) {
        return {
          id: c.id,
          firstName: c.firstName || '',
          lastName: c.lastName || '',
          email: c.email || '',
          appliedAt: c.createdAt,
          company: mf(c.company),
          businessType: mf(c.businessType),
          volume: mf(c.volume),
          phone: mf(c.phone),
          website: mf(c.website),
          note: c.note || '',
          emailReady: !!process.env.RESEND_API_KEY
        };
      });
      return res.status(200).json({ ok: true, apps: apps, emailReady: !!process.env.RESEND_API_KEY });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ ok: false, error: 'email_not_configured',
        message: 'Add RESEND_API_KEY in Vercel first — approvals must send the email.' });
    }

    const body = readBody(req);
    const customerId = String(body.customerId || '');
    const firstName = String(body.firstName || '').slice(0, 100);
    const company = String(body.company || '').slice(0, 200);
    const email = String(body.email || '').slice(0, 200);
    const priceDog = String(body.priceDog || '').slice(0, 20);
    const priceCat = String(body.priceCat || '').slice(0, 20);
    const minOrder = String(body.minOrder || '').slice(0, 60);
    const senderName = String(body.senderName || '').slice(0, 100);
    if (!customerId || !email || !firstName || !company || !priceDog || !priceCat || !minOrder || !senderName) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'All fields are required.' });
    }

    // 1. Send the email FIRST — if it fails we leave the application pending,
    //    so a broken send can never strand an approved-but-unnotified account.
    const html = buildEmail({ firstName: firstName, company: company, priceDog: priceDog, priceCat: priceCat, minOrder: minOrder, senderName: senderName });
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        reply_to: 'hello@happybeanie.com',
        subject: "You're approved — Happy Beanie trade pricing inside",
        html: html
      })
    });
    const sentJson = await sent.json().catch(function () { return {}; });
    if (!sent.ok || !sentJson.id) {
      console.error('[admin/wholesale] resend:', sent.status, JSON.stringify(sentJson));
      return res.status(502).json({ ok: false, error: 'email_failed',
        message: (sentJson && sentJson.message) || ('Email service returned ' + sent.status) });
    }

    // 2. Flip the tags. If this half fails the email is already out — report
    //    it so the tag can be fixed by hand rather than double-sending.
    const tagged = await admin(token, APPROVE_TAGS, {
      id: customerId,
      add: ['wholesale', 'wholesale-approved'],
      remove: ['wholesale-pending']
    });
    const tErrs = []
      .concat(((tagged.json.data || {}).tagsAdd || {}).userErrors || [])
      .concat(((tagged.json.data || {}).tagsRemove || {}).userErrors || [])
      .concat(tagged.json.errors || []);
    if (tErrs.length) {
      console.error('[admin/wholesale] tag:', JSON.stringify(tErrs));
      return res.status(200).json({ ok: true, warning: 'email_sent_tags_failed',
        message: 'The email went out, but the Shopify tags did not update — flip wholesale-pending → wholesale-approved by hand for ' + email + '.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[admin/wholesale]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
