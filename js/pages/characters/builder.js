// ─────────────────────────────────────────────────────────────
//  builder.js — the character forge. A step wizard that edits a
//  WORKING COPY of the character (race → class → abilities →
//  background → equipment → spells → details) and hands the
//  finished draft back through opts.onSave. Saving is ALWAYS
//  allowed — half-forged heroes are welcome; the pending-choice
//  chips show what's left.
// ─────────────────────────────────────────────────────────────
import { esc, md, guard, toast } from "../../shell.js";
import {
  derive, eligibleSpells, pendingChoices, finalAbilities, fmtMod,
  STANDARD_ARRAY, POINT_BUY_BUDGET, POINT_BUY_COST, pointBuySpent,
  expertiseSlots, parseDice, raceInfo, classInfo,
} from "../../dnd/rules.js";
import { ABILITIES, ABILITY_NAMES, SKILLS, ALIGNMENTS, LANGUAGES } from "../../dnd/data/core.js";
import { RACES } from "../../dnd/data/races.js";
import { CLASSES } from "../../dnd/data/classes.js";
import { SPELLS } from "../../dnd/data/spells.js";
import { WEAPONS, ARMOR, GEAR, PACKS } from "../../dnd/data/equipment.js";
import { BACKGROUNDS } from "../../dnd/data/backgrounds.js";
import { FEATS } from "../../dnd/data/feats.js";
import { cap, ordinal, statTile, spellMetaLine, spellTags, spellText } from "./common.js";

/* ── tiny pure helpers ── */
const STEP_LABELS = {
  race: "Race", class: "Class", abilities: "Abilities", background: "Background",
  equipment: "Equipment", spells: "Spells", details: "Details",
};
const LANG_NAME = new Map(LANGUAGES.map((l) => [l.index, l.name]));
const langName = (i) => LANG_NAME.get(i) || cap(i);
const skillName = (i) => SKILLS[i]?.name || cap(i);

function bonusText(bonuses) {
  const e = Object.entries(bonuses || {}).filter(([, v]) => v);
  if (!e.length) return "no ability bonuses";
  if (e.length === 6 && e.every(([, v]) => v === 1)) return "+1 to everything";
  return e.map(([k, v]) => `${fmtMod(v)} ${k.toUpperCase()}`).join(", ");
}

const REF_LINKS = `<p class="srd-note">Only SRD 5.1 content can ship with the site. Using other
  books you own? Look them up on <a href="https://www.dndbeyond.com/sources" target="_blank" rel="noopener">D&amp;D Beyond</a>
  or the free <a href="https://open5e.com" target="_blank" rel="noopener">Open5e</a>, then type them in with the custom forms.</p>`;

const chipBtn = (label, on, data, { disabled = false, onCls = "on" } = {}) =>
  `<button type="button" class="choice-chip ${on ? onCls : ""}" ${disabled ? "disabled" : ""} ${data}>${label}</button>`;

const d6 = () => 1 + Math.floor(Math.random() * 6);
const roll4d6DropLowest = () => {
  const r = [d6(), d6(), d6(), d6()].sort((a, b) => a - b);
  return r[1] + r[2] + r[3];
};

const sameValues = (a, b) =>
  [...a].sort((x, y) => x - y).join(",") === [...b].sort((x, y) => x - y).join(",");

const itemName = (e) => {
  if (e.kind === "custom") return e.name || "Mystery item";
  const src = e.kind === "weapon" ? WEAPONS : e.kind === "armor" ? ARMOR : e.kind === "pack" ? PACKS : GEAR;
  return src[e.item]?.name || cap(String(e.item || "item").replace(/-/g, " "));
};

/* ═════════════════════ the wizard ═════════════════════ */
export function renderBuilder(root, ctx, opts) {
  const draft = structuredClone(opts.char);
  const state = {
    step: "race",
    rolledSet: null,   // roll-method ability set (local to this visit)
    asiLocal: {},      // level → {mode, picks:[], name, desc} in-progress ASI picks
    warnedBook: false, // wizard spellbook soft-cap warned once
  };
  // seed in-progress ASI state from what's already on the draft
  for (const a of draft.asi || []) {
    if (a.kind === "feat") state.asiLocal[a.level] = { mode: "feat", picks: [], name: a.name || "", desc: a.desc || "" };
    else {
      const ents = Object.entries(a.plus || {});
      if (ents.length === 1 && ents[0][1] === 2) state.asiLocal[a.level] = { mode: "asi2", picks: [ents[0][0]], name: "", desc: "" };
      else state.asiLocal[a.level] = { mode: "asi1", picks: ents.map(([k]) => k), name: "", desc: "" };
    }
  }

  root.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:baseline; margin-bottom:12px">
      <h2 class="section" style="margin:0">${opts.existing ? "⚒ Rework the hero" : "⚒ Forge a character"}</h2>
      <span class="muted small">drafts save any time — finish later if the table's waiting</span>
    </div>
    <div class="wiz-steps" id="wiz-steps"></div>
    <div id="wiz-body"></div>
    <div class="wiz-nav" id="wiz-nav"></div>`;

  const $ = (sel, base = root) => base.querySelector(sel);
  const $$ = (sel, base = root) => [...base.querySelectorAll(sel)];

  const doSave = () => guard(async () => { await opts.onSave(draft); });

  function spellsVisible(drv) {
    if (drv.spellcasting || (drv.racialSpells || []).length) return true;
    if (draft.race?.kind === "srd") {
      const r = RACES[draft.race.index];
      if (r?.racialSpells?.length) return true;
      const sub = draft.race.subrace ? r?.subraces.find((s) => s.index === draft.race.subrace) : null;
      if (sub?.cantripChoice) return true;
    }
    return false;
  }
  function visibleSteps(drv) {
    const s = ["race", "class", "abilities", "background", "equipment"];
    if (spellsVisible(drv)) s.push("spells");
    s.push("details");
    return s;
  }

  /* ── chrome: step chips + footer nav (cheap, safe to refresh often) ── */
  function renderChrome() {
    const drv = derive(draft);
    const pend = pendingChoices(draft, drv);
    const byStep = {};
    for (const p of pend) (byStep[p.step] ??= []).push(p);
    const steps = visibleSteps(drv);
    if (!steps.includes(state.step)) state.step = "equipment";

    const stepsEl = $("#wiz-steps");
    stepsEl.innerHTML = steps.map((s) =>
      `<button data-step="${s}" class="${s === state.step ? "active" : ""} ${byStep[s] ? "needs" : "done"}"
        title="${byStep[s] ? esc(byStep[s].map((p) => p.label).join("\n")) : "complete"}">${STEP_LABELS[s]}</button>`
    ).join("");
    $$("button", stepsEl).forEach((b) => (b.onclick = () => { state.step = b.dataset.step; rerender(); }));

    const i = steps.indexOf(state.step);
    const nav = $("#wiz-nav");
    nav.innerHTML = `
      <button class="btn-ghost" id="wz-back" ${i <= 0 ? "disabled" : ""}>‹ Back</button>
      <button class="btn-ghost" id="wz-next" ${i >= steps.length - 1 ? "disabled" : ""}>Next ›</button>
      <span class="spacer"></span>
      ${pend.length
        ? `<span class="pending-note">${pend.length} choice${pend.length > 1 ? "s" : ""} left</span>`
        : `<span class="muted small">✓ all choices made</span>`}
      <button class="btn-ghost" id="wz-cancel">Cancel</button>
      <button class="btn" id="wz-save">Save character</button>`;
    $("#wz-back", nav).onclick = () => { state.step = steps[Math.max(0, i - 1)]; rerender(); };
    $("#wz-next", nav).onclick = () => { state.step = steps[Math.min(steps.length - 1, i + 1)]; rerender(); };
    $("#wz-cancel", nav).onclick = () => opts.onCancel();
    $("#wz-save", nav).onclick = doSave;
  }

  function renderStep() {
    const body = $("#wiz-body");
    const drv = derive(draft);
    const fn = {
      race: stepRace, class: stepClass, abilities: stepAbilities, background: stepBackground,
      equipment: stepEquipment, spells: stepSpells, details: stepDetails,
    }[state.step] || stepRace;
    fn(body, drv);
  }
  const rerender = () => { renderChrome(); renderStep(); };
  const syncChrome = () => renderChrome();

  /* ════════════ STEP: RACE ════════════ */
  function stepRace(body) {
    const cur = draft.race;
    const cards = Object.values(RACES).map((r) => `
      <button class="opt-card ${cur?.kind === "srd" && cur.index === r.index ? "selected" : ""}" data-race="${r.index}">
        <div class="opt-title">${esc(r.name)}</div>
        <div class="opt-sub">${esc(bonusText(r.abilityBonuses))} · ${r.speed} ft</div>
      </button>`).join("");
    body.innerHTML = `
      <div class="card">
        <h3 class="section">Choose your race</h3>
        <div class="opt-grid">
          ${cards}
          <button class="opt-card ${cur?.kind === "custom" ? "selected" : ""}" data-race="__custom">
            <div class="opt-title">Custom race</div>
            <div class="opt-sub"><span class="pill mystic">homebrew</span> your own people</div>
          </button>
        </div>
        <div id="race-detail"></div>
        ${REF_LINKS}
      </div>`;

    $$("[data-race]", body).forEach((btn) => (btn.onclick = () => {
      const idx = btn.dataset.race;
      if (idx === "__custom") {
        if (draft.race?.kind === "custom") return;
        draft.race = { kind: "custom", name: "", abilityBonuses: {}, speed: 30, size: "Medium", traits: [], languages: ["Common"] };
      } else {
        if (draft.race?.kind === "srd" && draft.race.index === idx) return;
        draft.race = { kind: "srd", index: idx, subrace: null, ancestry: null, bonusChoices: null, languageChoices: [], skillChoices: [], profChoices: [], cantripChoice: null };
      }
      rerender();
    }));

    const detail = $("#race-detail", body);
    if (cur?.kind === "srd" && RACES[cur.index]) srdRaceDetail(detail);
    else if (cur?.kind === "custom") customRaceForm(detail);
  }

  function srdRaceDetail(detail) {
    const cur = draft.race;
    const r = RACES[cur.index];
    const sub = cur.subrace ? r.subraces.find((s) => s.index === cur.subrace) : null;
    const info = raceInfo(draft);
    let html = "";

    if (r.subraces.length) {
      html += `<h3 class="section" style="margin-top:18px">Subrace <span class="pill ${cur.subrace ? "moss" : "ember"}">${cur.subrace ? "chosen" : "required"}</span></h3>
        <div class="opt-grid">${r.subraces.map((s) => `
          <button class="opt-card ${cur.subrace === s.index ? "selected" : ""}" data-subrace="${s.index}">
            <div class="opt-title">${esc(s.name)}</div>
            <div class="opt-sub">${esc(bonusText(s.abilityBonuses))}</div>
          </button>`).join("")}</div>`;
    }

    html += `<p class="muted small" style="margin:14px 0 0">Ability bonuses: <strong>${esc(bonusText(info?.abilityBonuses))}</strong>
      · ${info?.speed ?? r.speed} ft · ${esc(info?.size ?? r.size)}</p>`;

    if (r.abilityBonusOptions) {
      const o = r.abilityBonusOptions;
      const picked = cur.bonusChoices || {};
      const n = Object.keys(picked).length;
      html += `<label class="field">Choose ${o.choose} more abilit${o.choose > 1 ? "ies" : "y"} for +${o.bonus} each</label>
        <div class="choice-row">${o.from.map((a) =>
          chipBtn(`+${o.bonus} ${a.toUpperCase()}`, a in picked, `data-bonus="${a}"`, { disabled: !(a in picked) && n >= o.choose })
        ).join("")}</div>`;
    }

    const langChoose = (r.languageOptions?.choose || 0) + (sub?.languageOptions?.choose || 0);
    if (langChoose) {
      const known = new Set([...r.languages, ...(sub?.languages || [])]);
      const anyFrom = (r.languageOptions && !r.languageOptions.from) || (sub?.languageOptions && !sub.languageOptions.from);
      const pool = (anyFrom
        ? LANGUAGES.map((l) => l.index)
        : [...new Set([...(r.languageOptions?.from || []), ...(sub?.languageOptions?.from || [])])]
      ).filter((i) => !known.has(i));
      const picked = cur.languageChoices || [];
      html += `<label class="field">Extra language${langChoose > 1 ? "s" : ""} — choose ${langChoose}
        <span class="muted">(you already speak ${esc([...known].map(langName).join(", "))})</span></label>
        <div class="choice-row">${pool.map((i) =>
          chipBtn(esc(langName(i)), picked.includes(i), `data-lang="${esc(i)}"`, { disabled: !picked.includes(i) && picked.length >= langChoose })
        ).join("")}</div>`;
    }

    const allOpts = [...(r.profOptions || []), ...((sub?.profOptions) || [])];
    const skillOpts = allOpts.filter((o) => o.skills);
    const nameOpts = allOpts.filter((o) => !o.skills && o.names);
    if (skillOpts.length) {
      const need = skillOpts.reduce((t, o) => t + o.choose, 0);
      const pool = [...new Set(skillOpts.flatMap((o) => o.skills))];
      const picked = cur.skillChoices || [];
      html += `<label class="field">${esc(skillOpts[0].trait || "Bonus skills")} — choose ${need}</label>
        <div class="choice-row">${pool.map((s) =>
          chipBtn(esc(skillName(s)), picked.includes(s), `data-rskill="${esc(s)}"`, { disabled: !picked.includes(s) && picked.length >= need })
        ).join("")}</div>`;
    }
    if (nameOpts.length) {
      const need = nameOpts.reduce((t, o) => t + o.choose, 0);
      const pool = [...new Set(nameOpts.flatMap((o) => o.names))];
      const picked = cur.profChoices || [];
      html += `<label class="field">${esc(nameOpts[0].trait || "Tool proficiency")} — choose ${need}</label>
        <div class="choice-row">${pool.map((nm) =>
          chipBtn(esc(nm), picked.includes(nm), `data-rprof="${esc(nm)}"`, { disabled: !picked.includes(nm) && picked.length >= need })
        ).join("")}</div>`;
    }

    if (r.ancestryOptions) {
      html += `<h3 class="section" style="margin-top:18px">Draconic ancestry <span class="pill ${cur.ancestry ? "moss" : "ember"}">${cur.ancestry ? "chosen" : "required"}</span></h3>
        <div class="opt-grid">${r.ancestryOptions.map((a) => `
          <button class="opt-card ${cur.ancestry === a.index ? "selected" : ""}" data-ancestry="${a.index}">
            <div class="opt-title">${esc(a.name)}</div>
            <div class="opt-sub">${esc(a.damageType)} · ${esc(a.breath)}</div>
          </button>`).join("")}</div>`;
    }

    if (sub?.cantripChoice) {
      const pool = Object.values(SPELLS)
        .filter((s) => s.level === 0 && s.classes.includes(sub.cantripChoice.class || "wizard"))
        .sort((a, b) => a.name.localeCompare(b.name));
      html += `<label class="field">Free wizard cantrip — choose 1 (uses Intelligence)</label>
        <div class="choice-row">${pool.map((s) =>
          chipBtn(esc(s.name), cur.cantripChoice === s.index, `data-rcantrip="${esc(s.index)}"`)
        ).join("")}</div>`;
    }

    const traits = [...r.traits, ...(sub?.traits || [])];
    if (traits.length) {
      html += `<details class="fold"><summary>Racial traits (${traits.length})</summary>
        ${traits.map((t) => `<div class="feature-block"><span class="f-name">${esc(t.name)}</span>${md(t.desc)}</div>`).join("")}
      </details>`;
    }
    detail.innerHTML = html;

    $$("[data-subrace]", detail).forEach((b) => (b.onclick = () => {
      if (cur.subrace === b.dataset.subrace) return;
      cur.subrace = b.dataset.subrace;
      cur.cantripChoice = null;
      cur.languageChoices = [];
      rerender();
    }));
    $$("[data-bonus]", detail).forEach((b) => (b.onclick = () => {
      const a = b.dataset.bonus, o = r.abilityBonusOptions;
      const bc = (cur.bonusChoices ||= {});
      if (bc[a]) delete bc[a];
      else if (Object.keys(bc).length >= o.choose) { toast(`Pick ${o.choose} — unpick one first`); return; }
      else bc[a] = o.bonus;
      rerender();
    }));
    const bindList = (attr, getArr, capN) => $$(`[${attr}]`, detail).forEach((b) => (b.onclick = () => {
      const v = b.getAttribute(attr), arr = getArr();
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1);
      else if (arr.length >= capN) { toast(`Choose ${capN} — unpick one first`); return; }
      else arr.push(v);
      rerender();
    }));
    bindList("data-lang", () => (cur.languageChoices ||= []), langChoose);
    bindList("data-rskill", () => (cur.skillChoices ||= []), skillOpts.reduce((t, o) => t + o.choose, 0));
    bindList("data-rprof", () => (cur.profChoices ||= []), nameOpts.reduce((t, o) => t + o.choose, 0));
    $$("[data-ancestry]", detail).forEach((b) => (b.onclick = () => { cur.ancestry = b.dataset.ancestry; rerender(); }));
    $$("[data-rcantrip]", detail).forEach((b) => (b.onclick = () => {
      cur.cantripChoice = cur.cantripChoice === b.dataset.rcantrip ? null : b.dataset.rcantrip;
      rerender();
    }));
  }

  function customRaceForm(detail) {
    const r = draft.race;
    detail.innerHTML = `
      <hr class="rule">
      <p class="muted small">Copy a race from a book you own, or invent one — it's your table. ${""}</p>
      <label class="field">Race name</label>
      <input type="text" id="cr-name" value="${esc(r.name || "")}" placeholder="e.g. Sea-born of the Kared Klans">
      <label class="field">Ability score bonuses <span class="muted">(0–2 is typical)</span></label>
      <div class="row">${ABILITIES.map((a) => `
        <div style="width:74px">
          <div class="muted small" style="text-align:center">${a.toUpperCase()}</div>
          <input type="number" class="cr-ab" data-ab="${a}" min="-2" max="4" value="${r.abilityBonuses?.[a] || 0}">
        </div>`).join("")}</div>
      <div class="row">
        <div class="grow"><label class="field">Speed (feet)</label>
          <input type="number" id="cr-speed" min="5" max="120" step="5" value="${r.speed || 30}"></div>
        <div class="grow"><label class="field">Size</label>
          <select id="cr-size">
            <option value="Small" ${r.size === "Small" ? "selected" : ""}>Small</option>
            <option value="Medium" ${r.size !== "Small" ? "selected" : ""}>Medium</option>
          </select></div>
      </div>
      <label class="field">Languages <span class="muted">(comma-separated)</span></label>
      <input type="text" id="cr-langs" value="${esc((r.languages || []).join(", "))}" placeholder="Common, Primordial">
      <label class="field">Traits</label>
      <div id="cr-traits">${(r.traits || []).map((t, i) => `
        <div style="margin:8px 0">
          <div class="row">
            <input type="text" class="grow cr-tname" data-i="${i}" value="${esc(t.name || "")}" placeholder="Trait name">
            <button class="btn-danger cr-trm" data-i="${i}">✕</button>
          </div>
          <textarea class="cr-tdesc" data-i="${i}" style="min-height:56px" placeholder="What it does">${esc(t.desc || "")}</textarea>
        </div>`).join("")}</div>
      <button class="btn-ghost" id="cr-add-trait">＋ Add trait</button>`;

    $("#cr-name", detail).oninput = (e) => { r.name = e.target.value; syncChrome(); };
    $$(".cr-ab", detail).forEach((inp) => (inp.oninput = () => {
      const v = Math.max(-5, Math.min(5, parseInt(inp.value, 10) || 0));
      (r.abilityBonuses ||= {})[inp.dataset.ab] = v;
    }));
    $("#cr-speed", detail).oninput = (e) => { r.speed = Math.max(0, parseInt(e.target.value, 10) || 30); };
    $("#cr-size", detail).onchange = (e) => { r.size = e.target.value; };
    $("#cr-langs", detail).oninput = (e) => {
      r.languages = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
    };
    $$(".cr-tname", detail).forEach((inp) => (inp.oninput = () => { r.traits[+inp.dataset.i].name = inp.value; }));
    $$(".cr-tdesc", detail).forEach((ta) => (ta.oninput = () => { r.traits[+ta.dataset.i].desc = ta.value; }));
    $$(".cr-trm", detail).forEach((b) => (b.onclick = () => { r.traits.splice(+b.dataset.i, 1); rerender(); }));
    $("#cr-add-trait", detail).onclick = () => { (r.traits ||= []).push({ name: "", desc: "" }); rerender(); };
  }

  /* ════════════ STEP: CLASS ════════════ */
  function setLevel(n) {
    draft.level = n;
    draft.asi = (draft.asi || []).filter((a) => a.level <= n);
    for (const k of Object.keys(state.asiLocal)) if (+k > n) delete state.asiLocal[k];
    if (Array.isArray(draft.hp.rolled) && draft.hp.rolled.length > n - 1)
      draft.hp.rolled.length = Math.max(0, n - 1);
    rerender();
  }

  function stepClass(body, drv) {
    const cur = draft.clazz;
    const levelOpts = Array.from({ length: 20 }, (_, i) => i + 1)
      .map((n) => `<option value="${n}" ${draft.level === n ? "selected" : ""}>Level ${n}</option>`).join("");
    const cards = Object.values(CLASSES).map((c) => `
      <button class="opt-card ${cur?.kind === "srd" && cur.index === c.index ? "selected" : ""}" data-class="${c.index}">
        <div class="opt-title">${esc(c.name)}</div>
        <div class="opt-sub">d${c.hitDie} · ${c.saves.map((s) => s.toUpperCase()).join("/")} saves${c.spell ? " · caster" : ""}</div>
      </button>`).join("");

    body.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h3 class="section" style="margin:0">Choose your class</h3>
          <select id="cl-level" style="width:auto; font-family:var(--font-display)">${levelOpts}</select>
        </div>
        <p class="muted small" style="margin:6px 0 12px">The level select rules everything — hit points,
          spell slots, features and improvements all follow it.</p>
        <div class="opt-grid">${cards}</div>
        <div id="class-detail"></div>
        ${REF_LINKS}
      </div>`;

    $("#cl-level", body).onchange = (e) => setLevel(parseInt(e.target.value, 10) || 1);

    $$("[data-class]", body).forEach((btn) => (btn.onclick = () => {
      const idx = btn.dataset.class;
      if (draft.clazz?.kind === "srd" && draft.clazz.index === idx) return;
      const made = draft.clazz && ((draft.clazz.skillChoices || []).length || (draft.clazz.expertise || []).length ||
        draft.clazz.subclass || draft.spells.cantrips.length || draft.spells.known.length || draft.spells.prepared.length);
      if (made && !confirm("Switching class clears your class skills, expertise, subclass and spell picks. Continue?")) return;
      draft.clazz = { kind: "srd", index: idx, skillChoices: [], expertise: [], subclass: null };
      draft.spells.cantrips = []; draft.spells.known = []; draft.spells.prepared = [];
      draft.spells.slotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0]; draft.spells.pactUsed = 0;
      state.warnedBook = false;
      rerender();
    }));

    const detail = $("#class-detail", body);
    const cls = classInfo(draft);
    if (!cls) { detail.innerHTML = ""; return; }
    let html = `
      <p class="muted small" style="margin-top:14px">
        Hit die <strong>d${cls.hitDie}</strong> · Saving throws <strong>${cls.saves.map((s) => ABILITY_NAMES[s]).join(", ")}</strong><br>
        Armor: ${esc(cls.profArmor.join(", ") || "none")} · Weapons: ${esc(cls.profWeapons.join(", ") || "none")}
        · Tools: ${esc(cls.profTools.join(", ") || "none")}</p>`;

    const sc = cls.skillChoices;
    const picked = draft.clazz.skillChoices || [];
    html += `<label class="field">Class skills — choose ${sc.choose}</label>
      <div class="choice-row">${sc.skills.map((s) =>
        chipBtn(esc(skillName(s)), picked.includes(s), `data-cskill="${esc(s)}"`, { disabled: !picked.includes(s) && picked.length >= sc.choose })
      ).join("")}</div>`;

    const expNeed = expertiseSlots(cls.index, draft.level);
    if (expNeed > 0) {
      const profNow = Object.entries(drv.skills).filter(([, s]) => s.prof).map(([i]) => i);
      const exp = draft.clazz.expertise || [];
      html += `<label class="field">Expertise — choose ${expNeed} <span class="muted">(double proficiency; pick from skills you're proficient in)</span></label>`;
      html += profNow.length
        ? `<div class="choice-row">${profNow.map((s) =>
            chipBtn(esc(skillName(s)), exp.includes(s), `data-cexp="${esc(s)}"`, { disabled: !exp.includes(s) && exp.length >= expNeed, onCls: "exp" })
          ).join("")}</div>`
        : `<p class="muted small">Pick some proficient skills first (class, race or background).</p>`;
    }

    if (draft.level >= cls.subclassLevel) {
      const pick = draft.clazz.subclass;
      const isCustom = pick && typeof pick === "object";
      html += `<h3 class="section" style="margin-top:18px">${esc(cls.subclassFlavor)}
          <span class="pill ${pick ? "moss" : "ember"}">${pick ? "chosen" : "due at level " + cls.subclassLevel}</span></h3>
        <div class="opt-grid">
          ${cls.subclasses.map((s) => `
            <button class="opt-card ${pick === s.index ? "selected" : ""}" data-subclass="${s.index}">
              <div class="opt-title">${esc(s.name)}</div>
              <div class="opt-sub">levels ${s.features.map((f) => f.level).join(", ")}</div>
            </button>`).join("")}
          <button class="opt-card ${isCustom ? "selected" : ""}" data-subclass="__custom">
            <div class="opt-title">Custom…</div>
            <div class="opt-sub"><span class="pill mystic">homebrew</span> from another book</div>
          </button>
        </div>
        <div id="sub-detail"></div>`;
    }
    detail.innerHTML = html;

    $$("[data-cskill]", detail).forEach((b) => (b.onclick = () => {
      const v = b.dataset.cskill, arr = (draft.clazz.skillChoices ||= []);
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1);
      else if (arr.length >= sc.choose) { toast(`Choose ${sc.choose} — unpick one first`); return; }
      else arr.push(v);
      const d2 = derive(draft); // dropping a skill may invalidate an expertise pick
      draft.clazz.expertise = (draft.clazz.expertise || []).filter((s) => d2.skills[s]?.prof);
      rerender();
    }));
    $$("[data-cexp]", detail).forEach((b) => (b.onclick = () => {
      const v = b.dataset.cexp, arr = (draft.clazz.expertise ||= []);
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1);
      else if (arr.length >= expNeed) { toast(`Only ${expNeed} expertise pick${expNeed > 1 ? "s" : ""} at this level`); return; }
      else arr.push(v);
      rerender();
    }));
    $$("[data-subclass]", detail).forEach((b) => (b.onclick = () => {
      const v = b.dataset.subclass;
      if (v === "__custom") {
        if (draft.clazz.subclass && typeof draft.clazz.subclass === "object") return;
        draft.clazz.subclass = { kind: "custom", name: "", notes: "" };
      } else {
        if (draft.clazz.subclass === v) return;
        draft.clazz.subclass = v;
      }
      rerender();
    }));

    const subDetail = $("#sub-detail", detail);
    if (subDetail) {
      const pick = draft.clazz.subclass;
      if (pick && typeof pick === "object") {
        subDetail.innerHTML = `
          <label class="field">${esc(cls.subclassFlavor)} name</label>
          <input type="text" id="sub-name" value="${esc(pick.name || "")}" placeholder="e.g. Oath of the Open Ledger">
          <label class="field">Notes <span class="muted">(features, when you get them…)</span></label>
          <textarea id="sub-notes" style="min-height:70px">${esc(pick.notes || "")}</textarea>`;
        $("#sub-name", subDetail).oninput = (e) => { pick.name = e.target.value; };
        $("#sub-notes", subDetail).oninput = (e) => { pick.notes = e.target.value; };
      } else if (pick) {
        const s = cls.subclasses.find((x) => x.index === pick);
        if (s) subDetail.innerHTML = `
          <details class="fold"><summary>About the ${esc(s.name)}</summary>
            ${md(s.desc)}
            ${s.features.map((f) => `<div class="feature-block"><span class="f-name">${esc(f.name)}</span><span class="f-src">level ${f.level}</span></div>`).join("")}
          </details>`;
      }
    }
  }

  /* ════════════ STEP: ABILITIES ════════════ */
  function normalizeMethod(m) {
    const vals = ABILITIES.map((a) => draft.abilities[a]);
    if (m === "standard" && !sameValues(vals, STANDARD_ARRAY))
      ABILITIES.forEach((a, i) => (draft.abilities[a] = STANDARD_ARRAY[i]));
    if (m === "pointbuy" && (vals.some((v) => v < 8 || v > 15) || pointBuySpent(draft.abilities) > POINT_BUY_BUDGET))
      ABILITIES.forEach((a) => (draft.abilities[a] = 8));
    if (m === "roll" && !state.rolledSet) state.rolledSet = [...vals];
  }
  function assignSwap(ab, v) {
    const old = draft.abilities[ab];
    if (old === v) return;
    const other = ABILITIES.find((x) => x !== ab && draft.abilities[x] === v);
    if (other) draft.abilities[other] = old;
    draft.abilities[ab] = v;
  }

  function stepAbilities(body, drv) {
    const m = draft.abilityMethod || "standard";
    const race = raceInfo(draft);
    const spent = pointBuySpent(draft.abilities);

    const METHODS = [["standard", "Standard array"], ["pointbuy", "Point buy"], ["roll", "Roll"], ["manual", "Manual"]];
    const tabs = METHODS.map(([k, l]) =>
      `<button class="${m === k ? "btn" : "btn-ghost"}" data-method="${k}">${l}</button>`).join("");

    let methodBar = "";
    if (m === "standard") methodBar = `
      <div class="row" style="margin-top:10px">
        <button class="btn-ghost" data-autofill>Auto-fill 15 · 14 · 13 · 12 · 10 · 8</button>
        <span class="muted small">picking a value that's already in use swaps the two</span>
      </div>`;
    if (m === "pointbuy") methodBar = `
      <p class="muted small" style="margin:10px 0 0">Points spent: <strong style="color:${spent > POINT_BUY_BUDGET ? "var(--ember)" : "var(--gold)"}">${spent}</strong>
        of ${POINT_BUY_BUDGET} · scores 8–15 before racial bonuses</p>`;
    if (m === "roll") methodBar = `
      <div class="row" style="margin-top:10px">
        <button class="btn-ghost" id="ab-roll">🎲 Roll 4d6, drop lowest — six times</button>
        ${state.rolledSet ? state.rolledSet.map((v) => `<span class="die-chip">${v}</span>`).join("") : `<span class="muted small">roll to generate your set</span>`}
      </div>
      <p class="muted small" style="margin:6px 0 0">Rolled on your device — re-roll as your table allows. Assign with the selects (picking a used value swaps).</p>`;
    if (m === "manual") methodBar = `<p class="muted small" style="margin:10px 0 0">Type anything 3–20 — for tables with house rules.</p>`;

    const box = (a) => {
      const base = draft.abilities[a];
      const rb = race?.abilityBonuses?.[a] || 0;
      let editor = "";
      if (m === "standard" || m === "roll") {
        const set = m === "standard" ? STANDARD_ARRAY : (state.rolledSet || []);
        const opts = [...new Set([...set, base])].sort((x, y) => y - x)
          .map((v) => `<option value="${v}" ${v === base ? "selected" : ""}>${v}</option>`).join("");
        editor = `<select class="ab-sel" data-ab="${a}">${opts}</select>`;
      } else if (m === "pointbuy") {
        const upCost = (POINT_BUY_COST[base + 1] ?? 99) - (POINT_BUY_COST[base] ?? 0);
        editor = `<div class="ab-steps">
          <button data-pb="-1" data-ab="${a}" ${base <= 8 ? "disabled" : ""}>−</button>
          <strong style="min-width:24px">${base}</strong>
          <button data-pb="1" data-ab="${a}" ${base >= 15 || spent + upCost > POINT_BUY_BUDGET ? "disabled" : ""}>+</button>
        </div>`;
      } else {
        editor = `<input type="number" class="ab-man" data-ab="${a}" min="3" max="20" value="${base}">`;
      }
      return `<div class="ability-box" data-abbox="${a}">
        <div class="ab-name">${ABILITY_NAMES[a]}</div>
        ${editor}
        <div class="ab-race">${rb ? fmtMod(rb) + " race" : "&nbsp;"}</div>
        <div class="ab-mod">${fmtMod(drv.abilities[a].mod)}</div>
        <div class="ab-score">final ${drv.abilities[a].score}</div>
      </div>`;
    };

    /* ASI panel */
    const cls = classInfo(draft);
    const asiLevels = cls ? cls.levels.slice(0, draft.level).filter((l) => l.asi).map((l) => l.level) : [];
    const asiCard = asiLevels.length ? `
      <div class="card">
        <h3 class="section">Ability score improvements</h3>
        <p class="muted small" style="margin-top:-6px">At each of these levels: +2 to one ability, +1 to two, or take a feat.</p>
        ${asiLevels.map(asiBlock).join("")}
        ${REF_LINKS}
      </div>` : "";

    /* HP card */
    const hitDie = cls?.hitDie || 8;
    const hpMethod = draft.hp.method || "average";
    const hpRadios = [["average", "Average (steady)"], ["roll", "Rolled (brave)"], ["manual", "Manual (house rules)"]]
      .map(([k, l]) => `<label class="checkline"><input type="radio" name="hp-method" value="${k}" ${hpMethod === k ? "checked" : ""}> ${l}</label>`).join("");
    let hpExtra = "";
    if (hpMethod === "roll" && draft.level > 1) {
      hpExtra = `<p class="muted small" style="margin:10px 0 4px">Your d${hitDie} roll for each level past 1st (blank = average):</p>
        <div class="row">${Array.from({ length: draft.level - 1 }, (_, i) => i + 2).map((lv) => `
          <div style="width:66px">
            <div class="muted small" style="text-align:center">L${lv}</div>
            <input type="number" class="hp-roll" data-lv="${lv}" min="1" max="${hitDie}" value="${draft.hp.rolled?.[lv - 2] || ""}">
          </div>`).join("")}</div>`;
    } else if (hpMethod === "roll") {
      hpExtra = `<p class="muted small" style="margin:8px 0 0">Level 1 is always the full d${hitDie} — rolls start at level 2.</p>`;
    }
    if (hpMethod === "manual") {
      hpExtra = `<label class="field">Max HP</label>
        <input type="number" id="hp-manual" min="1" value="${draft.hp.manual ?? ""}" style="max-width:130px" placeholder="e.g. 38">`;
    }

    body.innerHTML = `
      <div class="card">
        <h3 class="section">Ability scores</h3>
        <div class="row">${tabs}</div>
        ${methodBar}
        <div class="ability-grid" style="margin-top:14px">${ABILITIES.map(box).join("")}</div>
      </div>
      ${asiCard}
      <div class="card">
        <h3 class="section">Hit points</h3>
        <div class="row">${hpRadios}</div>
        ${hpExtra}
        <p class="muted small" style="margin-top:10px">Max HP: <strong id="hp-live" style="color:var(--gold)">${drv.hp.max}</strong>
          <span class="muted small">(d${hitDie} hit die, CON ${fmtMod(drv.abilities.con.mod)})</span></p>
      </div>`;

    $$("[data-method]", body).forEach((b) => (b.onclick = () => {
      draft.abilityMethod = b.dataset.method;
      normalizeMethod(draft.abilityMethod);
      rerender();
    }));
    const autofill = $("[data-autofill]", body);
    if (autofill) autofill.onclick = () => { ABILITIES.forEach((a, i) => (draft.abilities[a] = STANDARD_ARRAY[i])); rerender(); };
    const rollBtn = $("#ab-roll", body);
    if (rollBtn) rollBtn.onclick = () => {
      state.rolledSet = Array.from({ length: 6 }, roll4d6DropLowest);
      const sorted = [...state.rolledSet].sort((x, y) => y - x);
      ABILITIES.forEach((a, i) => (draft.abilities[a] = sorted[i]));
      rerender();
    };
    $$(".ab-sel", body).forEach((sel) => (sel.onchange = () => {
      assignSwap(sel.dataset.ab, parseInt(sel.value, 10));
      rerender();
    }));
    $$("[data-pb]", body).forEach((b) => (b.onclick = () => {
      const a = b.dataset.ab;
      draft.abilities[a] = Math.max(8, Math.min(15, draft.abilities[a] + (+b.dataset.pb)));
      rerender();
    }));
    $$(".ab-man", body).forEach((inp) => {
      inp.oninput = () => {
        const v = parseInt(inp.value, 10);
        if (!Number.isFinite(v)) return;
        draft.abilities[inp.dataset.ab] = Math.max(3, Math.min(20, v));
        const boxEl = inp.closest(".ability-box");
        const fin = finalAbilities(draft)[inp.dataset.ab];
        boxEl.querySelector(".ab-mod").textContent = fmtMod(Math.floor((fin - 10) / 2));
        boxEl.querySelector(".ab-score").textContent = `final ${fin}`;
        const live = $("#hp-live", body);
        if (live) live.textContent = derive(draft).hp.max;
        syncChrome();
      };
      inp.onchange = () => rerender();
    });
    $$('input[name="hp-method"]', body).forEach((r) => (r.onchange = () => { draft.hp.method = r.value; rerender(); }));
    $$(".hp-roll", body).forEach((inp) => (inp.oninput = () => {
      const vals = $$(".hp-roll", body)
        .sort((x, y) => +x.dataset.lv - +y.dataset.lv)
        .map((i) => { const v = parseInt(i.value, 10); return v >= 1 && v <= hitDie ? v : null; });
      while (vals.length && vals[vals.length - 1] == null) vals.pop();
      draft.hp.rolled = vals;
      $("#hp-live", body).textContent = derive(draft).hp.max;
      syncChrome();
    }));
    const hpMan = $("#hp-manual", body);
    if (hpMan) hpMan.oninput = () => {
      const v = parseInt(hpMan.value, 10);
      draft.hp.manual = v > 0 ? v : null;
      $("#hp-live", body).textContent = derive(draft).hp.max;
      syncChrome();
    };
    bindAsi(body);
  }

  function asiBlock(lv) {
    const local = state.asiLocal[lv] || { mode: null, picks: [], name: "", desc: "" };
    const done = (draft.asi || []).some((a) => a.level === lv);
    const modeBtn = (k, l) => `<button class="${local.mode === k ? "btn" : "btn-ghost"}" data-asi-mode="${k}" data-asi-lv="${lv}">${l}</button>`;
    let inner = "";
    if (local.mode === "asi2" || local.mode === "asi1") {
      const need = local.mode === "asi2" ? 1 : 2;
      inner = `<div class="choice-row">${ABILITIES.map((a) =>
        chipBtn(`+${local.mode === "asi2" ? 2 : 1} ${a.toUpperCase()}`, local.picks.includes(a),
          `data-asi-ab="${a}" data-asi-lv="${lv}"`,
          { disabled: !local.picks.includes(a) && local.picks.length >= need })
      ).join("")}</div>`;
    } else if (local.mode === "feat") {
      inner = `
        <div class="row">
          <input type="text" class="grow asi-feat-name" data-asi-lv="${lv}" placeholder="Feat name" value="${esc(local.name)}">
          <button class="btn-ghost asi-grappler" data-asi-lv="${lv}">Use ${esc(FEATS.grappler.name)} (SRD)</button>
        </div>
        <textarea class="asi-feat-desc" data-asi-lv="${lv}" style="min-height:56px" placeholder="What the feat does">${esc(local.desc)}</textarea>`;
    }
    return `<div class="feature-block">
      <span class="f-name">Level ${lv} improvement</span>
      <span class="pill ${done ? "moss" : "ember"}">${done ? "done" : "to do"}</span>
      <div class="row" style="margin-top:8px">
        ${modeBtn("asi2", "+2 to one")}${modeBtn("asi1", "+1 to two")}${modeBtn("feat", "Take a feat")}
      </div>
      <div style="margin-top:8px">${inner}</div>
    </div>`;
  }

  function syncAsi(lv) {
    const local = state.asiLocal[lv];
    draft.asi = (draft.asi || []).filter((a) => a.level !== lv);
    if (local) {
      if (local.mode === "asi2" && local.picks.length === 1)
        draft.asi.push({ level: lv, kind: "asi", plus: { [local.picks[0]]: 2 } });
      else if (local.mode === "asi1" && local.picks.length === 2)
        draft.asi.push({ level: lv, kind: "asi", plus: { [local.picks[0]]: 1, [local.picks[1]]: 1 } });
      else if (local.mode === "feat" && local.name.trim())
        draft.asi.push({ level: lv, kind: "feat", name: local.name.trim(), desc: local.desc });
    }
    draft.asi.sort((a, b) => a.level - b.level);
  }

  function bindAsi(body) {
    $$("[data-asi-mode]", body).forEach((b) => (b.onclick = () => {
      const lv = +b.dataset.asiLv;
      const local = (state.asiLocal[lv] ||= { mode: null, picks: [], name: "", desc: "" });
      if (local.mode !== b.dataset.asiMode) { local.mode = b.dataset.asiMode; local.picks = []; }
      syncAsi(lv);
      rerender();
    }));
    $$("[data-asi-ab]", body).forEach((b) => (b.onclick = () => {
      const lv = +b.dataset.asiLv, a = b.dataset.asiAb;
      const local = state.asiLocal[lv];
      const need = local.mode === "asi2" ? 1 : 2;
      const i = local.picks.indexOf(a);
      if (i >= 0) local.picks.splice(i, 1);
      else if (local.picks.length >= need) { toast(`Pick ${need} — unpick one first`); return; }
      else local.picks.push(a);
      syncAsi(lv);
      rerender();
    }));
    $$(".asi-feat-name", body).forEach((inp) => {
      inp.oninput = () => {
        const lv = +inp.dataset.asiLv;
        state.asiLocal[lv].name = inp.value;
        syncAsi(lv);
        syncChrome();
      };
      inp.onchange = () => rerender();
    });
    $$(".asi-feat-desc", body).forEach((ta) => (ta.oninput = () => {
      const lv = +ta.dataset.asiLv;
      state.asiLocal[lv].desc = ta.value;
      syncAsi(lv);
    }));
    $$(".asi-grappler", body).forEach((b) => (b.onclick = () => {
      const lv = +b.dataset.asiLv;
      const local = state.asiLocal[lv];
      local.name = FEATS.grappler.name;
      local.desc = `${FEATS.grappler.desc}\n(Prerequisite: ${FEATS.grappler.prereqs.join(", ")})`;
      syncAsi(lv);
      rerender();
    }));
  }

  /* ════════════ STEP: BACKGROUND ════════════ */
  function stepBackground(body) {
    const cur = draft.background;
    const list = Object.values(BACKGROUNDS).sort((a, b) => a.name.localeCompare(b.name));
    const bgSub = (bg) => {
      const bits = [bg.skills.map(skillName).join(", ")];
      if (bg.tools?.length) bits.push(bg.tools.join(", "));
      if (bg.languages?.choose) bits.push(`${bg.languages.choose} language${bg.languages.choose > 1 ? "s" : ""}`);
      return bits.join(" · ");
    };
    body.innerHTML = `
      <div class="card">
        <h3 class="section">Choose a background</h3>
        <div class="opt-grid">
          ${list.map((bg) => `
          <button class="opt-card ${cur?.kind === "srd" && cur.index === bg.index ? "selected" : ""}" data-bg="${esc(bg.index)}">
            <div class="opt-title">${esc(bg.name)}</div>
            <div class="opt-sub">${esc(bgSub(bg))}</div>
          </button>`).join("")}
          <button class="opt-card ${cur?.kind === "custom" ? "selected" : ""}" data-bg="__custom">
            <div class="opt-title">Custom background</div>
            <div class="opt-sub"><span class="pill mystic">homebrew</span> your own</div>
          </button>
        </div>
        <div id="bg-detail"></div>
        ${REF_LINKS}
      </div>`;

    $$("[data-bg]", body).forEach((b) => (b.onclick = () => {
      const v = b.dataset.bg;
      if (v === "__custom") {
        if (cur?.kind === "custom") return;
        draft.background = { kind: "custom", name: "", skills: [], tools: [], languages: [], feature: { name: "", desc: "" } };
      } else {
        if (cur?.kind === "srd" && cur.index === v) return;
        draft.background = { kind: "srd", index: v, languageChoices: [] };
      }
      rerender();
    }));

    const detail = $("#bg-detail", body);
    const raceLangs = new Set((raceInfo(draft)?.languages || []).map(String));
    if (draft.background?.kind === "srd") {
      const bg = draft.background;
      const info = BACKGROUNDS[bg.index];
      const choose = info.languages?.choose || 0;
      const picked = bg.languageChoices || [];
      const pool = LANGUAGES.map((l) => l.index).filter((i) => !raceLangs.has(i));
      detail.innerHTML = `
        <p class="muted small" style="margin-top:14px">Skill proficiencies:
          <strong>${info.skills.map(skillName).map(esc).join(", ")}</strong>${
          info.tools?.length ? `<br>Tools: <strong>${info.tools.map(esc).join(", ")}</strong>` : ""}</p>
        ${choose ? `<label class="field">Bonus languages — choose ${choose} (any)</label>
        <div class="choice-row">${pool.map((i) =>
          chipBtn(esc(langName(i)), picked.includes(i), `data-bglang="${esc(i)}"`, { disabled: !picked.includes(i) && picked.length >= choose })
        ).join("")}</div>` : ""}
        <details class="fold"><summary>Feature: ${esc(info.feature.name)}</summary>${md(info.feature.desc)}</details>`;
      $$("[data-bglang]", detail).forEach((b) => (b.onclick = () => {
        const v = b.dataset.bglang, arr = (bg.languageChoices ||= []);
        const i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1);
        else if (arr.length >= choose) { toast(`Choose ${choose} — unpick one first`); return; }
        else arr.push(v);
        rerender();
      }));
    } else if (draft.background?.kind === "custom") {
      const bg = draft.background;
      const pool = LANGUAGES.map((l) => l.index).filter((i) => !raceLangs.has(i));
      detail.innerHTML = `
        <hr class="rule">
        <label class="field">Background name</label>
        <input type="text" id="cb-name" value="${esc(bg.name || "")}" placeholder="e.g. Willowfen Fishmonger">
        <label class="field">Skill proficiencies — choose exactly 2</label>
        <div class="choice-row">${Object.keys(SKILLS).map((s) =>
          chipBtn(esc(skillName(s)), (bg.skills || []).includes(s), `data-cbskill="${esc(s)}"`, { disabled: !(bg.skills || []).includes(s) && (bg.skills || []).length >= 2 })
        ).join("")}</div>
        <label class="field">Tool proficiencies <span class="muted">(comma-separated)</span></label>
        <input type="text" id="cb-tools" value="${esc((bg.tools || []).join(", "))}" placeholder="Thieves' tools, Disguise kit">
        <label class="field">Languages — up to 2</label>
        <div class="choice-row">${pool.map((i) =>
          chipBtn(esc(langName(i)), (bg.languages || []).includes(i), `data-cblang="${esc(i)}"`, { disabled: !(bg.languages || []).includes(i) && (bg.languages || []).length >= 2 })
        ).join("")}</div>
        <label class="field">Feature name</label>
        <input type="text" id="cb-fname" value="${esc(bg.feature?.name || "")}" placeholder="e.g. City Secrets">
        <label class="field">Feature description</label>
        <textarea id="cb-fdesc" style="min-height:64px">${esc(bg.feature?.desc || "")}</textarea>`;
      $("#cb-name", detail).oninput = (e) => { bg.name = e.target.value; syncChrome(); };
      $("#cb-tools", detail).oninput = (e) => { bg.tools = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); };
      $("#cb-fname", detail).oninput = (e) => { (bg.feature ||= {}).name = e.target.value; };
      $("#cb-fdesc", detail).oninput = (e) => { (bg.feature ||= {}).desc = e.target.value; };
      const bind = (attr, arrGet, capN) => $$(`[${attr}]`, detail).forEach((b) => (b.onclick = () => {
        const v = b.getAttribute(attr), arr = arrGet();
        const i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1);
        else if (arr.length >= capN) { toast(`Up to ${capN} — unpick one first`); return; }
        else arr.push(v);
        rerender();
      }));
      bind("data-cbskill", () => (bg.skills ||= []), 2);
      bind("data-cblang", () => (bg.languages ||= []), 2);
    } else {
      detail.innerHTML = "";
    }
  }

  /* ════════════ STEP: EQUIPMENT ════════════ */
  function addItem(kind, item) {
    const ex = draft.equipment.find((e) => e.kind === kind && e.item === item);
    if (ex) { ex.qty = (ex.qty || 1) + 1; rerender(); return; }
    draft.equipment.push({ kind, item, qty: 1, equipped: kind === "weapon" || kind === "armor" });
    rerender();
  }

  function stepEquipment(body, drv) {
    const cls = classInfo(draft);
    const simple = Object.values(WEAPONS).filter((w) => w.category.startsWith("simple"));
    const martial = Object.values(WEAPONS).filter((w) => w.category.startsWith("martial"));
    const wopt = (w) => `<option value="${esc(w.index)}">${esc(w.name)} — ${w.dmg || "—"} ${esc(w.dmgType)}</option>`;
    const armorGroups = ["light", "medium", "heavy", "shield"].map((cat) => {
      const items = Object.values(ARMOR).filter((a) => a.category === cat);
      return `<optgroup label="${cap(cat)}">${items.map((a) =>
        `<option value="${esc(a.index)}">${esc(a.name)} — AC ${a.base}${a.dexBonus ? " + DEX" + (a.dexMax != null ? ` (max ${a.dexMax})` : "") : ""}${cat === "shield" ? " +2" : ""}</option>`).join("")}</optgroup>`;
    }).join("");

    const itemRows = draft.equipment.map((e, i) => `
      <div class="row" style="margin:8px 0">
        <span class="grow">${esc(itemName(e))} <span class="muted small">· ${esc(e.kind)}</span></span>
        <button class="btn-ghost" style="padding:2px 10px" data-qty="-1" data-i="${i}" ${(e.qty || 1) <= 1 ? "disabled" : ""}>−</button>
        <span class="die-chip">${e.qty || 1}</span>
        <button class="btn-ghost" style="padding:2px 10px" data-qty="1" data-i="${i}">+</button>
        ${e.kind === "weapon" || e.kind === "armor"
          ? `<label class="checkline"><input type="checkbox" data-equip="${i}" ${e.equipped ? "checked" : ""}> equipped</label>`
          : ""}
        <button class="btn-danger" style="padding:2px 10px" data-rm="${i}">✕</button>
      </div>`).join("");

    const attackRows = drv.attacks.map((a) => `
      <div class="feature-block">
        <span class="f-name">${esc(a.name)}</span>
        <span class="f-src">${fmtMod(a.toHit)} to hit ·
          ${a.dmg ? `${a.dmg}${a.dmgMod ? " " + fmtMod(a.dmgMod) : ""}` : a.dmgFlat != null ? `${a.dmgFlat} flat` : "—"}
          ${esc(a.dmgType)}</span>
        ${a.note ? `<div class="muted small">${esc(a.note)}</div>` : ""}
      </div>`).join("");

    body.innerHTML = `
      <div class="grid">
        <div class="card">
          <h3 class="section">Gear up</h3>
          ${cls ? `
            <div class="row"><button class="btn" id="eq-kit">Take the ${esc(cls.name)} kit</button></div>
            <details class="fold"><summary>What the book offers at 1st level</summary>
              <ul class="log">${cls.startEquipOptions.map((o) => `<li class="muted small">${esc(o)}</li>`).join("")}</ul>
              <p class="muted small">The quick kit is one sensible pick — add or swap whatever you actually chose below.</p>
            </details>`
          : `<p class="muted small">Pick a class first to unlock its starting kit — or just add gear below.</p>`}
          <label class="field">Add a weapon</label>
          <select id="eq-weapon">
            <option value="">Choose a weapon…</option>
            <optgroup label="Simple">${simple.map(wopt).join("")}</optgroup>
            <optgroup label="Martial">${martial.map(wopt).join("")}</optgroup>
          </select>
          <label class="field">Add armor or a shield</label>
          <select id="eq-armor"><option value="">Choose armor…</option>${armorGroups}</select>
          <label class="field">Add gear or a pack</label>
          <select id="eq-gear">
            <option value="">Choose gear…</option>
            <optgroup label="Equipment packs">${Object.values(PACKS).map((p) => `<option value="${esc(p.index)}">${esc(p.name)} (${esc(p.cost)})</option>`).join("")}</optgroup>
            <optgroup label="Adventuring gear">${Object.values(GEAR).map((g) => `<option value="${esc(g.index)}">${esc(g.name)}</option>`).join("")}</optgroup>
          </select>
          <label class="field">Add anything else</label>
          <div class="row">
            <input type="text" id="eq-custom" class="grow" placeholder="e.g. Grandmother's lucky fishhook">
            <button class="btn-ghost" id="eq-custom-add">Add</button>
          </div>
          <div id="eq-list" style="margin-top:14px">
            ${itemRows || `<div class="empty">Nothing but pocket lint so far.</div>`}
          </div>
        </div>
        <div class="card">
          <h3 class="section">Battle readiness</h3>
          <div class="stat-row">
            ${statTile("AC", drv.ac.value, drv.ac.desc)}
            ${statTile("Max HP", drv.hp.max)}
            ${statTile("Speed", `${drv.speed} ft`)}
          </div>
          ${attackRows}
          <p class="muted small" style="margin-top:10px">Equipped armor, shields and weapons drive AC and the
            attack list — the same math runs live on your sheet.</p>
        </div>
      </div>`;

    const kitBtn = $("#eq-kit", body);
    if (kitBtn) kitBtn.onclick = () => {
      let added = 0;
      for (const k of cls.quickKit) {
        const kind = WEAPONS[k.item] ? "weapon" : ARMOR[k.item] ? "armor" : PACKS[k.item] ? "pack" : "gear";
        if (draft.equipment.some((e) => e.kind === kind && e.item === k.item)) continue;
        draft.equipment.push({ kind, item: k.item, qty: k.qty || 1, equipped: kind === "weapon" || kind === "armor" });
        added++;
      }
      toast(added ? `Added ${added} item${added > 1 ? "s" : ""} from the ${cls.name} kit` : "You already carry everything in the kit");
      rerender();
    };
    $("#eq-weapon", body).onchange = (e) => { if (e.target.value) addItem("weapon", e.target.value); };
    $("#eq-armor", body).onchange = (e) => { if (e.target.value) addItem("armor", e.target.value); };
    $("#eq-gear", body).onchange = (e) => {
      const v = e.target.value;
      if (v) addItem(PACKS[v] ? "pack" : "gear", v);
    };
    $("#eq-custom-add", body).onclick = () => {
      const inp = $("#eq-custom", body);
      const name = inp.value.trim();
      if (!name) { toast("Name the item first"); return; }
      draft.equipment.push({ kind: "custom", item: null, name, qty: 1, equipped: false });
      rerender();
    };
    $$("[data-qty]", body).forEach((b) => (b.onclick = () => {
      const e = draft.equipment[+b.dataset.i];
      e.qty = Math.max(1, (e.qty || 1) + (+b.dataset.qty));
      rerender();
    }));
    $$("[data-equip]", body).forEach((c) => (c.onchange = () => {
      draft.equipment[+c.dataset.equip].equipped = c.checked;
      rerender();
    }));
    $$("[data-rm]", body).forEach((b) => (b.onclick = () => {
      draft.equipment.splice(+b.dataset.i, 1);
      rerender();
    }));
  }

  /* ════════════ STEP: SPELLS ════════════ */
  function stepSpells(body, drv) {
    const sc = drv.spellcasting;
    let html = "";
    if (sc) html += spellsHeader(drv, sc) + cantripPicker(drv, sc) + spellPicker(drv, sc);
    html += racialMagicCard(drv);
    html += customSpellsCard();
    html += `<div class="card">${REF_LINKS.replace("<p ", '<p style="margin:0" ')}</div>`;
    body.innerHTML = html;
    bindSpells(body, drv, sc);
  }

  function spellsHeader(drv, sc) {
    const bookCap = 6 + 2 * (drv.level - 1);
    const tiles = [
      statTile("Spell DC", sc.dc, ABILITY_NAMES[sc.ability]),
      statTile("Spell attack", fmtMod(sc.attackBonus)),
      statTile("Max spell level", sc.maxSpellLevel ? ordinal(sc.maxSpellLevel) : "—"),
      sc.cantripsMax ? statTile("Cantrips", `${draft.spells.cantrips.length}/${sc.cantripsMax}`) : "",
      sc.knownMax != null ? statTile("Known", `${draft.spells.known.length}/${sc.knownMax}`) : "",
      sc.kind === "prepared-book" ? statTile("Spellbook", `${draft.spells.known.length}/${bookCap}`, "suggested") : "",
      sc.preparedMax != null ? statTile("Prepared", `${draft.spells.prepared.length}/${sc.preparedMax}`) : "",
    ].join("");
    const slots = sc.pact
      ? `Pact magic: ${sc.pact.count} × ${ordinal(sc.pact.level)}-level slot${sc.pact.count > 1 ? "s" : ""} (recharge on a short rest)`
      : `Slots: ${sc.slots.map((s) => `${s.max} × ${ordinal(s.level)}`).join(" · ")}`;
    return `<div class="card">
      <h3 class="section">Spellcasting — ${esc(ABILITY_NAMES[sc.ability])}</h3>
      <div class="stat-row">${tiles}</div>
      <p class="muted small" style="margin:4px 0 0">${slots}${sc.ritual ? " · ritual casting" : ""}</p>
    </div>`;
  }

  function cantripPicker(drv, sc) {
    if (!sc.cantripsMax) return "";
    const el = eligibleSpells(draft, drv);
    const picked = draft.spells.cantrips;
    return `<div class="card">
      <h3 class="section">Cantrips — choose ${sc.cantripsMax}</h3>
      <div class="choice-row">${el.cantrips.map((i) =>
        chipBtn(esc(SPELLS[i].name), picked.includes(i), `data-sp-cant="${esc(i)}"`, { disabled: !picked.includes(i) && picked.length >= sc.cantripsMax })
      ).join("")}</div>
    </div>`;
  }

  function spellPicker(drv, sc) {
    const el = eligibleSpells(draft, drv);
    if (!el.spells.length) return "";
    const byLvl = {};
    for (const i of el.spells) (byLvl[SPELLS[i].level] ??= []).push(i);
    const intro = {
      "known": `You know a fixed list of spells (${sc.knownMax ?? "—"} at this level) and can cast any of them with a free slot.`,
      "pact": `You know ${sc.knownMax ?? "—"} spells and cast them through your pact slots.`,
      "prepared-book": `Toggle <em>Spellbook</em> for spells you've scribed (about ${6 + 2 * (drv.level - 1)} suggested), then <em>Prepare</em> up to ${sc.preparedMax} from the book.`,
      "prepared-list": `You can prepare up to ${sc.preparedMax} spells from the whole list each long rest — pre-pick here if you like, or do it on the sheet.`,
    }[sc.kind] || "";
    const groups = Object.keys(byLvl).sort((a, b) => a - b).map((lvl) => `
      <div class="spell-lvl-head">${ordinal(+lvl)} level</div>
      ${byLvl[lvl].map((i) => spellRow(i, sc)).join("")}`).join("");
    return `<div class="card">
      <h3 class="section">Spells</h3>
      <p class="muted small" style="margin-top:-6px">${intro}</p>
      ${groups}
    </div>`;
  }

  function spellRow(idx, sc) {
    const s = SPELLS[idx];
    const known = draft.spells.known.includes(idx);
    const prepared = draft.spells.prepared.includes(idx);
    let btns = "";
    if (sc.kind === "known" || sc.kind === "pact") {
      btns = chipBtn("Known", known, `data-sp-known="${esc(idx)}"`);
    } else if (sc.kind === "prepared-book") {
      btns = chipBtn("Spellbook", known, `data-sp-known="${esc(idx)}"`)
        + chipBtn("Prepared", prepared, `data-sp-prep="${esc(idx)}"`, { disabled: !known && !prepared });
    } else {
      btns = chipBtn("Prepared", prepared, `data-sp-prep="${esc(idx)}"`);
    }
    return `<div class="spell-row">
      <div class="row">
        <span class="sp-name">${esc(s.name)}</span><span class="sp-tags">${spellTags(s)}</span>
        <span class="grow"></span>${btns}
      </div>
      <div class="sp-meta">${esc(spellMetaLine(s))}</div>
      <details class="fold sp-fold" data-sptext="${esc(idx)}"><summary>description</summary>
        <div class="sp-body muted small">…</div></details>
    </div>`;
  }

  function racialMagicCard(drv) {
    if (draft.race?.kind !== "srd") return "";
    const r = RACES[draft.race.index];
    const sub = draft.race.subrace ? r?.subraces.find((s) => s.index === draft.race.subrace) : null;
    const rows = (r?.racialSpells || []).map((rs) => {
      const nm = SPELLS[rs.spell]?.name || cap(rs.spell);
      const later = drv.level < rs.atLevel ? ` — unlocks at level ${rs.atLevel}` : "";
      return `<div class="feature-block"><span class="f-name">${esc(nm)}</span><span class="f-src">${esc(rs.note)} · ${esc(ABILITY_NAMES[rs.ability] || rs.ability)}${later}</span></div>`;
    });
    let picker = "";
    if (sub?.cantripChoice) {
      const pool = Object.values(SPELLS)
        .filter((s) => s.level === 0 && s.classes.includes(sub.cantripChoice.class || "wizard"))
        .sort((a, b) => a.name.localeCompare(b.name));
      picker = `<label class="field">High elf cantrip — choose 1 from the wizard list</label>
        <div class="choice-row">${pool.map((s) =>
          chipBtn(esc(s.name), draft.race.cantripChoice === s.index, `data-rcantrip2="${esc(s.index)}"`)
        ).join("")}</div>`;
    }
    if (!rows.length && !picker) return "";
    return `<div class="card">
      <h3 class="section">Racial magic</h3>
      ${rows.join("")}
      ${picker}
    </div>`;
  }

  function customSpellsCard() {
    const list = draft.spells.custom.map((cs, i) => `
      <div class="spell-row">
        <div class="row">
          <span class="sp-name">${esc(cs.name)}</span><span class="sp-tags">${spellTags(cs)}</span>
          <span class="grow"></span>
          <button class="btn-danger" style="padding:2px 10px" data-cs-rm="${i}">✕</button>
        </div>
        <div class="sp-meta">${esc(spellMetaLine(cs))}${cs.dmg ? esc(` · ${cs.dmg} ${cs.dmgType || ""}`) : ""}${cs.attack ? " · spell attack" : cs.save ? esc(` · ${String(cs.save).toUpperCase()} save`) : ""}</div>
        ${cs.desc ? `<details class="fold"><summary>description</summary>${md(cs.desc)}</details>` : ""}
      </div>`).join("");
    const lvlOpts = Array.from({ length: 10 }, (_, n) =>
      `<option value="${n}">${n === 0 ? "Cantrip" : ordinal(n)}</option>`).join("");
    const saveOpts = ABILITIES.map((a) => `<option value="${a}">${ABILITY_NAMES[a]} save</option>`).join("");
    return `<div class="card">
      <h3 class="section">Custom spells <span class="pill mystic">homebrew</span></h3>
      ${list || `<p class="muted small">Spells from other books, or your own inventions — they show up on the sheet with cast buttons.</p>`}
      <details class="fold"><summary>＋ Add a custom spell</summary>
        <div class="row">
          <div class="grow"><label class="field">Name</label><input type="text" id="cs-name" placeholder="e.g. Toll the Dead"></div>
          <div><label class="field">Level</label><select id="cs-level" style="width:auto">${lvlOpts}</select></div>
          <div class="grow"><label class="field">School</label><input type="text" id="cs-school" placeholder="necromancy"></div>
        </div>
        <div class="row">
          <div class="grow"><label class="field">Casting time</label><input type="text" id="cs-time" placeholder="1 action"></div>
          <div class="grow"><label class="field">Range</label><input type="text" id="cs-range" placeholder="60 feet"></div>
          <div class="grow"><label class="field">Components</label><input type="text" id="cs-comp" placeholder="V, S"></div>
          <div class="grow"><label class="field">Duration</label><input type="text" id="cs-dur" placeholder="Instantaneous"></div>
        </div>
        <div class="row" style="margin-top:10px">
          <label class="checkline"><input type="checkbox" id="cs-conc"> concentration</label>
          <label class="checkline"><input type="checkbox" id="cs-rit"> ritual</label>
          <label class="checkline"><input type="checkbox" id="cs-att"> spell attack</label>
          <select id="cs-save" style="width:auto"><option value="">no save</option>${saveOpts}</select>
        </div>
        <div class="row">
          <div><label class="field">Damage dice</label><input type="text" id="cs-dmg" placeholder="8d6" style="max-width:110px"></div>
          <div class="grow"><label class="field">Damage type</label><input type="text" id="cs-dmgtype" placeholder="fire"></div>
        </div>
        <label class="field">Description</label>
        <textarea id="cs-desc" style="min-height:64px"></textarea>
        <div class="actions"><button class="btn-ghost" id="cs-add">Add spell</button></div>
      </details>
    </div>`;
  }

  function bindSpells(body, drv, sc) {
    if (sc) {
      $$("[data-sp-cant]", body).forEach((b) => (b.onclick = () => {
        const idx = b.dataset.spCant, arr = draft.spells.cantrips;
        const i = arr.indexOf(idx);
        if (i >= 0) arr.splice(i, 1);
        else if (arr.length >= sc.cantripsMax) { toast(`You know ${sc.cantripsMax} cantrips at this level — unpick one first`); return; }
        else arr.push(idx);
        rerender();
      }));
      $$("[data-sp-known]", body).forEach((b) => (b.onclick = () => {
        const idx = b.dataset.spKnown, arr = draft.spells.known;
        const i = arr.indexOf(idx);
        if (i >= 0) {
          arr.splice(i, 1);
          const p = draft.spells.prepared.indexOf(idx);
          if (p >= 0) draft.spells.prepared.splice(p, 1);
        } else if (sc.kind === "prepared-book") {
          const bookCap = 6 + 2 * (drv.level - 1);
          if (arr.length >= bookCap && !state.warnedBook) {
            toast(`Past the suggested spellbook size (${bookCap}) — allowed, but copying costs gold and time`);
            state.warnedBook = true;
          }
          arr.push(idx);
        } else {
          if (sc.knownMax != null && arr.length >= sc.knownMax) { toast(`You know ${sc.knownMax} spells at this level — unpick one first`); return; }
          arr.push(idx);
        }
        rerender();
      }));
      $$("[data-sp-prep]", body).forEach((b) => (b.onclick = () => {
        const idx = b.dataset.spPrep, arr = draft.spells.prepared;
        const i = arr.indexOf(idx);
        if (i >= 0) arr.splice(i, 1);
        else {
          if (sc.kind === "prepared-book" && !draft.spells.known.includes(idx)) { toast("Add it to the spellbook first"); return; }
          if (sc.preparedMax != null && arr.length >= sc.preparedMax) { toast(`You can prepare ${sc.preparedMax} spells — unprepare one first`); return; }
          arr.push(idx);
        }
        rerender();
      }));
    }
    $$(".sp-fold", body).forEach((d) => d.addEventListener("toggle", () => {
      if (!d.open || d.dataset.loaded) return;
      d.dataset.loaded = "1";
      const slot = d.querySelector(".sp-body");
      guard(async () => {
        const t = await spellText(d.dataset.sptext);
        slot.innerHTML = t ? md(t) : `<span class="muted small">No SRD text for this one.</span>`;
      });
    }));
    $$("[data-rcantrip2]", body).forEach((b) => (b.onclick = () => {
      draft.race.cantripChoice = draft.race.cantripChoice === b.dataset.rcantrip2 ? null : b.dataset.rcantrip2;
      rerender();
    }));
    $$("[data-cs-rm]", body).forEach((b) => (b.onclick = () => {
      draft.spells.custom.splice(+b.dataset.csRm, 1);
      rerender();
    }));
    const att = $("#cs-att", body), save = $("#cs-save", body);
    if (att) att.onchange = () => { if (att.checked) save.value = ""; save.disabled = att.checked; };
    const add = $("#cs-add", body);
    if (add) add.onclick = () => {
      const v = (id) => $(id, body).value.trim();
      const name = v("#cs-name");
      if (!name) { toast("Give the spell a name"); return; }
      const dmg = v("#cs-dmg");
      if (dmg && !parseDice(dmg)) { toast('Damage dice look like "8d6" or "3d8 + 2"'); return; }
      draft.spells.custom.push({
        name,
        level: parseInt($("#cs-level", body).value, 10) || 0,
        school: v("#cs-school"),
        time: v("#cs-time") || "1 action",
        range: v("#cs-range"),
        components: v("#cs-comp"),
        duration: v("#cs-dur"),
        concentration: $("#cs-conc", body).checked,
        ritual: $("#cs-rit", body).checked,
        attack: att.checked,
        save: att.checked ? null : (save.value || null),
        dmg,
        dmgType: v("#cs-dmgtype"),
        desc: $("#cs-desc", body).value,
      });
      toast(`${name} scribed into your list`);
      rerender();
    };
  }

  /* ════════════ STEP: DETAILS ════════════ */
  function stepDetails(body, drv) {
    const isAco = draft.background?.kind === "srd" && draft.background.index === "acolyte";
    const SUGKEY = { personality: "traits", ideals: "ideals", bonds: "bonds", flaws: "flaws" };
    const dtField = (key, label, ph = "") => {
      const sug = isAco ? BACKGROUNDS.acolyte.suggestions[SUGKEY[key]] : null;
      return `<label class="field">${label}</label>
        ${sug ? `<select class="dt-sug" data-for="${key}">
            <option value="">Acolyte suggestions…</option>
            ${sug.map((s) => `<option value="${esc(s)}">${esc(s.length > 74 ? s.slice(0, 72) + "…" : s)}</option>`).join("")}
          </select>` : ""}
        <textarea class="dt-det" data-det="${key}" style="min-height:56px" placeholder="${esc(ph)}">${esc(draft.details[key] || "")}</textarea>`;
    };
    const alignOpts = ALIGNMENTS.map((a) =>
      `<option value="${esc(a.name)}" ${String(draft.alignment).toLowerCase() === a.name.toLowerCase() ? "selected" : ""}>${esc(a.name)} (${a.abbr})</option>`).join("");
    const sc = drv.spellcasting;

    body.innerHTML = `
      <div class="card">
        <h3 class="section">Who are they?</h3>
        <div class="row">
          <div class="grow" style="flex:2 1 260px">
            <label class="field">Character name</label>
            <input type="text" id="dt-name" value="${esc(draft.name || "")}" placeholder="e.g. Merrin of the Blackmire"
              style="font-size:21px; font-family:var(--font-display)">
          </div>
          <div class="grow">
            <label class="field">Alignment</label>
            <select id="dt-align"><option value="">—</option>${alignOpts}</select>
          </div>
        </div>
        ${dtField("personality", "Personality traits")}
        ${dtField("ideals", "Ideals")}
        ${dtField("bonds", "Bonds")}
        ${dtField("flaws", "Flaws")}
        ${dtField("appearance", "Appearance")}
        ${dtField("backstory", "Backstory", "Who would you cross an ocean for? What are you keeping your distance from?")}
        <label class="field">Table notes</label>
        <textarea id="dt-notes" style="min-height:56px" placeholder="Anything else — house rules, reminders…">${esc(draft.notes || "")}</textarea>
      </div>
      <div class="card">
        <h3 class="section">Review</h3>
        <p class="char-sub">${esc(`${drv.raceName} ${drv.className}${drv.subclassName ? ` (${drv.subclassName})` : ""} · Level ${drv.level}${drv.backgroundName ? ` · ${drv.backgroundName}` : ""}`)}</p>
        <div class="stat-row">
          ${statTile("AC", drv.ac.value, drv.ac.desc)}
          ${statTile("Max HP", drv.hp.max)}
          ${statTile("Passive Perception", drv.passivePerception)}
          ${sc ? statTile("Spell DC", sc.dc) : ""}
        </div>
        <div id="dt-problems"></div>
        <div class="actions">
          <button class="btn" id="dt-save" style="padding:12px 26px">💾 Save character</button>
        </div>
      </div>`;

    const refreshReview = () => {
      const pend = pendingChoices(draft);
      const box = $("#dt-problems", body);
      box.innerHTML = pend.length
        ? `<p class="pending-note" style="margin-bottom:4px">${pend.length} thing${pend.length > 1 ? "s" : ""} still to choose — saving now keeps it as a draft:</p>`
          + pend.map((p) => `
            <div class="row" style="margin:4px 0">
              <span class="grow pending-note">• ${esc(p.label)}</span>
              <button class="btn-ghost" data-goto="${p.step}" style="padding:3px 12px">Fix</button>
            </div>`).join("")
        : `<p class="muted">✓ Every choice is made — this hero is ready for the table.</p>`;
      $$("[data-goto]", box).forEach((b) => (b.onclick = () => { state.step = b.dataset.goto; rerender(); }));
    };
    refreshReview();

    $("#dt-name", body).oninput = (e) => { draft.name = e.target.value; syncChrome(); refreshReview(); };
    $("#dt-align", body).onchange = (e) => { draft.alignment = e.target.value; };
    $$(".dt-det", body).forEach((ta) => (ta.oninput = () => { draft.details[ta.dataset.det] = ta.value; }));
    $("#dt-notes", body).oninput = (e) => { draft.notes = e.target.value; };
    $$(".dt-sug", body).forEach((sel) => (sel.onchange = () => {
      const v = sel.value;
      if (!v) return;
      const key = sel.dataset.for;
      draft.details[key] = draft.details[key] ? draft.details[key] + "\n" + v : v;
      const ta = $(`.dt-det[data-det="${key}"]`, body);
      if (ta) ta.value = draft.details[key];
      sel.value = "";
    }));
    $("#dt-save", body).onclick = doSave;
  }

  rerender();
}
