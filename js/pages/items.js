// The Armory — a campaign's shared homebrew magic items and gear.
// Items live in `homebrew_items` (per campaign); the party reads,
// only a DM writes. An item authored here can be handed to any
// character, where it lands in that sheet's inventory carrying its
// full details. AI drafting shares the `generate-homebrew` Edge
// Function (kind: item) and the AI *text* bill cap with spells/monsters.
import { boot, esc, md, guard, toast } from "../shell.js";
import { homebrewItems, characters, ai, getCampaign, isReal } from "../db.js";
import { openModal } from "./characters/common.js";
import { migrateCharacter } from "../dnd/model.js";

const TYPES = ["weapon", "armor", "shield", "potion", "scroll", "wand", "rod", "staff", "ring", "wondrous", "gear"];
const RARITIES = ["common", "uncommon", "rare", "very rare", "legendary", "artifact"];
const RARITY_PILL = { common: "", uncommon: "moss", rare: "steel", "very rare": "mystic", legendary: "gold", artifact: "ember" };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Normalize an AI draft / stored blob into the canonical item shape.
function toItem(raw = {}) {
  const r = raw || {};
  const type = String(r.type || "").trim().toLowerCase();
  const rarity = String(r.rarity || "").trim().toLowerCase();
  return {
    name: String(r.name || "").trim() || "New item",
    type: TYPES.includes(type) ? type : (type || "wondrous"),
    rarity: RARITIES.includes(rarity) ? rarity : (rarity || "common"),
    attunement: !!r.attunement,
    attunement_note: String(r.attunement_note || "").trim(),
    props: String(r.props || "").trim(),
    charges: String(r.charges || "").trim(),
    weight: String(r.weight || "").trim(),
    cost: String(r.cost || "").trim(),
    desc: String(r.desc || "").trim(),
  };
}

const subtitle = (it) => {
  const bits = [cap(it.type)];
  if (it.rarity) bits.push(it.rarity);
  if (it.attunement) bits.push(`requires attunement${it.attunement_note ? ` ${it.attunement_note}` : ""}`);
  return bits.filter(Boolean).join(", ");
};

const ctx = await boot("items.html", "Armory");
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
      homebrewItems.list(),
      characters.list().catch(() => []),
    ]);

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">The Armory</h2>
        ${isDM ? '<button class="btn" id="new-it">+ Forge an item</button>' : ""}
      </div>
      <p class="muted small" style="margin-top:-6px">Homebrew magic items & gear for this campaign. Hand one to a
        character and it drops straight into their inventory with all its details.${isDM ? "" : " Your DM curates this hoard."}</p>
      ${isDM ? `<div id="ai-slot"></div>` : ""}
      <div id="form-slot"></div>
      <div class="grid" id="grid" style="grid-template-columns:repeat(auto-fill, minmax(300px, 1fr))"></div>`;

    const grid = root.querySelector("#grid");
    const order = (r) => RARITIES.indexOf(r.rarity) < 0 ? 99 : RARITIES.indexOf(r.rarity);
    const sorted = [...list].sort((a, b) => order(a.data || a) - order(b.data || b) || String(a.name).localeCompare(String(b.name)));
    if (!sorted.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">The armory is bare${isDM ? " — forge your first item above." : " — your DM hasn't stocked any homebrew items yet."}</div>`;
    }
    sorted.forEach((it) => grid.appendChild(card(it)));

    const nb = root.querySelector("#new-it");
    if (nb) nb.onclick = () => openForm();
    if (isDM) renderAi();
  }

  /* ── ✨ Forge an item with AI (DM only) ── */
  async function renderAi() {
    const slot = root.querySelector("#ai-slot");
    if (!slot || !isReal()) return;

    let usage = null;
    try { usage = await ai.textUsage(); } catch { usage = null; }

    if (!usage) {
      slot.innerHTML = `
        <div class="card ai-card">
          <div class="row" style="justify-content:space-between; align-items:center">
            <strong>✨ Forge an item with AI</strong>
            <span class="pill mystic">not set up</span>
          </div>
          <p class="muted small" style="margin:6px 0 0">AI drafting isn't set up yet. Deploy the
            <code>generate-homebrew</code> function and set a provider key — see <code>docs/AI-HOMEBREW.md</code>.
            You can still forge items by hand.</p>
        </div>`;
      return;
    }

    const left = usage.remaining ?? 0;
    slot.innerHTML = `
      <div class="card ai-card">
        <div class="row" style="justify-content:space-between; align-items:center">
          <strong>✨ Forge an item with AI</strong>
          <span class="pill ${left > 0 ? "moss" : "ember"}" title="Shared with spells & monsters · resets monthly">${left} of ${usage.cap ?? "?"} left this month</span>
        </div>
        <p class="muted small" style="margin:6px 0 8px">Describe it and the AI drafts a balanced magic item for you to review and edit. Failed drafts don't count against your quota.</p>
        <textarea id="ai-prompt" style="min-height:56px" placeholder="e.g. an uncommon dagger that whispers warnings, +1, once a day cast fog cloud"></textarea>
        <div class="actions">
          <button class="btn" id="ai-go" ${left > 0 ? "" : "disabled"}>${left > 0 ? "✨ Forge item" : "Monthly limit reached"}</button>
          <span class="muted small" id="ai-msg"></span>
        </div>
      </div>`;

    slot.querySelector("#ai-go").onclick = () => {
      const prompt = slot.querySelector("#ai-prompt").value.trim();
      if (!prompt) { toast("Describe the item first"); return; }
      const go = slot.querySelector("#ai-go");
      go.disabled = true;
      slot.querySelector("#ai-msg").textContent = "Consulting the artificers… (a few seconds)";
      guard(async () => {
        try {
          const draft = await ai.generateHomebrew({ campaignId: getCampaign(), kind: "item", prompt });
          if (!draft) throw new Error("No item came back");
          openForm(toItem(draft));
          toast("Draft ready — review it, then Save to the armory");
        } catch (e) {
          if (e.code === "not-configured") { renderAi(); toast("AI drafting isn't set up yet — see docs/AI-HOMEBREW.md"); return; }
          go.disabled = false;
          slot.querySelector("#ai-msg").textContent = "";
          toast("⚠ " + (e.message || "Drafting failed"));
        }
      });
    };
  }

  /* ── an item card ── */
  function card(it) {
    const d = toItem({ ...(it.data || {}), name: it.name, type: it.type || (it.data || {}).type, rarity: it.rarity || (it.data || {}).rarity });
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:baseline; gap:8px">
        <strong style="font-size:17px">${esc(it.name)}</strong>
        <span class="pill ${RARITY_PILL[d.rarity] || ""}">${esc(d.rarity || "—")}</span>
      </div>
      <p class="muted small" style="margin:6px 0 0; font-style:italic">${esc(subtitle(d))}</p>
      ${d.props ? `<p class="muted small" style="margin:6px 0 0">${esc(d.props)}</p>` : ""}
      <div class="row" style="justify-content:space-between; margin-top:12px; gap:6px">
        <span class="row" style="gap:6px">
          <button class="btn-ghost b-view">View</button>
          <button class="btn-ghost b-give">+ Give to hero</button>
        </span>
        ${isDM ? `<span class="row" style="gap:6px">
          <button class="btn-ghost b-edit">Edit</button>
          <button class="btn-danger b-del">✕</button>
        </span>` : ""}
      </div>`;
    el.querySelector(".b-view").onclick = () => viewModal(it);
    el.querySelector(".b-give").onclick = () => giveToCharacter(it);
    if (isDM) {
      el.querySelector(".b-edit").onclick = () => openForm({ ...(it.data || {}), name: it.name, type: it.type, rarity: it.rarity }, it);
      el.querySelector(".b-del").onclick = () => {
        if (!confirm(`Remove "${it.name}" from the armory?`)) return;
        guard(async () => { await homebrewItems.remove(it.id); render(); });
      };
    }
    return el;
  }

  /* ── full item details (view) ── */
  function detailsHtml(it) {
    const d = toItem({ ...(it.data || {}), name: it.name, type: it.type, rarity: it.rarity });
    const line = (label, val) => val ? `<p style="margin:3px 0"><strong>${esc(label)}</strong> ${esc(String(val))}</p>` : "";
    return `
      <div style="font-size:14px; line-height:1.55">
        <p class="muted small" style="font-style:italic; margin:0 0 8px">${esc(subtitle(d))}</p>
        ${line("Properties", d.props)}
        ${line("Charges", d.charges)}
        ${line("Weight", d.weight)}
        ${line("Value", d.cost)}
        ${d.desc ? `<div style="margin-top:8px">${md(d.desc)}</div>` : ""}
      </div>`;
  }
  function viewModal(it) { openModal(it.name, detailsHtml(it)); }

  /* ── hand an item to a character (own hero, or any if DM) ── */
  function giveToCharacter(it) {
    const editable = chars.filter((c) => isDM || String(c.owner_email || "").toLowerCase() === myEmail);
    if (!editable.length) {
      toast(isDM ? "No characters in this campaign yet." : "You don't have a character here yet — build one first.");
      return;
    }
    const modal = openModal(`Give "${it.name}" to…`, `
      <p class="muted small" style="margin:0 0 10px">It drops into the sheet's inventory with its full details.</p>
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
        sheet.equipment ||= [];
        const d = toItem({ ...(it.data || {}), name: it.name, type: it.type, rarity: it.rarity });
        sheet.equipment.push({ kind: "custom", item: null, name: d.name, qty: 1, hb: d });
        await characters.save({ id: c.id, name: c.name, sheet }, c.owner_email);
        c.sheet = sheet;
        toast(`Gave "${d.name}" to ${c.name}`);
      });
    }));
  }

  /* ── forge / edit form ── */
  function openForm(seed = {}, existing = null) {
    const slot = root.querySelector("#form-slot");
    const s = toItem(seed);
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center">
        <h3 style="margin:0">${existing ? "Edit item" : "New item"}</h3>
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
      </div>
      <form id="it-form" style="margin-top:10px">
        <div class="row">
          <div class="grow"><label class="field">Name</label><input name="name" required value="${esc(s.name === "New item" ? "" : s.name)}" placeholder="Whisperfang Dagger" /></div>
          <div><label class="field">Type</label>
            <select name="type">${TYPES.map((t) => `<option value="${t}" ${t === s.type ? "selected" : ""}>${cap(t)}</option>`).join("")}</select></div>
          <div><label class="field">Rarity</label>
            <select name="rarity">${RARITIES.map((r) => `<option value="${r}" ${r === s.rarity ? "selected" : ""}>${cap(r)}</option>`).join("")}</select></div>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="checkline"><input type="checkbox" name="attunement" ${s.attunement ? "checked" : ""} /> requires attunement</label>
          <input type="text" name="attunement_note" placeholder="…by a spellcaster (optional)" value="${esc(s.attunement_note)}" class="grow" />
        </div>
        <label class="field" style="margin-top:8px">Properties <span class="muted small">(the mechanical summary)</span></label>
        <input type="text" name="props" value="${esc(s.props)}" placeholder="+1 to attack and damage; extra 1d6 fire" />
        <div class="row" style="margin-top:8px">
          <div class="grow"><label class="field">Charges</label><input name="charges" value="${esc(s.charges)}" placeholder="3 charges, regains 1d3 at dawn" /></div>
          <div><label class="field">Weight</label><input name="weight" value="${esc(s.weight)}" style="width:100px" placeholder="1 lb." /></div>
          <div><label class="field">Value</label><input name="cost" value="${esc(s.cost)}" style="width:110px" placeholder="500 gp" /></div>
        </div>
        <label class="field" style="margin-top:8px">Description</label>
        <textarea name="desc" placeholder="What the item is and does…">${esc(s.desc)}</textarea>
        <div class="actions" style="margin-top:12px">
          <button class="btn" type="submit">${existing ? "Save changes" : "Save to armory"}</button>
          <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        </div>
      </form>`;

    el.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => render()));
    el.querySelector("#it-form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const str = (k) => (f.get(k) || "").toString().trim();
      const data = toItem({
        name: str("name"), type: str("type"), rarity: str("rarity"),
        attunement: !!f.get("attunement"), attunement_note: str("attunement_note"),
        props: str("props"), charges: str("charges"), weight: str("weight"), cost: str("cost"),
        desc: str("desc"),
      });
      if (!data.name || data.name === "New item") { toast("Give the item a name"); return; }
      guard(async () => {
        await homebrewItems.save({ id: existing?.id, name: data.name, type: data.type, rarity: data.rarity, data });
        toast(existing ? "Item updated" : "Item added to the armory");
        render();
      });
    };

    slot.replaceChildren(el);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
