// Embeds the designed welcome email — email-templates/waitlist/01-welcome.html —
// as step 1 of the welcome sequence.
//
//   node tools/build-welcome-hello.js
//
// The design predates the store opening: it was drawn as the waitlist's
// confirmation email, built around a batch-production countdown. The batch
// framing is dead ("this wont matter in a couple of weeks"), so every line of
// it is rewritten on the way through — but the design itself carries over
// whole: the hero, the dark four-column strip, the gold pill, the numbered
// list. The strip that tracked the batch now walks the daily routine.
//
// Two markers are left in the output for send-time personalisation:
//   __HB_UNSUB__     the per-recipient unsubscribe link
//   __HB_CODEROW__   an optional discount-code strip (empty when no code)
//
// Re-run after any edit to the template, and commit both files.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'email-templates/waitlist/01-welcome.html');
const OUT = path.join(ROOT, 'api/_lib/welcome-hello-email.js');
const SITE = 'https://www.happybeanie.com';
const UNSUB_MARK = '__HB_UNSUB__';
const CODEROW_MARK = '__HB_CODEROW__';

let html = fs.readFileSync(SRC, 'utf8');

const swaps = [
  ['<title>You&rsquo;re on the list</title>', '<title>One chew, once a day</title>'],
  ['Batch 0072 is in production and ships in about four weeks. Here is what happens next.',
    'What the bean is, what is in it, and how the daily routine goes.'],
  ['&mdash;&nbsp;&nbsp;Waitlist &middot; Confirmed', '&mdash;&nbsp;&nbsp;Welcome &middot; The daily ritual'],
  ['You&rsquo;re on the list, Jordan.', 'One chew, once a day. That&rsquo;s the whole routine.'],
  ['Happy Beanie is a daily supplement for hormone and joint health, blended in small runs in our own lab in Scottsdale. Batch 0072 is in production now and ships in about four weeks. You&rsquo;ll hear from us two or three times before then, and on the day it ships.',
    'Happy Beanie is a peptide-infused daily chew &mdash; one formulation for dogs, one for cats &mdash; compounded in Scottsdale and third-party tested, with every certificate published. It works like a treat, not a treatment: one chew after food, before the walk.'],
  // The four-column strip: batch progress → the daily routine. Column two
  // keeps the template's highlight; the two unlit bars light up gold because
  // a routine has no "not yet" stages.
  ['Batch 0072 &middot; where it is now', 'The daily routine &middot; how it goes'],
  ['>Formulated</p>', '>After food</p>'],
  ['>Recipe locked</p>', '>Meal first, then bean</p>'],
  ['>Blending</p>', '>One chew</p>'],
  ['>Happening now</p>', '>Once a day</p>'],
  ['>Testing</p>', '>Scored</p>'],
  ['>Third party</p>', '>Half dose is exact</p>'],
  ['>Ships</p>', '>One box</p>'],
  ['>~4 weeks</p>', '>30 days</p>'],
  [/#3A342A/g, '#F0C64B'],
  ['<strong style="color:#17140F;">Made to order</strong> &mdash; we blend a run at a time rather than warehousing it, so a box is mixed close to when it ships.',
    '<strong style="color:#17140F;">Works like a treat</strong> &mdash; most beans take it on the first try. No mixing, no measuring, no pill pocket.'],
  ['<strong style="color:#17140F;">Every lot third-party tested</strong> &mdash; the certificate for a batch is published before that batch ships. They are all at happybeanie.com/certificates.',
    '<strong style="color:#17140F;">Every lot third-party tested</strong> &mdash; every certificate is published at happybeanie.com/certificates before a single box ships.'],
  ['you asked for first dibs at happybeanie.com', 'you signed up for emails from Happy Beanie'],
  [/src="img\/([^"]+)"/g, 'src="' + SITE + '/assets/email/$1"'],
  ['https://happybeanie.com/product',
    SITE + '/product?utm_source=email&utm_medium=lifecycle&utm_campaign=welcome_1'],
  [/https:\/\/happybeanie\.com\/unsubscribe/g, UNSUB_MARK],
  // Anything else on the apex spends a redirect for nothing.
  [/https:\/\/happybeanie\.com/g, SITE]
];
swaps.forEach(function (s) {
  if (typeof s[0] === 'string' && html.indexOf(s[0]) === -1) {
    throw new Error('anchor not found in template: ' + s[0]);
  }
  html = html.replace(s[0], s[1]);
});

// The optional code strip slots in just above "Worth knowing" — the margin
// anchor is what tells this row opener apart from the identical one higher up.
const codeAnchor = '<tr><td class="sm-pad" style="padding:34px 44px 0 44px;">\n    <p style="margin:0 0 2px 0;';
if (html.indexOf(codeAnchor) === -1) throw new Error('code-strip anchor not found');
html = html.replace(codeAnchor, CODEROW_MARK + codeAnchor);

if (/src="img\//.test(html)) throw new Error('a relative image path survived');
if (/batch/i.test(html)) throw new Error('a batch reference survived');
if (/Jordan/.test(html)) throw new Error('the mock name survived');
if (html.indexOf(UNSUB_MARK) === -1) throw new Error('no unsubscribe link found to personalise');
if (html.indexOf(CODEROW_MARK) === -1) throw new Error('no code-strip marker in output');

fs.writeFileSync(OUT,
  '// GENERATED by tools/build-welcome-hello.js — do not edit.\n' +
  '//\n' +
  '// The design source is email-templates/waitlist/01-welcome.html. Edit that,\n' +
  '// re-run the generator, and commit both. This is welcome step 1: the\n' +
  '// designed welcome email with the batch countdown rewritten to the daily\n' +
  '// routine. welcome-email.js swaps the UNSUB and CODEROW markers per\n' +
  '// recipient.\n' +
  '\n' +
  'module.exports = {\n' +
  '  UNSUB_MARK: ' + JSON.stringify(UNSUB_MARK) + ',\n' +
  '  CODEROW_MARK: ' + JSON.stringify(CODEROW_MARK) + ',\n' +
  '  html: ' + JSON.stringify(html) + '\n' +
  '};\n');
console.log('wrote', path.relative(ROOT, OUT), '·', Math.round(html.length / 1024) + 'KB');
