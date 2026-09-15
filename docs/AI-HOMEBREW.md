# Homebrew editors & AI drafting

The **Spellbook** (and the homebrew editors that follow it — items, feats, and
more) let you author custom content by hand, and optionally have the AI draft it
for you. Building by hand needs **no setup**; only the ✨ *Draft with AI* buttons
need the steps below.

The whole homebrew family shares **one** AI *text* budget and **one** Edge
Function, so this is a small, one-time setup that covers every current and future
homebrew editor.

## 1. Apply the migration

`supabase/migrations/20260919120000_homebrew_spells.sql` creates the
`homebrew_spells` table and **widens the shared AI-text budget** (added with the
Bestiary) so its reserve/complete/fail gate accepts every homebrew `kind`
(spell, item, feat, …) — not just `monster`. It reuses the existing
`ai_text_config` caps, so there's nothing new to configure.

```
npx supabase db push
```

Or paste the file into the Supabase **SQL Editor** and run it (it's safe to run
more than once).

## 2. Deploy the one Edge Function

`generate-homebrew` is the single AI drafter for all homebrew editors — it takes
a `kind` and returns a schema-shaped draft.

```
npx supabase functions deploy generate-homebrew
```

Or, in the browser: Supabase dashboard → **Edge Functions** → **Deploy a new
function** → name it `generate-homebrew` → paste the contents of
`supabase/functions/generate-homebrew/index.ts`.

## 3. Provider key — already set if monsters work

`generate-homebrew` uses the **same** provider secrets as the Bestiary's
`generate-monster` (Cloudflare Workers AI — free — or Anthropic). If AI monster
generation already works, **AI drafting works with no extra key.** If not, set a
provider following [`AI-MONSTERS.md`](./AI-MONSTERS.md) step 3.

Until the function is deployed, the ✨ panels show a calm "not set up" note and
the hand-built forms keep working.

## Cost & the caps

Drafts draw the shared AI *text* budget (`ai_text_config`, default **25 / DM /
month**, **500 global**) — the *same pool* as monster and encounter generation,
counted together. Change it any time with one line in the SQL editor:

```sql
update ai_text_config set per_dm_monthly_cap = 50, global_monthly_cap = 1000;
```

As always, the hard backstop is the spend limit on your provider account — set
it (see [`AI-MONSTERS.md`](./AI-MONSTERS.md)). Every draft is reserved in the
database **before** the paid call, and a failed draft never counts against quota.

## What you get in the Spellbook

A homebrew spell you author (school, level, range, save/attack, damage + type,
area, duration, description, "at higher levels") can be **added to any
character** from its card. It lands on the sheet as a custom spell — editable
there — and when that character casts it on the **Battle map**, the animation
engine reads its **school**, **damage type**, and **area** and gives it the
matching volumetric effect automatically. Author once, reuse across the party.
