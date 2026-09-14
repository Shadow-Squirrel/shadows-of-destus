// ─────────────────────────────────────────────────────────────
//  rules.js — the 5e rules engine (SRD 5.1).
//
//  One entry point: derive(character) → a fully computed sheet
//  (final scores, saves, skills, AC, HP, attacks, spell slots,
//  save DCs…). Pure functions of (character, SRD data): nothing
//  here touches the DOM or the database.
// ─────────────────────────────────────────────────────────────
import { ABILITIES, ABILITY_NAMES, SKILLS } from "./data/core.js";
import { RACES } from "./data/races.js";
import { CLASSES } from "./data/classes.js";
import { SPELLS } from "./data/spells.js";
import { WEAPONS, ARMOR } from "./data/equipment.js";
import { BACKGROUNDS } from "./data/backgrounds.js";

export const abilityMod = (score) => Math.floor((score - 10) / 2);
export const fmtMod = (m) => (m >= 0 ? `+${m}` : `${m}`);

/* ── ability score generation ── */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const pointBuySpent = (scores) =>
  ABILITIES.reduce((t, a) => t + (POINT_BUY_COST[scores[a]] ?? 99), 0);

/* ── expertise slots by class/level (SRD: rogue + bard) ── */
export function expertiseSlots(classIndex, level) {
  if (classIndex === "rogue") return level >= 6 ? 4 : level >= 1 ? 2 : 0;
  if (classIndex === "bard") return level >= 10 ? 4 : level >= 3 ? 2 : 0;
  return 0;
}

/* ── race helpers (SRD or custom) ── */
export function raceInfo(c) {
  const r = c.race;
  if (!r) return null;
  if (r.kind === "custom") {
    return {
      name: r.name || "Custom race",
      speed: r.speed || 30,
      size: r.size || "Medium",
      abilityBonuses: r.abilityBonuses || {},
      traits: (r.traits || []).map((t) => ({ name: t.name, desc: t.desc, source: "race" })),
      languages: r.languages || [],
      profSkills: [],
      profs: [],
      srd: null,
      subrace: null,
    };
  }
  const srd = RACES[r.index];
  if (!srd) return null;
  const subrace = r.subrace ? srd.subraces.find((s) => s.index === r.subrace) : null;
  const bonuses = { ...srd.abilityBonuses };
  if (subrace) for (const [k, v] of Object.entries(subrace.abilityBonuses)) bonuses[k] = (bonuses[k] || 0) + v;
  if (r.bonusChoices) for (const [k, v] of Object.entries(r.bonusChoices)) bonuses[k] = (bonuses[k] || 0) + v;
  const traits = [
    ...srd.traits.map((t) => ({ ...t, source: "race" })),
    ...(subrace ? subrace.traits.map((t) => ({ ...t, source: "subrace" })) : []),
  ];
  if (r.ancestry && srd.ancestryOptions) {
    const a = srd.ancestryOptions.find((x) => x.index === r.ancestry);
    if (a) traits.unshift({ index: "draconic-ancestry", name: `Draconic Ancestry (${a.name})`, desc: `Your breath weapon deals ${a.damageType.toLowerCase()} damage (${a.breath}).`, source: "race" });
  }
  return {
    name: subrace ? subrace.name : srd.name,
    speed: srd.speed,
    size: srd.size,
    abilityBonuses: bonuses,
    traits,
    languages: [...srd.languages, ...(subrace?.languages || []), ...(r.languageChoices || [])],
    profSkills: [...srd.profSkills, ...(subrace?.profSkills || []), ...(r.skillChoices || [])],
    profs: [...srd.profs, ...(subrace?.profs || []), ...(r.profChoices || [])],
    srd,
    subrace,
  };
}

export function classInfo(c) {
  const k = c.clazz;
  if (!k || k.kind === "custom") return null; // custom classes: not yet
  return CLASSES[k.index] || null;
}

export function backgroundInfo(c) {
  const b = c.background;
  if (!b) return null;
  if (b.kind === "custom")
    return {
      name: b.name || "Custom background",
      skills: b.skills || [],
      tools: b.tools || [],
      languages: b.languages || [],
      feature: b.feature && b.feature.name ? b.feature : null,
    };
  const srd = BACKGROUNDS[b.index];
  if (!srd) return null;
  return {
    name: srd.name,
    skills: srd.skills,
    tools: srd.tools,
    languages: b.languageChoices || [],
    feature: srd.feature,
  };
}

/* ── final ability scores: base + race + ASI (cap 20) ── */
export function finalAbilities(c) {
  const race = raceInfo(c);
  const out = {};
  // Scores cap at 20, except a level-20 Barbarian's Primal Champion raises
  // the STR and CON ceiling to 24.
  const cls = c.clazz?.kind === "srd" ? c.clazz.index : null;
  const primalChampion = cls === "barbarian" && (c.level || 1) >= 20;
  for (const a of ABILITIES) {
    let v = (c.abilities?.[a] ?? 10) + (race?.abilityBonuses?.[a] || 0);
    for (const step of c.asi || [])
      if (step.kind === "asi" && step.plus?.[a]) v += step.plus[a];
    const cap = primalChampion && (a === "str" || a === "con") ? 24 : 20;
    out[a] = Math.min(cap, v);
  }
  return out;
}

/* ── weapon proficiency check ── */
function proficientWith(w, profNames) {
  const names = profNames.map((n) => n.toLowerCase());
  if (names.includes("simple weapons") && w.category.startsWith("simple")) return true;
  if (names.includes("martial weapons") && w.category.startsWith("martial")) return true;
  const wn = w.name.toLowerCase();
  return names.some((n) => n === wn || n === wn + "s" || (wn.endsWith("s") ? n === wn.slice(0, -1) : false) || n.replace(/s$/, "") === wn);
}

const dieAvg = (sides) => Math.floor(sides / 2) + 1;

/* ═════════════════════ derive() ═════════════════════ */
export function derive(c) {
  const problems = [];
  const race = raceInfo(c);
  const cls = classInfo(c);
  const bg = backgroundInfo(c);
  const level = Math.max(1, Math.min(20, c.level || 1));
  if (!race) problems.push("No race chosen yet");
  if (!cls) problems.push(c.clazz?.kind === "custom" ? "Custom classes aren't supported yet" : "No class chosen yet");

  const scores = finalAbilities(c);
  const abilities = {};
  for (const a of ABILITIES) abilities[a] = { score: scores[a], mod: abilityMod(scores[a]) };
  const mod = (a) => abilities[a].mod;

  const lrow = cls ? cls.levels[level - 1] : null;
  const profBonus = lrow?.profBonus ?? Math.ceil(level / 4) + 1;

  /* saves */
  const saves = {};
  for (const a of ABILITIES) {
    const prof = !!cls?.saves.includes(a);
    saves[a] = { prof, mod: mod(a) + (prof ? profBonus : 0) };
  }

  /* skills */
  const profSkills = new Set([
    ...(race?.profSkills || []),
    ...(c.clazz?.skillChoices || []),
    ...(bg?.skills || []),
  ]);
  const expertise = new Set(c.clazz?.expertise || []);
  const skills = {};
  for (const [idx, s] of Object.entries(SKILLS)) {
    const prof = profSkills.has(idx);
    const exp = prof && expertise.has(idx);
    skills[idx] = {
      name: s.name,
      ability: s.ability,
      prof,
      expertise: exp,
      mod: mod(s.ability) + (prof ? profBonus * (exp ? 2 : 1) : 0),
    };
  }

  /* features (class + subclass + race + background + feats + custom) */
  const subclassPick = c.clazz?.subclass;
  const customSub = subclassPick && typeof subclassPick === "object" ? subclassPick : null;
  const srdSub = cls && !customSub && subclassPick ? cls.subclasses.find((s) => s.index === subclassPick) : null;
  const features = [];
  if (cls)
    for (let i = 0; i < level; i++)
      for (const f of cls.levels[i].features)
        features.push({ level: i + 1, name: f.name, index: f.index, source: "class" });
  if (srdSub)
    for (const f of srdSub.features)
      if (f.level <= level) features.push({ level: f.level, name: f.name, index: f.index, source: "subclass" });
  if (customSub?.name)
    features.push({ level: cls?.subclassLevel || 1, name: `${customSub.name} (custom ${cls?.subclassFlavor || "subclass"})`, index: null, desc: customSub.notes || "", source: "subclass" });
  for (const t of race?.traits || []) features.push({ level: 1, name: t.name, index: t.index || null, desc: t.desc, source: "race" });
  if (bg?.feature) features.push({ level: 1, name: bg.feature.name, index: null, desc: bg.feature.desc, source: "background" });
  for (const step of c.asi || [])
    if (step.kind === "feat") features.push({ level: step.level, name: `Feat: ${step.name}`, index: null, desc: step.desc || "", source: "feat" });
  for (const f of c.customFeatures || []) features.push({ level: null, name: f.name, index: null, desc: f.desc, source: "custom" });
  features.sort((a, b) => (a.level ?? 99) - (b.level ?? 99));

  const featureIdx = new Set(features.map((f) => f.index).filter(Boolean));
  const traitIdx = new Set((race?.traits || []).map((t) => t.index).filter(Boolean));

  /* HP */
  const hitDie = cls?.hitDie || 8;
  let maxHP;
  if (c.hp?.method === "manual" && c.hp.manual) maxHP = c.hp.manual;
  else {
    maxHP = hitDie + mod("con");
    for (let lv = 2; lv <= level; lv++) {
      const rolled = c.hp?.method === "roll" ? c.hp.rolled?.[lv - 2] : null;
      maxHP += (rolled || dieAvg(hitDie)) + mod("con");
    }
  }
  // Dwarven Toughness / Draconic Resilience add +1 HP per level — but a
  // manually-entered max is the player's authoritative total and already
  // includes them, so only apply the bonus to computed (average/rolled) HP.
  if (c.hp?.method !== "manual") {
    let hpPerLevelBonus = 0;
    if (traitIdx.has("dwarven-toughness")) hpPerLevelBonus += 1;
    if (featureIdx.has("draconic-resilience")) hpPerLevelBonus += 1;
    maxHP += hpPerLevelBonus * level;
  }
  maxHP = Math.max(1, maxHP);

  /* equipment on body */
  const equippedArmor = (c.equipment || [])
    .filter((e) => e.kind === "armor" && e.equipped && ARMOR[e.item] && ARMOR[e.item].category !== "shield")
    .map((e) => ARMOR[e.item])[0];
  const hasShield = (c.equipment || []).some((e) => e.kind === "armor" && e.equipped && ARMOR[e.item]?.category === "shield");

  /* AC — best applicable formula */
  const candidates = [];
  if (equippedArmor) {
    const dex = equippedArmor.dexBonus ? Math.min(mod("dex"), equippedArmor.dexMax ?? 99) : 0;
    candidates.push({ value: equippedArmor.base + dex, desc: equippedArmor.name, shieldOk: true });
  } else {
    candidates.push({ value: 10 + mod("dex"), desc: "Unarmored", shieldOk: true });
    if (cls?.index === "barbarian")
      candidates.push({ value: 10 + mod("dex") + mod("con"), desc: "Unarmored Defense", shieldOk: true });
    if (cls?.index === "monk")
      candidates.push({ value: 10 + mod("dex") + mod("wis"), desc: "Unarmored Defense", shieldOk: false });
    if (featureIdx.has("draconic-resilience"))
      candidates.push({ value: 13 + mod("dex"), desc: "Draconic Resilience", shieldOk: true });
  }
  // Pick the formula that yields the best FINAL AC, shield included — a
  // monk's shield disallows their Unarmored Defense, so plain 10+DEX+shield
  // can beat it and must be compared with the shield already folded in.
  const withShield = (x) => x.value + (hasShield && x.shieldOk ? 2 : 0);
  const ac = candidates.reduce((best, x) => (withShield(x) > withShield(best) ? x : best), candidates[0]);
  const shieldApplied = hasShield && ac.shieldOk;
  const acValue = withShield(ac) + (c.acBonus || 0);
  const acDesc = [ac.desc, shieldApplied ? "shield" : null, c.acBonus ? `${fmtMod(c.acBonus)} misc` : null]
    .filter(Boolean).join(" + ");

  /* proficiency lists */
  const dedupe = (arr) => [...new Set(arr)];
  const profList = {
    armor: dedupe(cls?.profArmor || []),
    weapons: dedupe([...(cls?.profWeapons || []), ...(race?.profs || []).filter((p) => /axe|hammer|sword|bow|blade|rapier/i.test(p))]),
    tools: dedupe([...(cls?.profTools || []), ...(bg?.tools || []), ...(race?.profs || []).filter((p) => !/axe|hammer|sword|bow|blade|rapier/i.test(p))]),
    languages: dedupe([...(race?.languages || []), ...(bg?.languages || [])]),
  };

  /* class counters (rage, ki, sneak attack…) */
  const cs = lrow?.classSpecific || {};
  const sneakAttack = cs.sneak_attack ? `${cs.sneak_attack.dice_count}d${cs.sneak_attack.dice_value}` : null;
  const martialArts = cs.martial_arts ? { count: cs.martial_arts.dice_count, sides: cs.martial_arts.dice_value } : null;

  /* attacks */
  const attacks = [];
  const weaponProfNames = profList.weapons;
  const monkish = cls?.index === "monk";
  for (const e of c.equipment || []) {
    if (e.kind !== "weapon" || !WEAPONS[e.item]) continue;
    const w = WEAPONS[e.item];
    const finesse = w.props.includes("finesse");
    const monkW = monkish && (w.props.includes("monk") || w.index === "shortsword");
    const ranged = w.category.endsWith("ranged");
    let ability = ranged ? "dex" : "str";
    if ((finesse || monkW) && mod("dex") > mod(ability)) ability = "dex";
    const prof = proficientWith(w, weaponProfNames);
    let dmgDie = w.dmg;
    if (monkW && martialArts) {
      const [n, s] = (w.dmg || "1d4").split("d").map(Number);
      if (martialArts.sides > (s || 0) && (n || 1) === 1) dmgDie = `1d${martialArts.sides}`;
    }
    const notes = [];
    if (w.versatile) notes.push(`versatile (${w.versatile})`);
    if (w.throwRange) notes.push(`thrown ${w.throwRange.normal}/${w.throwRange.long}`);
    if (w.range && ranged) notes.push(`range ${w.range.normal}${w.range.long ? "/" + w.range.long : ""}`);
    if (!prof) notes.push("not proficient");
    attacks.push({
      name: w.name,
      toHit: mod(ability) + (prof ? profBonus : 0),
      dmg: dmgDie,
      dmgMod: mod(ability),
      dmgType: w.dmgType,
      ability,
      note: notes.join(", "),
    });
  }
  // unarmed strike
  {
    const ability = monkish && mod("dex") > mod("str") ? "dex" : "str";
    attacks.push({
      name: "Unarmed Strike",
      toHit: mod(ability) + profBonus,
      dmg: monkish && martialArts ? `1d${martialArts.sides}` : null,
      dmgFlat: monkish && martialArts ? null : 1 + mod("str"),
      dmgMod: mod(ability),
      dmgType: "bludgeoning",
      ability,
      note: "",
    });
  }
  for (const a of c.attacksCustom || []) {
    const ab = a.ability || "str";
    attacks.push({
      name: a.name || "Custom attack",
      toHit: a.toHit ?? (mod(ab) + (a.proficient !== false ? profBonus : 0)),
      dmg: a.dmg || null,
      dmgMod: 0,
      dmgType: a.dmgType || "",
      ability: ab,
      note: a.note || "",
      custom: true,
    });
  }

  /* breath weapon (dragonborn with ancestry picked) */
  let breath = null;
  if (c.race?.kind === "srd" && c.race.index === "dragonborn" && c.race.ancestry) {
    const a = RACES.dragonborn.ancestryOptions.find((x) => x.index === c.race.ancestry);
    if (a) {
      const dice = level >= 16 ? "5d6" : level >= 11 ? "4d6" : level >= 6 ? "3d6" : "2d6";
      breath = { name: "Breath Weapon", dmg: dice, dmgType: a.damageType.toLowerCase(), dc: 8 + mod("con") + profBonus, shape: a.breath };
    }
  }

  /* spellcasting */
  let spellcasting = null;
  if (cls?.spell && level >= cls.spell.startLevel && lrow?.slots) {
    const sp = cls.spell;
    const isPact = sp.kind === "pact";
    let slots = lrow.slots.map((max, i) => ({ level: i + 1, max })).filter((s) => s.max > 0);
    let pact = null;
    if (isPact && slots.length) {
      pact = { count: slots[0].max, level: slots[0].level };
      slots = [];
    }
    const maxSpellLevel = pact ? pact.level : slots.length ? slots[slots.length - 1].level : 0;
    let preparedMax = null;
    if (sp.kind === "prepared-list" || sp.kind === "prepared-book") {
      const half = cls.index === "paladin";
      preparedMax = Math.max(1, mod(sp.ability) + (half ? Math.floor(level / 2) : level));
    }
    spellcasting = {
      ability: sp.ability,
      abilityName: ABILITY_NAMES[sp.ability],
      dc: 8 + profBonus + mod(sp.ability),
      attackBonus: profBonus + mod(sp.ability),
      kind: sp.kind,
      ritual: sp.ritual,
      slots,
      pact,
      maxSpellLevel,
      cantripsMax: lrow.cantrips ?? 0,
      knownMax: lrow.spellsKnown ?? null,
      preparedMax,
      list: cls.index,
    };
  }

  /* racial spells (tiefling etc.) + high elf cantrip */
  const racialSpells = [];
  if (c.race?.kind === "srd") {
    const srdRace = RACES[c.race.index];
    for (const rs of srdRace?.racialSpells || [])
      if (level >= rs.atLevel) racialSpells.push({ spell: rs.spell, note: rs.note, ability: rs.ability });
    if (c.race.cantripChoice) racialSpells.push({ spell: c.race.cantripChoice, note: "high elf cantrip", ability: "int" });
  }

  return {
    problems,
    level,
    profBonus,
    abilities,
    saves,
    skills,
    initiative: mod("dex"),
    speed: race?.speed ?? 30,
    size: race?.size ?? "Medium",
    ac: { value: acValue, desc: acDesc },
    hp: { max: maxHP, hitDie, hitDiceCount: level },
    passivePerception: 10 + skills.perception.mod,
    profList,
    features,
    attacks,
    breath,
    sneakAttack,
    martialArts,
    classSpecific: cs,
    spellcasting,
    racialSpells,
    raceName: race?.name || "—",
    className: cls?.name || (c.clazz?.kind === "custom" ? c.clazz.name : "—"),
    subclassName: customSub?.name || srdSub?.name || null,
    backgroundName: bg?.name || null,
  };
}

/* ── spell eligibility for pickers ── */
export function eligibleSpells(c, drv) {
  const sc = drv.spellcasting;
  if (!sc) return { cantrips: [], spells: [] };
  const cantrips = [];
  const spells = [];
  for (const s of Object.values(SPELLS)) {
    if (!s.classes.includes(sc.list)) continue;
    if (s.level === 0) cantrips.push(s.index);
    else if (s.level <= sc.maxSpellLevel) spells.push(s.index);
  }
  const byLvlName = (a, b) => SPELLS[a].level - SPELLS[b].level || SPELLS[a].name.localeCompare(SPELLS[b].name);
  return { cantrips: cantrips.sort(byLvlName), spells: spells.sort(byLvlName) };
}

/* ── what still needs choosing at the current level? ──
   Powers builder validation AND the level-up flow: every entry
   is {step, label} where step names the builder step that fixes it. */
export function pendingChoices(c, drv) {
  drv = drv || derive(c);
  const out = [];
  const cls = classInfo(c);
  const race = c.race?.kind === "srd" ? RACES[c.race.index] : null;

  if (!c.race) out.push({ step: "race", label: "Choose a race" });
  if (race) {
    if (race.abilityBonusOptions && Object.keys(c.race.bonusChoices || {}).length < race.abilityBonusOptions.choose)
      out.push({ step: "race", label: `Choose ${race.abilityBonusOptions.choose} ability score bonus${race.abilityBonusOptions.choose > 1 ? "es" : ""}` });
    if (race.subraces.length && !c.race.subrace)
      out.push({ step: "race", label: `Choose a subrace (${race.subraces.map((s) => s.name).join(", ")})` });
    if (race.index === "dragonborn" && !c.race.ancestry)
      out.push({ step: "race", label: "Choose a draconic ancestry" });
    const sub = c.race.subrace ? race.subraces.find((s) => s.index === c.race.subrace) : null;
    if (sub?.cantripChoice && !c.race.cantripChoice)
      out.push({ step: "race", label: "Choose your free wizard cantrip" });
    const langChoose = (race.languageOptions?.choose || 0) + (sub?.languageOptions?.choose || 0);
    if (langChoose && (c.race.languageChoices || []).length < langChoose)
      out.push({ step: "race", label: `Choose ${langChoose} extra language${langChoose > 1 ? "s" : ""}` });
    // trait-granted picks (half-elf: any 2 skills; dwarf: an artisan tool…)
    const allOpts = [...(race.profOptions || []), ...((sub?.profOptions) || [])];
    const skillNeed = allOpts.filter((o) => o.skills).reduce((t, o) => t + o.choose, 0);
    const toolNeed = allOpts.filter((o) => !o.skills).reduce((t, o) => t + o.choose, 0);
    if (skillNeed && (c.race.skillChoices || []).length < skillNeed)
      out.push({ step: "race", label: `Choose ${skillNeed} skill${skillNeed > 1 ? "s" : ""} (racial trait)` });
    if (toolNeed && (c.race.profChoices || []).length < toolNeed)
      out.push({ step: "race", label: `Choose ${toolNeed} tool proficiency` });
  }

  if (!c.clazz) out.push({ step: "class", label: "Choose a class" });
  if (cls) {
    const need = cls.skillChoices?.choose || 0;
    if ((c.clazz.skillChoices || []).length < need)
      out.push({ step: "class", label: `Choose ${need} class skills` });
    if (drv.level >= cls.subclassLevel && !c.clazz.subclass)
      out.push({ step: "class", label: `Choose your ${cls.subclassFlavor || "subclass"}` });
    const expNeed = expertiseSlots(cls.index, drv.level);
    if (expNeed && (c.clazz.expertise || []).length < expNeed)
      out.push({ step: "class", label: `Choose ${expNeed} expertise skills` });
    const asiDue = cls.levels.slice(0, drv.level).filter((l) => l.asi).map((l) => l.level);
    const asiDone = (c.asi || []).map((a) => a.level);
    for (const lv of asiDue)
      if (!asiDone.includes(lv))
        out.push({ step: "abilities", label: `Level ${lv}: ability score improvement (or feat)` });
  }

  if (!c.background) out.push({ step: "background", label: "Choose a background" });

  const sc = drv.spellcasting;
  if (sc) {
    if (sc.cantripsMax && (c.spells.cantrips || []).length < sc.cantripsMax)
      out.push({ step: "spells", label: `Choose ${sc.cantripsMax - c.spells.cantrips.length} more cantrip(s)` });
    if (sc.knownMax && (c.spells.known || []).length < sc.knownMax)
      out.push({ step: "spells", label: `Choose ${sc.knownMax - c.spells.known.length} more spell(s) known` });
    if (sc.kind === "prepared-book" && (c.spells.known || []).length < 6 + (drv.level - 1) * 2)
      out.push({ step: "spells", label: "Add spells to your spellbook (6 at 1st level, +2 per level)" });
  }
  if (c.hp?.method === "roll" && (c.hp.rolled || []).length < drv.level - 1)
    out.push({ step: "abilities", label: `Roll hit points for ${drv.level - 1 - (c.hp.rolled || []).length} level(s)` });
  if (!c.name) out.push({ step: "details", label: "Name your character" });
  return out;
}

/* ── what's new when leveling from N to N+1? ── */
export function levelUpSummary(c, newLevel) {
  const cls = classInfo(c);
  if (!cls || newLevel < 2 || newLevel > 20) return null;
  const row = cls.levels[newLevel - 1];
  const prev = cls.levels[newLevel - 2];
  const out = {
    level: newLevel,
    features: row.features.map((f) => f.name),
    asi: row.asi,
    subclassDue: newLevel === cls.subclassLevel,
    profBonusUp: row.profBonus !== prev.profBonus ? row.profBonus : null,
    hitDie: cls.hitDie,
    spells: null,
    expertiseUp: expertiseSlots(cls.index, newLevel) > expertiseSlots(cls.index, newLevel - 1),
  };
  if (cls.spell && row.slots) {
    const gained = [];
    for (let i = 0; i < 9; i++) {
      const now = row.slots[i], before = prev.slots?.[i] || 0;
      if (now > before) gained.push(`${now - before} × level-${i + 1} slot${now - before > 1 ? "s" : ""}`);
    }
    out.spells = {
      newSlots: gained,
      cantrips: (row.cantrips || 0) - (prev.cantrips || 0),
      known: row.spellsKnown != null ? row.spellsKnown - (prev.spellsKnown || 0) : null,
      bookSpells: cls.spell.kind === "prepared-book" ? 2 : 0,
    };
  }
  return out;
}

/* ── parse "8d6", "3d4 + 3", "1d8 + MOD" into a roll spec ── */
// Only the SRD die sizes the server's roll_dice() accepts — so a custom
// attack/spell typed as "2d7" is rejected here too, keeping demo and real
// modes in agreement instead of demo rolling something the server refuses.
export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100];
export function parseDice(str, abilityModValue = 0) {
  if (!str) return null;
  const m = String(str).match(/^\s*(\d+)d(\d+)\s*(?:\+\s*(MOD|\d+))?\s*$/i);
  if (!m) return null;
  const sides = +m[2], count = +m[1];
  if (!DIE_SIDES.includes(sides) || count < 1) return null;
  let modifier = 0;
  if (m[3]) modifier = /mod/i.test(m[3]) ? abilityModValue : +m[3];
  return { spec: [{ sides, count }], modifier };
}
