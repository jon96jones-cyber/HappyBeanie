// Ambassador emails. Since the 2026-09 scene redesign the art is the
// lanyard-pass design in email-templates/scene/ambassador.html, embedded by
// tools/build-scene-emails.js — edit the template and re-run the generator,
// never a string here. This module fills the pass's tokens for the two
// variants: approval (the ambassador still has to claim a code) and retier
// (the rate changed; the code stays).
//
// Tokens: firstName, code, link, buyerPct, commissionPct, senderName.

const scene = require('./scene-designs.js');
const TEMPLATE = scene.ambassador;

function fill(tpl, t) {
  return tpl
    .replace(/\[\[FIRST_NAME\]\]/g, t.firstName)
    .replace(/\[\[TITLE\]\]/g, t.title || '')
    .replace(/\[\[PREHEADER\]\]/g, t.preheader || '')
    .replace(/\[\[EYEBROW\]\]/g, t.eyebrow || '')
    .replace(/\[\[HEADLINE\]\]/g, t.headline || '')
    .replace(/\[\[CODE_LINE\]\]/g, t.codeLine || '')
    .replace(/\[\[INTRO\]\]/g, t.intro || '')
    .replace(/\[\[STEP1\]\]/g, t.step1 || '')
    .replace(/\[\[SIGNIN_NOTE\]\]/g, t.signinNote || '')
    .replace(/\[\[CODE\]\]/g, t.code)
    .replace(/\[\[LINK\]\]/g, t.link)
    .replace(/\[\[BUYER_PCT\]\]/g, String(t.buyerPct))
    .replace(/\[\[COMMISSION_PCT\]\]/g, String(t.commissionPct))
    .replace(/\[\[YOUR_NAME\]\]/g, t.senderName);
}

// Approval: the desk approves terms only — the ambassador picks their own
// code in the portal, so the pass shows the invitation rather than a code.
module.exports = function buildApprovalEmail(t) {
  return fill(TEMPLATE, Object.assign({}, t, {
    title: 'Pick your Happy Beanie ambassador code',
    preheader: "You're in — open your portal and pick your personal code.",
    eyebrow: 'Application &middot; approved',
    headline: "You're in, " + t.firstName + '.',
    codeLine: 'You pick it',
    intro: 'Pick your own code in the portal &mdash; any 3&ndash;20 letters or numbers, ' +
           'your name or your pet&rsquo;s. It goes live the moment you claim it.',
    step1: '<strong style="color:#F2EAD9;">Pick your code</strong> &mdash; sign in and claim it, ' +
           'then share the code or your link. Your audience gets [[BUYER_PCT]]% off with it, and ' +
           'every sale it drives is credited to you automatically.',
    // The portal uses passwordless sign-in; without this line a first-timer
    // can sign in with some other address and land in an empty account.
    signinNote: '<tr><td colspan="2" align="center" style="padding:14px 60px 0 60px; ' +
      "font-family:'DM Sans', Arial, 'Helvetica Neue', Helvetica, sans-serif; " +
      'font-size:12.5px; line-height:20px; color:#8A7F6E;">Sign in with this same email address ' +
      '&mdash; we&rsquo;ll send you a one-time code. No password to create.</td></tr>'
  }));
};

// Tier-change variant: same pass, and the code on it is the one they hold.
module.exports.retier = function buildRetierEmail(t) {
  return fill(TEMPLATE, Object.assign({}, t, {
    title: 'Your new Happy Beanie ambassador rate',
    preheader: 'Your commission moved to ' + t.commissionPct + '% — details inside.',
    eyebrow: 'Ambassador &middot; rate update',
    headline: 'New rate, ' + t.firstName + '.',
    codeLine: t.code,
    intro: 'Your commission rate just changed. Your code and link stay exactly the same &mdash; ' +
           'the new rate applies to every sale from today.',
    step1: '<strong style="color:#F2EAD9;">Share your link or code</strong> &mdash; anyone who uses ' +
           'it gets [[BUYER_PCT]]% off their order, and the sale is credited to you automatically.',
    signinNote: ''
  }));
};

// Plain-text parts — HTML-only sends are a spam signal, so every send
// carries both.
function textApproval(t) {
  return [
    "You're in, " + t.firstName + ".",
    "",
    "Welcome to the Happy Beanie ambassador program. One thing left to do:",
    "sign in to your portal and pick your personal code - it goes live the",
    "moment you claim it.",
    "",
    "YOU EARN: " + t.commissionPct + "% of every sale your code drives",
    "YOUR AUDIENCE GETS: " + t.buyerPct + "% off with it",
    "",
    "HOW IT WORKS",
    "  1. Pick your code - sign in and claim any code, 3-20 letters or",
    "     numbers (your name, your pet's name, your call). Every sale it",
    "     drives is credited to you automatically.",
    "  2. Get paid monthly - " + t.commissionPct + "% of net product sales, paid at",
    "     month end once you've earned $25 or more.",
    "  3. Play it straight - always disclose the partnership (#ad), never",
    "     make health claims we don't make ourselves, and keep the code",
    "     off coupon sites. Full rules in your portal.",
    "",
    "Your portal: https://www.happybeanie.com/account",
    "Sign in with this same email address - we'll send you a one-time",
    "code. No password to create.",
    "",
    "Questions - reply directly to me. A person reads this inbox.",
    "",
    t.senderName,
    "Ambassador team, Happy Beanie",
    "hello@happybeanie.com"
  ].join("\n");
}

function textRetier(t) {
  return [
    "New rate, " + t.firstName + ".",
    "",
    "Your ambassador commission just changed. Your code and link stay the",
    "same; the new rate applies to every sale from today.",
    "",
    "YOUR CODE: " + t.code,
    "YOUR LINK: " + t.link,
    "YOU NOW EARN: " + t.commissionPct + "% of every sale",
    "",
    "Your portal: https://www.happybeanie.com/account",
    "",
    t.senderName,
    "Ambassador team, Happy Beanie",
    "hello@happybeanie.com"
  ].join("\n");
}

module.exports.text = textApproval;
module.exports.retierText = textRetier;
