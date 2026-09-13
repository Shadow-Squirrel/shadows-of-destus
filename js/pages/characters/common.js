// ─────────────────────────────────────────────────────────────
//  common.js — small helpers shared by the character builder
//  and the character sheet. UI-flavored, but no page state.
// ─────────────────────────────────────────────────────────────
import { esc } from "../../shell.js";
import { fmtMod } from "../../dnd/rules.js";
import { SCHOOLS } from "../../dnd/data/core.js";
import { SPELLS } from "../../dnd/data/spells.js";

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const ordinal = (n) =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
export const prettyKey = (k) =>
  cap(String(k).replace(/_/g, " ").replace(/\bdice\b/, "dice"));

/* a labeled stat tile (AC, initiative, speed…) */
export const statTile = (label, big, sub = "") => `
  <div class="stat-tile">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-big">${big}</div>
    ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}
  </div>`;

/* one-line spell metadata: "3rd · Evocation · 1 action · 150 feet" */
export function spellMetaLine(s) {
  const lvl = s.level === 0 ? "Cantrip" : ordinal(s.level);
  return [lvl, SCHOOLS[s.school] || cap(s.school), s.time, s.range, s.components]
    .filter(Boolean).join(" · ");
}
export function spellTags(s) {
  return `
    ${s.concentration ? '<span class="conc-dot" title="Concentration">C</span>' : ""}
    ${s.ritual ? '<span class="rit-dot" title="Ritual">R</span>' : ""}`;
}

/* find a spell (SRD or a character's custom list) */
export function findSpell(indexOrCustom, char) {
  if (SPELLS[indexOrCustom]) return SPELLS[indexOrCustom];
  return (char?.spells?.custom || []).find((c) => c.name === indexOrCustom) || null;
}

/* lazy text loaders — big description files load on first use */
let _spellTexts = null;
export async function spellText(index) {
  _spellTexts ??= (await import("../../dnd/data/spell-texts.js")).SPELL_TEXTS;
  return _spellTexts[index] || null;
}
let _featureTexts = null;
export async function featureText(index) {
  _featureTexts ??= (await import("../../dnd/data/features.js")).FEATURE_TEXTS;
  return _featureTexts[index] || null;
}

/* a minimal modal; returns {el, close} */
export function openModal(title, bodyHtml) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><div class="modal-body">${bodyHtml}</div></div>`;
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  document.body.appendChild(back);
  return { el: back, close };
}

/* three-state advantage toggle; onChange("adv"|"normal"|"dis") */
export function advToggle(initial = "normal", onChange) {
  const wrap = document.createElement("span");
  wrap.className = "adv-toggle";
  let mode = initial;
  const render = () => {
    wrap.innerHTML = `
      <button type="button" class="dis ${mode === "dis" ? "on" : ""}" title="Disadvantage: roll 2d20, keep lowest">DIS</button>
      <button type="button" class="norm ${mode === "normal" ? "on" : ""}">—</button>
      <button type="button" class="adv ${mode === "adv" ? "on" : ""}" title="Advantage: roll 2d20, keep highest">ADV</button>`;
    wrap.querySelector(".dis").onclick = () => set("dis");
    wrap.querySelector(".norm").onclick = () => set("normal");
    wrap.querySelector(".adv").onclick = () => set("adv");
  };
  const set = (m) => { mode = m; render(); onChange && onChange(m); };
  render();
  wrap.get = () => mode;
  return wrap;
}

export { fmtMod, esc };
