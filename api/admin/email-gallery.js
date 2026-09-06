// GET /api/admin/email-gallery — every email design, rendered with sample data.
//
// The campaigns desk shows what was SENT; this answers "what do our emails
// look like" without triggering a send. Two shapes:
//   (no id)   the catalogue — id, group, name, live subject line
//   ?id=x     one design rendered with the sample tokens below
//
// Renders straight from the same builders the crons use, so the gallery can
// never drift from what customers receive. Sample values are obviously fake
// (JORDAN15, #-links) so a screenshot of the gallery can't be mistaken for a
// real send.
//
// Auth: x-analytics-key against ANALYTICS_KEY — same key as the other desks.

const db = require('../_lib/analytics-db.js');

const lifecycle = require('../_lib/lifecycle-email.js');
const welcome = require('../_lib/welcome-email.js');
const pp = require('../_lib/postpurchase-email.js');
const quiz = require('../_lib/quiz-reminder-email.js');
const research = require('../_lib/research-email.js');
const ambassador = require('../_lib/ambassador-email.js');
const wholesale = require('../_lib/wholesale-email.js');

const SAMPLE = {
  code: 'BEANIE10-7F3K',
  expires: 'October 6',
  cartVars: {
    first_name: 'Jordan',
    items: [{ title: 'Happy Beans for Dogs', variant: 'Subscribe & save', quantity: 1, line_total: '$99.00' }],
    cart_subtotal: '$99.00',
    checkout_url: '#', cart_optout_url: '#'
  }
};

// One entry per design. render() returns { subject, html, text? }.
const CATALOGUE = [
  { id: 'welcome-code', group: 'Signup', name: 'Discount code (popup & footer)', render: function () {
    const vars = { discount_code: SAMPLE.code, discount_expires_at: SAMPLE.expires, shop_url: '#', screener_url: '#', unsubscribe_url: '#' };
    return { subject: lifecycle.subject('welcome-code'), html: lifecycle('welcome-code', vars), text: lifecycle.text('welcome-code', vars) };
  } },
  { id: 'research', group: 'Signup', name: 'Research popup email', render: function () {
    return { subject: research.subject(), html: research({ unsubUrl: '#' }), text: research.text({ unsubUrl: '#' }) };
  } },
  { id: 'welcome-1', group: 'Welcome series', name: 'Step 1 · the ritual', render: function () {
    return { subject: welcome.subject(1), html: welcome(1, { code: SAMPLE.code, expiresLabel: SAMPLE.expires, unsubUrl: '#' }) };
  } },
  { id: 'welcome-2', group: 'Welcome series', name: 'Step 2 · the screener', render: function () {
    return { subject: welcome.subject(2), html: welcome(2, { unsubUrl: '#' }) };
  } },
  { id: 'welcome-3', group: 'Welcome series', name: 'Step 3 · the research', render: function () {
    return { subject: welcome.subject(3), html: welcome(3, { unsubUrl: '#' }) };
  } },
  { id: 'cart-45m', group: 'Cart recovery', name: 'Rung 1 · 45 minutes (and cart nudge)', render: function () {
    return { subject: 'You left your box on the counter', html: lifecycle('cart-recovery', SAMPLE.cartVars), text: lifecycle.text('cart-recovery', SAMPLE.cartVars) };
  } },
  { id: 'cart-24h', group: 'Cart recovery', name: 'Rung 2 · 24 hours', render: function () {
    return { subject: 'Should we set your box aside?', html: lifecycle('cart-recovery', SAMPLE.cartVars), note: 'Same design as rung 1 — only the subject changes.' };
  } },
  { id: 'cart-48h', group: 'Cart recovery', name: 'Rung 3 · 48 hours, final', render: function () {
    return { subject: 'Last one from us, promise', html: lifecycle('cart-recovery', SAMPLE.cartVars), note: 'Same design as rung 1 — only the subject changes.' };
  } },
  { id: 'pp-checkin', group: 'Post-purchase', name: 'Day 7 check-in', render: function () {
    return { subject: pp.subject('checkin'), html: pp('checkin', { unsubUrl: '#' }) };
  } },
  { id: 'pp-halfway', group: 'Post-purchase', name: 'Halfway · one-time buyer', render: function () {
    return { subject: pp.subject('halfway'), html: pp('halfway', { unsubUrl: '#', chewsRemaining: 14 }) };
  } },
  { id: 'pp-halfway-sub', group: 'Post-purchase', name: 'Halfway · subscriber', render: function () {
    return { subject: pp.subject('halfway-sub'), html: pp('halfway-sub', { unsubUrl: '#', chewsRemaining: 14, renewsOn: 'October 12' }) };
  } },
  { id: 'pp-milestone', group: 'Post-purchase', name: 'Two boxes in · review ask', render: function () {
    return { subject: pp.subject('milestone'), html: pp('milestone', { unsubUrl: '#' }) };
  } },
  { id: 'pp-rescue', group: 'Post-purchase', name: 'Cancellation confirmation', render: function () {
    return { subject: pp.subject('rescue'), html: pp('rescue', { unsubUrl: '#' }) };
  } },
  { id: 'quiz-age', group: 'Screener reminders', name: 'Pet was too young', render: function () {
    return { subject: quiz.subject('age'), html: quiz({ reason: 'age', species: 'dog', quizUrl: '#', cancelUrl: '#' }), text: quiz.text({ reason: 'age', species: 'dog', quizUrl: '#', cancelUrl: '#' }) };
  } },
  { id: 'quiz-repro', group: 'Screener reminders', name: 'Recheck (other reasons)', render: function () {
    return { subject: quiz.subject('repro'), html: quiz({ reason: 'repro', species: 'cat', quizUrl: '#', cancelUrl: '#' }), text: quiz.text({ reason: 'repro', species: 'cat', quizUrl: '#', cancelUrl: '#' }) };
  } },
  { id: 'screener-recheck', group: 'Screener reminders', name: 'Old-enough-now (lifecycle)', render: function () {
    const vars = { screened_at: 'Sep 12, 2025', today: 'Sep 6, 2026', screener_url: '#', forget_url: '#' };
    return { subject: lifecycle.subject('screener-recheck'), html: lifecycle('screener-recheck', vars), text: lifecycle.text('screener-recheck', vars) };
  } },
  { id: 'amb-approval', group: 'Partners', name: 'Ambassador approval', render: function () {
    const t = { firstName: 'Jordan', code: 'JORDAN15', link: 'https://www.happybeanie.com/?ref=JORDAN15', buyerPct: 15, commissionPct: 10, senderName: 'Jon' };
    return { subject: 'You’re in — pick your Happy Beanie ambassador code', html: ambassador(t), text: ambassador.text(t) };
  } },
  { id: 'amb-retier', group: 'Partners', name: 'Ambassador rate change', render: function () {
    const t = { firstName: 'Jordan', code: 'JORDAN15', link: 'https://www.happybeanie.com/?ref=JORDAN15', buyerPct: 15, commissionPct: 12, senderName: 'Jon' };
    return { subject: 'Your new Happy Beanie ambassador rate', html: ambassador.retier(t), text: ambassador.retierText(t) };
  } },
  { id: 'ws-approval', group: 'Partners', name: 'Wholesale approval', render: function () {
    const t = { firstName: 'Dana', company: 'Desert Paws Clinic', priceDog: '$62.00', priceCat: '$62.00', minOrder: '5 boxes', senderName: 'Jon' };
    return { subject: "You're approved — Happy Beanie trade pricing inside", html: wholesale(t), text: wholesale.text(t) };
  } },
  { id: 'ws-reprice', group: 'Partners', name: 'Wholesale rate change', render: function () {
    const t = { firstName: 'Dana', company: 'Desert Paws Clinic', priceDog: '$59.00', priceCat: '$59.00', minOrder: '5 boxes', senderName: 'Jon' };
    return { subject: 'Your new Happy Beanie trade pricing', html: wholesale.reprice(t), text: wholesale.repriceText(t) };
  } }
];

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!db.keyOk(req, 'x-analytics-key', 'ANALYTICS_KEY')) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const id = req.query && req.query.id;
  if (!id) {
    return res.status(200).json({
      ok: true,
      designs: CATALOGUE.map(function (d) {
        let subject = '';
        try { subject = d.render().subject; } catch (e) {}
        return { id: d.id, group: d.group, name: d.name, subject: subject };
      })
    });
  }
  const entry = CATALOGUE.find(function (d) { return d.id === String(id); });
  if (!entry) return res.status(404).json({ ok: false, error: 'unknown_design' });
  try {
    const r = entry.render();
    return res.status(200).json({ ok: true, id: entry.id, name: entry.name, group: entry.group,
      subject: r.subject, html: r.html, text: r.text || null, note: r.note || null });
  } catch (e) {
    console.error('[email-gallery]', entry.id, e && e.message);
    return res.status(500).json({ ok: false, error: 'render_failed', message: e && e.message });
  }
};
