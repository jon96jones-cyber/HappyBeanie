// Abandoned-checkout recovery email — the full-custom template, sent by our
// own cron (api/cron/recover-checkouts.js) through Resend, because Shopify
// Messaging's editor can't take custom HTML. Same design family as the
// ambassador/wholesale emails.
//
// build({ firstName, items, subtotal, url, unsubUrl })
//   items: [{ title, quantity, price, image }] — price/subtotal preformatted
//   ("$89.00"), image an https URL or null. url is Shopify's recovery link.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SANS = "font-family:'DM Sans',Helvetica,Arial,sans-serif;";
const MONO = "font-family:'DM Mono',Menlo,Consolas,monospace;";

function itemRows(items) {
  return items.map(function (it) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #e0d6c2;"><tr>' +
      (it.image ? '<td width="66" style="padding:14px 14px 14px 0;"><img src="' + esc(it.image) + '" width="52" height="52" alt="" style="display:block; border:0; border-radius:6px; background:#e7decb;"></td>' : '') +
      '<td style="padding:14px 0; ' + SANS + ' font-size:14.5px; line-height:1.45; color:#17140f;"><b>' + esc(it.title) + '</b><br><span style="' + MONO + ' font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#8a7f6e;">Qty ' + esc(it.quantity) + '</span></td>' +
      '<td align="right" style="padding:14px 0; ' + MONO + ' font-size:13px; color:#17140f; white-space:nowrap;">' + esc(it.price) + '</td>' +
    '</tr></table>';
  }).join('');
}

module.exports = function build(t) {
  const greet = t.firstName ? 'Still thinking it over, ' + esc(t.firstName) + '?' : 'Still thinking it over?';
  return '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Your bean’s box is still here</title></head>\n<body style="margin:0; padding:0; background:#e7decb;">\n' +
  '<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#e7decb; font-size:1px; line-height:1px;">Your cart is saved — one tap picks up right where you left off.</div>\n' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e7decb;"><tr><td align="center" style="padding:28px 12px;">\n' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background:#fcfaf4; border:1px solid #e0d6c2; border-radius:10px; overflow:hidden;">\n' +
  '<tr><td style="background:#17140f; padding:22px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td align="left"><img src="https://www.happybeanie.com/assets/email-logo-2.png" width="133" height="38" alt="happy beanie" style="display:block; border:0; ' + SANS + ' font-size:20px; font-weight:700; letter-spacing:-0.5px; color:#f5f0e6;"></td>' +
    '<td align="right" style="' + MONO + ' font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">Order&nbsp;desk</td>' +
  '</tr></table></td></tr>\n' +
  '<tr><td style="height:3px; background:#f2ce59; font-size:0; line-height:0;">&nbsp;</td></tr>\n' +
  '<tr><td style="padding:38px 34px 6px;">\n' +
    '<p style="margin:0 0 14px; ' + MONO + ' font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">— &nbsp;Checkout · saved for you</p>' +
    '<h1 style="margin:0 0 14px; ' + SANS + ' font-size:27px; line-height:1.1; letter-spacing:-1px; font-weight:700; color:#17140f;">' + greet + '</h1>' +
    '<p style="margin:0 0 26px; ' + SANS + ' font-size:15.5px; line-height:1.62; color:#554c40;">Your bean’s box is packed and waiting right where you left it. No rush — your cart is saved, and checkout picks up exactly where you stopped.</p>\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f0e6; border:1px solid #e0d6c2; border-radius:10px;"><tr><td style="padding:8px 20px;">' +
      itemRows(t.items || []) +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td style="padding:14px 0; ' + MONO + ' font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#8a7f6e;">Subtotal</td>' +
        '<td align="right" style="padding:14px 0; ' + SANS + ' font-size:16px; font-weight:700; color:#17140f;">' + esc(t.subtotal) + '</td>' +
      '</tr></table>' +
    '</td></tr></table>\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr><td align="center" bgcolor="#f2ce59" style="border-radius:999px;">' +
      '<a href="' + esc(t.url) + '" style="display:block; padding:17px 24px; ' + MONO + ' font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:700; color:#17140f; text-decoration:none;">Finish checking out →</a>' +
    '</td></tr></table>\n' +
    '<p style="margin:28px 0 12px; ' + MONO + ' font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">— &nbsp;While you decide</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      '<tr><td style="padding:0 0 12px;"><span style="display:inline-block; width:22px; ' + MONO + ' font-size:11px; color:#325e3f; vertical-align:top;">01</span><span style="display:inline-block; width:520px; max-width:88%; ' + SANS + ' font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;"><b style="color:#17140f;">30-day guarantee</b> — give it a full month. If your bean isn’t visibly happier, it’s on us. No return label, no questions.</span></td></tr>' +
      '<tr><td style="padding:0 0 12px;"><span style="display:inline-block; width:22px; ' + MONO + ' font-size:11px; color:#325e3f; vertical-align:top;">02</span><span style="display:inline-block; width:520px; max-width:88%; ' + SANS + ' font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;"><b style="color:#17140f;">Every lot third-party tested</b> — the certificate for your batch is published before it ships. See them anytime at happybeanie.com/certificates.</span></td></tr>' +
      '<tr><td style="padding:0 0 6px;"><span style="display:inline-block; width:22px; ' + MONO + ' font-size:11px; color:#325e3f; vertical-align:top;">03</span><span style="display:inline-block; width:520px; max-width:88%; ' + SANS + ' font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;"><b style="color:#17140f;">Made to order in Scottsdale, AZ</b> — we blend in small batches, so your box is made fresh when you order it.</span></td></tr>' +
    '</table>\n' +
  '</td></tr>\n' +
  '<tr><td style="background:#f5f0e6; border-top:1px solid #e0d6c2; padding:26px 34px 30px;" align="center">' +
    '<p style="margin:0 0 12px; ' + MONO + ' font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">Formulated fresh · Scottsdale, AZ</p>' +
    '<p style="margin:0; ' + SANS + ' font-size:11px; line-height:1.6; color:#8a7f6e;">You’re getting this one-time reminder because you started a checkout at happybeanie.com.<br>' +
    '<a href="' + esc(t.unsubUrl) + '" style="color:#325e3f; text-decoration:underline;">Don’t remind me about carts</a> &nbsp;·&nbsp; <a href="mailto:hello@happybeanie.com" style="color:#325e3f; text-decoration:none;">hello@happybeanie.com</a> &nbsp;·&nbsp; © 2026 Happy Beanie · Scottsdale, AZ</p>' +
  '</td></tr>\n' +
  '</table></td></tr></table>\n</body>\n</html>';
};

module.exports.text = function buildText(t) {
  const lines = [
    t.firstName ? 'Still thinking it over, ' + t.firstName + '?' : 'Still thinking it over?',
    '',
    "Your bean's box is packed and waiting right where you left it. Your",
    'cart is saved, and checkout picks up exactly where you stopped.',
    ''
  ];
  (t.items || []).forEach(function (it) {
    lines.push('  ' + it.title + '  x' + it.quantity + '  ' + it.price);
  });
  lines.push('  SUBTOTAL: ' + t.subtotal, '', 'Finish checking out: ' + t.url, '',
    'WHILE YOU DECIDE',
    "  - 30-day guarantee: if your bean isn't visibly happier, it's on us.",
    '  - Every lot third-party tested; certificates published before shipping.',
    '  - Made to order in Scottsdale, AZ.',
    '',
    'Questions? Reply to this email - a person reads this inbox.',
    '',
    "Don't want cart reminders? " + t.unsubUrl,
    'Happy Beanie - Scottsdale, AZ');
  return lines.join('\n');
};
