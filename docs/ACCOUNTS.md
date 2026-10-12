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

### The two-minute way: your Gmail + one script (recommended for a table)

No new account, no DNS. Emails arrive from your Gmail address with the name
"Onyx Dungeon". Google allows ~500 a day — more than a table will ever send.

1. **Get an App Password from Google** (the only part only you can do):
   [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   → name it `Onyx Dungeon` → **Create** → copy the 16-letter password it
   shows (spaces don't matter). If that page says app passwords aren't
   available, turn on **2-Step Verification** first (Security → 2-Step
   Verification), then come back.
2. **Run the script** from the project folder in PowerShell:
   ```powershell
   .\tools\setup-email.ps1
   ```
   It asks for the password (typed hidden, never saved), shows exactly what
   will change on the project, pushes the SMTP settings with
   `npx supabase config push` (say **Y** to the auth/smtp changes; **N** to
   anything it offers that isn't under `auth`), then sends a **real
   password-reset email** to an address you give it. If that lands in your
   inbox, you're done for good.

The settings it pushes are the `[auth.email.smtp]` block in
`supabase/config.toml` (host `smtp.gmail.com`, port `465`, user = your Gmail)
plus the Site URL / redirect allow-list and a 30-emails-per-hour limit — so
this also fixes reset links landing on the wrong address.

### The "own domain" way: Resend (free, 3,000 emails/month)

Only if you'd rather emails come from `noreply@onyxdungeon.com`:

1. Sign up at **resend.com** → **Domains → Add domain** → `onyxdungeon.com` →
   add the 3–4 DNS records it shows at your domain registrar → **Verify**.
2. **API Keys → Create** → copy the `re_…` key.
3. In `supabase/config.toml` under `[auth.email.smtp]` set
   `host = "smtp.resend.com"`, `user = "resend"`,
   `admin_email = "noreply@onyxdungeon.com"`, then run the same
   `.\tools\setup-email.ps1` and paste the `re_…` key as the password.

> Prefer clicking? Both can also be typed into Supabase → **Project Settings →
> Authentication → SMTP Settings** by hand; the values are the ones in
> `config.toml`.

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
