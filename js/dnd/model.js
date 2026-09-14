// ─────────────────────────────────────────────────────────────
//  model.js — the shape of a stored character.
//
//  A character records the player's CHOICES only (race, class,
//  base scores, picked skills, picked spells…). Everything
//  derivable — modifiers, AC, spell slots, attack bonuses — is
//  computed fresh by rules.js every render, so fixing a rule
//  fixes every existing character.
//
//  Homebrew is first-class: race/subclass/background can be
//  {kind:"custom"} with player-written content, and spells,
//  attacks, items and features all accept custom entries.
// ─────────────────────────────────────────────────────────────

export const CHAR_VERSION = 1;

export function newCharacter() {
  return {
    v: CHAR_VERSION,
    name: "",
    level: 1,
    // {kind:"srd", index, subrace:null|index, ancestry:null|index,
    //  bonusChoices:{dex:1,...}|null, languageChoices:[],
    //  skillChoices:[skillIndex] (half-elf versatility),
    //  profChoices:[toolName] (dwarf tools), cantripChoice:null|spellIndex}
    // {kind:"custom", name, abilityBonuses:{str:0..2,...}, speed, size,
    //  traits:[{name,desc}], languages:[]}
    race: null,
    // {kind:"srd", index, subclass:null|index|{kind:"custom",name,notes},
    //  skillChoices:[skillIndex], expertise:[skillIndex]}
    clazz: null,
    // {kind:"srd", index:"acolyte", languageChoices:[]}
    // {kind:"custom", name, skills:[2 skill indexes], tools:[], languages:[],
    //  feature:{name,desc}}
    background: null,
    // BASE ability scores — before racial bonuses and ASIs.
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    abilityMethod: "standard", // standard | pointbuy | roll | manual
    // one entry per ASI level actually used:
    // {level, kind:"asi", plus:{str:1,dex:1}} or {level, kind:"feat", name, desc}
    asi: [],
    alignment: "",
    hp: {
      method: "average", // average | roll | manual
      rolled: [],        // die results for levels 2..N when method=roll
      manual: null,      // full max HP when method=manual
      current: null,     // null = full
      temp: 0,
    },
    acBonus: 0,          // misc AC bonus (ring of protection, fighting style…)
    // [{kind:"weapon"|"armor"|"gear"|"pack"|"custom", item:index|null,
    //   name:string(custom only), qty, equipped:bool}]
    equipment: [],
    // custom attacks: {name, toHit:int|null (null = use ability+prof),
    //   ability:"str"|..., proficient:bool, dmg:"2d6+3", dmgType, note}
    attacksCustom: [],
    spells: {
      cantrips: [],   // spell indexes
      known: [],      // known/spellbook spell indexes
      prepared: [],   // subset of known (or of class list for prepared casters)
      // custom spells: {name, level:0-9, school, time, range, components,
      //   duration, concentration:bool, ritual:bool, attack:bool, save:null|"dex",
      //   dmg:""|"8d6", dmgType, desc}
      custom: [],
      slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      pactUsed: 0,
    },
    customFeatures: [], // [{name, desc}]
    details: { personality: "", ideals: "", bonds: "", flaws: "", backstory: "", appearance: "" },
    notes: "",
  };
}

// Bring an older stored sheet up to the current shape (fills in
// anything a previous version didn't have). Safe on current ones.
export function migrateCharacter(c) {
  const fresh = newCharacter();
  const out = { ...fresh, ...c, v: CHAR_VERSION };
  out.abilities = { ...fresh.abilities, ...(c.abilities || {}) };
  out.hp = { ...fresh.hp, ...(c.hp || {}) };
  out.spells = { ...fresh.spells, ...(c.spells || {}) };
  if (!Array.isArray(out.spells.slotsUsed) || out.spells.slotsUsed.length !== 9)
    out.spells.slotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  // A hand-written or imported sheet may omit or mistype these — coerce so
  // the renderer never crashes on a non-array spell list.
  for (const k of ["cantrips", "known", "prepared", "custom"])
    if (!Array.isArray(out.spells[k])) out.spells[k] = [];
  if (typeof out.spells.pactUsed !== "number") out.spells.pactUsed = 0;
  out.details = { ...fresh.details, ...(c.details || {}) };
  for (const k of ["asi", "equipment", "attacksCustom", "customFeatures"])
    if (!Array.isArray(out[k])) out[k] = [];
  return out;
}
