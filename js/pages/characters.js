// ─────────────────────────────────────────────────────────────
//  Characters — build full D&D characters right on the site.
//  This file is the traffic cop: it shows the roster and routes
//  by URL hash to the builder wizard or a character's sheet.
//    (no hash)   → the roster
//    #new        → builder, fresh character
//    #edit/<id>  → builder, editing
//    #c/<id>     → the character sheet
// ─────────────────────────────────────────────────────────────
import { boot, esc, guard, toast, fmtDate } from "../shell.js";
import { characters as store } from "../db.js";
import { newCharacter, migrateCharacter } from "../dnd/model.js";
import { derive } from "../dnd/rules.js";
import { createRollStage } from "../roll-fx.js";

const ctx = await boot("characters.html", "Characters");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  const rollFx = createRollStage(ctx.nameOf);

  // parked local sheets move into the database once it's ready
  if (store.mode() === "real") {
    guard(async () => {
      const moved = await store.migrateLocal();
      if (moved) toast(`${moved} locally-saved character${moved > 1 ? "s" : ""} moved into the party vault`);
    });
  }

  const route = () => guard(async () => {
    const h = location.hash || "";
    if (h === "#new" || h.startsWith("#edit/")) {
      const { renderBuilder } = await import("./characters/builder.js");
      let existing = null;
      let char = newCharacter();
      if (h.startsWith("#edit/")) {
        existing = (await store.list()).find((r) => r.id === h.slice(6));
        if (!existing) { toast("Character not found"); location.hash = ""; return; }
        char = migrateCharacter(existing.sheet);
      }
      renderBuilder(root, ctx, {
        char,
        existing,
        onSave: async (c) => {
          const row = await store.save({ id: existing?.id, name: c.name || "Unnamed hero", sheet: c }, ctx.me.email);
          toast(existing ? "Character updated" : `${c.name || "Your hero"} joins the tale`);
          location.hash = "#c/" + row.id;
        },
        onCancel: () => { location.hash = existing ? "#c/" + existing.id : ""; },
      });
    } else if (h.startsWith("#c/")) {
      const rows = await store.list();
      const row = rows.find((r) => r.id === h.slice(3));
      if (!row) { toast("Character not found"); location.hash = ""; return; }
      const { renderSheet } = await import("./characters/sheet.js");
      const mine = row.owner_email?.toLowerCase() === ctx.me.email;
      renderSheet(root, ctx, {
        row,
        char: migrateCharacter(row.sheet),
        mine,
        canEdit: mine || ctx.me.isDM,
        rollFx,
        onEdit: () => { location.hash = "#edit/" + row.id; },
        onDelete: async () => {
          await store.remove(row.id);
          toast("Character removed");
          location.hash = "";
        },
        // trackers (HP, slots, prepared spells…) save without a rebuild
        onSaveSheet: async (c) => {
          await store.save({ id: row.id, name: c.name || row.name, sheet: c }, ctx.me.email);
        },
      });
    } else {
      await renderList();
    }
    window.scrollTo(0, 0);
  });

  window.addEventListener("hashchange", route);
  await route();

  /* ── the roster ── */
  async function renderList() {
    const rows = await store.list();
    const mode = store.mode();
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">Heroes of the Table</h2>
        <a class="btn" style="text-decoration:none" href="#new">⚒ Forge a character</a>
      </div>
      ${mode === "local" ? `
        <div class="banner" style="margin:0 0 14px; max-width:none">
          🗄️ <strong>Saved on this device for now.</strong> The characters table hasn't been
          added to the database yet — sheets are parked in this browser and will move to the
          party vault automatically once the DM applies the latest migration
          (<code>supabase/migrations/…_characters.sql</code>).
        </div>` : ""}
      <p class="muted small" style="margin-top:-6px">Full character sheets, built and rolled right here —
      race, class, spells and all. Sheets are visible to the whole party; only you (and the DM) can edit yours.</p>
      <div class="grid" id="char-grid"></div>
      <p class="srd-note">Game content from the <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">SRD 5.1 (CC-BY-4.0)</a>.
      Using material from other books you own? Add it with the <em>custom</em> options in the builder —
      look things up on <a href="https://www.dndbeyond.com/sources" target="_blank" rel="noopener">D&D Beyond</a> or the free
      <a href="https://open5e.com" target="_blank" rel="noopener">Open5e</a> reference.</p>`;

    const grid = root.querySelector("#char-grid");
    if (!rows.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No heroes yet. Forge the first one.</div>`;
      return;
    }
    rows.forEach((row) => {
      const c = migrateCharacter(row.sheet);
      let d = null;
      try { d = derive(c); } catch (e) { console.error(e); }
      const mine = row.owner_email?.toLowerCase() === ctx.me.email;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="row" style="justify-content:space-between; align-items:baseline">
          <h3 class="char-name">${esc(row.name || "Unnamed hero")}</h3>
          <span class="pill gold">Level ${d ? d.level : c.level}</span>
        </div>
        <div class="char-sub">${esc(d ? `${d.raceName} ${d.className}${d.subclassName ? ` (${d.subclassName})` : ""}` : "")}</div>
        <p class="muted small" style="margin:4px 0 0">
          played by ${esc(ctx.nameOf(row.owner_email))}${row.updated_at ? ` · updated ${esc(fmtDate(row.updated_at))}` : ""}
        </p>
        ${d ? `
        <div class="char-mini">
          <span>AC <strong>${d.ac.value}</strong></span>
          <span>HP <strong>${c.hp.current ?? d.hp.max}/${d.hp.max}</strong></span>
          <span>PP <strong>${d.passivePerception}</strong></span>
          ${d.spellcasting ? `<span>DC <strong>${d.spellcasting.dc}</strong></span>` : ""}
        </div>` : ""}
        <div class="actions">
          <a class="btn" style="text-decoration:none" href="#c/${esc(row.id)}">Open sheet</a>
          ${mine || ctx.me.isDM ? `<a class="btn-ghost" style="text-decoration:none" href="#edit/${esc(row.id)}">Edit</a>` : ""}
          ${mine || ctx.me.isDM ? `<button class="btn-danger b-del">✕</button>` : ""}
        </div>`;
      const del = card.querySelector(".b-del");
      if (del) del.onclick = () => {
        if (!confirm(`Remove ${row.name} forever? There is no resurrection spell for this.`)) return;
        guard(async () => { await store.remove(row.id); renderList(); });
      };
      grid.appendChild(card);
    });
  }
}
