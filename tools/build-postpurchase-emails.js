// Embeds the designed post-purchase emails — email-templates/postpurchase/,
// the Setup_29 handoff — as the four steps of that flow.
//
//   node tools/build-postpurchase-emails.js
//
// The handoff's {{ merge_var }} placeholders are resolved here where the
// value is fixed (the CTAs, the price book, the chew count) and turned into
// per-recipient markers where it is not:
//
//   __HB_UNSUB__   the per-recipient unsubscribe link (also box_optout_url)
//   __HB_CHEWS__   halfway only — chews remaining, computed by the cron so
//                  the count tracks the order's age
//   __HB_RENEWS__  halfway-sub only — the next billing date, from Shopify
//
// halfway-sub is a DERIVED variant, not a fifth design file: the same
// 05-halfway-jar.html re-cut for people already on Subscribe & Save. The
// pitch becomes reassurance (the next jar is scheduled), the price
// comparison becomes plan + next-box date, and the CTA goes to /account.
// Every swap is anchored, so an edit to the design file that breaks the
// variant fails this build instead of shipping half of it.
//
// Prices come from the same book the cart nudge restates server-side:
// one-time $115, subscribe $99. Assets ship under /assets/email/pp/ (the
// handoff's big wordmark is downscaled to its 2x render size on the way in).
//
// Re-run after any edit to the templates, and commit both sides.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'email-templates/postpurchase');
const OUT = path.join(ROOT, 'api/_lib/postpurchase-designs.js');
const SITE = 'https://www.happybeanie.com';
const UNSUB_MARK = '__HB_UNSUB__';
const CHEWS_MARK = '__HB_CHEWS__';

function utm(tag) {
  return SITE + '/product?utm_source=email&utm_medium=lifecycle&utm_campaign=' + tag;
}

// step id → [file, {placeholder: value}]
const FILES = {
  checkin: ['04-day7-checkin.html', {
    research_url: utm('pp_checkin'),
    unsubscribe_url: UNSUB_MARK
  }],
  halfway: ['05-halfway-jar.html', {
    chews_remaining: CHEWS_MARK,
    chews_total: '30',
    one_time_price: '$115',
    subscribe_price: '$99',
    subscribe_url: utm('pp_halfway'),
    box_optout_url: UNSUB_MARK
  }],
  'halfway-sub': ['05-halfway-jar.html', {
    chews_remaining: CHEWS_MARK,
    chews_total: '30',
    subscribe_price: '$99',
    renews_on: '__HB_RENEWS__',
    subscribe_url: SITE + '/account?utm_source=email&utm_medium=lifecycle&utm_campaign=pp_halfway_sub',
    box_optout_url: UNSUB_MARK
  }],
  milestone: ['06-second-order.html', {
    share_url: 'mailto:hello@happybeanie.com?subject=Our%20bean%2C%20two%20boxes%20in',
    unsubscribe_url: UNSUB_MARK
  }],
  rescue: ['07-cancellation-confirmed.html', {
    restart_url: utm('pp_rescue'),
    unsubscribe_url: UNSUB_MARK
  }]
};

const RENEWS_MARK = '__HB_RENEWS__';
const MONO = "font-family:'DM Mono', 'Courier New', Courier, monospace;";

// The subscriber re-cut of 05, applied to the raw template before its
// placeholders resolve. Each anchor is an exact string from the design file.
const SUB_SWAPS = [
  ['<title>About halfway through the jar</title>',
    '<title>Halfway through &mdash; the next jar is scheduled</title>'],
  ['A 30 day box goes quicker than it sounds. Subscribe and the next one lands before this runs out.',
    'A 30 day box goes quicker than it sounds. Yours is already handled &mdash; the next one is scheduled.'],
  ['A 30 day box goes quicker than it sounds and right about now is when consistency starts to pay &mdash; don&rsquo;t let your bean lapse in their daily vitamins. Switching your plan to subscribe ensures no lapse in their plan, and you get a discount.',
    'A 30 day box goes quicker than it sounds and right about now is when consistency starts to pay. You&rsquo;re on Subscribe &amp; Save, so there&rsquo;s nothing to do &mdash; the next jar is already scheduled, and it lands before this one runs out.'],
  // Right (highlighted) cell first: the pitch price becomes the next-box
  // date. Order matters — the left-cell rewrite below inserts an identical
  // subscribe_price paragraph, so the right cell must be re-cut while its
  // anchors are still unique.
  ['>Subscribe &amp; Save</p>', '>Next box</p>'],
  ['>{{ subscribe_price }}</p>', '>{{ renews_on }}</p>'],
  ['>Monthly &middot; cancel whenever</p>', '>Before this one runs out</p>'],
  // Left panel cell: the struck-through one-time price becomes their plan.
  ['>One-time box</p>', '>Your plan</p>'],
  ["<p style=\"margin:0; " + MONO + " font-size:24px; line-height:28px; color:#8A7F6E; text-decoration:line-through; mso-line-height-rule:exactly;\">{{ one_time_price }}</p>",
    "<p style=\"margin:0 0 4px 0; " + MONO + " font-weight:500; font-size:24px; line-height:28px; color:#17140F; mso-line-height-rule:exactly;\">{{ subscribe_price }}</p><p style=\"margin:0; " + MONO + " font-size:10.5px; line-height:15px; letter-spacing:1.1px; text-transform:uppercase; color:#43684E; mso-line-height-rule:exactly;\">Subscribe &amp; Save &middot; active</p>"],
  ['>Switch to Subscribe &amp; Save &rarr;</a>', '>Manage your plan &rarr;</a>'],
  ['Set it up now and the next jar arrives before this one runs out.',
    'Need to pause, skip, or move the date? It&rsquo;s all in your account.'],
  ['You&rsquo;re getting this because you have an open 30-day box.',
    'You&rsquo;re getting this because you&rsquo;re halfway through your current box.']
];

const html = {};
Object.keys(FILES).forEach(function (step) {
  const file = FILES[step][0], vars = FILES[step][1];
  let h = fs.readFileSync(path.join(SRC, file), 'utf8');

  if (step === 'halfway-sub') {
    SUB_SWAPS.forEach(function (s) {
      if (h.indexOf(s[0]) === -1) throw new Error('halfway-sub anchor not found: ' + s[0]);
      h = h.replace(s[0], s[1]);
    });
  }

  Object.keys(vars).forEach(function (name) {
    const re = new RegExp('\\{\\{\\s*' + name + '\\s*\\}\\}', 'g');
    if (!re.test(h)) throw new Error(file + ': placeholder not found: ' + name);
    h = h.replace(re, vars[name]);
  });
  h = h.replace(/src="img\/([^"]+)"/g, 'src="' + SITE + '/assets/email/pp/$1"');

  if (/\{\{/.test(h)) throw new Error(file + ': an unresolved placeholder survived');
  if (/src="img\//.test(h)) throw new Error(file + ': a relative image path survived');
  if (/batch/i.test(h)) throw new Error(file + ': a batch reference survived');
  if (h.indexOf(UNSUB_MARK) === -1) throw new Error(file + ': no unsubscribe link to personalise');
  html[step] = h;
});

fs.writeFileSync(OUT,
  '// GENERATED by tools/build-postpurchase-emails.js — do not edit.\n' +
  '//\n' +
  '// The design source is email-templates/postpurchase/ (the Setup_29\n' +
  '// handoff). Edit those, re-run the generator, and commit both.\n' +
  '// postpurchase-email.js swaps the markers per recipient.\n' +
  '\n' +
  'module.exports = {\n' +
  '  UNSUB_MARK: ' + JSON.stringify(UNSUB_MARK) + ',\n' +
  '  CHEWS_MARK: ' + JSON.stringify(CHEWS_MARK) + ',\n' +
  '  RENEWS_MARK: ' + JSON.stringify(RENEWS_MARK) + ',\n' +
  '  html: {\n' +
  Object.keys(html).map(function (s) {
    return '    ' + JSON.stringify(s) + ': ' + JSON.stringify(html[s]);
  }).join(',\n') + '\n' +
  '  }\n' +
  '};\n');
console.log('wrote', path.relative(ROOT, OUT), '·',
  Object.keys(html).map(function (s) { return s + ' ' + Math.round(html[s].length / 1024) + 'KB'; }).join(' · '));
