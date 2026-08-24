// Ambassador approval email builder. Same design family as the wholesale
// approval email (dark header, gold rule, card, numbered steps, real-person
// sign-off). Tokens: firstName, code, link, buyerPct, commissionPct, senderName.

const TEMPLATE = "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"color-scheme\" content=\"light\"><title>Welcome to the Happy Beanie ambassador program</title></head>\n<body style=\"margin:0; padding:0; background:#e7decb;\">\n  <div style=\"display:none; max-height:0; overflow:hidden; opacity:0; color:#e7decb; font-size:1px; line-height:1px;\">You're in — your code [[CODE]] and your link are inside.</div>\n  <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#e7decb;\"><tr><td align=\"center\" style=\"padding:28px 12px;\">\n    <table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:600px; max-width:600px; background:#fcfaf4; border:1px solid #e0d6c2; border-radius:10px; overflow:hidden;\">\n\n      <tr><td style=\"background:#17140f; padding:22px 30px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>\n        <td align=\"left\" style=\"font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:20px; font-weight:700; letter-spacing:-0.5px; color:#f5f0e6;\">happy&nbsp;beanie</td>\n        <td align=\"right\" style=\"font-family:'DM Mono',Menlo,Consolas,monospace; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;\">Ambassador&nbsp;program</td>\n      </tr></table></td></tr>\n      <tr><td style=\"height:3px; background:#f2ce59; font-size:0; line-height:0;\">&nbsp;</td></tr>\n\n      <tr><td style=\"padding:38px 34px 6px;\">\n        <p style=\"margin:0 0 14px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;\">— &nbsp;Application · approved</p>\n        <h1 style=\"margin:0 0 14px; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:27px; line-height:1.1; letter-spacing:-1px; font-weight:700; color:#17140f;\">You're in, [[FIRST_NAME]].</h1>\n        <p style=\"margin:0 0 26px; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:15.5px; line-height:1.62; color:#554c40;\">Welcome to the Happy Beanie ambassador program. I read your application myself and loved it. Your personal code and link are below — they're live right now.</p>\n\n        <!-- Code card -->\n        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#17140f; border-radius:10px;\"><tr><td style=\"padding:24px 24px 22px;\" align=\"center\">\n          <p style=\"margin:0 0 12px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#7eb38c;\">Your code · [[BUYER_PCT]]% off for your people</p>\n          <p style=\"margin:0 0 14px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:30px; letter-spacing:4px; font-weight:700; color:#f2ce59;\">[[CODE]]</p>\n          <p style=\"margin:0; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:11px; letter-spacing:0.5px; color:#8a7f6e; word-break:break-all;\">[[LINK]]</p>\n          <p style=\"margin:14px 0 0; padding-top:14px; border-top:1px solid rgba(245,240,230,0.14); font-family:'DM Mono',Menlo,Consolas,monospace; font-size:9.5px; letter-spacing:1px; text-transform:uppercase; color:#8a7f6e;\">You earn&nbsp; [[COMMISSION_PCT]]% &nbsp;of every sale it drives</p>\n        </td></tr></table>\n\n        <!-- How it works -->\n        <p style=\"margin:28px 0 12px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;\">— &nbsp;How it works</p>\n        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">\n          <tr><td style=\"padding:0 0 12px;\">\n            <span style=\"display:inline-block; width:22px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:11px; color:#325e3f; vertical-align:top;\">01</span><span style=\"display:inline-block; width:520px; max-width:88%; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;\"><b style=\"color:#17140f;\">Share your link or code</b> — anyone who uses it gets [[BUYER_PCT]]% off their order, and the sale is credited to you automatically.</span>\n          </td></tr>\n          <tr><td style=\"padding:0 0 12px;\">\n            <span style=\"display:inline-block; width:22px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:11px; color:#325e3f; vertical-align:top;\">02</span><span style=\"display:inline-block; width:520px; max-width:88%; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;\"><b style=\"color:#17140f;\">Get paid monthly</b> — [[COMMISSION_PCT]]% of net product sales (after discounts and refunds, before shipping and tax), paid at month end once you've earned $25 or more.</span>\n          </td></tr>\n          <tr><td style=\"padding:0 0 6px;\">\n            <span style=\"display:inline-block; width:22px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:11px; color:#325e3f; vertical-align:top;\">03</span><span style=\"display:inline-block; width:520px; max-width:88%; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;\"><b style=\"color:#17140f;\">Play it straight</b> — always disclose the partnership (#ad or #happybeaniepartner), never make health claims we don't make ourselves, and keep the code off coupon sites. The full rules live in your portal.</span>\n          </td></tr>\n        </table>\n\n        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:24px 0 8px;\"><tr><td align=\"center\" bgcolor=\"#f2ce59\" style=\"border-radius:999px;\">\n          <a href=\"https://www.happybeanie.com/account\" style=\"display:block; padding:17px 24px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:700; color:#17140f; text-decoration:none;\">Open your ambassador portal →</a>\n        </td></tr></table>\n\n        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:26px 0 30px; background:#f5f0e6; border:1px solid #e0d6c2; border-radius:8px;\"><tr><td style=\"padding:18px 20px;\">\n          <p style=\"margin:0 0 4px; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; line-height:1.6; color:#554c40;\">Questions about content, payouts or anything else — reply directly to me. A person reads this inbox, not a queue.</p>\n          <p style=\"margin:10px 0 0; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; color:#17140f;\"><b>[[YOUR_NAME]]</b><br><span style=\"font-family:'DM Mono',Menlo,Consolas,monospace; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#8a7f6e;\">Ambassador team · Happy Beanie</span></p>\n        </td></tr></table>\n      </td></tr>\n\n      <tr><td style=\"background:#f5f0e6; border-top:1px solid #e0d6c2; padding:26px 34px 30px;\" align=\"center\">\n        <p style=\"margin:0 0 12px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;\">Formulated fresh · Scottsdale, AZ</p>\n        <p style=\"margin:0; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:11px; line-height:1.6; color:#8a7f6e;\">Questions? <a href=\"mailto:hello@happybeanie.com\" style=\"color:#325e3f; text-decoration:none;\">hello@happybeanie.com</a> &nbsp;·&nbsp; © 2026 Happy Beanie</p>\n      </td></tr>\n    </table>\n  </td></tr></table>\n</body>\n</html>\n";

function fill(tpl, t) {
  return tpl
    .replace(/\[\[FIRST_NAME\]\]/g, t.firstName)
    .replace(/\[\[CODE\]\]/g, t.code)
    .replace(/\[\[LINK\]\]/g, t.link)
    .replace(/\[\[BUYER_PCT\]\]/g, String(t.buyerPct))
    .replace(/\[\[COMMISSION_PCT\]\]/g, String(t.commissionPct))
    .replace(/\[\[YOUR_NAME\]\]/g, t.senderName);
}

module.exports = function buildApprovalEmail(t) {
  return fill(TEMPLATE, t);
};

// Tier-change variant: same design, copy announces the new commission rate.
module.exports.retier = function buildRetierEmail(t) {
  const tpl = TEMPLATE
    .replace('Welcome to the Happy Beanie ambassador program</title>', 'Your new Happy Beanie ambassador rate</title>')
    .replace("You're in — your code [[CODE]] and your link are inside.",
             'Your commission moved to [[COMMISSION_PCT]]% — details inside.')
    .replace('— &nbsp;Application · approved', '— &nbsp;Ambassador · rate update')
    .replace("You're in, [[FIRST_NAME]].", 'New rate, [[FIRST_NAME]].')
    .replace('Welcome to the Happy Beanie ambassador program. I read your application myself and loved it. Your personal code and link are below — they\'re live right now.',
             'Good news from the ambassador program — your commission rate just changed. Your code and link stay exactly the same; the new rate applies to every sale from today.');
  return fill(tpl, t);
};

// Plain-text parts — HTML-only sends are a spam signal, so every send
// carries both.
function textApproval(t) {
  return [
    "You're in, " + t.firstName + ".",
    "",
    "Welcome to the Happy Beanie ambassador program. Your personal code and",
    "link are below - they're live right now.",
    "",
    "YOUR CODE (" + t.buyerPct + "% off for your people): " + t.code,
    "YOUR LINK: " + t.link,
    "YOU EARN: " + t.commissionPct + "% of every sale it drives",
    "",
    "HOW IT WORKS",
    "  1. Share your link or code - anyone who uses it gets " + t.buyerPct + "% off,",
    "     and the sale is credited to you automatically.",
    "  2. Get paid monthly - " + t.commissionPct + "% of net product sales, paid at",
    "     month end once you've earned $25 or more.",
    "  3. Play it straight - always disclose the partnership (#ad), never",
    "     make health claims we don't make ourselves, and keep the code",
    "     off coupon sites. Full rules in your portal.",
    "",
    "Your portal: https://www.happybeanie.com/account",
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
