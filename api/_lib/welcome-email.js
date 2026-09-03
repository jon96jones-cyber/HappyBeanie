// The welcome sequence — three emails on time-since-consent, sent by
// api/cron/send-welcome.js. This replaces the retired waitlist series: that
// one was written for a pre-launch list with no discount in hand and leaned
// on the production batch; this one assumes the store is simply open.
//
//   1 · day 2  · the designed welcome — what the chew is, the daily routine
//   2 · day 5  · the screener — the least salesy email we can send
//   3 · day 12 · the research, pointing at the evidence pile
//
// build(step, t) → html   with t = { code, expiresLabel, unsubUrl }
// build.text(step, t)     the plain-text alternate
// build.subject(step)     subject line
// build.STEPS             ['1','2','3']
//
// `code` is optional on purpose: someone who consented at Shopify's checkout
// holds no popup code, and the email must read whole without one. When a code
// exists it appears as a quiet strip, not the headline — these emails are the
// relationship, the code email already did the transaction.
//
// Same design family as the lifecycle set (Setup_27/28): 600px table, dark
// header bar with the wordmark, 3px gold rule, DM Sans/Mono with real
// fallbacks, one gold pill CTA per email.

const SITE = 'https://www.happybeanie.com';
const WORDMARK = SITE + '/assets/email/lifecycle/hb-wordmark.png';
// Steps 1 and 2 are not built here at all: designed emails already existed in
// the waitlist series, and a design in hand beats copy written to fill its
// place. Generators de-waitlist them; this module only personalises them.
// (Step 1's STEPS entry below still supplies its subject and text alternate.)
const hello = require('./welcome-hello-email.js');
const screener = require('./welcome-screener-email.js');

const INK = '#17140F', PAPER = '#FAF8F1', PAGE = '#DED5C4', GOLD = '#F0C64B',
      BODY = '#4A4237', MUTED = '#8A7F6E', HAIR = '#E0D6C3', FOOT_BG = '#F2EEE3';
const SANS = "'DM Sans', Arial, 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'DM Mono', 'Courier New', Courier, monospace";

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function utm(path, step) {
  return SITE + path + (path.indexOf('?') === -1 ? '?' : '&') +
    'utm_source=email&utm_medium=lifecycle&utm_campaign=welcome_' + step;
}

const STEPS = {
  '1': {
    subject: 'One chew, once a day',
    preheader: 'What the bean is, what is in it, and how the first week goes.',
    eyebrow: 'The daily ritual',
    title: 'One chew, once a day. That&rsquo;s the whole routine.',
    paras: [
      'Happy Beanie is a peptide-infused daily chew &mdash; one formulation for dogs, one for cats &mdash; compounded in Scottsdale and third-party tested, with every certificate published.',
      'It works like a treat, not a treatment: one chew after food, before the walk. Most beans take it on the first try, and each chew is scored down the middle so a half dose is exact &mdash; no mixing, no measuring, no pill pocket.'
    ],
    cta: { label: 'Pick your box', path: '/product' },
    text: [
      'One chew, once a day. That is the whole routine.',
      '',
      'Happy Beanie is a peptide-infused daily chew - one formulation for dogs,',
      'one for cats - compounded in Scottsdale and third-party tested, with every',
      'certificate published. One chew after food, before the walk.'
    ]
  },
  '2': {
    subject: 'Worth checking first',
    preheader: 'Not every pet should take this. The screener will tell you plainly.',
    eyebrow: 'Before you order',
    title: 'We&rsquo;d rather tell you no.',
    paras: [
      'Not every pet should take this &mdash; a puppy still growing, a cat on certain medications &mdash; and we would rather say so before you pay than after.',
      'The screener is eight questions checked against every ingredient in the formula. Two minutes, and it answers plainly: a yes, a no, or a &ldquo;not yet, check back at twelve months.&rdquo;'
    ],
    cta: { label: 'Run the screener', path: '/quiz' },
    text: [
      'We would rather tell you no.',
      '',
      'Not every pet should take this, and we would rather say so before you',
      'pay than after. Eight questions, checked against every ingredient.',
      'Two minutes, and it answers plainly.'
    ]
  },
  '3': {
    subject: 'The research behind the bean',
    preheader: 'Independent studies on the ingredients — none funded by us.',
    eyebrow: 'The evidence',
    title: 'We did the research so you don&rsquo;t have to.',
    paras: [
      'Every active in the formula is there because published work says it should be: mushroom compounds that lengthened survival in dogs, taurine that reversed heart failure in cats, collagen peptides that survive digestion and reach the tissue that needs them.',
      'The studies are stacked on the product page &mdash; journal, trial design, and a link to every paper. Happy Beanie funded none of them, and none of them tested our chew. That is exactly why they are worth your time.'
    ],
    cta: { label: 'Read the studies', path: '/product' },
    text: [
      'We did the research so you don’t have to.',
      '',
      'Mushroom compounds that lengthened survival in dogs. Taurine that',
      'reversed heart failure in cats. Collagen peptides that reach the tissue',
      'that needs them. The studies are on the product page - journal, design,',
      'and a link to every paper. We funded none of them.'
    ]
  }
};

function pick(step) {
  const s = STEPS[String(step)];
  if (!s) throw new Error('unknown welcome step: ' + step);
  return s;
}

// The code strip — shown only when the recipient actually holds a live code.
function codeRow(t, step) {
  if (!t || !t.code) return '';
  return '<tr><td style="padding:0 40px 30px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1.5px dashed ' + INK + '; border-radius:3px;">' +
    '<tr><td style="padding:14px 18px; font-family:' + MONO + '; font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:' + MUTED + ';">' +
    'Your 10% code &middot; one order' + (t.expiresLabel ? ' &middot; until ' + esc(t.expiresLabel) : '') +
    '<span style="float:right; font-family:' + MONO + '; font-size:15px; letter-spacing:0.08em; color:' + INK + ';">' + esc(t.code) + '</span>' +
    '</td></tr></table></td></tr>';
}

// The code strip in the designed welcome's own rhythm — 44px gutters, the
// sm-pad mobile class — slotted at its marker only when a code exists.
function helloCodeRow(t) {
  if (!t || !t.code) return '';
  return '<tr><td class="sm-pad" style="padding:30px 44px 0 44px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1.5px dashed ' + INK + '; border-radius:3px;">' +
    '<tr><td style="padding:14px 18px; font-family:' + MONO + '; font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:' + MUTED + ';">' +
    'Your 10% code &middot; one order' + (t.expiresLabel ? ' &middot; until ' + esc(t.expiresLabel) : '') +
    '<span style="float:right; font-family:' + MONO + '; font-size:15px; letter-spacing:0.08em; color:' + INK + ';">' + esc(t.code) + '</span>' +
    '</td></tr></table></td></tr>';
}

function build(step, t) {
  const s = pick(step);
  const unsub = esc((t && t.unsubUrl) || SITE + '/api/unsubscribe');
  // The designed welcome, with its two markers filled per recipient.
  if (String(step) === '1') {
    return hello.html
      .split(hello.UNSUB_MARK).join(unsub)
      .split(hello.CODEROW_MARK).join(helloCodeRow(t));
  }
  // The designed screener, exactly as drawn — no code strip; it should ask
  // for two minutes and nothing else.
  if (String(step) === '2') {
    return screener.html.split(screener.UNSUB_MARK).join(unsub);
  }
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + s.subject + '</title></head>' +
    '<body style="margin:0; padding:0; width:100%; background-color:' + PAGE + ';">' +
    '<div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; color:' + PAGE + ';">' + esc(s.preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:' + PAGE + ';"><tr><td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background-color:' + PAPER + '; border-radius:4px; overflow:hidden;">' +

    '<tr><td style="background-color:' + INK + '; padding:22px 40px 19px; border-bottom:3px solid ' + GOLD + ';">' +
    '<img src="' + WORDMARK + '" width="159" height="26" alt="happy beanie" style="display:block; border:0;"></td></tr>' +

    '<tr><td style="padding:36px 40px 6px; font-family:' + MONO + '; font-size:10.5px; letter-spacing:0.2em; text-transform:uppercase; color:#43684E;">' + s.eyebrow + '</td></tr>' +
    '<tr><td style="padding:0 40px 14px; font-family:' + SANS + '; font-weight:bold; font-size:31px; line-height:36px; letter-spacing:-1px; color:' + INK + ';">' + s.title + '</td></tr>' +

    s.paras.map(function (p) {
      return '<tr><td style="padding:0 40px 16px; font-family:' + SANS + '; font-size:16px; line-height:26px; letter-spacing:-0.2px; color:' + BODY + ';">' + p + '</td></tr>';
    }).join('') +

    '<tr><td style="padding:10px 40px 26px;">' +
    '<a href="' + utm(s.cta.path, step) + '" style="display:inline-block; background-color:' + GOLD + '; color:' + INK + '; font-family:' + MONO + '; font-size:12.5px; letter-spacing:0.2em; text-transform:uppercase; text-decoration:none; padding:17px 30px; border-radius:999px;">' + s.cta.label + ' &rarr;</a>' +
    '</td></tr>' +

    codeRow(t, step) +

    '<tr><td style="background-color:' + FOOT_BG + '; border-top:1px solid ' + HAIR + '; padding:22px 40px 26px;">' +
    '<p style="margin:0 0 8px; font-family:' + MONO + '; font-size:9.5px; letter-spacing:0.16em; text-transform:uppercase; color:' + MUTED + ';">Formulated fresh &middot; Scottsdale, AZ</p>' +
    '<p style="margin:0; font-family:' + SANS + '; font-size:12px; line-height:19px; color:' + MUTED + ';">You&rsquo;re getting this because you signed up for emails from Happy Beanie.<br>' +
    '<a href="' + unsub + '" style="color:' + MUTED + ';">Unsubscribe</a> &middot; hello@happybeanie.com &middot; &copy; 2026 Happy Beanie &middot; 7180 E Main St, Scottsdale, AZ 85251</p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

build.text = function (step, t) {
  const s = pick(step);
  const lines = s.text.slice();
  lines.push('', s.cta.label + ': ' + utm(s.cta.path, step));
  if (t && t.code) {
    lines.push('', 'Your 10% code (one order' + (t.expiresLabel ? ', until ' + t.expiresLabel : '') + '): ' + t.code);
  }
  if (t && t.unsubUrl) lines.push('', 'Unsubscribe: ' + t.unsubUrl);
  return lines.join('\n');
};

build.subject = function (step) { return pick(step).subject; };
build.STEPS = ['1', '2', '3'];

module.exports = build;
