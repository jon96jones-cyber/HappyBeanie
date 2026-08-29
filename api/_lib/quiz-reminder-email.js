// The screener deferral email — sent once, months after someone was told their
// pet was not eligible yet, at the point the reason should have passed.
//
// Same design family as the recovery and ambassador emails.
//
// build({ reason, species, quizUrl, cancelUrl })
//   reason: 'age' | 'repro'

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SANS = "font-family:'DM Sans',Helvetica,Arial,sans-serif;";
const MONO = "font-family:'DM Mono',Menlo,Consolas,monospace;";

// The copy is deliberately careful: we do not know that anything changed, only
// that the window they told us about has passed. The screener decides, not us.
const COPY = {
  age: {
    eyebrow: 'Screener · the year is up',
    head: 'Your bean should be old enough now.',
    body: 'When you ran our screener, your pet was still under twelve months, so we said no — the formula is dosed for a finished skeleton and has not been evaluated in growing animals. You asked us to check back, so here we are.',
    action: 'Run the screener again'
  },
  repro: {
    eyebrow: 'Screener · checking back',
    head: 'Checking in on your bean.',
    body: 'When you ran our screener, your pet was pregnant or nursing, so we said no — several inputs in the formula cross into a developing or nursing animal and none of it has been studied there. You asked us to check back once the litter was weaned.',
    action: 'Run the screener again'
  }
};

module.exports = function build(t) {
  const c = COPY[t.reason] || COPY.age;
  const formula = t.species === 'cat' ? 'the cat formula' : 'the dog formula';
  return '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>' + esc(c.head) + '</title></head>\n<body style="margin:0; padding:0; background:#e7decb;">\n' +
  '<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#e7decb; font-size:1px; line-height:1px;">You asked us to check back — the screener takes a minute.</div>\n' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e7decb;"><tr><td align="center" style="padding:28px 12px;">\n' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background:#fcfaf4; border:1px solid #e0d6c2; border-radius:10px; overflow:hidden;">\n' +
  '<tr><td style="background:#17140f; padding:22px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td align="left"><img src="https://www.happybeanie.com/assets/email-logo-2.png" width="133" height="38" alt="happy beanie" style="display:block; border:0; ' + SANS + ' font-size:20px; font-weight:700; letter-spacing:-0.5px; color:#f5f0e6;"></td>' +
    '<td align="right" style="' + MONO + ' font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">Eligibility&nbsp;screener</td>' +
  '</tr></table></td></tr>\n' +
  '<tr><td style="height:3px; background:#f2ce59; font-size:0; line-height:0;">&nbsp;</td></tr>\n' +
  '<tr><td style="padding:38px 34px 8px;">\n' +
    '<p style="margin:0 0 14px; ' + MONO + ' font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">— &nbsp;' + esc(c.eyebrow) + '</p>' +
    '<h1 style="margin:0 0 14px; ' + SANS + ' font-size:27px; line-height:1.1; letter-spacing:-1px; font-weight:700; color:#17140f;">' + esc(c.head) + '</h1>' +
    '<p style="margin:0 0 20px; ' + SANS + ' font-size:15.5px; line-height:1.62; color:#554c40;">' + esc(c.body) + '</p>' +
    '<p style="margin:0 0 26px; ' + SANS + ' font-size:15.5px; line-height:1.62; color:#554c40;">We have not seen your pet and nothing here is a clearance — run the eight questions again and it will screen ' + esc(formula) + ' against whatever is true today.</p>\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr><td align="center" bgcolor="#f2ce59" style="border-radius:999px;">' +
      '<a href="' + esc(t.quizUrl) + '" style="display:block; padding:17px 24px; ' + MONO + ' font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:700; color:#17140f; text-decoration:none;">' + esc(c.action) + ' →</a>' +
    '</td></tr></table>\n' +
    '<p style="margin:22px 0 12px; ' + MONO + ' font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">— &nbsp;Worth knowing</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      '<tr><td style="padding:0 0 12px;"><span style="display:inline-block; width:22px; ' + MONO + ' font-size:11px; color:#325e3f; vertical-align:top;">01</span><span style="display:inline-block; width:520px; max-width:88%; ' + SANS + ' font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;"><b style="color:#17140f;">The screener can still say no.</b> It checks every ingredient against your pet’s medications and diagnoses, and we would rather turn you away than sell you something that is wrong for your animal.</span></td></tr>' +
      '<tr><td style="padding:0 0 12px;"><span style="display:inline-block; width:22px; ' + MONO + ' font-size:11px; color:#325e3f; vertical-align:top;">02</span><span style="display:inline-block; width:520px; max-width:88%; ' + SANS + ' font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;"><b style="color:#17140f;">Ask your vet either way.</b> If anything has changed since we last spoke — new medication, a new diagnosis — take the ingredient list to them first.</span></td></tr>' +
      '<tr><td style="padding:0 0 6px;"><span style="display:inline-block; width:22px; ' + MONO + ' font-size:11px; color:#325e3f; vertical-align:top;">03</span><span style="display:inline-block; width:520px; max-width:88%; ' + SANS + ' font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;"><b style="color:#17140f;">This is the only email you get from this.</b> We kept your address for one reminder and nothing else.</span></td></tr>' +
    '</table>\n' +
  '</td></tr>\n' +
  '<tr><td style="background:#f5f0e6; border-top:1px solid #e0d6c2; padding:26px 34px 30px;" align="center">' +
    '<p style="margin:0 0 12px; ' + MONO + ' font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">Formulated fresh · Scottsdale, AZ</p>' +
    '<p style="margin:0; ' + SANS + ' font-size:11px; line-height:1.6; color:#8a7f6e;">You asked us to check back after running the eligibility screener at happybeanie.com.<br>' +
    '<a href="' + esc(t.cancelUrl) + '" style="color:#325e3f; text-decoration:underline;">Forget my address</a> &nbsp;·&nbsp; <a href="mailto:hello@happybeanie.com" style="color:#325e3f; text-decoration:none;">hello@happybeanie.com</a> &nbsp;·&nbsp; © 2026 Happy Beanie · Scottsdale, AZ</p>' +
  '</td></tr>\n' +
  '</table></td></tr></table>\n</body>\n</html>';
};

module.exports.text = function buildText(t) {
  const c = COPY[t.reason] || COPY.age;
  return [
    c.head,
    '',
    c.body,
    '',
    'We have not seen your pet and nothing here is a clearance — run the eight questions again and it will screen against whatever is true today.',
    '',
    c.action + ': ' + t.quizUrl,
    '',
    'The screener can still say no. If anything has changed since we last spoke, take the ingredient list to your vet first.',
    '',
    'This is the only email you get from this. Forget my address: ' + t.cancelUrl,
    'hello@happybeanie.com · Happy Beanie · Scottsdale, AZ'
  ].join('\n');
};

module.exports.subject = function subject(reason) {
  return reason === 'repro'
    ? 'Checking back on your bean'
    : 'Your bean should be old enough now';
};
