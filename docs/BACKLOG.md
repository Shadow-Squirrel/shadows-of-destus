# Onyx Dungeon — backlog (planned, not yet built)

Captured from the owner. Not started; listed roughly by theme. Notes connect
each item to what already exists so we don't rebuild.

## AI-powered DM prep (flagship — "the area to dominate")
Positioning: **AI removes the boring prep, it does NOT play D&D for you.** Aligns
with WotC's stated 2026 priority of cutting DM prep + tool/tab-switching.

The flow the owner described:
- **"Create Encounter"** + a natural-language brief (e.g. *"an abandoned dwarven
  mine for four level-6 characters, a hidden cult, three encounters, a puzzle,
  and a boss"*) → Onyx generates a structured adventure:
  named location, ordered encounters, a puzzle, a boss, **suggested treasure**,
  **XP/difficulty** (budgeted to party level/size), **NPC dialogue ideas**, and
  **boxed read-aloud descriptions**.
- **"Generate Map"** → makes/imports the battlemap (reuses the FLUX.1 image
  feature already built).
- **"Add Encounter to Map"** → auto-stages the tokens (e.g. Cult Scout ×4, Void
  Acolyte ×2, Champion ×1) with **HP and initiative already rolled/ready**.

Build-on / feasibility:
- The **token/encounter system already exists** (VTT), so auto-staging monsters
  with HP + initiative is mostly wiring on top of it.
- Monster stats come from the **SRD bestiary already shipped**; generated
  custom creatures map to the same token shape (or a homebrew statblock).
- Needs a **text-LLM** integration (encounter design, NPC lines, boxed text) —
  a new Edge Function alongside the image one, behind the **same cost-safety
  cap pattern** (per-DM + global monthly caps, prepaid provider ceiling).
- Output is **editable**, not final — the DM tweaks before running it.

## Legal & trust
- **Privacy Policy / Terms / DMCA process** — Terms, Privacy, and Licenses pages
  already exist as reviewed-templates (`terms.html`, `privacy.html`,
  `licenses.html`, linked in the footer). Still to add: a **DMCA / takedown
  policy** page + a reporting channel and a documented notice-and-takedown
  workflow (important once users upload maps/art and share homebrew).
- **Content moderation** — needed because users upload images (map uploads, AI
  art) and write homebrew text. Wants: a report button, a moderation queue/mod
  tooling, and a removal path. Ties into DMCA above and to storage RLS.

## Payments & commerce
- **Secure payment processing** — the deferred Stripe phase: Stripe Checkout +
  Customer Portal, no card data stored (PCI SAQ A). Subscription unlocks DM
  accounts (adds the buyer's email to `campaign_creators`).
- **Marketplace infrastructure** — a storefront where **creators sell their own
  content** and buyers get it in-app. Details from the owner:
  - **What creators sell:** custom **classes and races** (homebrew), **theme
    packs**, **maps / map packs**, tokens, adventures, asset packs.
  - **Revenue split:** **creator 70% / Onyx Dungeon 30%** of each sale.
  - **Purchase → use flow:** a **DM buys** an item → it's **added to that DM's
    campaign** → **the party can access it if the DM chooses** (DM toggles
    visibility to players). Custom classes/races become selectable in the
    character builder for that campaign.
  - **Build-on:** the character builder already supports `{kind:"custom"}`
    races/subclasses/backgrounds + custom spells/feats — marketplace classes &
    races extend that same homebrew shape, gated by an entitlement.
  - **Infra:** listings, search, reviews/ratings; creator payouts via **Stripe
    Connect** (handles the split + tax/1099s); creator onboarding + content
    review/moderation before listing.
- **Digital entitlement system** — the engine under the marketplace: records who
  owns/licensed what, grants/revokes access, and gates content (a bought class,
  map pack, or adventure) behind the buyer's entitlement — scoped so a DM's
  purchase unlocks it for their campaign, and optionally their players. Also
  powers the "how D&D products would work" demo.

## Growth & fundraising
- **Strong analytics** — active-users dashboard (DAU/MAU, retention, campaigns
  created, sessions run). Privacy-respecting; feeds the investor story.
- **Professional investor / partner deck** — pitch deck (problem, product,
  traction, market, model, roadmap, team, ask).
- **Technical demonstration of how D&D products would work** — a concrete demo
  of a purchased adventure/module: how buying it unlocks maps, statblocks,
  quests, and drops them into a DM's campaign (entitlements → content).

---
*Add to this list as ideas come up; pull items out when they become active tasks.*
