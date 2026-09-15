# AI NPC generator

The **🎭 NPCs** page is the DM's private cast. Describe someone in a sentence —
*"a nervous goblin merchant who secretly works for the thieves' guild"* — and the
AI drafts a full NPC: **name, race, role, personality, a real secret, a table
voice, and a small inventory**, plus an optional **portrait**. Everything is an
editable draft you tweak and keep.

**Secrets stay yours.** NPCs live in a **DM-only** table (`campaign_npcs`) — only
the campaign's DM can read or write it, enforced by the database, not the
browser. When you're ready, **Reveal to Codex** publishes just the public-facing
details (appearance, personality, race/role) and the portrait into the shared
🐉 **Codex** the whole party sees — never the secret, voice notes, or inventory.

## It reuses the AI you already set up — no new keys

- The **NPC draft** uses the same AI *text* budget and provider as the
  [Bestiary's monster generator](./AI-MONSTERS.md) and the homebrew editors
  (Cloudflare Workers AI — free — or Anthropic), via the shared
  `generate-homebrew` function (kind `npc`). One draft = one text slot.
- The **portrait** uses the same AI *image* setup as [AI images](./AI-IMAGES.md)
  (the `generate-image` function, kind `portrait`).

## 1. Apply the migration

```
npx supabase db push
```

Or paste `supabase/migrations/20260923120000_npcs.sql` into the Supabase **SQL
Editor** and run it (safe to run more than once). It:
- adds the DM-only `campaign_npcs` table,
- widens the shared AI-text budget to allow the `npc` kind,
- adds an `art_path` column to `codex_entries` so a revealed NPC's portrait
  (which lives in the private `ai-art` bucket) can show in the Codex.

## 2. Re-deploy the shared homebrew function

The NPC schema is a new `kind` inside the existing drafter, so re-deploy it:

```
npx supabase functions deploy generate-homebrew
```

Or, in the browser: Supabase dashboard → **Edge Functions** → open
`generate-homebrew` → paste the updated
`supabase/functions/generate-homebrew/index.ts`.

## 3. Provider key — already set if monsters work

`generate-homebrew` and `generate-image` use the **same** provider secrets you
already have. If AI monsters and AI maps work, NPCs and portraits work with **no
extra key**.

## Cost & the caps

Same bill-safety as everything else: every paid step is reserved in the database
before the call, and a failed draft is marked `failed` and **doesn't count**.

- **NPC draft** → the AI *text* cap (`ai_text_config`, default **25 / DM /
  month**), shared with monsters, spells, items and adventures.
- **Portrait** → the AI *image* cap (`ai_images_config`).

## The flow

1. **Describe** an NPC → **✨ Draft NPC** → review and edit the full sheet.
2. Optionally **✨ Portrait** to paint their face.
3. **Reveal to Codex** when the party meets them — they see the face and public
   details; the secret stays with you.
