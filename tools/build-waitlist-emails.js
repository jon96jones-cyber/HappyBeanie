// Turns email-templates/waitlist/*.html into api/_lib/waitlist-email.js.
//
//   node tools/build-waitlist-emails.js
//
// The four HTML files are the design source and are never edited by hand here.
// This embeds them in a module so they are guaranteed to ship inside the
// serverless bundle (reading them from disk at runtime is not), and applies the
// three fixes the handoff asks for plus two the site needs:
//
//   img/X                → an absolute https URL, because a recipient cannot
//                          read a local file. The README calls for this.
//   happybeanie.com      → www.happybeanie.com. The apex 301s to www, and
//                          every hop is a chance for a scanner to give up.
//   /screener            → /quiz. There is no /screener route; the SPA's
//                          VALID_PAGES has no such page, so that link lands on
//                          the homepage — and it is the only CTA in email 03.
//   CTA                  → carries UTM so the sequence shows up in analytics.
//   /unsubscribe         → a marker, swapped per recipient at send time.
//
// Re-run this after any edit to the templates.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'email-templates/waitlist');
const OUT = path.join(ROOT, 'api/_lib/waitlist-email.js');
const SITE = 'https://www.happybeanie.com';
const UNSUB_MARK = '__HB_UNSUB__';
// The mock copy carries a stand-in name and a stand-in date. Left alone they
// would ship: every recipient greeted as Jordan, and a certificate "published"
// on the day the design was drawn rather than the day the batch actually
// cleared. Both become fields the sender has to fill.
const NAME_MARK = '__HB_NAME__';
const DATE_MARK = '__HB_PUBLISHED__';
const MOCK_NAME = /,\s*Jordan\./g;
const MOCK_DATE = /1 Sep 2026/g;

const STEPS = [
  { key: 'welcome',  file: '01-welcome.html',  subject: 'You’re on the list' },
  { key: 'formula',  file: '02-formula.html',  subject: 'What actually goes in it' },
  { key: 'screener', file: '03-screener.html', subject: 'Worth checking first' },
  { key: 'ready',    file: '04-ready.html',    subject: 'It’s ready' }
];

// Short plain-text alternates. Not in the handoff, and a multipart send without
// one is a spam signal — so they are written here rather than derived from the
// HTML, which would read like a stripped web page.
const TEXT = {
  welcome: [
    'You are on the list.',
    '',
    'Happy Beanie is a daily soft chew for hormone and joint health, blended',
    'in small runs in our own lab in Scottsdale. Batch 0072 is in production',
    'now. You will hear from us a few times before it ships, and on the day',
    'it does.',
    '',
    'See what is in the chew: ' + SITE + '/product'
  ],
  formula: [
    'What actually goes in it.',
    '',
    'Ten inputs, each one there for a reason we can name. The full list, with',
    'quantities, is on the product page.',
    '',
    'Read the ingredient list: ' + SITE + '/product#inside'
  ],
  screener: [
    'Worth checking first.',
    '',
    'Not every pet should take this, and we would rather tell you now than',
    'after you have paid. Eight questions, checked against every ingredient',
    'in the formula. Two minutes, and it will tell you plainly if the answer',
    'is no.',
    '',
    'Check your pet: ' + SITE + '/quiz'
  ],
  ready: [
    'It is ready.',
    '',
    'The run is finished, the certificate is published, and boxes are going',
    'out. It is a small run — when it is gone, the next batch starts from',
    'scratch.',
    '',
    'Order your box: ' + SITE + '/product'
  ]
};

function transform(html, key) {
  let out = html;

  // Assets: local paths a recipient cannot resolve become absolute.
  out = out.replace(/src="img\/([^"]+)"/g, 'src="' + SITE + '/assets/email/$1"');

  // The route that does not exist. Do this before the host rewrite so both
  // spellings of the host are covered.
  out = out.replace(/(https?:\/\/(?:www\.)?happybeanie\.com)\/screener\b/g, '$1/quiz');

  // Apex to www, so no link spends a redirect.
  out = out.replace(/https:\/\/happybeanie\.com/g, SITE);

  // Per-recipient, filled in at send time.
  out = out.replace(new RegExp(SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/unsubscribe', 'g'), UNSUB_MARK);
  out = out.replace(MOCK_NAME, NAME_MARK);
  out = out.replace(MOCK_DATE, DATE_MARK);

  // Tag the one content CTA so the sequence is legible in analytics. The
  // mailto and the unsubscribe marker are deliberately left alone.
  const utm = 'utm_source=email&utm_medium=lifecycle&utm_campaign=waitlist_' + key;
  out = out.replace(new RegExp('href="(' + SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^"]*)"', 'g'), function (m, url) {
    if (url.indexOf(UNSUB_MARK) !== -1) return m;
    const hash = url.indexOf('#');
    const frag = hash === -1 ? '' : url.slice(hash);
    const base = hash === -1 ? url : url.slice(0, hash);
    return 'href="' + base + (base.indexOf('?') === -1 ? '?' : '&') + utm + frag + '"';
  });

  return out;
}

const parts = STEPS.map(function (s) {
  const raw = fs.readFileSync(path.join(SRC, s.file), 'utf8');
  const html = transform(raw, s.key);
  if (html.indexOf(UNSUB_MARK) === -1) throw new Error(s.file + ': no unsubscribe link found to personalise');
  if (/src="img\//.test(html)) throw new Error(s.file + ': a local image path survived the rewrite');
  return '  ' + JSON.stringify(s.key) + ': {\n' +
    '    subject: ' + JSON.stringify(s.subject) + ',\n' +
    '    needsDate: ' + (html.indexOf(DATE_MARK) !== -1) + ',\n' +
    '    html: ' + JSON.stringify(html) + ',\n' +
    '    text: ' + JSON.stringify(TEXT[s.key].join('\n')) + '\n' +
    '  }';
});

const module_ = `// GENERATED by tools/build-waitlist-emails.js — do not edit.
//
// The design source is email-templates/waitlist/*.html. Edit those, re-run the
// generator, and commit both. Editing this file by hand means the next run
// silently throws your change away.
//
// build(step, { unsubUrl })  →  html with the recipient's own opt-out link
// build.text(step, t)        →  the plain-text alternate
// build.subject(step)        →  subject line
// build.STEPS                →  step keys, in order

const UNSUB_MARK = ${JSON.stringify(UNSUB_MARK)};
const NAME_MARK = ${JSON.stringify(NAME_MARK)};
const DATE_MARK = ${JSON.stringify(DATE_MARK)};

const MAIL = {
${parts.join(',\n')}
};

const ORDER = ${JSON.stringify(STEPS.map(function (s) { return s.key; }))};

function pick(step) {
  const m = MAIL[step];
  if (!m) throw new Error('unknown waitlist step: ' + step);
  return m;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Most footer signups are an address and nothing else, so a greeting has to
// read correctly with no name at all: "You're on the list." rather than a
// dangling comma or an empty space where a name should be.
function greeting(firstName) {
  const n = String(firstName || '').trim();
  return n ? ', ' + esc(n) + '.' : '.';
}

module.exports = function build(step, t) {
  const o = t || {};
  const url = o.unsubUrl || '';
  if (!url) throw new Error('waitlist email needs an unsubUrl — every send must carry a working opt-out');
  const m = pick(step);
  if (m.needsDate && !o.publishedOn) {
    throw new Error(step + ' states a certificate publication date; pass publishedOn rather than shipping the mock');
  }
  return m.html
    .split(UNSUB_MARK).join(url)
    .split(NAME_MARK).join(greeting(o.firstName))
    .split(DATE_MARK).join(esc(o.publishedOn || ''));
};

module.exports.text = function text(step, t) {
  const o = t || {};
  return pick(step).text +
    '\\n\\nYou are getting this because you asked for first dibs at happybeanie.com.' +
    '\\nUnsubscribe: ' + (o.unsubUrl || '') +
    '\\nHappy Beanie - 7180 E Main St, Scottsdale, AZ 85251';
};

module.exports.subject = function subject(step) { return pick(step).subject; };
module.exports.STEPS = ORDER.slice();
`;

fs.writeFileSync(OUT, module_);
console.log('wrote ' + path.relative(ROOT, OUT) + ' — ' + STEPS.length + ' emails, ' +
  Math.round(module_.length / 1024) + 'KB');
STEPS.forEach(function (s) {
  const raw = fs.readFileSync(path.join(SRC, s.file), 'utf8');
  console.log('  ' + s.key.padEnd(9) + ' ' + String(Math.round(raw.length / 1024)).padStart(2) + 'KB  ' + s.subject);
});
