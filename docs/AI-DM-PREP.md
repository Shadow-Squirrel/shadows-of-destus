# AI DM-prep accelerator

Describe a fight in one sentence and the **Battle Map** page drafts the whole
encounter for you: a balanced monster roster, a battle-map image, and the tokens
placed on the grid — ready to flip live.

Look for **⚡ AI Prep** on the Battle Map toolbar (and on the empty-state card
when you have no encounters yet). It's **DM-only**.

## What it does (and what it spends)

1. **Plan** — you type the scene, party level, party size and difficulty. The
   `plan-encounter` Edge Function drafts a roster (drawn from the SRD bestiary so
   the creatures are real) plus a top-down battle-map prompt. → **1 planner slot.**
2. **Review** — you see the whole plan before anything is built: the name, the
   read-aloud summary, the map prompt (editable), and the roster. Each monster is
   tagged **SRD** (pulled straight from the bestiary), **homebrew** (a custom
   creature you already saved), or **generate** (will be drafted fresh). Untick
   anything you don't want. A running tally tells you exactly how many tokens,
   images and generations the build will use.
3. **Build** — it creates the encounter, draws the map, pulls or generates each
   monster, and drops the tokens. Each **generate** creature draws **1 planner
   slot**; the map draws **1 image**. Everything runs against the caps below.

Nothing is placed until you press **⚔ Build encounter**, and the new encounter is
created **inactive** — the party sees nothing until you press **⚑ Go live**.

## It reuses the AI you already set up — no new keys

The accelerator does **not** need its own provider key or its own budget:

- The **plan** and any **generated monsters** use the same AI *text* budget and
  provider as the [Bestiary's monster generator](./AI-MONSTERS.md) (Cloudflare
  Workers AI — free — or Anthropic). The plan is logged as a `monster` generation,
  so it counts against the same monthly cap.
- The **battle map** uses the same image setup as [AI images](./AI-IMAGES.md)
  (FLUX.1 [schnell] via the `generate-image` function).

So if monster generation and images already work, the **only** new step is
deploying one function. **No migration is required** — the accelerator reuses the
`ai_text` budget tables from the monsters migration.

## Deploy the one new function

```
npx supabase functions deploy plan-encounter
```

Or, all in the browser (the repo is public): Supabase dashboard → **Edge
Functions** → **Deploy a new function** → name it `plan-encounter` → paste the
contents of `supabase/functions/plan-encounter/index.ts`.

That's it. If the Bestiary's ✨ generator and AI maps already work, ⚡ AI Prep
works too. Until the function is deployed, the panel shows a calm "AI not set up"
note and you can still build encounters by hand.

## Cost & the caps (the bill-safety part)

Every paid step is reserved **in the database, before the paid call**, under the
same per-month advisory lock as everything else — two requests can't both slip
past a cap, and a failed generation is marked `failed` and **doesn't count**.

- **Planner + generated monsters** → the AI *text* cap (`ai_text_config`,
  default **25 / DM / month**, **500 global**). See
  [`AI-MONSTERS.md`](./AI-MONSTERS.md) to change it.
- **Battle map** → the AI *image* cap (`ai_images_config`). See
  [`AI-IMAGES.md`](./AI-IMAGES.md).
- **Your provider account spend limit** is the hard backstop. Set it — see the
  two docs above.

Because a single build can fire several generations at once, the review step
always shows the exact tally first, and you can untick creatures (or turn off the
map) to spend less. Any step that fails is skipped and reported — a half-built
plan still leaves you a usable encounter.
