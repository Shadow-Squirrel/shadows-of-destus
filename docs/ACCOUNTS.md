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

**Authentication → Providers → Email → "Confirm email": OFF** for a private
table.

The invite / member list is the real gate — an account that isn't on it sees
nothing — so there's no need to make friends click a confirmation link. It
also means sign-up doesn't depend on email arriving at all. If you ever want
it on (so an address is proven to belong to the person), set up custom SMTP
first (next section); with the built-in mailer, confirmation emails stop
after a couple of sign-ups and nobody can get in.

## 4. SMTP — do this, or password resets stop after two emails

Supabase's built-in mailer is **for development only**: it allows roughly
**2–4 emails per hour for the whole project**, and every password reset and
sign-up confirmation counts. Once it's spent you get
`email rate limit exceeded` and nobody can reset a password until it cools
down. The permanent fix is a real email provider — about ten minutes, free.

### The quick way: Resend (free, 3,000 emails/month)

1. Sign up at **resend.com**.
2. **Domains → Add domain** → `onyxdungeon.com`. Resend shows 3–4 DNS records
   (TXT/MX). Add them wherever the domain's DNS lives (the registrar), then
   press **Verify** (minutes to an hour to propagate).
3. **API Keys → Create** → copy the key (`re_…`). Treat it like a password:
   it goes in the Supabase form below and nowhere else.
4. Supabase → **Project Settings → Authentication → SMTP Settings → Enable
   custom SMTP**, and fill in:

   | Field | Value |
   |---|---|
   | Sender email | `noreply@onyxdungeon.com` |
   | Sender name | `Onyx Dungeon` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Minimum interval per user | `10` |
   | Username | `resend` (literally that word) |
   | Password | the `re_…` key |

   Save. The limit rises to 30/hour immediately (raise it further in
   **Authentication → Rate Limits** if you ever need to).

> Until the domain verifies, Resend will only send from `onboarding@resend.dev`
> and only to your own address — fine for a test, not for the party.

### No email at all? Set a player's password by hand

The dashboard's **Authentication → Users → "…" → Send password recovery**
only sends *another email* through the same mailer, so it doesn't help until
SMTP is set up. What always works is setting the password directly. Supabase →
**SQL Editor → New query**, with the player's email and a temporary password
of your choosing:

```sql
update auth.users
   set encrypted_password = crypt('temporary-password-here', gen_salt('bf'))
 where email = 'player@example.com';
```

Tell them the temporary password, and have them change it on their **⚙
Profile** page once they're in. The login gate already tells people to ask
their DM when the reset mail doesn't come, so this is the fallback it means.

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
