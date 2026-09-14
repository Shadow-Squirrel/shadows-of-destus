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

### AI NPC generator
DM types e.g. *"a nervous goblin merchant who secretly works for the thieves
guild"* → Onyx produces a full NPC: name, race, occupation, personality,
**secret**, **voice notes**, and an **inventory** (item + price). Then
**"Generate Portrait"** (reuses FLUX) and **"Add NPC to campaign"** (drops it
into the codex/roster). Editable. Same cost-caps as the image/text AI.

### AI monster generator
DM types e.g. *"a CR 7 undead crocodile boss"* → Onyx builds a statblock
(name, CR, HP, AC, actions, legendary actions, traits like "Death Roll",
"Swamp Ambush"). Then **"Generate Token"** → it's playable on the VTT (same
token/HP/initiative shape as SRD monsters). Editable before use.

## Homebrew & in-play tools
- **Make homebrew stupidly easy** — one-click **Create Monster / Spell / Item /
  Class / Subclass / Race-Species / Feat** with a **structured form editor**
  (fields + checkboxes, e.g. Name / Level / School / Range / Damage / Damage
  Type / ☑ Upcast → +1d8 per level), NOT a scripting language. Output is
  **immediately usable by character sheets and the VTT**. Build-on: the model
  already stores `{kind:"custom"}` races/subclasses/backgrounds + custom
  spells/feats/attacks/items — these editors are friendly front-ends onto that
  same shape, and the marketplace can sell the results.
- **Smart combat (assist, don't automate)** — when the Fighter attacks
  "Longsword → Goblin #3", Onyx rolls to-hit (🎲 19+8=27 HIT), rolls damage
  (🎲 7+5=12), then **asks "Apply 12 damage? [Apply]"** — the DM stays in
  control (confirm, not auto-apply). Reduces bookkeeping without taking over.
  Build-on: the VTT already has attack targeting, dice, token HP, and the
  cast→damage flow — this adds the guided "roll → confirm → apply" loop.

## Community & network effects
- **LFG ("Find a Game")** — a game-discovery board: players browse open
  campaigns filtered by **System, Experience (beginner-friendly…), Day, Time,
  Style (☑ roleplay / ☑ combat / hardcore), Voice (Discord…), Cost, Age
  (18+…)** → **Join Campaign** (ties into the invite/redeem system already
  built). Strong network effect; D&D Beyond put LFG on its 2026 roadmap, so
  discovery is strategically validated. Needs a public "listing" opt-in per
  campaign + moderation.
- **Deep Discord integration** — embrace Discord rather than compete: connect a
  Discord account, then Onyx posts to the server: game reminders ("⚔ Game
  Tonight — Curse of the Crimson King, 7:00 PM [Join Session]"), **session
  recaps** ("📖 Session 14 Recap Available"), and optionally dice results /
  character updates. Discord OAuth + a bot/webhook; per-campaign channel config.

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
