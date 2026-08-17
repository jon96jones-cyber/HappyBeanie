// Wholesale approval email builder. Source of truth for the design:
// email-templates/wholesale/approval.html — regenerate this module if that
// file changes (the desk endpoint fills the [[TOKENS]] per account).

const TEMPLATE = "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"color-scheme\" content=\"light\"><title>Your Happy Beanie trade account is approved</title></head>\n<body style=\"margin:0; padding:0; background:#e7decb;\">\n  <div style=\"display:none; max-height:0; overflow:hidden; opacity:0; color:#e7decb; font-size:1px; line-height:1px;\">[[COMPANY]] is approved for trade pricing \u2014 your rates and portal sign-in are inside.</div>\n  <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#e7decb;\"><tr><td align=\"center\" style=\"padding:28px 12px;\">\n    <table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:600px; max-width:600px; background:#fcfaf4; border:1px solid #e0d6c2; border-radius:10px; overflow:hidden;\">\n\n      <tr><td style=\"background:#17140f; padding:22px 30px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>\n        <td align=\"left\" style=\"font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:20px; font-weight:700; letter-spacing:-0.5px; color:#f5f0e6;\">happy&nbsp;beanie</td>\n        <td align=\"right\" style=\"font-family:'DM Mono',Menlo,Consolas,monospace; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;\">Trade&nbsp;account</td>\n      </tr></table></td></tr>\n      <tr><td style=\"height:3px; background:#f2ce59; font-size:0; line-height:0;\">&nbsp;</td></tr>\n\n      <tr><td style=\"padding:38px 34px 6px;\">\n        <p style=\"margin:0 0 14px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;\">\u2014 &nbsp;Application \u00b7 approved</p>\n        <h1 style=\"margin:0 0 14px; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:27px; line-height:1.1; letter-spacing:-1px; font-weight:700; color:#17140f;\">You're approved, [[FIRST_NAME]].</h1>\n        <p style=\"margin:0 0 26px; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:15.5px; line-height:1.62; color:#554c40;\">Welcome to the trade program \u2014 [[COMPANY]] now has a Happy Beanie wholesale account. I reviewed your application myself, and everything checked out. Here are your rates and how to place your first order.</p>\n\n        <!-- Pricing card -->\n        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#17140f; border-radius:10px;\"><tr><td style=\"padding:24px 24px 8px;\">\n          <p style=\"margin:0 0 16px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#7eb38c;\">Your trade pricing</p>\n          <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">\n            <tr>\n              <td style=\"padding:12px 0 14px; border-bottom:1px solid rgba(245,240,230,0.14);\">\n                <span style=\"font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#f5f0e6;\">Happy Beans for Dogs</span><br>\n                <span style=\"font-family:'DM Mono',Menlo,Consolas,monospace; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#8a7f6e;\">30-day box \u00b7 MSRP $115</span>\n              </td>\n              <td align=\"right\" style=\"padding:12px 0 14px; border-bottom:1px solid rgba(245,240,230,0.14); font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:22px; font-weight:700; letter-spacing:-0.5px; color:#f2ce59; white-space:nowrap;\">[[PRICE_DOG]]<span style=\"font-size:12px; font-weight:400; color:#8a7f6e;\">&nbsp;/ box</span></td>\n            </tr>\n            <tr>\n              <td style=\"padding:14px 0;\">\n                <span style=\"font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#f5f0e6;\">Happy Beans for Cats</span><br>\n                <span style=\"font-family:'DM Mono',Menlo,Consolas,monospace; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:#8a7f6e;\">30-day box \u00b7 MSRP $115</span>\n              </td>\n              <td align=\"right\" style=\"padding:14px 0; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:22px; font-weight:700; letter-spacing:-0.5px; color:#f2ce59; white-space:nowrap;\">[[PRICE_CAT]]<span style=\"font-size:12px; font-weight:400; color:#8a7f6e;\">&nbsp;/ box</span></td>\n            </tr>\n          </table>\n          <p style=\"margin:0; padding:12px 0 16px; border-top:1px solid rgba(245,240,230,0.14); font-family:'DM Mono',Menlo,Consolas,monospace; font-size:9.5px; letter-spacing:1px; text-transform:uppercase; color:#8a7f6e;\">Minimum opening order&nbsp; [[MIN_ORDER]] &nbsp;\u00b7&nbsp; Ships in 48h from Scottsdale</p>\n        </td></tr></table>\n\n        <!-- How to order -->\n        <p style=\"margin:28px 0 12px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;\">\u2014 &nbsp;Placing orders</p>\n        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">\n          <tr><td style=\"padding:0 0 12px;\">\n            <span style=\"display:inline-block; width:22px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:11px; color:#325e3f; vertical-align:top;\">01</span><span style=\"display:inline-block; width:520px; max-width:88%; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;\"><b style=\"color:#17140f;\">Sign in to your portal</b> at happybeanie.com/account with this email address \u2014 your trade pricing is attached to it.</span>\n          </td></tr>\n          <tr><td style=\"padding:0 0 12px;\">\n            <span style=\"display:inline-block; width:22px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:11px; color:#325e3f; vertical-align:top;\">02</span><span style=\"display:inline-block; width:520px; max-width:88%; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;\"><b style=\"color:#17140f;\">Or just reply to this email</b> with quantities for your first purchase order and I'll enter it for you.</span>\n          </td></tr>\n          <tr><td style=\"padding:0 0 6px;\">\n            <span style=\"display:inline-block; width:22px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:11px; color:#325e3f; vertical-align:top;\">03</span><span style=\"display:inline-block; width:520px; max-width:88%; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; line-height:1.6; color:#554c40; vertical-align:top;\"><b style=\"color:#17140f;\">Marketing kit included</b> \u2014 shelf cards, a counter display and product photography ship free with your opening order.</span>\n          </td></tr>\n        </table>\n\n        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:24px 0 8px;\"><tr><td align=\"center\" bgcolor=\"#f2ce59\" style=\"border-radius:999px;\">\n          <a href=\"https://www.happybeanie.com/account\" style=\"display:block; padding:17px 24px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:700; color:#17140f; text-decoration:none;\">Open your trade portal \u2192</a>\n        </td></tr></table>\n\n        <!-- Real-person sign-off -->\n        <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:26px 0 30px; background:#f5f0e6; border:1px solid #e0d6c2; border-radius:8px;\"><tr><td style=\"padding:18px 20px;\">\n          <p style=\"margin:0 0 4px; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; line-height:1.6; color:#554c40;\">Questions on pricing, terms or timing \u2014 reply directly to me. A person reads this inbox, not a queue.</p>\n          <p style=\"margin:10px 0 0; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:14.5px; color:#17140f;\"><b>[[YOUR_NAME]]</b><br><span style=\"font-family:'DM Mono',Menlo,Consolas,monospace; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#8a7f6e;\">Trade team \u00b7 Happy Beanie</span></p>\n        </td></tr></table>\n      </td></tr>\n\n      <tr><td style=\"background:#f5f0e6; border-top:1px solid #e0d6c2; padding:26px 34px 30px;\" align=\"center\">\n        <p style=\"margin:0 0 12px; font-family:'DM Mono',Menlo,Consolas,monospace; font-size:9px; letter-spacing:2px; text-transform:uppercase; color:#8a7f6e;\">Formulated fresh \u00b7 Scottsdale, AZ</p>\n        <p style=\"margin:0; font-family:'DM Sans',Helvetica,Arial,sans-serif; font-size:11px; line-height:1.6; color:#8a7f6e;\">Questions? <a href=\"mailto:hello@happybeanie.com\" style=\"color:#325e3f; text-decoration:none;\">hello@happybeanie.com</a> &nbsp;\u00b7&nbsp; \u00a9 2026 Happy Beanie</p>\n      </td></tr>\n    </table>\n  </td></tr></table>\n</body>\n</html>\n";

function fill(tpl, t) {
  return tpl
    .replace(/\[\[FIRST_NAME\]\]/g, t.firstName)
    .replace(/\[\[COMPANY\]\]/g, t.company)
    .replace(/\[\[PRICE_DOG\]\]/g, t.priceDog)
    .replace(/\[\[PRICE_CAT\]\]/g, t.priceCat)
    .replace(/\[\[MIN_ORDER\]\]/g, t.minOrder)
    .replace(/\[\[YOUR_NAME\]\]/g, t.senderName);
}

module.exports = function buildApprovalEmail(t) {
  return fill(TEMPLATE, t);
};

// Pricing-update variant for already-approved accounts: same design, but the
// copy announces new rates instead of a new account, and the opening-order
// marketing-kit step is dropped.
module.exports.reprice = function buildRepriceEmail(t) {
  const tpl = TEMPLATE
    .replace('Your Happy Beanie trade account is approved', 'Your new Happy Beanie trade pricing')
    .replace('[[COMPANY]] is approved for trade pricing — your rates and portal sign-in are inside.',
             'New trade pricing for [[COMPANY]] — your updated rates are inside.')
    .replace('— &nbsp;Application · approved', '— &nbsp;Trade account · pricing update')
    .replace("You're approved, [[FIRST_NAME]].", 'New pricing, [[FIRST_NAME]].')
    .replace('Welcome to the trade program — [[COMPANY]] now has a Happy Beanie wholesale account. I reviewed your application myself, and everything checked out. Here are your rates and how to place your first order.',
             'A quick update from the trade program — the wholesale rates for [[COMPANY]] have changed. Your new pricing is below; it is already live on your account and applies to every order from today.')
    .replace('Minimum opening order&nbsp;', 'Minimum order&nbsp;')
    .replace("with quantities for your first purchase order and I'll enter it for you",
             "with quantities for your next purchase order and I'll enter it for you")
    .replace(/<tr><td style="padding:0 0 6px;">[\s\S]*?Marketing kit included[\s\S]*?<\/td><\/tr>\n/, '');
  return fill(tpl, t);
};

// Plain-text alternative. Sending HTML with no text/plain part is itself a
// spam signal at Gmail and friends, so every send carries both.
function textApproval(t) {
  return [
    "You're approved, " + t.firstName + ".",
    "",
    "Welcome to the trade program - " + t.company + " now has a Happy Beanie",
    "wholesale account. I reviewed your application myself, and everything",
    "checked out. Here are your rates and how to place your first order.",
    "",
    "YOUR TRADE PRICING",
    "  Happy Beans for Dogs (30-day box, MSRP $115): " + t.priceDog + " / box",
    "  Happy Beans for Cats (30-day box, MSRP $115): " + t.priceCat + " / box",
    "  Minimum opening order: " + t.minOrder,
    "  Ships in 48h from Scottsdale",
    "",
    "PLACING ORDERS",
    "  1. Sign in at https://www.happybeanie.com/account with this email",
    "     address - your trade pricing is attached to it.",
    "  2. Or reply to this email with quantities and I'll enter the order",
    "     for you.",
    "",
    "Questions on pricing, terms or timing - reply directly to me. A person",
    "reads this inbox, not a queue.",
    "",
    t.senderName,
    "Trade team, Happy Beanie",
    "hello@happybeanie.com",
    "Formulated fresh in Scottsdale, AZ"
  ].join("\n");
}

function textReprice(t) {
  return [
    "New pricing, " + t.firstName + ".",
    "",
    "A quick update from the trade program - the wholesale rates for",
    t.company + " have changed. Your new pricing is below; it is already",
    "live on your account and applies to every order from today.",
    "",
    "YOUR TRADE PRICING",
    "  Happy Beans for Dogs (30-day box, MSRP $115): " + t.priceDog + " / box",
    "  Happy Beans for Cats (30-day box, MSRP $115): " + t.priceCat + " / box",
    "  Minimum order: " + t.minOrder,
    "  Ships in 48h from Scottsdale",
    "",
    "PLACING ORDERS",
    "  1. Sign in at https://www.happybeanie.com/account with this email",
    "     address - your pricing is attached to it.",
    "  2. Or reply to this email with quantities and I'll enter the order",
    "     for you.",
    "",
    "Questions on pricing, terms or timing - reply directly to me. A person",
    "reads this inbox, not a queue.",
    "",
    t.senderName,
    "Trade team, Happy Beanie",
    "hello@happybeanie.com",
    "Formulated fresh in Scottsdale, AZ"
  ].join("\n");
}

module.exports.text = textApproval;
module.exports.repriceText = textReprice;
