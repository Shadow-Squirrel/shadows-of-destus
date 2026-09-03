# 🐉 Campaign Hub

A private website for one D&D table: campaign details, a quest board the DM
updates, the party's shared notes, a codex of everyone (and everything) met
along the way, an atlas of maps, and a roster linking out to D&D Beyond
character sheets.

**Total running cost: $0.** GitHub Pages hosts the site; Supabase's free tier
stores what people type.

**⚔️ Live at: <https://shadow-squirrel.github.io/shadows-of-destus/>**

---

## How the three pieces fit

| Piece | Job | Analogy |
|---|---|---|
| **GitHub Pages** | Serves the site's files (HTML, styling, map images) to anyone who visits | The inn where the party gathers |
| **Supabase** | The database that remembers quests, notes, codex entries — and checks *who is allowed to do what* | The ledger behind the bar, and the bouncer |
| **This repo** | The source of truth for the site's files; push a change and Pages redeploys | The blueprints |

The important security idea: **the website is not the guard — the database is.**
Site code runs in visitors' browsers where it can be tampered with, so every
"only the DM can…" and "members only" rule is enforced *inside* Supabase by
Row Level Security (see `supabase/schema.sql`, which is heavily commented).
That's also why the `SUPABASE_ANON_KEY` in `js/config.js` is safe to publish:
it opens the front door only as far as those rules allow.

## Folder tour

```
index.html, quests.html, ...   ← one thin file per page
css/style.css                  ← the whole look; colors are tokens at the top
js/config.js                   ← ★ the only file you edit by hand (name + keys)
js/shell.js                    ← shared header/nav + the login gate
js/db.js                       ← the "librarian": all reads/writes go through it
js/pages/*.js                  ← the behavior of each page
supabase/schema.sql            ← database blueprint: tables + security rules
maps/                          ← put map images here (jpg/png/webp)
server.js + run-local.bat      ← local preview only; not used by GitHub Pages
```

---

## Step 1 — Preview it right now (demo mode)

Double-click **`run-local.bat`**. A browser opens at `http://localhost:4173`
showing the site with sample data. Until the database is connected, the site
runs in *demo mode*: you're treated as the DM so every control is visible,
and edits vanish on refresh.

## Step 2 — Make it real (free Supabase database)

> ✅ **Already done** for this table (project `shadows-of-destus`, us-west-1;
> schema applied via `supabase/migrations/`). Kept for reference — future
> database changes go in a new migration file + `npx supabase db push`.

1. Go to [supabase.com](https://supabase.com) → sign in → **New project**
   (Free plan). Name it anything; save the database password somewhere safe
   (you rarely need it again).
2. Open **SQL Editor → New query**, paste the entire contents of
   `supabase/schema.sql`, and **Run**. First, check the `BOOTSTRAP` line —
   it must contain the email *you* will sign in with (that's what makes you
   the DM).
3. Same again with `supabase/seed-campaign.sql` — it loads the
   *Shadows of Destus* player primer onto the Home page.
4. In **Authentication → Sign In / Providers → Email**, turn **off**
   "Confirm email". (The invite list is the real gate; skipping confirmation
   emails avoids Supabase's very low free email limits.)
5. In **Project Settings → API**, copy the **Project URL** and the
   **anon public** key into `js/config.js`. Never copy the `service_role`
   key anywhere.
6. Reload the site → create your account (with the DM email) → you're in.

## Step 3 — Put it on the internet (GitHub Pages)

> ✅ **Already done** — pushing to `main` redeploys the live site automatically
> in about a minute.

1. Create a **public** repo on GitHub (free accounts can only publish Pages
   from public repos) and push this folder to it.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* →
   Branch: `main`, folder `/ (root)` → Save.
3. A minute later the site is live at
   `https://<your-username>.github.io/<repo-name>/`. Send that link to the party.

> Because the repo is public, anything committed to it (including `maps/`) is
> technically visible to a determined snooper — so **only upload maps the
> players are allowed to see**. Everything typed into the site (quests, notes,
> codex) lives in Supabase behind the login, not in the repo.

## Everyday use

- **Invite a player:** Party page → *Invite players* → add their email + display
  name. They visit the site and *Create account* with that exact email.
  Remove the email later and their access dies instantly.
- **Add a map:** drop the image into `maps/`, commit + push, then on the Maps
  page add a card with location `maps/yourfile.jpg`.
- **Quests / campaign details:** DM-only buttons appear on those pages when
  you're signed in as DM.
- **D&D Beyond:** sheets stay there (no official API; embedding is blocked).
  The Party page links each character straight to their sheet.

## Free-tier fine print

- Supabase free projects **pause after ~1 week of inactivity** — a weekly game
  keeps it alive; if it pauses, one click in the dashboard wakes it.
- Supabase's built-in email is limited to a few messages/hour — that's why
  email confirmation is off and invites don't send emails.
- Forgot password? The DM can set a new one in Supabase → Authentication → Users.
