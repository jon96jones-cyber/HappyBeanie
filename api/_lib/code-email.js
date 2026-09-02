// The discount code the "feed Summer" popup promises.
//
// The popup says the code "lands in your inbox", then "check your inbox", then
// "on its way" — three promises on one screen. This is the thing that keeps
// them. The code is also shown on screen, so this is a receipt rather than the
// only copy, but an unsent receipt still makes the popup a liar.
//
// build({ code, unsubUrl })  →  html
// build.text({ code, unsubUrl })  →  the plain-text alternate

const SANS = "font-family:'DM Sans',Helvetica,Arial,sans-serif;";
const MONO = "font-family:'DM Mono',Menlo,Consolas,monospace;";
const SITE = 'https://www.happybeanie.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = function build(t) {
  const code = esc((t && t.code) || '');
  const unsub = esc((t && t.unsubUrl) || '');
  const pct = esc(String((t && t.pct) || 10));
  // An undated code is a support email waiting to happen — every "is this still
  // good?" is one a person has to answer by hand.
  const by = (t && t.expiresLabel) ? esc(t.expiresLabel) : '';
  return '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Your code</title></head>\n<body style="margin:0; padding:0; background:#e7decb;">\n' +
  '<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#e7decb; font-size:1px; line-height:1px;">' + code + ' — 10% off your next box, from Summer.</div>\n' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e7decb;"><tr><td align="center" style="padding:28px 12px;">\n' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background:#fcfaf4; border:1px solid #e0d6c2; border-radius:10px; overflow:hidden;">\n' +
  '<tr><td style="background:#17140f; padding:22px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td align="left"><img src="' + SITE + '/assets/email-logo-2.png" width="133" height="38" alt="happy beanie" style="display:block; border:0; ' + SANS + ' font-size:20px; font-weight:700; letter-spacing:-0.5px; color:#f5f0e6;"></td>' +
    '<td align="right" style="' + MONO + ' font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">Summer&rsquo;s&nbsp;daily&nbsp;bean</td>' +
  '</tr></table></td></tr>\n' +
  '<tr><td style="height:3px; background:#f2ce59; font-size:0; line-height:0;">&nbsp;</td></tr>\n' +
  '<tr><td style="padding:38px 34px 8px;">\n' +
    '<p style="margin:0 0 14px; ' + MONO + ' font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">&mdash; &nbsp;You fed her</p>' +
    '<h1 style="margin:0 0 14px; ' + SANS + ' font-size:27px; line-height:1.1; letter-spacing:-1px; font-weight:700; color:#17140f;">Here&rsquo;s your ' + pct + '% off.</h1>' +
    '<p style="margin:0 0 26px; ' + SANS + ' font-size:15.5px; line-height:1.62; color:#554c40;">Enter it at checkout. It works on any box &mdash; Summer&rsquo;s formula or the cat one &mdash; and on a subscription as well as a one-time order.' +
      (by ? ' It is yours alone, good for a single order, and expires on <b style="color:#17140f;">' + by + '</b>.' : ' It is yours alone and good for a single order.') +
    '</p>\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffdf7; border:2px dashed #17140f; border-radius:4px;"><tr>' +
      '<td style="padding:18px 20px; ' + MONO + ' font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">' + pct + '% off' + (by ? '<br><span style="letter-spacing:1px; text-transform:none;">one order, until ' + by + '</span>' : '') + '</td>' +
      '<td align="right" style="padding:18px 20px; ' + MONO + ' font-size:23px; font-weight:500; letter-spacing:3px; color:#17140f;">' + code + '</td>' +
    '</tr></table>\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr><td align="center" bgcolor="#f2ce59" style="border-radius:999px;">' +
      '<a href="' + SITE + '/product?utm_source=email&utm_medium=lifecycle&utm_campaign=popup_code" style="display:block; padding:17px 24px; ' + MONO + ' font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:700; color:#17140f; text-decoration:none;">Pick your box &rarr;</a>' +
    '</td></tr></table>\n' +
    '<p style="margin:26px 0 0; ' + SANS + ' font-size:14px; line-height:1.6; color:#554c40;">Not sure it suits your pet? The <a href="' + SITE + '/quiz?utm_source=email&utm_medium=lifecycle&utm_campaign=popup_code" style="color:#325e3f;">two-minute screener</a> checks eight questions against every ingredient, and it will tell you plainly if the answer is no.</p>\n' +
  '</td></tr>\n' +
  '<tr><td style="background:#f5f0e6; border-top:1px solid #e0d6c2; padding:26px 34px 30px;" align="center">' +
    '<p style="margin:0 0 12px; ' + MONO + ' font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">Formulated fresh &middot; Scottsdale, AZ</p>' +
    '<p style="margin:0; ' + SANS + ' font-size:11px; line-height:1.6; color:#8a7f6e;">You&rsquo;re getting this because you asked for the code at happybeanie.com.<br>' +
    '<a href="' + unsub + '" style="color:#325e3f; text-decoration:underline;">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="mailto:hello@happybeanie.com" style="color:#325e3f; text-decoration:none;">hello@happybeanie.com</a> &nbsp;&middot;&nbsp; &copy; 2026 Happy Beanie &middot; 7180 E Main St, Scottsdale, AZ 85251</p>' +
  '</td></tr>\n' +
  '</table></td></tr></table>\n</body>\n</html>';
};

module.exports.text = function buildText(t) {
  const code = (t && t.code) || '';
  return [
    'Here is your ' + ((t && t.pct) || 10) + '% off.',
    '',
    '    ' + code,
    '',
    'Enter it at checkout. It works on any box - Summer\'s formula or the cat',
    'one - and on a subscription as well as a one-time order.',
    (t && t.expiresLabel)
      ? 'It is yours alone, good for a single order, and expires on ' + t.expiresLabel + '.'
      : 'It is yours alone and good for a single order.',
    '',
    'Pick your box: ' + SITE + '/product',
    '',
    'Not sure it suits your pet? The two-minute screener checks eight questions',
    'against every ingredient, and will tell you plainly if the answer is no:',
    SITE + '/quiz',
    '',
    'You are getting this because you asked for the code at happybeanie.com.',
    'Unsubscribe: ' + ((t && t.unsubUrl) || ''),
    'Happy Beanie - 7180 E Main St, Scottsdale, AZ 85251'
  ].join('\n');
};
