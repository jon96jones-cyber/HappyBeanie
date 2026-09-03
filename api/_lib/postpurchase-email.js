// The post-purchase emails — sent to people who have actually bought, which
// makes them the highest-stakes copy in the system: a buyer's inbox is earned.
//
//   checkin   · ~day 7 after a first order   · expectations, honestly set
//   halfway   · ~day 21 into a 30-day box    · the Subscribe & Save pitch
//   milestone · ~a week after a second order · the review / photo ask
//   rescue    · a cancelled subscription     · the door left open
//
// Sent by api/cron/post-purchase.js (first three) and api/cron/sub-rescue.js.
// Failed RENEWAL PAYMENTS are deliberately absent: Shopify's native
// subscription dunning already emails those, and that is the transactional
// side of the line — a second email from us would just be a duplicate.
//
// build(step, t) → html   with t = { unsubUrl }
// build.text(step, t)     the plain-text alternate
// build.subject(step)     subject line
//
// Same design family as the lifecycle set: 600px table, dark header bar with
// the wordmark, 3px gold rule, one gold pill CTA per email.

const SITE = 'https://www.happybeanie.com';
const WORDMARK = SITE + '/assets/email/lifecycle/hb-wordmark.png';

const INK = '#17140F', PAPER = '#FAF8F1', PAGE = '#DED5C4', GOLD = '#F0C64B',
      BODY = '#4A4237', MUTED = '#8A7F6E', HAIR = '#E0D6C3', FOOT_BG = '#F2EEE3';
const SANS = "'DM Sans', Arial, 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'DM Mono', 'Courier New', Courier, monospace";

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function utm(path, tag) {
  return SITE + path + (path.indexOf('?') === -1 ? '?' : '&') +
    'utm_source=email&utm_medium=lifecycle&utm_campaign=' + tag;
}

const STEPS = {
  checkin: {
    subject: 'One week in',
    preheader: 'What the first week does, and what the next month will.',
    eyebrow: 'The first week',
    title: 'By now it&rsquo;s a habit. The rest takes longer.',
    paras: [
      'A week in, the win to look for is the small one: the chew disappears without negotiation, same time every day. That routine is the whole delivery mechanism &mdash; the actives only do their work if they show up daily.',
      'The honest timeline for everything else: the changes owners come to trust &mdash; energy, movement, coat &mdash; tend to show over weeks, not days. And if the bean is turning their nose up, or anything seems off, reply to this email. A person reads it, same day.'
    ],
    cta: { label: 'Read the research', href: utm('/product', 'pp_checkin') },
    text: [
      'One week in.',
      '',
      'The win to look for is the small one: the chew disappears without',
      'negotiation, same time every day. The changes owners come to trust -',
      'energy, movement, coat - tend to show over weeks, not days.',
      'Anything seem off? Reply to this email. A person reads it, same day.'
    ]
  },
  halfway: {
    subject: 'About halfway through the jar',
    preheader: 'A note on timing, and the cheaper way to keep the routine going.',
    eyebrow: 'Day 21, give or take',
    title: 'Halfway through the jar already.',
    paras: [
      'A 30-day box goes quicker than it sounds &mdash; and right about now is when consistency starts to pay, which makes an empty jar the worst-timed pause in the whole routine.',
      'If the bean is taking it happily, Subscribe &amp; Save is the same box at $99 instead of $115 &mdash; one a month, cancel whenever. Set it up now and the next jar arrives before this one runs out.'
    ],
    cta: { label: 'Switch to Subscribe &amp; Save', href: utm('/product', 'pp_halfway') },
    text: [
      'Halfway through the jar already.',
      '',
      'A 30-day box goes quicker than it sounds. If the bean is taking it',
      'happily, Subscribe & Save is the same box at $99 instead of $115 -',
      'one a month, cancel whenever. Set it up now and the next jar arrives',
      'before this one runs out.'
    ]
  },
  milestone: {
    subject: 'Two boxes in — a small favor',
    preheader: 'You reordered, which says more than any ad we could write.',
    eyebrow: 'Box two',
    title: 'You came back. Can we quote you on that?',
    paras: [
      'A second box is the only endorsement that counts in this business, and yours didn&rsquo;t go unnoticed. Thank you.',
      'If you have two minutes: reply with a line about what changed for your bean &mdash; and a photo, if you have one. The best ones end up on the site (we&rsquo;ll ask first), and every single one is read by the people who make the chew.'
    ],
    cta: { label: 'Share your bean', href: 'mailto:hello@happybeanie.com?subject=Our%20bean%2C%20two%20boxes%20in' },
    text: [
      'You came back. Can we quote you on that?',
      '',
      'A second box is the only endorsement that counts in this business.',
      'If you have two minutes, reply with a line about what changed for',
      'your bean - and a photo, if you have one. Every single one is read',
      'by the people who make the chew.'
    ]
  },
  rescue: {
    subject: 'Cancelled, as asked',
    preheader: 'No hard feelings — and no hoops if you ever want back in.',
    eyebrow: 'Subscription &middot; cancelled',
    title: 'Done &mdash; it&rsquo;s cancelled.',
    paras: [
      'Your Subscribe &amp; Save is off: no more boxes, no more charges, and no retention offer dressed up as a survey.',
      'If the reason was something we got wrong &mdash; the chew, the timing, the price &mdash; reply and say so; it goes straight to the people who can fix it. And if you ever want back in, the door is a click, not a phone call.'
    ],
    cta: { label: 'Start it back up', href: utm('/product', 'pp_rescue') },
    text: [
      'Done - it’s cancelled.',
      '',
      'No more boxes, no more charges, and no retention offer dressed up as',
      'a survey. If the reason was something we got wrong, reply and say so.',
      'And if you ever want back in, the door is a click, not a phone call.'
    ]
  }
};

function pick(step) {
  const s = STEPS[String(step)];
  if (!s) throw new Error('unknown post-purchase step: ' + step);
  return s;
}

function build(step, t) {
  const s = pick(step);
  const unsub = esc((t && t.unsubUrl) || SITE + '/api/unsubscribe');
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
    '<a href="' + s.cta.href + '" style="display:inline-block; background-color:' + GOLD + '; color:' + INK + '; font-family:' + MONO + '; font-size:12.5px; letter-spacing:0.2em; text-transform:uppercase; text-decoration:none; padding:17px 30px; border-radius:999px;">' + s.cta.label + ' &rarr;</a>' +
    '</td></tr>' +

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
  lines.push('', s.cta.label.replace(/&amp;/g, '&') + ': ' + s.cta.href);
  if (t && t.unsubUrl) lines.push('', 'Unsubscribe: ' + t.unsubUrl);
  return lines.join('\n');
};

build.subject = function (step) { return pick(step).subject; };
build.STEPS = ['checkin', 'halfway', 'milestone', 'rescue'];

module.exports = build;
