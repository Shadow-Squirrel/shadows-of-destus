// The Bestiary — custom monsters a DM builds by hand.
// Stat blocks live in `homebrew_monsters` (per campaign); the party
// can read them, only a DM writes. A monster may carry a portrait
// (`art_path` in the private storage bucket) — shown via art.urls.
import { boot, esc, guard, toast } from "../shell.js";
import { homebrewMonsters, art } from "../db.js";
import { openModal } from "./characters/common.js";

const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const ABILS = [["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"]];
const amod = (s) => Math.floor((Number(s || 10) - 10) / 2);
const sgn = (n) => (n >= 0 ? `+${n}` : `${n}`);
const abilLine = (m) => `${Number(m.str ?? 10)} (${sgn(amod(m.str))})`;

const ctx = await boot("monsters.html", "Bestiary");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  const isDM = ctx.me.isDM;
  let list = [];
  let urls = {};

  await render();

  async function render() {
    list = await homebrewMonsters.list();
    try { urls = await art.urls(list.map((m) => m.art_path).filter(Boolean)); }
    catch { urls = {}; }

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">The Bestiary</h2>
        ${isDM ? '<button class="btn" id="new-mon">+ Build a monster</button>' : ""}
      </div>
      ${isDM ? `<p class="muted small" style="margin-top:-6px">Custom monsters you make here can be dropped into any encounter on the Battle map.</p>` : ""}
      <div id="form-slot"></div>
      <div class="grid" id="grid" style="grid-template-columns:repeat(auto-fill, minmax(320px, 1fr))"></div>`;

    const grid = root.querySelector("#grid");
    if (!list.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">The bestiary is empty${isDM ? " — conjure your first monster above." : " — your DM hasn't brewed any custom monsters yet."}</div>`;
    }
    list.forEach((m) => grid.appendChild(card(m)));

    const nb = root.querySelector("#new-mon");
    if (nb) nb.onclick = () => openForm();
  }

  /* ── a monster card in the grid ── */
  function card(m) {
    const d = m.data || {};
    const src = m.art_path ? urls[m.art_path] : null;
    const el = document.createElement("div");
    el.className = "card map-card";
    el.innerHTML = `
      ${src ? `<img src="${esc(src)}" alt="${esc(m.name)}" loading="lazy" style="border-radius:10px; aspect-ratio:4/3; object-fit:cover" />` : ""}
      <div class="row" style="justify-content:space-between; margin-top:${src ? "10px" : "0"}">
        <strong style="font-size:17px">${esc(m.name)}</strong>
        <span class="pill ember">CR ${esc(m.cr || d.cr || "?")}</span>
      </div>
      <p class="muted small" style="margin:6px 0 0">${esc([d.size, d.type].filter(Boolean).join(" "))}${d.alignment ? ` · ${esc(d.alignment)}` : ""}</p>
      <div class="row" style="justify-content:space-between; margin-top:10px">
        <button class="btn-ghost b-view">View</button>
        ${isDM ? `<span class="row" style="gap:6px">
          <button class="btn-ghost b-edit">Edit</button>
          <button class="btn-danger b-del">Remove</button>
        </span>` : ""}
      </div>`;
    el.querySelector(".b-view").onclick = () => viewModal(m);
    if (isDM) {
      el.querySelector(".b-edit").onclick = () => openForm({ ...d, name: m.name, cr: m.cr || d.cr }, m);
      el.querySelector(".b-del").onclick = () => {
        if (!confirm(`Remove "${m.name}" from the bestiary?`)) return;
        guard(async () => { await homebrewMonsters.remove(m.id); render(); });
      };
    }
    return el;
  }

  /* ── rendered stat block (view) ── */
  function statBlockHtml(m) {
    const d = m.data ? { ...m.data, name: m.name, cr: m.cr || m.data.cr } : m;
    const line = (label, val) => val ? `<p style="margin:2px 0"><strong>${esc(label)}</strong> ${esc(String(val))}</p>` : "";
    const abilTable = `
      <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:6px; text-align:center; margin:10px 0; border-block:1px solid rgba(212,165,49,.3); padding:8px 0">
        ${ABILS.map(([k, L]) => `<div><div class="muted" style="font-size:11px">${L}</div><div>${Number(d[k] ?? 10)} (${sgn(amod(d[k]))})</div></div>`).join("")}
      </div>`;
    const section = (title, items) => (items && items.length)
      ? `<h4 style="margin:12px 0 4px; color:var(--gold); border-bottom:1px solid rgba(212,165,49,.3)">${esc(title)}</h4>
         ${items.map((it) => `<p style="margin:5px 0"><strong><em>${esc(it.name)}.</em></strong> ${esc(it.text)}</p>`).join("")}`
      : "";
    return `
      <div style="font-size:14px; line-height:1.5">
        <p class="muted small" style="font-style:italic; margin:0 0 8px">${esc([d.size, d.type].filter(Boolean).join(" "))}${d.alignment ? `, ${esc(d.alignment)}` : ""}</p>
        ${line("Armor Class", d.ac != null ? `${d.ac}${d.ac_note ? ` (${d.ac_note})` : ""}` : "")}
        ${line("Hit Points", d.hp != null ? `${d.hp}${d.hp_dice ? ` (${d.hp_dice})` : ""}` : "")}
        ${line("Speed", d.speed)}
        ${abilTable}
        ${line("Saving Throws", d.saves)}
        ${line("Skills", d.skills)}
        ${line("Damage Resistances", d.damage_resistances)}
        ${line("Damage Immunities", d.damage_immunities)}
        ${line("Condition Immunities", d.condition_immunities)}
        ${line("Senses", d.senses)}
        ${line("Languages", d.languages)}
        ${line("Challenge", d.cr)}
        ${section("Traits", d.traits)}
        ${section("Actions", d.actions)}
        ${section("Reactions", d.reactions)}
        ${section("Legendary Actions", d.legendary)}
      </div>`;
  }

  function viewModal(m) {
    const src = m.art_path ? urls[m.art_path] : null;
    openModal(m.name, `
      ${src ? `<img src="${esc(src)}" alt="${esc(m.name)}" style="width:100%; border-radius:10px; margin-bottom:12px" />` : ""}
      ${statBlockHtml(m)}`);
  }

  /* ── a small repeatable name+text editor for traits/actions/… ── */
  function sectionEditor(label, items) {
    const wrap = document.createElement("div");
    wrap.style.margin = "10px 0";
    wrap.innerHTML = `<label class="field">${esc(label)}</label><div class="rows"></div>
      <button type="button" class="btn-ghost add" style="padding:3px 10px; margin-top:4px">+ Add</button>`;
    const rows = wrap.querySelector(".rows");
    const addRow = (it = { name: "", text: "" }) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex; gap:6px; margin-bottom:6px; align-items:flex-start";
      row.innerHTML = `
        <input class="i-name" placeholder="Name" value="${esc(it.name || "")}" style="width:34%" />
        <textarea class="i-text" placeholder="Description" style="flex:1; min-height:40px">${esc(it.text || "")}</textarea>
        <button type="button" class="btn-ghost rm" title="Remove" style="padding:3px 9px">✕</button>`;
      row.querySelector(".rm").onclick = () => row.remove();
      rows.appendChild(row);
    };
    (items || []).forEach(addRow);
    wrap.querySelector(".add").onclick = () => addRow();
    wrap.get = () => [...rows.children].map((r) => ({
      name: r.querySelector(".i-name").value.trim(),
      text: r.querySelector(".i-text").value.trim(),
    })).filter((x) => x.name || x.text);
    return wrap;
  }

  /* ── the build / edit form ── */
  function openForm(seed = {}, existing = null) {
    const slot = root.querySelector("#form-slot");
    const s = seed || {};
    const num = (v, d = 10) => (v == null || v === "" ? d : v);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center">
        <h3 style="margin:0">${existing ? "Edit monster" : "New monster"}</h3>
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
      </div>
      <form id="mon-form" style="margin-top:10px">
        <div class="row">
          <div class="grow"><label class="field">Name</label><input name="name" required value="${esc(s.name || "")}" /></div>
          <div><label class="field">CR</label><input name="cr" value="${esc(s.cr || "")}" style="width:80px" placeholder="4" /></div>
        </div>
        <div class="row">
          <div><label class="field">Size</label><select name="size">${SIZES.map((z) => `<option ${z === (s.size || "Medium") ? "selected" : ""}>${z}</option>`).join("")}</select></div>
          <div class="grow"><label class="field">Type</label><input name="type" value="${esc(s.type || "")}" placeholder="beast, dragon, fiend…" /></div>
          <div class="grow"><label class="field">Alignment</label><input name="alignment" value="${esc(s.alignment || "")}" placeholder="unaligned" /></div>
        </div>
        <div class="row">
          <div><label class="field">AC</label><input name="ac" type="number" value="${esc(num(s.ac, 12))}" style="width:70px" /></div>
          <div class="grow"><label class="field">AC note</label><input name="ac_note" value="${esc(s.ac_note || "")}" placeholder="natural armor" /></div>
          <div><label class="field">HP</label><input name="hp" type="number" value="${esc(num(s.hp, 10))}" style="width:80px" /></div>
          <div class="grow"><label class="field">HP dice</label><input name="hp_dice" value="${esc(s.hp_dice || "")}" placeholder="2d8+2" /></div>
        </div>
        <label class="field">Speed</label><input name="speed" value="${esc(s.speed || "30 ft.")}" />
        <div class="row" style="margin-top:8px">
          ${ABILS.map(([k, L]) => `<div><label class="field">${L}</label><input name="${k}" type="number" value="${esc(num(s[k], 10))}" style="width:64px" /></div>`).join("")}
        </div>
        <div class="row" style="margin-top:8px">
          <div class="grow"><label class="field">Saving Throws</label><input name="saves" value="${esc(s.saves || "")}" placeholder="Dex +5, Con +7" /></div>
          <div class="grow"><label class="field">Skills</label><input name="skills" value="${esc(s.skills || "")}" placeholder="Perception +4" /></div>
        </div>
        <div class="row" style="margin-top:8px">
          <div class="grow"><label class="field">Damage Resistances</label><input name="damage_resistances" value="${esc(s.damage_resistances || "")}" /></div>
          <div class="grow"><label class="field">Damage Immunities</label><input name="damage_immunities" value="${esc(s.damage_immunities || "")}" /></div>
        </div>
        <div class="row" style="margin-top:8px">
          <div class="grow"><label class="field">Condition Immunities</label><input name="condition_immunities" value="${esc(s.condition_immunities || "")}" /></div>
          <div class="grow"><label class="field">Senses</label><input name="senses" value="${esc(s.senses || "")}" placeholder="darkvision 60 ft." /></div>
          <div class="grow"><label class="field">Languages</label><input name="languages" value="${esc(s.languages || "")}" placeholder="Common" /></div>
        </div>
        <div id="sections"></div>
        <div id="art-preview" style="margin:8px 0"></div>
        <div class="actions" style="margin-top:12px">
          <button class="btn" type="submit">${existing ? "Save changes" : "Save to bestiary"}</button>
          <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        </div>
      </form>`;

    // section editors
    const secWrap = card.querySelector("#sections");
    const secTraits = sectionEditor("Traits", s.traits);
    const secActions = sectionEditor("Actions", s.actions);
    const secReactions = sectionEditor("Reactions", s.reactions);
    const secLegendary = sectionEditor("Legendary Actions", s.legendary);
    [secTraits, secActions, secReactions, secLegendary].forEach((e) => secWrap.appendChild(e));

    // existing portrait (kept as-is on save)
    const artPath = existing?.art_path || null;
    if (artPath && urls[artPath]) {
      card.querySelector("#art-preview").innerHTML = `<label class="field">Portrait</label>
        <img src="${esc(urls[artPath])}" alt="portrait" style="width:100%; max-width:280px; border-radius:10px" />`;
    }

    card.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => render()));
    card.querySelector("#mon-form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const n = (k, d = 0) => { const v = parseInt(f.get(k), 10); return Number.isFinite(v) ? v : d; };
      const str = (k) => (f.get(k) || "").toString().trim();
      const data = {
        size: str("size"), type: str("type"), alignment: str("alignment"),
        ac: n("ac", 10), ac_note: str("ac_note"), hp: n("hp", 1), hp_dice: str("hp_dice"),
        speed: str("speed"),
        str: n("str", 10), dex: n("dex", 10), con: n("con", 10), int: n("int", 10), wis: n("wis", 10), cha: n("cha", 10),
        saves: str("saves"), skills: str("skills"),
        damage_resistances: str("damage_resistances"), damage_immunities: str("damage_immunities"),
        condition_immunities: str("condition_immunities"), senses: str("senses"), languages: str("languages"),
        cr: str("cr"),
        traits: secTraits.get(), actions: secActions.get(),
        reactions: secReactions.get(), legendary: secLegendary.get(),
      };
      guard(async () => {
        await homebrewMonsters.save({ id: existing?.id, name: str("name") || "New monster", cr: str("cr"), data, art_path: artPath });
        toast(existing ? "Monster updated" : "Monster added to the bestiary");
        render();
      });
    };

    slot.replaceChildren(card);
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
