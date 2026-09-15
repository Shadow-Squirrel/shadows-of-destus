// The Spellbook — a campaign's shared homebrew spells. Custom spells
// live in `homebrew_spells` (per campaign); the party can read them,
// only a DM writes. A spell authored here can be dropped onto any
// character sheet, where the existing per-character custom-spell
// plumbing casts AND animates it (school → volumetric FX on the
// Battle map). AI drafting goes through the `generate-homebrew` Edge
// Function (kind: spell), sharing the AI *text* bill cap with monsters.
import { boot, esc, md, guard, toast } from "../shell.js";
import { homebrewSpells, characters, ai, getCampaign, isReal } from "../db.js";
import { openModal, spellMetaLine, spellTags, ordinal } from "./characters/common.js";
import { migrateCharacter } from "../dnd/model.js";

const SCHOOLS = ["abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"];
const DMG_TYPES = ["", "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const SAVES = ["", "str", "dex", "con", "int", "wis", "cha"];
const SAVE_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const AOE_TYPES = ["", "sphere", "cone", "line", "cube", "cylinder"];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Normalize an AI draft (flat aoe_type/aoe_size, mixed case) OR a stored data
// blob into the canonical custom-spell shape the model + FX understand. School
// and damage type are lowercased so schoolFlourish()/pal() in effects.js match.
function toCustomSpell(raw = {}) {
  const r = raw || {};
  const lvl = Math.max(0, Math.min(9, parseInt(r.level, 10) || 0));
  const school = String(r.school || "").trim().toLowerCase();
  const dmgType = String(r.dmgType || r.dmg_type || "").trim().toLowerCase();
  let aoe = r.aoe && r.aoe.type ? { type: String(r.aoe.type).toLowerCase(), size: +r.aoe.size || 0 } : null;
  if (!aoe && r.aoe_type) aoe = { type: String(r.aoe_type).toLowerCase(), size: +r.aoe_size || 0 };
  return {
    name: String(r.name || "").trim() || "New spell",
    level: lvl,
    school: SCHOOLS.includes(school) ? school : "evocation",  // unknown → a safe default the FX + select agree on
    time: String(r.time || "").trim(),
    range: String(r.range || "").trim(),
    components: String(r.components || "").trim(),
    duration: String(r.duration || "").trim(),
    concentration: !!r.concentration,
    ritual: !!r.ritual,
    attack: !!r.attack,
    save: SAVES.includes(String(r.save || "").toLowerCase()) ? String(r.save || "").toLowerCase() : "",
    dmg: String(r.dmg || "").trim(),
    dmgType,
    higher: String(r.higher || "").trim(),
    desc: String(r.desc || "").trim(),
    ...(aoe ? { aoe } : {}),
  };
}

const ctx = await boot("spells.html", "Spellbook");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  const isDM = ctx.me.isDM;
  const myEmail = (ctx.me.email || "").toLowerCase();
  let list = [];
  let chars = [];

  await render();

  async function render() {
    [list, chars] = await Promise.all([
      homebrewSpells.list(),
      characters.list().catch(() => []),
    ]);

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">The Spellbook</h2>
        ${isDM ? '<button class="btn" id="new-sp">+ Write a spell</button>' : ""}
      </div>
      <p class="muted small" style="margin-top:-6px">Homebrew spells for this campaign. Add one to a character and it
        casts — and bursts to life on the Battle map — like any spell.${isDM ? "" : " Your DM curates this list."}</p>
      ${isDM ? `<div id="ai-slot"></div>` : ""}
      <div id="form-slot"></div>
      <div class="grid" id="grid" style="grid-template-columns:repeat(auto-fill, minmax(300px, 1fr))"></div>`;

    const grid = root.querySelector("#grid");
    const sorted = [...list].sort((a, b) => (a.level - b.level) || String(a.name).localeCompare(String(b.name)));
    if (!sorted.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">The spellbook is empty${isDM ? " — inscribe your first spell above." : " — your DM hasn't written any homebrew spells yet."}</div>`;
    }
    sorted.forEach((sp) => grid.appendChild(card(sp)));

    const nb = root.querySelector("#new-sp");
    if (nb) nb.onclick = () => openForm();
    if (isDM) renderAi();
  }

  /* ── ✨ Draft a spell with AI (DM only) ── */
  async function renderAi() {
    const slot = root.querySelector("#ai-slot");
    if (!slot || !isReal()) return;

    let usage = null;
    try { usage = await ai.textUsage(); } catch { usage = null; }

    if (!usage) {
      slot.innerHTML = `
        <div class="card ai-card">
          <div class="row" style="justify-content:space-between; align-items:center">
            <strong>✨ Draft a spell with AI</strong>
            <span class="pill mystic">not set up</span>
          </div>
          <p class="muted small" style="margin:6px 0 0">AI drafting isn't set up yet. Deploy the
            <code>generate-homebrew</code> function and set a provider key — see <code>docs/AI-HOMEBREW.md</code>.
            You can still write spells by hand.</p>
        </div>`;
      return;
    }

    const left = usage.remaining ?? 0;
    slot.innerHTML = `
      <div class="card ai-card">
        <div class="row" style="justify-content:space-between; align-items:center">
          <strong>✨ Draft a spell with AI</strong>
          <span class="pill ${left > 0 ? "moss" : "ember"}" title="Shared with monster generation · resets monthly">${left} of ${usage.cap ?? "?"} left this month</span>
        </div>
        <p class="muted small" style="margin:6px 0 8px">Describe it and the AI drafts a balanced 5e spell for you to review and edit. Failed drafts don't count against your quota.</p>
        <textarea id="ai-prompt" style="min-height:56px" placeholder="e.g. a 3rd-level evocation that hurls a spiraling lance of frost, Dex save, cold damage, 60 ft line"></textarea>
        <div class="actions">
          <button class="btn" id="ai-go" ${left > 0 ? "" : "disabled"}>${left > 0 ? "✨ Draft spell" : "Monthly limit reached"}</button>
          <span class="muted small" id="ai-msg"></span>
        </div>
      </div>`;

    slot.querySelector("#ai-go").onclick = () => {
      const prompt = slot.querySelector("#ai-prompt").value.trim();
      if (!prompt) { toast("Describe the spell first"); return; }
      const go = slot.querySelector("#ai-go");
      go.disabled = true;
      slot.querySelector("#ai-msg").textContent = "Consulting the loremasters… (a few seconds)";
      guard(async () => {
        try {
          const draft = await ai.generateHomebrew({ campaignId: getCampaign(), kind: "spell", prompt });
          if (!draft) throw new Error("No spell came back");
          openForm(toCustomSpell(draft));
          toast("Draft ready — review it, then Save to the spellbook");
        } catch (e) {
          if (e.code === "not-configured") { renderAi(); toast("AI drafting isn't set up yet — see docs/AI-HOMEBREW.md"); return; }
          go.disabled = false;
          slot.querySelector("#ai-msg").textContent = "";
          toast("⚠ " + (e.message || "Drafting failed"));
        }
      });
    };
  }

  /* ── a spell card ── */
  function card(sp) {
    const d = sp.data || {};
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:baseline; gap:8px">
        <strong style="font-size:17px">${esc(sp.name)}</strong>
        <span class="pill gold">${sp.level === 0 ? "Cantrip" : ordinal(sp.level)}</span>
      </div>
      <p class="muted small" style="margin:6px 0 0">${esc([cap(sp.school || d.school), d.time, d.range].filter(Boolean).join(" · "))} <span class="sp-tags">${spellTags(d)}</span></p>
      ${d.dmg ? `<p class="muted small" style="margin:4px 0 0">${esc(d.dmg)}${d.dmgType ? ` ${esc(d.dmgType)}` : ""} damage${d.save ? ` · ${esc((d.save || "").toUpperCase())} save` : d.attack ? " · spell attack" : ""}</p>` : ""}
      <div class="row" style="justify-content:space-between; margin-top:12px; gap:6px">
        <span class="row" style="gap:6px">
          <button class="btn-ghost b-view">View</button>
          <button class="btn-ghost b-add">+ Add to hero</button>
        </span>
        ${isDM ? `<span class="row" style="gap:6px">
          <button class="btn-ghost b-edit">Edit</button>
          <button class="btn-danger b-del">✕</button>
        </span>` : ""}
      </div>`;
    el.querySelector(".b-view").onclick = () => viewModal(sp);
    el.querySelector(".b-add").onclick = () => addToCharacter(sp);
    if (isDM) {
      el.querySelector(".b-edit").onclick = () => openForm({ ...d, name: sp.name, level: sp.level, school: sp.school || d.school }, sp);
      el.querySelector(".b-del").onclick = () => {
        if (!confirm(`Remove "${sp.name}" from the spellbook?`)) return;
        guard(async () => { await homebrewSpells.remove(sp.id); render(); });
      };
    }
    return el;
  }

  /* ── full spell details (view) ── */
  function detailsHtml(sp) {
    const d = { ...(sp.data || {}), level: sp.level, school: sp.school || (sp.data || {}).school };
    const line = (label, val) => val ? `<p style="margin:3px 0"><strong>${esc(label)}</strong> ${esc(String(val))}</p>` : "";
    const dmgLine = d.dmg ? `${d.dmg}${d.dmgType ? ` ${d.dmgType}` : ""}` : "";
    const atkSave = d.attack ? "Spell attack" : d.save ? `${SAVE_NAMES[d.save] || (d.save || "").toUpperCase()} saving throw` : "";
    const area = d.aoe && d.aoe.type ? `${d.aoe.size ? d.aoe.size + "-ft " : ""}${d.aoe.type}` : "";
    return `
      <div style="font-size:14px; line-height:1.55">
        <p class="muted small" style="font-style:italic; margin:0 0 8px">${esc(spellMetaLine(d))} <span class="sp-tags">${spellTags(d)}</span></p>
        ${line("Casting Time", d.time)}
        ${line("Range", d.range)}
        ${line("Components", d.components)}
        ${line("Duration", d.duration)}
        ${line("Attack/Save", atkSave)}
        ${line("Damage/Effect", dmgLine)}
        ${line("Area", area)}
        ${d.desc ? `<div style="margin-top:8px">${md(d.desc)}</div>` : ""}
        ${d.higher ? `<p style="margin:8px 0 0"><strong><em>At Higher Levels.</em></strong> ${esc(d.higher)}</p>` : ""}
      </div>`;
  }
  function viewModal(sp) { openModal(sp.name, detailsHtml(sp)); }

  /* ── add a spell to a character's sheet (own hero, or any if DM) ── */
  function addToCharacter(sp) {
    const editable = chars.filter((c) => isDM || String(c.owner_email || "").toLowerCase() === myEmail);
    if (!editable.length) {
      toast(isDM ? "No characters in this campaign yet." : "You don't have a character here yet — build one first.");
      return;
    }
    const modal = openModal(`Add "${sp.name}" to…`, `
      <p class="muted small" style="margin:0 0 10px">It's copied onto the sheet as a custom spell — editable there, and castable on the Battle map.</p>
      <div class="rows" id="pick"></div>`);
    const pick = modal.el.querySelector("#pick");
    pick.innerHTML = editable.map((c, i) =>
      `<button class="btn-ghost" data-i="${i}" style="display:block; width:100%; text-align:left; margin-bottom:6px">
        ${esc(c.name || "Unnamed")}${String(c.owner_email || "").toLowerCase() === myEmail ? " (yours)" : ""}</button>`).join("");
    pick.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => {
      const c = editable[+b.dataset.i];
      modal.close();
      guard(async () => {
        const sheet = migrateCharacter(c.sheet || {});
        sheet.spells ||= {};
        sheet.spells.custom ||= [];
        const cs = toCustomSpell({ ...(sp.data || {}), name: sp.name, level: sp.level, school: sp.school || (sp.data || {}).school });
        if (sheet.spells.custom.some((x) => (x.name || "").toLowerCase() === cs.name.toLowerCase())) {
          toast(`${c.name} already has "${cs.name}"`);
          return;
        }
        sheet.spells.custom.push(cs);
        await characters.save({ id: c.id, name: c.name, sheet }, c.owner_email);
        c.sheet = sheet;
        toast(`Added "${cs.name}" to ${c.name}`);
      });
    }));
  }

  /* ── write / edit form ── */
  function openForm(seed = {}, existing = null) {
    const slot = root.querySelector("#form-slot");
    const s = toCustomSpell(seed);
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center">
        <h3 style="margin:0">${existing ? "Edit spell" : "New spell"}</h3>
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
      </div>
      <form id="sp-form" style="margin-top:10px">
        <div class="row">
          <div class="grow"><label class="field">Name</label><input name="name" required value="${esc(s.name === "New spell" ? "" : s.name)}" placeholder="Frostfire Lance" /></div>
          <div><label class="field">Level</label>
            <select name="level">${Array.from({ length: 10 }, (_, l) => `<option value="${l}" ${l === s.level ? "selected" : ""}>${l === 0 ? "Cantrip" : ordinal(l)}</option>`).join("")}</select></div>
          <div><label class="field">School</label>
            <select name="school">${SCHOOLS.map((k) => `<option value="${k}" ${k === s.school ? "selected" : ""}>${cap(k)}</option>`).join("")}</select></div>
        </div>
        <div class="row" style="margin-top:8px">
          <input type="text" name="time" placeholder="Casting time (1 action)" value="${esc(s.time)}" style="width:170px" />
          <input type="text" name="range" placeholder="Range (60 feet)" value="${esc(s.range)}" style="width:130px" />
          <input type="text" name="components" placeholder="Components (V, S, M)" value="${esc(s.components)}" class="grow" />
        </div>
        <div class="row" style="margin-top:8px">
          <input type="text" name="duration" placeholder="Duration (Instantaneous)" value="${esc(s.duration)}" class="grow" />
          <label class="checkline"><input type="checkbox" name="concentration" ${s.concentration ? "checked" : ""} /> concentration</label>
          <label class="checkline"><input type="checkbox" name="ritual" ${s.ritual ? "checked" : ""} /> ritual</label>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="checkline"><input type="checkbox" name="attack" ${s.attack ? "checked" : ""} /> spell attack</label>
          <div><label class="field">Save</label>
            <select name="save"><option value="">no save</option>${SAVES.filter(Boolean).map((a) => `<option value="${a}" ${a === s.save ? "selected" : ""}>${SAVE_NAMES[a]}</option>`).join("")}</select></div>
          <div><label class="field">Damage / healing dice</label><input name="dmg" placeholder="8d6" value="${esc(s.dmg)}" style="width:120px" /></div>
          <div><label class="field">Damage type</label>
            <select name="dmgType">${DMG_TYPES.map((t) => `<option value="${t}" ${t === s.dmgType ? "selected" : ""}>${t ? cap(t) : "—"}</option>`).join("")}</select></div>
        </div>
        <div class="row" style="margin-top:8px">
          <div><label class="field">Area shape</label>
            <select name="aoe_type">${AOE_TYPES.map((t) => `<option value="${t}" ${t === (s.aoe?.type || "") ? "selected" : ""}>${t ? cap(t) : "— none —"}</option>`).join("")}</select></div>
          <div><label class="field">Area size (ft)</label><input name="aoe_size" type="number" min="0" value="${esc(s.aoe?.size || 0)}" style="width:90px" /></div>
          <p class="muted small" style="flex:1; align-self:flex-end; margin:0">The school, damage type and area drive the Battle-map animation.</p>
        </div>
        <label class="field" style="margin-top:8px">Description</label>
        <textarea name="desc" placeholder="What the spell does…">${esc(s.desc)}</textarea>
        <label class="field" style="margin-top:8px">At Higher Levels <span class="muted small">(optional)</span></label>
        <textarea name="higher" style="min-height:44px" placeholder="When cast using a slot of 4th level or higher…">${esc(s.higher)}</textarea>
        <div class="actions" style="margin-top:12px">
          <button class="btn" type="submit">${existing ? "Save changes" : "Save to spellbook"}</button>
          <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        </div>
      </form>`;

    el.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => render()));
    el.querySelector("#sp-form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const str = (k) => (f.get(k) || "").toString().trim();
      const data = toCustomSpell({
        name: str("name"), level: parseInt(f.get("level"), 10) || 0, school: str("school"),
        time: str("time"), range: str("range"), components: str("components"), duration: str("duration"),
        concentration: !!f.get("concentration"), ritual: !!f.get("ritual"), attack: !!f.get("attack"),
        save: str("save"), dmg: str("dmg"), dmgType: str("dmgType"),
        aoe_type: str("aoe_type"), aoe_size: parseInt(f.get("aoe_size"), 10) || 0,
        desc: str("desc"), higher: str("higher"),
      });
      if (!data.name || data.name === "New spell") { toast("Give the spell a name"); return; }
      guard(async () => {
        await homebrewSpells.save({ id: existing?.id, name: data.name, level: data.level, school: data.school, data });
        toast(existing ? "Spell updated" : "Spell added to the spellbook");
        render();
      });
    };

    slot.replaceChildren(el);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
