# Homebrew editors & AI drafting

The **Spellbook** (and the homebrew editors that follow it — items, feats, and
more) let you author custom content by hand, and optionally have the AI draft it
for you. Building by hand needs **no setup**; only the ✨ *Draft with AI* buttons
need the steps below.

The whole homebrew family shares **one** AI *text* budget and **one** Edge
Function, so this is a small, one-time setup that covers every current and future
homebrew editor.

## 1. Apply the migrations

Each homebrew editor adds one small content table:

- `20260919120000_homebrew_spells.sql` — the **Spellbook** table, and it
  **widens the shared AI-text budget** (added with the Bestiary) so the
  reserve/complete/fail gate accepts every homebrew `kind` (spell, item, feat, …),
  not just `monster`. Reuses the existing `ai_text_config` caps.
- `20260920120000_homebrew_items.sql` — the **Armory** table.

```
npx supabase db push
```

Or paste each file into the Supabase **SQL Editor** and run it (all are safe to
run more than once). Building by hand needs only these; the ✨ buttons also need
steps 2–3.

## 2. Deploy the one Edge Function

`generate-homebrew` is the single AI drafter for all homebrew editors (spells and
items today) — it takes a `kind` and returns a schema-shaped draft. Re-deploy it
whenever a new editor adds a kind.

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

## What you get

**Spellbook** — a homebrew spell you author (school, level, range, save/attack,
damage + type, area, duration, description, "at higher levels") can be **added to
any character** from its card. It lands on the sheet as a custom spell — editable
there — and when that character casts it on the **Battle map**, the animation
engine reads its **school**, **damage type**, and **area** and gives it the
matching volumetric effect automatically.

**Armory** — a homebrew magic item (type, rarity, attunement, properties,
charges, value, description) can be **handed to any character** from its card. It
drops into that sheet's inventory carrying all its details. Author once, reuse
across the party.

---

## Roadmap / status (homebrew editors)

The user asked for four homebrew editors, in this order. Progress:

1. **Custom spells — DONE.** `Spellbook` page (`spells.html`/`js/pages/spells.js`),
   `homebrew_spells` table, `homebrewSpells` store. Casts + animates via the
   existing custom-spell plumbing.
2. **Magic items — DONE.** `Armory` page (`items.html`/`js/pages/items.js`),
   `homebrew_items` table, `homebrewItems` store. "Give to hero" → sheet inventory.
3. **Races, classes & subclasses — IN PROGRESS (scaffolded).**
   - Done so far: migration `20260921120000_homebrew_options.sql` (one
     `homebrew_options` table keyed by `kind` in race/subclass/class) and the
     `homebrewOptions` store in `js/db.js`. **These are committed but not yet
     wired to any UI** (inert until then).
   - The rules engine ALREADY supports custom **races** (`raceInfo` in
     `js/dnd/rules.js` consumes a custom race object) and custom **subclasses**
     (`{name, notes}`). The builder already has inline custom-race/subclass forms.
   - TODO: add `race` + `subclass` schemas to `generate-homebrew/index.ts`
     (kinds already allowed by the widened `ai_text_log` check); build an
     `origins.html` / `js/pages/origins.js` tabbed page (Races | Subclasses |
     Classes) mirroring the Spellbook/Armory, with "Apply to hero" that sets
     `sheet.race` / `sheet.clazz.subclass` and re-derives; add nav
     `["origins.html", "🌿 Origins"]`.
   - **Custom CLASSES need engine work** (a class's spell slots come from its
     own `levels[].slots` array, not a formula — `classInfo` returns null for
     non-SRD). Plan: extend `classInfo`/`derive` to accept a custom class object
     and synthesize `levels[].slots` from a caster-type table (full/half/third/
     pact/none, copied from wizard/paladin/warlock progressions). Do this as its
     own commit after races+subclasses.
4. **Feats & backgrounds — TODO.** Same pattern: `homebrew_options` can hold
   them too (or a small table), a `feat`/`background` schema in generate-homebrew,
   and a page. Backgrounds feed skills/tools/equipment; feats feed features.

Also outstanding (housekeeping): the user pasted a fal.ai API key in an earlier
chat — remind them to rotate it. Keys only ever live in Supabase function secrets.
