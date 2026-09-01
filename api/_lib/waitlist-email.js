// The waitlist sequence — what someone gets after signing up in the footer.
//
// build(step, { firstName, unsubUrl })  →  html
// build.text(step, t)                   →  plain text
// build.subject(step)                   →  subject line
// build.STEPS                           →  the step keys, in order
//
// Same shell as the recovery and screener emails: dark header, gold rule, mono
// eyebrow, one CTA, three reassurance lines, footer carrying the opt-out.
//
// Two rules the copy here has to hold to, because this sequence goes out on a
// timer while the batch moves at its own pace:
//
//   1. Nothing claims a thing has happened. "Every lot is third-party tested
//      before it ships" is true the day it is written and the day it is read.
//      "Your batch passed testing" would be a guess about the future, sent
//      automatically, to people who paid attention to it.
//   2. Nothing promises a discount. There is no launch offer, so saying
//      "something special for the list" would be a debt we did not agree to.
//
// The last step is the exception and is not on the timer at all — see the cron.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SANS = "font-family:'DM Sans',Helvetica,Arial,sans-serif;";
const MONO = "font-family:'DM Mono',Menlo,Consolas,monospace;";
const SITE = 'https://www.happybeanie.com';
const UTM = '?utm_source=email&utm_medium=lifecycle&utm_campaign=waitlist';

const STEPS = {
  welcome: {
    subject: 'You’re on the list',
    preheader: 'What Happy Beanie is, and when Batch 0072 arrives.',
    eyebrow: 'Waitlist · confirmed',
    head: function (n) { return n ? 'You’re on the list, ' + n + '.' : 'You’re on the list.'; },
    body: 'Happy Beanie is a daily soft chew for hormone and joint health, blended in small runs in our own lab in Scottsdale. ' +
      'Batch 0072 is in production now and ships in about four weeks. You’ll hear from us two or three times before then, and on the day it ships.',
    cta: { label: 'See what’s in the chew →', path: '/product' },
    points: [
      ['Made to order', 'we blend a run at a time rather than warehousing it, so a box is mixed close to when it ships.'],
      ['Every lot third-party tested', 'the certificate for a batch is published before that batch ships. They are all at happybeanie.com/certificates.'],
      ['Two formulas', 'dogs and cats get different blends, because a cat clears these inputs faster and cannot have some of them at all.']
    ]
  },

  formula: {
    subject: 'What actually goes in the chew',
    preheader: 'Ten inputs, why each one is there, and what we left out.',
    eyebrow: 'Batch 0072 · in production',
    head: function () { return 'What actually goes in it.'; },
    body: 'While Batch 0072 is being blended, here is what is in it. Ten inputs, each one there for a reason we can name — ' +
      'a peptide blend for repair signalling, whole-food nutrition for the cofactors that repair spends, and a mushroom layer for immune and gut support. ' +
      'The full list, with quantities, is on the product page.',
    cta: { label: 'Read the full ingredient list →', path: '/product' },
    points: [
      ['No proprietary hand-waving on the label', 'the ingredient list names everything and the certificates back it.'],
      ['Human-grade, grain free', 'made in a facility that also makes food for people.'],
      ['One chew a day', 'given with a meal. Two for a dog over 100 lb, half for one under 20.']
    ]
  },

  screener: {
    subject: 'Is it right for your pet?',
    preheader: 'Eight questions, checked against every ingredient. Two minutes.',
    eyebrow: 'Before Batch 0072 ships',
    head: function () { return 'Worth checking first.'; },
    body: 'Not every pet should take this, and we would rather tell you now than after you have paid. ' +
      'The screener asks eight questions about age, diet, diagnoses and medication, and checks the answers against every ingredient in the formula. ' +
      'It takes two minutes and it will tell you plainly if the answer is no.',
    cta: { label: 'Check your pet →', path: '/quiz' },
    points: [
      ['It does say no', 'a pancreatitis history, a fish allergy and a few medications rule the chew out, and the screener says so.'],
      ['You keep the result', 'save it to an account and the formula, the dose and anything flagged stay with you.'],
      ['Not veterinary advice', 'it is a screen against our own ingredient list. Your vet knows your pet; this does not.']
    ]
  },

  // Not on the timer. This one says a thing has happened, so it only goes out
  // when someone has confirmed that it has. See api/cron/waitlist.js.
  ready: {
    subject: 'Batch 0072 is ready',
    preheader: 'The run is finished and boxes are going out.',
    eyebrow: 'Batch 0072 · ready',
    head: function (n) { return n ? 'It’s ready, ' + n + '.' : 'Batch 0072 is ready.'; },
    body: 'The run is finished, the certificate is published, and boxes are going out. ' +
      'You are hearing this because you asked to know first — it is a small run, and when it is gone the next batch starts from scratch.',
    cta: { label: 'Order your box →', path: '/product' },
    points: [
      ['30-day guarantee', 'give it a full month. If your bean isn’t visibly happier, it’s on us. No return label, no questions.'],
      ['Free shipping over $60', 'and cancel a plan anytime in one click, with no phone call.'],
      ['Certificate published', 'this batch’s third-party results are at happybeanie.com/certificates.']
    ]
  }
};

const ORDER = ['welcome', 'formula', 'screener', 'ready'];

function pointRows(points) {
  return points.map(function (p, i) {
    const pad = i === points.length - 1 ? '0 0 6px' : '0 0 12px';
    return '<tr><td style="padding:' + pad + ';"><span style="display:inline-block; width:22px; ' + MONO +
      ' font-size:11px; color:#325e3f; vertical-align:top;">0' + (i + 1) + '</span>' +
      '<span style="display:inline-block; width:520px; max-width:88%; ' + SANS +
      ' font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;"><b style="color:#17140f;">' +
      esc(p[0]) + '</b> — ' + esc(p[1]) + '</span></td></tr>';
  }).join('');
}

module.exports = function build(step, t) {
  const s = STEPS[step];
  if (!s) throw new Error('unknown waitlist step: ' + step);
  const opts = t || {};
  const name = opts.firstName ? esc(opts.firstName) : '';
  const url = SITE + s.cta.path + UTM + '_' + step;

  return '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>' + esc(s.subject) + '</title></head>\n<body style="margin:0; padding:0; background:#e7decb;">\n' +
  '<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:#e7decb; font-size:1px; line-height:1px;">' + esc(s.preheader) + '</div>\n' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e7decb;"><tr><td align="center" style="padding:28px 12px;">\n' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background:#fcfaf4; border:1px solid #e0d6c2; border-radius:10px; overflow:hidden;">\n' +
  '<tr><td style="background:#17140f; padding:22px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td align="left"><img src="' + SITE + '/assets/email-logo-2.png" width="133" height="38" alt="happy beanie" style="display:block; border:0; ' + SANS + ' font-size:20px; font-weight:700; letter-spacing:-0.5px; color:#f5f0e6;"></td>' +
    '<td align="right" style="' + MONO + ' font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">The&nbsp;list</td>' +
  '</tr></table></td></tr>\n' +
  '<tr><td style="height:3px; background:#f2ce59; font-size:0; line-height:0;">&nbsp;</td></tr>\n' +
  '<tr><td style="padding:38px 34px 6px;">\n' +
    '<p style="margin:0 0 14px; ' + MONO + ' font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">— &nbsp;' + esc(s.eyebrow) + '</p>' +
    '<h1 style="margin:0 0 14px; ' + SANS + ' font-size:27px; line-height:1.1; letter-spacing:-1px; font-weight:700; color:#17140f;">' + s.head(name) + '</h1>' +
    '<p style="margin:0 0 26px; ' + SANS + ' font-size:15.5px; line-height:1.62; color:#554c40;">' + esc(s.body) + '</p>\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr><td align="center" bgcolor="#f2ce59" style="border-radius:999px;">' +
      '<a href="' + esc(url) + '" style="display:block; padding:17px 24px; ' + MONO + ' font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:700; color:#17140f; text-decoration:none;">' + esc(s.cta.label) + '</a>' +
    '</td></tr></table>\n' +
    '<p style="margin:28px 0 12px; ' + MONO + ' font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">— &nbsp;Worth knowing</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + pointRows(s.points) + '</table>\n' +
  '</td></tr>\n' +
  '<tr><td style="background:#f5f0e6; border-top:1px solid #e0d6c2; padding:26px 34px 30px;" align="center">' +
    '<p style="margin:0 0 12px; ' + MONO + ' font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;">Formulated fresh · Scottsdale, AZ</p>' +
    '<p style="margin:0; ' + SANS + ' font-size:11px; line-height:1.6; color:#8a7f6e;">You’re getting this because you asked for first dibs at happybeanie.com.<br>' +
    '<a href="' + esc(opts.unsubUrl) + '" style="color:#325e3f; text-decoration:underline;">Unsubscribe</a> &nbsp;·&nbsp; <a href="mailto:hello@happybeanie.com" style="color:#325e3f; text-decoration:none;">hello@happybeanie.com</a> &nbsp;·&nbsp; © 2026 Happy Beanie · Scottsdale, AZ</p>' +
  '</td></tr>\n' +
  '</table></td></tr></table>\n</body>\n</html>';
};

module.exports.subject = function subject(step) {
  const s = STEPS[step];
  if (!s) throw new Error('unknown waitlist step: ' + step);
  return s.subject;
};

module.exports.text = function buildText(step, t) {
  const s = STEPS[step];
  if (!s) throw new Error('unknown waitlist step: ' + step);
  const opts = t || {};
  const lines = [
    s.head(opts.firstName || '').replace(/&[a-z]+;/g, ''),
    '',
    s.body,
    '',
    s.cta.label.replace(/\s*→$/, '') + ': ' + SITE + s.cta.path + UTM + '_' + step,
    '',
    'WORTH KNOWING'
  ];
  s.points.forEach(function (p) { lines.push('  - ' + p[0] + ': ' + p[1]); });
  lines.push('',
    'Questions? Reply to this email - a person reads this inbox.',
    '',
    'You are getting this because you asked for first dibs at happybeanie.com.',
    'Unsubscribe: ' + opts.unsubUrl,
    'Happy Beanie - Scottsdale, AZ');
  return lines.join('\n');
};

module.exports.STEPS = ORDER.slice();
module.exports.DEFS = STEPS;
