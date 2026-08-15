# Automated wholesale approval email — setup

Approvals now run from a private desk at **`/admin/wholesale`**: pending
applications listed with their details, per-account pricing fields, and one
**Approve & send →** button that flips the Shopify tags AND fires the branded
pricing email. The email sends first — if sending fails, the application stays
pending, so nobody ends up approved-but-unnotified.

## One-time setup (~10 min)

### 1. Create a Resend account (the email pipe)
1. Sign up at **resend.com** (free — 100 emails/day, plenty for approvals).
2. **Domains → Add domain** → `happybeanie.com`.
3. Resend shows 2–3 DNS records (SPF + DKIM). Add them at **GoDaddy → DNS**
   for happybeanie.com, then click **Verify** in Resend (can take ~15 min).
4. **API Keys → Create** → copy the `re_…` key.

### 2. Vercel environment variables
| Name | Value |
|---|---|
| `RESEND_API_KEY` | the `re_…` key |
| `WHOLESALE_KEY` | any long random string — the desk's gate key (separate from the supplier's FULFILLMENT_KEY on purpose) |

**Redeploy** after saving.

### 3. Test
1. Submit a test application at `/wholesale` with your own email.
2. Open `/admin/wholesale`, enter the key → the application appears.
3. Set prices → **Approve & send** → check your inbox for the branded email
   and confirm the customer in Shopify now carries `wholesale-approved`.

## Day-to-day
New applications land tagged `wholesale-pending` (as before). Open the desk,
review, type the account's prices (your last-used values pre-fill), click
approve. Done — tags flipped, email sent from hello@happybeanie.com with
reply-to back to you.

## Notes
- Email design source: `email-templates/wholesale/approval.html`. If you edit
  it, the sending copy lives in `api/_lib/wholesale-email.js` — ask Claude to
  regenerate it from the template.
- Until `RESEND_API_KEY` is set, the desk lists applications but blocks
  approvals with a clear banner (it never tags without emailing).
