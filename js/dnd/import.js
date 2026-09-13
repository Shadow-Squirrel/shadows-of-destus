// ─────────────────────────────────────────────────────────────
//  import.js — bring characters in, send characters out.
//
//  • Native format: a JSON file this site exported. Round-trips
//    perfectly.
//  • D&D Beyond: paste the JSON from D&D Beyond's character
//    service (public characters expose it). Best-effort mapping:
//    name, race, class/subclass, level, ability scores, spells,
//    inventory, alignment and flavor text come across; anything
//    that doesn't match SRD data lands as custom entries, and
//    every gap is reported as a warning so the player can finish
//    the sheet with the builder (pendingChoices flags the rest).
// ─────────────────────────────────────────────────────────────
import { newCharacter, migrateCharacter, CHAR_VERSION } from "./model.js";
import { RACES } from "./data/races.js";
import { CLASSES } from "./data/classes.js";
import { SPELLS } from "./data/spells.js";
import { WEAPONS, ARMOR, GEAR, PACKS } from "./data/equipment.js";
import { BACKGROUNDS } from "./data/backgrounds.js";

/* ── native export ── */
export function exportCharacter(row) {
  return JSON.stringify(
    { app: "campaign-hub", kind: "character", version: CHAR_VERSION, name: row.name, character: row.sheet },
    null,
    2
  );
}

/* ── import: sniff the format and convert ── */
export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("That isn't valid JSON — paste the whole file/response."); }
  if (data?.app === "campaign-hub" && data.character)
    return { char: migrateCharacter(data.character), warnings: [], source: "native" };
  const ddb = data?.data && (data.data.classes || data.data.stats) ? data.data : data.classes || data.stats ? data : null;
  if (ddb) return importDdb(ddb);
  throw new Error("Unrecognized format. Export from this site, or paste D&D Beyond character JSON.");
}

/* ── D&D Beyond mapping ── */
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const byName = (dict) => {
  const m = new Map(Object.values(dict).map((x) => [norm(x.name), x.index]));
  return (name) => m.get(norm(name)) || null;
};
const ALIGN = { 1: "lawful good", 2: "neutral good", 3: "chaotic good", 4: "lawful neutral", 5: "true neutral", 6: "chaotic neutral", 7: "lawful evil", 8: "neutral evil", 9: "chaotic evil" };
const STAT_IDS = { 1: "str", 2: "dex", 3: "con", 4: "int", 5: "wis", 6: "cha" };

function importDdb(d) {
  const warnings = [];
  const c = newCharacter();
  const findSpellIdx = byName(SPELLS);

  c.name = d.name || "Imported hero";

  /* class + level */
  const classes = d.classes || [];
  if (classes.length) {
    const main = classes.reduce((a, b) => ((b.level || 0) > (a.level || 0) ? b : a), classes[0]);
    c.level = Math.max(1, Math.min(20, classes.reduce((t, k) => t + (k.level || 0), 0)));
    const clsIdx = byName(CLASSES)(main.definition?.name);
    if (clsIdx) {
      c.clazz = { kind: "srd", index: clsIdx, skillChoices: [], expertise: [], subclass: null };
      const subName = main.subclassDefinition?.name;
      if (subName) {
        // DDB says "School of Evocation" / "Life Domain" / "The Fiend";
        // the SRD says "Evocation" / "Life" / "Fiend" — contains-match.
        const srdSub = CLASSES[clsIdx].subclasses.find(
          (s) => norm(s.name) === norm(subName) || norm(subName).includes(norm(s.name))
        );
        c.clazz.subclass = srdSub
          ? srdSub.index
          : { kind: "custom", name: subName, notes: "Imported from D&D Beyond — add its features as custom features." };
        if (!srdSub) warnings.push(`Subclass “${subName}” isn't in the SRD — kept as a custom subclass; add its features by hand.`);
      }
      warnings.push("Re-pick your class skills (and expertise, if any) in the builder — those choices don't transfer cleanly.");
    } else {
      warnings.push(`Class “${main.definition?.name}” isn't in the SRD — pick the closest class and add differences as custom features.`);
    }
    if (classes.length > 1) warnings.push("Multiclass detected: only the highest class imported (multiclass support is coming).");
  } else warnings.push("No class found in the file.");

  /* race */
  const raceName = d.race?.fullName || d.race?.baseName || d.race?.baseRaceName;
  if (raceName) {
    let matched = false;
    for (const r of Object.values(RACES)) {
      const sub = r.subraces.find((s) => norm(s.name) === norm(raceName));
      if (sub) { c.race = { kind: "srd", index: r.index, subrace: sub.index }; matched = true; break; }
      if (norm(r.name) === norm(raceName) || norm(d.race?.baseRaceName) === norm(r.name)) {
        c.race = { kind: "srd", index: r.index, subrace: r.subraces[0]?.index || null };
        matched = true;
        if (r.subraces.length && norm(r.name) !== norm(raceName))
          warnings.push(`Subrace “${raceName}” isn't in the SRD — defaulted to ${r.subraces[0]?.name || r.name}; adjust in the builder.`);
        break;
      }
    }
    if (!matched) {
      c.race = {
        kind: "custom", name: raceName, abilityBonuses: {},
        speed: d.race?.weightSpeeds?.normal?.walk || 30, size: d.race?.size || "Medium",
        traits: (d.race?.racialTraits || []).map((t) => ({ name: t.definition?.name || "Trait", desc: "" })).filter((t) => t.name !== "Trait"),
        languages: [],
      };
      warnings.push(`Race “${raceName}” isn't in the SRD — imported as a custom race. Set its ability bonuses in the builder (they're included in your imported scores as zeros for now).`);
    }
  } else warnings.push("No race found in the file.");

  /* ability scores: DDB stores BASE scores; racial bonuses reapply from our data */
  const stats = d.stats || [];
  for (const s of stats) {
    const ab = STAT_IDS[s.id];
    if (ab && s.value != null) c.abilities[ab] = s.value;
  }
  for (const s of d.overrideStats || []) {
    const ab = STAT_IDS[s.id];
    if (ab && s.value != null) c.abilities[ab] = s.value;
  }
  c.abilityMethod = "manual";
  warnings.push("Ability Score Improvements from leveling don't transfer — redo them in the builder (the checklist will remind you).");

  /* background */
  const bgName = d.background?.definition?.name;
  if (bgName) {
    const srdBg = byName(BACKGROUNDS)(bgName);
    c.background = srdBg
      ? { kind: "srd", index: srdBg, languageChoices: [] }
      : { kind: "custom", name: bgName, skills: [], tools: [], languages: [], feature: { name: "", desc: "" } };
    if (!srdBg) warnings.push(`Background “${bgName}” imported as custom — pick its two skills in the builder.`);
  }

  /* alignment + flavor */
  c.alignment = ALIGN[d.alignmentId] || "";
  const tr = d.traits || {};
  c.details.personality = tr.personalityTraits || "";
  c.details.ideals = tr.ideals || "";
  c.details.bonds = tr.bonds || "";
  c.details.flaws = tr.flaws || "";
  c.details.appearance = tr.appearance || "";
  c.details.backstory = d.notes?.backstory || "";

  /* spells */
  const seen = new Set();
  const addSpell = (def, prepared) => {
    if (!def?.name) return;
    const idx = findSpellIdx(def.name);
    const key = idx || norm(def.name);
    if (seen.has(key)) return;
    seen.add(key);
    if (idx) {
      if (SPELLS[idx].level === 0) c.spells.cantrips.push(idx);
      else {
        c.spells.known.push(idx);
        if (prepared) c.spells.prepared.push(idx);
      }
    } else {
      c.spells.custom.push({
        name: def.name, level: def.level ?? 1, school: def.school || "", time: "", range: "",
        components: "", duration: "", concentration: !!def.concentration, ritual: !!def.ritual,
        attack: false, save: null, dmg: "", dmgType: "", desc: "Imported from D&D Beyond — fill in details.",
      });
      warnings.push(`Spell “${def.name}” isn't in the SRD — imported as a custom spell (add its text yourself).`);
    }
  };
  for (const grp of d.classSpells || [])
    for (const s of grp.spells || []) addSpell(s.definition, s.prepared || s.alwaysPrepared);
  for (const bucket of ["race", "class", "item", "feat"])
    for (const s of d.spells?.[bucket] || []) addSpell(s.definition, s.prepared || s.alwaysPrepared);

  /* inventory */
  const wIdx = byName(WEAPONS), aIdx = byName(ARMOR), gIdx = byName(GEAR), pIdx = byName(PACKS);
  for (const it of d.inventory || []) {
    const name = it.definition?.name;
    if (!name) continue;
    const qty = it.quantity || 1;
    const equipped = !!it.equipped;
    const w = wIdx(name), a = aIdx(name), g = gIdx(name), p = pIdx(name);
    if (w) c.equipment.push({ kind: "weapon", item: w, qty, equipped });
    else if (a) c.equipment.push({ kind: "armor", item: a, qty, equipped });
    else if (g) c.equipment.push({ kind: "gear", item: g, qty });
    else if (p) c.equipment.push({ kind: "pack", item: p, qty });
    else c.equipment.push({ kind: "custom", item: null, name, qty });
  }

  /* HP: derived here rather than trusted, players can override */
  warnings.push("Max HP is recomputed from your class + CON (average rolls). Use the builder's HP options if your total differed.");

  return { char: migrateCharacter(c), warnings, source: "ddb" };
}
