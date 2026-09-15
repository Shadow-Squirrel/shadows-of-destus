# 🐉 Campaign Hub

A private website for one D&D table: campaign details, a quest board the DM
updates, the party's shared notes, a codex of everyone (and everything) met
along the way, an atlas of maps, live shared dice — and a full **character
builder & sheet** (D&D Beyond-style): every SRD race, class and spell, with
click-to-roll checks, saves, attacks and spell slots wired straight into the
table's shared dice feed.

**Total running cost: $0.** GitHub Pages hosts the site; Supabase's free tier
stores what people type.

**⚔️ Live at: <https://onyxdungeon.com>** (GitHub Pages, custom domain via `CNAME`)

## Accounts & tiers

The site has a **public front door** (`index.html` — the landing page, no
login) and a **sign-in door** (`login.html`). Anyone can create a **free
account**:

| Tier | Who | Gets |
|---|---|---|
| 🗡️ **Adventurer** (free) | everyone who signs up | build heroes, join tables by invite link, play on the battle map, roll with the table, read the hub / notes / codex |
| 🔥 **Dungeon Lord** (subscription) | whoever runs the table | everything above **plus** creating & running campaigns (the DM role), invites, encounters, homebrew editors, Discord, and every AI dungeon-prep tool |

Tier names and the display price live in `js/config.js` (`TIERS`, `PRICING`).
The paid tier is just the buyer's email in the `campaign_creators` allow-list —
Stripe Checkout + a webhook grant/revoke it; see `docs/BILLING.md`. Until
Stripe is configured the pricing page shows "coming soon" and nothing breaks.

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
index.html                     ← PUBLIC landing page (no login) · js/pages/landing.js
pricing.html, login.html       ← public plans page · the sign-in / create-account door
hub.html, quests.html, ...     ← the signed-in app: one thin file per page (hub = campaign Home)
css/style.css                  ← the whole look; colors are tokens at the top
css/characters.css             ← builder + character-sheet styles
js/config.js                   ← ★ the only file you edit by hand (name + keys)
js/shell.js                    ← shared header/nav + the login gate
js/db.js                       ← the "librarian": all reads/writes go through it
js/roll-fx.js                  ← the dice show (shared by Dice page + sheets)
js/pages/*.js                  ← the behavior of each page
js/dnd/                        ← the 5e rules engine + SRD game data
js/dnd/data/*.js               ← GENERATED from the SRD (see tools/build-srd.mjs)
supabase/schema.sql            ← database blueprint: tables + security rules
supabase/migrations/           ← applied database changes, in order
tools/                         ← dev scripts: SRD data build, rules tests
server.js + run-local.bat      ← local preview only; not used by GitHub Pages
```

## The character builder

The **Characters** page builds real 5e characters: pick race → class →
abilities → background → equipment → spells, then play from a live sheet —
tap any skill, save or attack and the roll (with the right bonuses, advantage
and all) goes through the table's shared dice feed. Leveling up walks you
through exactly what changed.

- **Game content:** the [SRD 5.1](https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf)
  (CC-BY-4.0) — all 12 classes, 9 races, 319 spells. Content from other books
  isn't freely licensed, so it can't ship here; instead every picker has a
  **Custom** option (homebrew race, subclass, background, spells, items,
  features) so players can type in anything from books they own, with links to
  [D&D Beyond](https://www.dndbeyond.com/sources) / [Open5e](https://open5e.com)
  for looking things up.
- **Database:** characters need the `…_characters.sql` migration (below).
  Until it's applied, sheets park safely in the browser's localStorage and
  move to the database automatically afterwards.
- **Refreshing SRD data:** `git clone --depth 1 https://github.com/5e-bits/5e-database /tmp/5edb`
  then `SRD_DIR=/tmp/5edb/src/2014/en node tools/build-srd.mjs`, and sanity-check
  with `node tools/test-rules.mjs`.

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
4. In **Authentication → Sign In / Providers → Email**: for a private table you
   can leave "Confirm email" **off** (the invite list is the real gate, and it
   avoids Supabase's very low free email limits). Once signups are **public**
   — and definitely **before charging for the Dungeon Lord tier** — turn it
   **on** and set up custom SMTP, so an unverified address can't claim a seat.
   See `docs/ACCOUNTS.md`.
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

> Because the repo is public, anything committed to it is technically visible
> to a determined snooper — so **no campaign secrets in the repo, ever**.
> Everything typed into the site (quests, notes, codex) lives in Supabase
> behind the login, and map images live in a *private* Supabase Storage
> bucket where players can only fetch maps the DM has revealed.

## Everyday use

- **Invite a player:** Party page → *Invite players* → add their email + display
  name, or mint an invite link (Campaigns page). They create a free account
  (or open the link) and land at your table. Remove the email later and their
  access dies instantly.
- **Add a map:** Maps page → **+ Add map** → pick the image straight off your
  computer (png/jpg/webp, up to 25 MB; DM only). New maps start **hidden**;
  players see nothing until you press **Reveal** — perfect for mid-session
  "you arrive at…" moments.
- **Quests / campaign details:** DM-only buttons appear on those pages when
  you're signed in as DM.
- **Build a character:** Characters page → *Forge a character*. Sheets are
  visible to the whole party; only the owner (and the DM) can edit or roll
  from one. *Level up* on the sheet shows what you gained and which choices
  are still owed.
- **Dice:** the Dice page rolls for the whole table — results are generated
  by the database itself (no fudging possible) and every open Dice page sees
  the dice tumble live. Everyone can save favorite rolls ("Fireball — 8d6")
  as one-click presets. Advantage/disadvantage rolls both d20s server-side
  and keeps the right one.
- **D&D Beyond:** prefer to keep a sheet there? The Party page still links
  out to external sheets.

## Free-tier fine print

- Supabase free projects **pause after ~1 week of inactivity** — a weekly game
  keeps it alive; if it pauses, one click in the dashboard wakes it.
- Supabase's built-in email is limited to a few messages/hour — that's why
  email confirmation is off and invites don't send emails.
- Forgot password? The DM can set a new one in Supabase → Authentication → Users.
