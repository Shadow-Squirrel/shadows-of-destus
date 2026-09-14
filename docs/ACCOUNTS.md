# Accounts, profiles & password reset — Supabase config

The profile page (`profile.html`), avatar uploads, "Change password", and the
public password-reset page (`reset.html`) are all wired to **Supabase Auth**
and the `profiles` table + `avatars` storage bucket created by
`supabase/migrations/20260917120000_profiles.sql`. The database migration is
already applied — but a few settings in the **Supabase dashboard** must be set
by the project owner before reset/confirmation emails work in production.

All of these live under **Authentication** in the Supabase dashboard.

## 1. Site URL

**Authentication → URL Configuration → Site URL:**

```
https://onyxdungeon.com
```

This is the base URL Supabase uses when it builds links in its emails.

## 2. Redirect URLs (allow-list)

**Authentication → URL Configuration → Redirect URLs** — add both:

```
https://onyxdungeon.com/reset.html
https://onyxdungeon.com/join.html
```

Supabase only redirects auth links to URLs on this allow-list. The app asks
for `…/reset.html` as the `redirectTo` for password resets
(`profile.sendReset`), and invite/confirmation flows land on `…/join.html`.
A link whose target isn't allow-listed silently falls back to the Site URL,
which breaks the reset flow — so both entries are required.

> For local testing you can also add `http://localhost:8000/reset.html` and
> `http://localhost:8000/join.html` (match whatever port `run-local.bat` /
> `server.js` serve on).

## 3. Confirm email

**Authentication → Providers → Email → "Confirm email": ON.**

With this on, a new account must click a confirmation link before it can sign
in. The join flow already handles the "check your email to confirm" state, and
keeping accounts email-verified is what makes campaign-mate profile sharing
trustworthy (the email really belongs to the person).

## 4. SMTP (important for reliable emails)

**Authentication → Emails / SMTP Settings → configure a custom SMTP server.**

Supabase's built-in email sender is **heavily rate-limited** (a few messages
per hour) and is meant only for early testing. Password-reset and
email-confirmation messages are exactly the emails users need to arrive
promptly, so configure a real SMTP provider (e.g. Resend, Postmark, SendGrid,
Amazon SES, Mailgun) with a verified sending domain. Without this, resets and
confirmations will appear to "work" in the app but the emails will be delayed,
throttled, or dropped.

You may also want to customise the **email templates** (Authentication →
Emails) so the "Reset password" and "Confirm signup" messages match the Onyx
Dungeon brand. The default templates are fine functionally.

---

## What the app already does (no config needed)

- **Profiles / avatars:** table, RLS, `save_profile()` RPC, and the public-read
  `avatars` bucket (5 MB limit, image MIME types, per-user write folder) are all
  created by the migration.
- **Change password:** re-authenticates with the current password first, then
  `sb.auth.updateUser({ password })`.
- **Forgot password:** the login gate calls
  `sb.auth.resetPasswordForEmail(email, { redirectTo: …/reset.html })`.
- **Reset page:** `reset.html` listens for the `PASSWORD_RECOVERY` auth event
  (and an existing recovery session), then calls
  `sb.auth.updateUser({ password })`.
- **Change email (optional):** `sb.auth.updateUser({ email })` sends a
  confirmation to the new address; the change applies only once confirmed.
