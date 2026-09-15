# AI Create-Adventure

The **📖 Adventures** page turns one paragraph — *"an abandoned dwarven mine
for four level-6 heroes, a hidden cult, a flooded-cavern puzzle, and a bound
elemental boss"* — into a whole **ready-to-run adventure**: a named location, an
ordered set of scenes (combat / puzzle / social / exploration) each with **boxed
read-aloud text** and private DM notes, a cast of **NPCs** (with secrets and
voices), suggested **treasure**, and an **XP/difficulty budget**.

It **removes the boring prep — it does not play D&D for you.** Everything comes
back as an editable draft you review, tweak, and run. It's **DM-only**.

Combat scenes stage straight onto the **Battle map**: press **⚔ Stage on Battle
map** on a fight and the roster is handed to the ⚡ AI-prep builder you already
have — it draws the map and drops the tokens with HP ready, as an **inactive**
encounter you flip live when the party arrives.

## It reuses the AI you already set up — no new keys

The adventure planner does **not** need its own provider key or its own budget:

- The **draft** uses the same AI *text* budget and provider as the
  [Bestiary's monster generator](./AI-MONSTERS.md) and the
  [encounter accelerator](./AI-DM-PREP.md) (Cloudflare Workers AI — free — or
  Anthropic). One adventure is logged as a `monster` generation, so it counts
  against the same monthly cap.
- **Battle maps** and any **generated custom monsters** are billed only *later*,
  by their own functions/caps ([images](./AI-IMAGES.md), text) when you stage a
  combat scene — never at draft time.

So if monster generation already works, the **only** new steps are one migration
and deploying one function.

## 1. Apply the migration

```
npx supabase db push
```

Or paste `supabase/migrations/20260922120000_adventures.sql` into the Supabase
**SQL Editor** and run it (safe to run more than once). It adds one small
`adventures` table (party members read, only a DM writes). **No AI-budget change
is needed** — an adventure reserves against the existing `ai_text` budget.

## 2. Deploy the one new function

```
npx supabase functions deploy plan-adventure
```

Or, all in the browser (the repo is public): Supabase dashboard → **Edge
Functions** → **Deploy a new function** → name it `plan-adventure` → paste the
contents of `supabase/functions/plan-adventure/index.ts`.

That's it. If the Bestiary's ✨ generator already works, Create-Adventure works
too. Until the function is deployed, the composer shows a calm "not set up" note.

## 3. Provider key — already set if monsters work

`plan-adventure` uses the **same** provider secrets as `generate-monster`
(Cloudflare Workers AI — free — or Anthropic). If AI monster generation already
works, adventure drafting works with **no extra key**. If not, set a provider
following [`AI-MONSTERS.md`](./AI-MONSTERS.md) step 3.

## Cost & the caps (the bill-safety part)

Every paid step is reserved **in the database, before the paid call**, under the
same per-month advisory lock as everything else — two requests can't both slip
past a cap, and a failed draft is marked `failed` and **doesn't count**.

- **Adventure draft** → the AI *text* cap (`ai_text_config`, default **25 / DM /
  month**, **500 global**) — the *same pool* as monsters and encounters, counted
  together. Change it any time:

  ```sql
  update ai_text_config set per_dm_monthly_cap = 50, global_monthly_cap = 1000;
  ```

- **Staging a fight** → the battle map draws one AI *image* (`ai_images_config`)
  and each generated custom monster draws one AI *text* slot, exactly as the
  ⚡ AI-prep accelerator already does. The review step on the Battle map shows
  the tally first, so you always see what a build will spend.
- **Your provider account spend limit** is the hard backstop. Set it — see
  [`AI-MONSTERS.md`](./AI-MONSTERS.md) / [`AI-IMAGES.md`](./AI-IMAGES.md).

## The flow

1. **Describe** — a paragraph, plus party level/size, difficulty, and roughly how
   many scenes. → **1 planner slot.**
2. **Review & edit** — the whole adventure appears as a prep document. Fix the
   title, rewrite any read-aloud box, adjust DM notes, NPCs and treasure, then
   **Save** it to the campaign.
3. **Run it** — read the boxed text at the table; when a fight begins, **⚔ Stage
   on Battle map** builds it live-ready. Nothing the party sees changes until you
   press **⚑ Go live** on the Battle map.
