#!/usr/bin/env node
// Sanity tests for js/dnd/rules.js against well-known 5e facts.
// Run: node tools/test-rules.mjs   (exits non-zero on failure)
import { newCharacter } from "../js/dnd/model.js";
import { derive, eligibleSpells, finalAbilities, pointBuySpent, parseDice, expertiseSlots } from "../js/dnd/rules.js";
import { SPELLS } from "../js/dnd/data/spells.js";

let fails = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.error(`✗ ${label}: got ${g}, want ${w}`); fails++; }
  else console.log(`✓ ${label}`);
};

const mk = (over) => {
  const c = newCharacter();
  Object.assign(c, over);
  return c;
};

/* ── a level 5 high-elf wizard, point-buyish scores ── */
const wiz = mk({
  level: 5,
  race: { kind: "srd", index: "elf", subrace: "high-elf", languageChoices: ["draconic"], cantripChoice: "fire-bolt" },
  clazz: { kind: "srd", index: "wizard", subclass: "evocation", skillChoices: ["arcana", "investigation"], expertise: [] },
  background: { kind: "srd", index: "acolyte", languageChoices: ["celestial", "infernal"] },
  abilities: { str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 10 },
  asi: [{ level: 4, kind: "asi", plus: { int: 2 } }],
  equipment: [{ kind: "weapon", item: "quarterstaff", qty: 1, equipped: true }],
});
const dw = derive(wiz);
eq("wizard problems", dw.problems, []);
eq("high elf INT 15+1 base, +2 ASI = 18", dw.abilities.int.score, 18); // elf gives dex+2, high elf int+1
eq("high elf DEX 14+2", dw.abilities.dex.score, 16);
eq("L5 prof bonus", dw.profBonus, 3);
eq("wizard INT save prof", dw.saves.int.mod, 4 + 3);
eq("wizard STR save no prof", dw.saves.str.mod, -1);
eq("arcana skill (prof, INT)", dw.skills.arcana.mod, 4 + 3);
eq("perception racial prof (Keen Senses)", dw.skills.perception.prof, true);
eq("passive perception", dw.passivePerception, 10 + 1 + 3);
eq("wizard L5 HP avg: 6+2 + 4*(4+2)", dw.hp.max, 32);
eq("unarmored AC 10+dex", dw.ac.value, 13);
eq("initiative = dex mod", dw.initiative, 3);
eq("speed 30", dw.speed, 30);
const wsc = dw.spellcasting;
eq("wizard slots L5", wsc.slots, [{ level: 1, max: 4 }, { level: 2, max: 3 }, { level: 3, max: 2 }]);
eq("wizard DC 8+3+4", wsc.dc, 15);
eq("wizard spell attack", wsc.attackBonus, 7);
eq("wizard cantrips known @5", wsc.cantripsMax, 4);
eq("wizard prepared max = int mod + level", wsc.preparedMax, 4 + 5);
eq("wizard max spell level", wsc.maxSpellLevel, 3);
eq("high-elf bonus cantrip surfaces", dw.racialSpells, [{ spell: "fire-bolt", note: "high elf cantrip", ability: "int" }]);
const elig = eligibleSpells(wiz, dw);
eq("fireball eligible for L5 wizard", elig.spells.includes("fireball"), true);
eq("cure wounds NOT on wizard list", elig.spells.includes("cure-wounds"), false);
eq("no 4th-level spells eligible at L5", elig.spells.some((s) => SPELLS[s].level > 3), false);
// quarterstaff attack: simple weapon, STR -1, prof → +2 to hit
const qs = dw.attacks.find((a) => a.name === "Quarterstaff");
eq("quarterstaff to-hit (STR-1 + prof3)", qs.toHit, 2);

/* ── a level 5 hill dwarf barbarian-alike: test barbarian/monk/rogue bits separately ── */
const barb = mk({
  level: 5,
  race: { kind: "srd", index: "dwarf", subrace: "hill-dwarf" },
  clazz: { kind: "srd", index: "barbarian", subclass: "berserker", skillChoices: ["athletics", "intimidation"] },
  background: { kind: "custom", name: "Bouncer", skills: ["insight", "perception"], tools: [], languages: [], feature: { name: "Seen It All", desc: "..." } },
  abilities: { str: 16, dex: 14, con: 16, int: 8, wis: 12, cha: 10 },
  equipment: [
    { kind: "weapon", item: "greataxe", qty: 1, equipped: true },
    { kind: "armor", item: "shield", qty: 1, equipped: true },
  ],
});
const db_ = derive(barb);
eq("hill dwarf CON 16+2+1... wait dwarf con+2, hill wis+1", db_.abilities.con.score, 18);
eq("hill dwarf WIS +1", db_.abilities.wis.score, 13);
eq("barbarian unarmored defense 10+2+4 (+2 shield)", db_.ac.value, 18);
eq("dwarven toughness: 12+4 + 4*(7+4) + 5", db_.hp.max, 65);
eq("barbarian L5 rage count", db_.classSpecific.rage_count, 3);
eq("greataxe to-hit STR+3 prof+3", db_.attacks[0].toHit, 6);
eq("no spellcasting", db_.spellcasting, null);
eq("custom background skills prof", db_.skills.insight.prof, true);

/* ── warlock pact magic L5 ── */
const lock = mk({
  level: 5,
  race: { kind: "srd", index: "tiefling" },
  clazz: { kind: "srd", index: "warlock", subclass: "fiend", skillChoices: ["deception", "intimidation"] },
  abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
});
const dl = derive(lock);
eq("pact slots: two 3rd-level", dl.spellcasting.pact, { count: 2, level: 3 });
eq("no regular slots for warlock", dl.spellcasting.slots, []);
eq("warlock known max @5", dl.spellcasting.knownMax, 6);
eq("tiefling CHA 16+2", dl.abilities.cha.score, 18);
eq("tiefling racial spells @5", dl.racialSpells.map((r) => r.spell), ["thaumaturgy", "hellish-rebuke", "darkness"]);

/* ── rogue: expertise + sneak attack + finesse ── */
const rog = mk({
  level: 5,
  race: { kind: "srd", index: "halfling", subrace: "lightfoot-halfling" },
  clazz: { kind: "srd", index: "rogue", subclass: "thief", skillChoices: ["stealth", "acrobatics", "perception", "deception"], expertise: ["stealth", "perception"] },
  abilities: { str: 10, dex: 16, con: 14, int: 12, wis: 13, cha: 14 },
  equipment: [{ kind: "weapon", item: "rapier", qty: 1, equipped: true }],
});
const dr = derive(rog);
eq("halfling DEX 16+2 = 18", dr.abilities.dex.score, 18);
eq("stealth expertise: 4 + 3*2", dr.skills.stealth.mod, 10);
eq("sneak attack 3d6 @5", dr.sneakAttack, "3d6");
eq("rapier finesse uses DEX", dr.attacks[0].toHit, 4 + 3);
eq("expertise slots rogue L5", expertiseSlots("rogue", 5), 2);
eq("expertise slots rogue L6", expertiseSlots("rogue", 6), 4);

/* ── monk martial arts ── */
const monk = mk({
  level: 5,
  race: { kind: "srd", index: "human" },
  clazz: { kind: "srd", index: "monk", subclass: "open-hand", skillChoices: ["acrobatics", "insight"] },
  abilities: { str: 10, dex: 16, con: 14, int: 10, wis: 15, cha: 8 },
});
const dm = derive(monk);
eq("human +1 all: WIS 16", dm.abilities.wis.score, 16);
eq("monk unarmored defense 10+4+3... dex16+1=17→+3, wis 16→+3", dm.ac.value, 16);
eq("martial arts d6 @5", dm.martialArts, { count: 1, sides: 6 });
const ua = dm.attacks.find((a) => a.name === "Unarmed Strike");
eq("monk unarmed uses DEX, d6", [ua.toHit, ua.dmg], [3 + 3, "1d6"]);

/* ── cleric prepared-list, half-caster paladin ── */
const cleric = mk({
  level: 3,
  race: { kind: "srd", index: "human" },
  clazz: { kind: "srd", index: "cleric", subclass: "life", skillChoices: ["insight", "medicine"] },
  abilities: { str: 12, dex: 10, con: 14, int: 8, wis: 16, cha: 12 },
  equipment: [
    { kind: "armor", item: "chain-mail", qty: 1, equipped: true },
    { kind: "armor", item: "shield", qty: 1, equipped: true },
  ],
});
const dc = derive(cleric);
eq("cleric prepared = wis mod (17→+3) + level 3", dc.spellcasting.preparedMax, 3 + 3);
eq("cleric slots L3", dc.spellcasting.slots, [{ level: 1, max: 4 }, { level: 2, max: 2 }]);
eq("chain mail ignores dex, +2 shield", dc.ac.value, 18);
eq("cleric knows all: knownMax null", dc.spellcasting.knownMax, null);

const pal = mk({
  level: 5,
  race: { kind: "srd", index: "half-elf", bonusChoices: { str: 1, con: 1 }, languageChoices: ["orc"] },
  clazz: { kind: "srd", index: "paladin", subclass: "devotion", skillChoices: ["athletics", "persuasion"] },
  abilities: { str: 15, dex: 10, con: 14, int: 8, wis: 10, cha: 15 },
});
const dp = derive(pal);
eq("half-elf CHA+2 → 17", dp.abilities.cha.score, 17);
eq("half-elf chosen +1s", [dp.abilities.str.score, dp.abilities.con.score], [16, 15]);
eq("paladin prepared = cha mod + half level", dp.spellcasting.preparedMax, 3 + 2);
eq("paladin slots @5 (half caster)", dp.spellcasting.slots, [{ level: 1, max: 4 }, { level: 2, max: 2 }]);
eq("no paladin spellcasting at L1", derive({ ...pal, level: 1 }).spellcasting, null);

/* ── dragonborn breath weapon ── */
const dragon = mk({
  level: 6,
  race: { kind: "srd", index: "dragonborn", ancestry: "red" },
  clazz: { kind: "srd", index: "fighter", subclass: "champion", skillChoices: ["athletics", "survival"] },
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
});
const dd = derive(dragon);
eq("breath weapon 3d6 fire @6, DC 8+2+3", [dd.breath.dmg, dd.breath.dmgType, dd.breath.dc], ["3d6", "fire", 13]);

/* ── custom race + custom subclass + custom background ── */
const cust = mk({
  level: 3,
  race: { kind: "custom", name: "Warforged", abilityBonuses: { con: 2, str: 1 }, speed: 30, size: "Medium", traits: [{ name: "Constructed Resilience", desc: "You don't need to eat." }], languages: ["common"] },
  clazz: { kind: "srd", index: "fighter", subclass: { kind: "custom", name: "Echo Knight", notes: "From Explorer's Guide. Manifest an echo..." }, skillChoices: ["athletics", "perception"] },
  background: { kind: "custom", name: "Soldier", skills: ["athletics", "intimidation"], tools: ["Dice set"], languages: [], feature: { name: "Military Rank", desc: "..." } },
  abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
});
const dcu = derive(cust);
eq("custom race bonuses", [dcu.abilities.con.score, dcu.abilities.str.score], [16, 16]);
eq("custom subclass in features", dcu.features.some((f) => f.name.includes("Echo Knight")), true);
eq("custom race trait in features", dcu.features.some((f) => f.name === "Constructed Resilience"), true);
eq("custom bg tools listed", dcu.profList.tools.includes("Dice set"), true);
eq("no problems for custom build", dcu.problems, []);

/* ── utilities ── */
eq("point buy: 15,14,13,12,10,8 = 27", pointBuySpent({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }), 27);
eq("parse 8d6", parseDice("8d6"), { spec: [{ sides: 6, count: 8 }], modifier: 0 });
eq("parse 3d4 + 3", parseDice("3d4 + 3"), { spec: [{ sides: 4, count: 3 }], modifier: 3 });
eq("parse 1d8 + MOD (mod 3)", parseDice("1d8 + MOD", 3), { spec: [{ sides: 8, count: 1 }], modifier: 3 });

console.log(fails ? `\n${fails} FAILURES` : "\nAll rules tests pass.");
process.exit(fails ? 1 : 0);
