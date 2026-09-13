# What's new: Characters & the Battle Map

Two big additions turn the campaign hub into a full virtual tabletop.

## 🧙 Characters (`characters.html`)

A D&D Beyond-style **character builder and live sheet**, using the free
**SRD 5.1** (Creative Commons, safe to ship — see *Licensing* below).

- **Builder wizard:** race → class → abilities → background → equipment →
  spells → details. Every SRD race (with subraces), all 12 classes (with
  subclasses), point-buy / standard array / rolled / manual stats, ASIs and
  feats, full spell selection.
- **Living sheet:** tap any skill, save, or attack to roll it — the right
  bonus, advantage/disadvantage and all — straight into the table's shared
  dice feed. HP, temp HP, spell slots, prepared spells, and a **Level up**
  button that shows exactly what changed.
- **Homebrew everywhere:** every picker has a *Custom* option (race,
  subclass, background, spells, items, features) so content from books you
  own can be typed in, with look-it-up links to
  [D&D Beyond](https://www.dndbeyond.com/sources) and [Open5e](https://open5e.com).
- **Import / export:** paste a **D&D Beyond** character's JSON to bring a
  hero across (anything non-SRD lands as custom, with a finish-up checklist),
  or export/back up any character as JSON.

## ⚔️ Battle Map (`vtt.html`)

A live virtual tabletop the whole table shares.

- The **DM** opens an encounter on any uploaded map, drops the party on as
  tokens, and stages monsters from the **SRD bestiary** (330+ monsters, full
  stat blocks with rollable attacks). Tokens carry HP, conditions, and a
  hidden-until-revealed flag.
- **Players** see the live board and can move only their own character's token.
- **Initiative tracker** with a turn pointer, a **dice tray**, and
  **spell animations** — cast a spell at a point and an effect plays for
  everyone (fireball blasts and leaves a fiery radius ring; every spell gets
  a fitting visual from its own data).

## 🎲 3D dice (everywhere)

Rolls can now tumble as **3D physics dice** across the screen and land on the
database's real (un-fudgeable) result. Toggle on the Dice page; falls back to
the classic 2D animation automatically where 3D can't run.

---

## Turning it on (one-time database update)

The site works in **every** browser immediately — until the database is
updated, characters save in that browser's local storage and the battle map
runs in read-only demo form. To switch on shared, saved characters and the
live battle map for the whole table, apply the new tables **once**:

**Option A — laptop (Supabase CLI already set up):**
```
npx supabase db push
```

**Option B — anywhere, phone included:** open your project at
[supabase.com](https://supabase.com) → **SQL Editor → New query**, paste the
entire contents of **`supabase/apply-new-features.sql`**, and press **Run**.
It only adds tables, security rules, and functions — it never touches existing
data, and it's safe to run more than once.

Once applied, any character a player saved locally moves into the shared
database automatically the next time they open the Characters page.

---

## Licensing (important for going commercial)

All game content shipped in the site is from the **System Reference Document
5.1**, released by Wizards of the Coast under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) —
which **permits commercial use** with attribution (the footer credit is that
attribution). That covers the 9 SRD races, 12 classes, 319 spells, ~330
monsters, and the core rules.

Content from other books (Tasha's, Xanathar's, Volo's, adventure-specific
monsters, etc.) is **not** freely licensed and is deliberately **not** shipped.
The *Custom* options exist so a group can add material from books they own
without that content living in this codebase — the same approach Roll20 and
Foundry take. Keep it that way when you start charging: ship SRD + user
homebrew, never other publishers' text.

Refreshing the SRD data (rarely needed):
```
git clone --depth 1 https://github.com/5e-bits/5e-database /tmp/5edb
SRD_DIR=/tmp/5edb/src/2014/en node tools/build-srd.mjs
node tools/test-rules.mjs
```
