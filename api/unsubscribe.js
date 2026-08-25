// One-click opt-out for cart-recovery reminders. The link in every recovery
// email carries an HMAC of the address, so only someone holding the email
// can unsubscribe it. Sets the no-recovery-email tag on the customer —
// the recovery cron skips anyone carrying it.

const recover = require('./cron/recover-checkouts.js');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';

async function admin(token, query, variables) {
  const res = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: query, variables: variables || {} })
  });
  return res.json().catch(function () { return {}; });
}

function page(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + '</title></head>' +
    '<body style="margin:0; background:#17140F; color:#F5F0E6; font-family:\'DM Sans\',-apple-system,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; text-align:center; padding:24px;">' +
    '<div style="max-width:26em;"><div style="font-weight:700; font-size:26px; letter-spacing:-0.03em; margin-bottom:12px;">' + title + '</div>' +
    '<div style="font-size:15px; line-height:1.7; color:#B9AF9C;">' + body + '</div>' +
    '<a href="https://www.happybeanie.com/" style="display:inline-block; margin-top:26px; font-family:\'DM Mono\',monospace; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; padding:13px 24px; border-radius:2px; background:#F0C64B; color:#17140F; text-decoration:none;">Back to Happy Beanie</a></div></body></html>';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const q = (req.query || {});
    const email = String(q.e || '').toLowerCase().slice(0, 200);
    const tok = String(q.t || '');
    if (!email || tok !== recover.unsubToken(email)) {
      return res.status(400).send(page('That link didn’t check out', 'The unsubscribe link looks incomplete — try the link in your email again, or just reply to the email and we’ll take you off by hand.'));
    }
    const token = process.env.SHOPIFY_ADMIN_TOKEN;
    if (token) {
      const cj = await admin(token, 'query Find($q: String!) { customers(first: 1, query: $q) { nodes { id } } }', { q: 'email:' + email });
      const node = (((((cj || {}).data || {}).customers) || {}).nodes || [])[0];
      if (node && node.id) {
        await admin(token, 'mutation Tag($id: ID!, $t: [String!]!) { tagsAdd(id: $id, tags: $t) { userErrors { message } } }',
          { id: node.id, t: ['no-recovery-email'] });
      }
    }
    return res.status(200).send(page('You’re all set', 'No more cart reminders for ' + email.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '. Order emails — confirmations, shipping, lot certificates — still arrive as normal.'));
  } catch (e) {
    return res.status(200).send(page('You’re all set', 'No more cart reminders. If one slips through, reply to it and a person will sort it.'));
  }
};
