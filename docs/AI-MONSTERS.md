# AI monster generation

The **Bestiary** page lets a DM build custom monsters. Two of the buttons are
AI-powered and **dormant until you turn them on**:

- **✨ Generate stat block** — describe a monster ("a fire-breathing bog lizard,
  CR 4") and Claude drafts a balanced 5e stat block you review and edit. This
  uses a **text** AI (Anthropic / Claude) through the `generate-monster` Edge
  Function.
- **✨ Generate art** — draws the monster's portrait with FLUX.1 [schnell]. This
  reuses the **image** setup from [`AI-IMAGES.md`](./AI-IMAGES.md) (kind
  `portrait`); if you've already set images up, art works with no extra steps.

**Building monsters by hand needs none of this** — the form works offline of any
AI. Only the two ✨ buttons need the setup below.

Just like images, the money-critical part is enforced **in the database, before
any paid call**: `ai_reserve_text()` checks DM-ship and the monthly caps under a
per-month advisory lock, so two requests can't both slip past the cap. A failed
generation is marked `failed` and **doesn't count against quota**.

---

## 1. Apply the migration

`supabase/migrations/20260918120000_homebrew_monsters.sql` creates the
`homebrew_monsters` table and a **separate** AI-text budget
(`ai_text_config` / `ai_text_log`, counted apart from images because the
provider and price differ).

```
npx supabase db push
```

## 2. Deploy the Edge Function

```
npx supabase functions deploy generate-monster
```

## 3. Set your Anthropic key (the ONLY place it lives)

Create an API key at <https://console.anthropic.com/> → **API keys**, then:

```
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# optional — defaults to claude-opus-5. A cheaper model is fine for stat blocks:
npx supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5      # or claude-haiku-4-5
```

The browser never sees this key. Until it's set, the page shows a calm
"not set up" note and the hand-built form still works.

---

## Cost & the caps (read this — it's the bill-safety part)

There are **two independent ceilings**:

1. **In-app monthly caps** (`ai_text_config`) — the UX layer. Defaults:
   **25 per DM / month**, **500 globally / month**. Change them any time with one
   line in the SQL editor, no redeploy:
   ```sql
   update ai_text_config set per_dm_monthly_cap = 50, global_monthly_cap = 1000;
   ```
2. **Your Anthropic account spend limit** — the **hard** guarantee. Set a monthly
   usage limit at <https://console.anthropic.com/> → **Billing → Limits**. Even
   if the in-app caps were misconfigured, Anthropic stops charging past this.
   **Set it.** This is the real backstop against a surprise bill.

**Rough cost per stat block:** a monster is a small generation (~1–2K output
tokens). At Claude Opus 5 rates that's a few cents each; on Sonnet 5 or Haiku 4.5
it's a fraction of that. With the default 500/month global cap and Opus 5, the
absolute worst case is on the order of ~$20/month — and your account spend limit
caps it regardless.

Portrait art is billed separately by your image provider — see
[`AI-IMAGES.md`](./AI-IMAGES.md).

---

## What the AI returns

The function forces a schema-validated tool call, so Claude always returns a
structured stat block (name, size, type, AC, HP + hit dice, speed, the six
ability scores, saves/skills/senses/languages, CR, and arrays of
traits/actions/reactions/legendary actions, plus a one-line `art_prompt` used to
seed the portrait). You **review and edit** everything before it's saved — the
AI drafts, you decide.

Saved monsters appear in the **Bestiary** and in the **Battle** map's monster
search (tagged "homebrew"), so you can drop them into encounters like any SRD
creature.
