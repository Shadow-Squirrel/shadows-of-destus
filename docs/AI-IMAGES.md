# AI image generation — deploy & cost-safety guide

Let DMs generate **character portraits** and **battle maps** with
**FLUX.1 [schnell]**. This feature is built so you can turn it into a paid
product without waking up to a surprise bill.

---

## The two layers that protect you from a surprise bill

Read this first. There are **two** independent ceilings, and you want both.

1. **The provider prepaid ceiling — the REAL guarantee (you must set this).**
   The image provider (fal.ai or Replicate) can only ever bill you for what
   you let it. Load **prepaid credits** and/or set a **hard spend limit** in
   the provider dashboard. Turn OFF auto-recharge. Once the balance is spent,
   the provider stops serving — full stop. This is the ceiling that cannot be
   bypassed by any bug, race, or abuse in the app, because it lives at the
   company that charges your card. **If you do nothing else, do this.**

2. **The in-app caps — the UX layer (already built, enforced in the DB).**
   A per-DM monthly cap and a global monthly cap live in the database and are
   enforced *atomically, before any paid call is ever made*. They exist so a
   normal month stays cheap and predictable and so one DM can't burn the whole
   budget — and so users see "N images left this month" instead of a hard
   provider failure. They are your first line of defence, not your last.

Layer 2 keeps costs sane and friendly. Layer 1 is the wall. Use both.

---

## How it works (architecture)

```
browser (js/db.js `ai` store)
   │  supabase.functions.invoke('generate-image', { body })   ← user's JWT attached
   ▼
Edge Function  supabase/functions/generate-image/index.ts     ← holds the provider KEY
   │  1. authenticate the user (getUser)
   │  2. if no provider key set → 501 {error:"not-configured"} (no spend)
   │  3. ai_reserve_image()  ← DB checks DM-ship + caps ATOMICALLY, inserts 'pending'
   │  4. only now: call FLUX.1 [schnell] at the provider  ← the one paid step
   │  5. upload the image to private Storage (service role)
   │  6. success → ai_complete_image();  failure → ai_fail_image() (frees the slot)
   │  7. map → also insert a campaign-scoped `maps` row
   ▼
returns { path, url, kind, mapId }
```

The static site **never** holds the provider key — only the Edge Function
does. The database is the enforcer: even if the frontend were tampered with,
`ai_reserve_image` rejects non-DMs and over-cap requests before a cent is spent.

### The database objects (see the migration)

`supabase/migrations/20260916130000_ai_images.sql` (mirrored into
`supabase/schema.sql` and `supabase/apply-new-features.sql`):

- **`ai_image_config`** — single row. `per_dm_monthly_cap` (default **50**) and
  `global_monthly_cap` (default **5000**). Change a cap with one UPDATE, no
  redeploy:
  ```sql
  update ai_image_config set per_dm_monthly_cap = 100, global_monthly_cap = 8000;
  ```
- **`ai_image_log`** — one row per attempt: `campaign_id, dm_email, ym
  ('YYYY-MM'), kind ('map'|'portrait'), prompt, storage_path, status
  ('pending'|'done'|'failed'), created_at`. RLS: campaign members read their
  campaign's rows; **no client writes** (only the RPCs / service role).
- **`ai_reserve_image(campaign, kind, prompt)`** → reservation uuid. Raises
  `Only a DM of this campaign can generate images`, `DM monthly limit reached`,
  or `Global monthly AI budget reached`. **Atomic:** it takes a per-month
  advisory lock, then counts this month's non-`failed` rows for the DM and
  globally and inserts the `pending` row — all in one transaction, so two
  concurrent requests can never both slip past the cap.
- **`ai_complete_image(id, path)`** / **`ai_fail_image(id)`** — finalize a
  reservation (owner DM or service role). A `failed` row is excluded from every
  cap count, so **a failed generation costs no quota.**
- **`ai_usage()`** → `{used, cap, remaining, global_used, global_cap}` for the
  "N left this month" display.

### Storage buckets

- **Portraits** → new private bucket **`ai-art`**, at `${campaign_id}/${id}.<ext>`.
  Readable by any member of that campaign.
- **Battle maps** → the existing private **`maps`** bucket, at
  `${campaign_id}/ai-${id}.<ext>`. This is deliberate: the `maps` bucket is
  **reveal-gated** (players can't fetch a map until the DM reveals it), whereas
  `ai-art` is readable by all campaign members. A hidden battle map must stay
  hidden, so maps use the reveal-gated bucket and get a `maps` row with
  `revealed = false`. Only the **service role** writes either bucket.

---

## Provider payloads (verified)

Selected by the `IMAGE_PROVIDER` secret. `num_inference_steps` is pinned to
**4** (schnell is a 4-step turbo model).

**fal.ai** (default) — `POST https://fal.run/fal-ai/flux/schnell`,
header `Authorization: Key $FAL_KEY`:
```json
{ "prompt": "...", "num_inference_steps": 4,
  "image_size": "landscape_16_9" | "portrait_4_3", "num_images": 1,
  "enable_safety_checker": true }
```
Response: `{ "images": [ { "url": "https://…" } ] }`.

**Replicate** — `POST https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions`,
headers `Authorization: Bearer $REPLICATE_API_TOKEN` and `Prefer: wait`:
```json
{ "input": { "prompt": "...", "num_inference_steps": 4,
             "aspect_ratio": "16:9" | "3:4", "output_format": "webp" } }
```
Response: prediction with `output` = array of image URLs (the function polls if
the wait window lapses).

**Hugging Face** is a documented future option (its Inference API also serves
`black-forest-labs/FLUX.1-schnell`); it is intentionally **not** implemented
here — add a `generateHuggingFace()` branch mirroring the two above if wanted.

---

## Deploy steps (owner)

Prerequisite: the Supabase CLI is linked to the project (as the README's
step 2 already set up).

1. **Run the migration** — adds the tables, caps, RPCs and the `ai-art` bucket.
   ```bash
   npx supabase db push
   ```
   Or, from the dashboard: **SQL Editor → New query**, paste
   `supabase/apply-new-features.sql`, **Run** (safe to run more than once).

2. **Confirm the `ai-art` bucket exists** (the migration creates it). If your
   project blocks creating buckets from SQL, create it by hand: **Storage →
   New bucket → name `ai-art`, Private**, then re-run the migration so its
   storage read policy is applied.

3. **Set a provider and its key as function secrets** (never in the repo):
   ```bash
   # fal.ai (default)
   npx supabase secrets set IMAGE_PROVIDER=fal
   npx supabase secrets set FAL_KEY=<your fal key>

   # …or Replicate
   npx supabase secrets set IMAGE_PROVIDER=replicate
   npx supabase secrets set REPLICATE_API_TOKEN=<your replicate token>
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
   injected into Edge Functions automatically — you do **not** set those.

4. **Deploy the function:**
   ```bash
   npx supabase functions deploy generate-image
   ```

5. **Set your caps** (optional — sensible defaults of 50 / 5000 ship):
   ```sql
   update ai_image_config set per_dm_monthly_cap = 50, global_monthly_cap = 5000;
   ```

6. **★ Set the PREPAID CREDIT / hard spend limit at the provider ★** — the
   ceiling that actually protects your card (see the top of this doc). In the
   fal.ai or Replicate billing dashboard: load a fixed prepaid amount and/or set
   a hard monthly spend cap, and disable auto-recharge. **Do not skip this.**

Until steps 3–4 are done, the app shows a calm "AI images aren't set up yet"
note instead of erroring — nothing breaks.

---

## Using it

- **Maps page** (DM only): a **✨ Generate a battle map with AI** card — pick a
  style preset, describe the scene, generate. The new map arrives **hidden**;
  reveal it when ready. It also appears in the VTT map picker.
- **Character sheet** (DM only to generate; everyone sees the result): a
  **✨ Generate portrait** control on the sheet head, prefilled from the
  character's race/class/appearance. The portrait is stored on the sheet
  (`sheet.portrait`) and shown to the whole party.
- Both show the DM's **remaining monthly quota**. Failed generations don't
  count against it.

---

## Verifying the cost-safety (what's tested vs. what needs a live key)

**Proven automatically, against a real PostgreSQL** (see
`tools/run-ai-caps-tests.sh`, which boots a throwaway cluster as a non-root
user, applies the Supabase shim + `schema.sql`, and runs
`tools/test-ai-caps.sql` plus a parallel concurrency stress):

```
su pgtest -c 'bash tools/run-ai-caps-tests.sh'
```
proves: a player/non-DM can't reserve; the per-DM cap blocks at the limit and
inserts nothing over-cap; a `failed` row frees a slot (no quota consumed); the
global cap blocks everyone across DMs; only the owner/service role finalizes a
reservation; `ai_usage()` is correct; and **30 concurrent reservations against
a cap of 5 yield exactly 5** — the advisory lock closes the race.

**Still needs a live check** (can't be done without a real provider key/spend):

- An end-to-end real generation (fal.ai / Replicate → image → Storage upload →
  `maps` row / portrait). Do one manual generation of each kind after deploy.
- Confirm the returned image's content-type maps to a sensible extension for
  your chosen provider/output format.
- Confirm the provider prepaid limit actually halts generation once exhausted
  (spend down a tiny test balance, or trust the provider's documented behavior).
