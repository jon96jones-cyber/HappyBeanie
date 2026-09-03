// The post-purchase emails — sent to people who have actually bought, which
// makes them the highest-stakes copy in the system: a buyer's inbox is earned.
//
//   checkin     · ~day 7 after a first order  · the honest timeline
//   halfway     · ~day 21 into a 30-day box   · the Subscribe & Save pitch
//   halfway-sub · same day, for subscribers   · the next jar is scheduled
//   milestone   · just after a second order   · the review / photo ask
//   rescue      · a cancelled subscription    · the confirmation, door open
//
// The HTML is the DESIGNED set from the Setup_29 handoff, embedded by
// tools/build-postpurchase-emails.js — edit email-templates/postpurchase/
// and re-run the generator, never the strings here. This module only
// personalises the markers and supplies subjects and text alternates.
//
// Per the handoff, rescue is TRANSACTIONAL — it confirms a cancellation the
// customer asked for, so its cron sends it regardless of marketing consent.
// Failed RENEWAL PAYMENTS stay absent on purpose: Shopify's native
// subscription dunning already emails those.
//
// build(step, t) → html   with t = { unsubUrl, chewsRemaining (halfway*),
//                                    renewsOn (halfway-sub) }
// build.text(step, t)     the plain-text alternate
// build.subject(step)     subject line

const designs = require('./postpurchase-designs.js');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SITE = 'https://www.happybeanie.com';

function utm(tag) {
  return SITE + '/product?utm_source=email&utm_medium=lifecycle&utm_campaign=' + tag;
}

// Subjects come from the handoff's campaigns.json; the text alternates
// restate each design's copy for clients that want plain text.
const STEPS = {
  checkin: {
    subject: 'One week in',
    text: [
      'One week in - by now it’s a habit. The rest takes longer.',
      '',
      'The honest timeline: week 1 the habit lands, the chew taken at the',
      'same time daily. Weeks 2-4, appetite and energy - the first changes',
      'owners tend to notice. Weeks 6+, movement - the slow ones.',
      'Weeks, not days.',
      '',
      'Anything seems off? Reply to this email - a person reads it, same day.',
      '',
      'Read the research: ' + utm('pp_checkin')
    ]
  },
  halfway: {
    subject: 'About halfway through the jar',
    text: [
      'Halfway through the box already.',
      '',
      'A 30 day box goes quicker than it sounds, and right about now is when',
      'consistency starts to pay - don’t let your bean lapse in their daily',
      'vitamins. Subscribe & Save is the same box at $99 instead of $115 -',
      'monthly, cancel whenever. Set it up now and the next jar arrives',
      'before this one runs out.',
      '',
      'Switch to Subscribe & Save: ' + utm('pp_halfway')
    ]
  },
  'halfway-sub': {
    subject: 'Halfway through — the next jar is scheduled',
    text: [
      'Halfway through the box already.',
      '',
      'A 30 day box goes quicker than it sounds, and right about now is when',
      'consistency starts to pay. You’re on Subscribe & Save, so there’s',
      'nothing to do - the next jar is already scheduled, and it lands',
      'before this one runs out.',
      '',
      'Need to pause, skip, or move the date? It’s all in your account:',
      SITE + '/account'
    ]
  },
  milestone: {
    subject: 'Two boxes in — a small favor',
    text: [
      'You came back!',
      '',
      'A second box is the only endorsement that counts in this business,',
      'and yours didn’t go unnoticed. Thank you for your trust and support.',
      '',
      'If you have a minute, reply with a line about what changed for your',
      'bean. A sentence is plenty. A photo is a bonus.',
      '',
      'Share your bean: hello@happybeanie.com'
    ]
  },
  rescue: {
    subject: 'Cancelled, as asked',
    text: [
      'Done - it’s cancelled.',
      '',
      'Your Subscribe & Save is off. Nothing else will ship, and this is the',
      'last email about it. Coming back? The door is only a click away -',
      'same box, same price, no re-onboarding.',
      '',
      'Start it back up: ' + utm('pp_rescue')
    ]
  }
};

function pick(step) {
  const s = STEPS[String(step)];
  if (!s) throw new Error('unknown post-purchase step: ' + step);
  return s;
}

function build(step, t) {
  pick(step);
  const unsub = esc((t && t.unsubUrl) || SITE + '/api/unsubscribe');
  let h = designs.html[String(step)].split(designs.UNSUB_MARK).join(unsub);
  if (String(step) === 'halfway' || String(step) === 'halfway-sub') {
    const n = parseInt(t && t.chewsRemaining, 10);
    h = h.split(designs.CHEWS_MARK).join(String(Number.isFinite(n) && n > 0 ? n : 15));
  }
  if (String(step) === 'halfway-sub') {
    // The next billing date from Shopify; when it is missing the panel still
    // has to say something true.
    h = h.split(designs.RENEWS_MARK).join(esc((t && t.renewsOn) || 'On schedule'));
  }
  return h;
}

build.text = function (step, t) {
  const lines = pick(step).text.slice();
  if (t && t.unsubUrl) lines.push('', 'Unsubscribe: ' + t.unsubUrl);
  return lines.join('\n');
};

build.subject = function (step) { return pick(step).subject; };
build.STEPS = ['checkin', 'halfway', 'halfway-sub', 'milestone', 'rescue'];

module.exports = build;
