// Campaigns — a DM's home base: create tables, switch between them,
// rename or delete the ones you own, and manage each campaign's players.
// Every campaign is walled off from every other (the database enforces it);
// this page is just the controls.
import { boot, esc, guard, toast, fmtDate } from "../shell.js";
import { campaigns, members } from "../db.js";

const CAMP_KEY = "sod-campaign";
const remember = (id) => { try { localStorage.setItem(CAMP_KEY, id); } catch {} };

const ctx = await boot("campaigns.html", "Campaigns");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  await render();

  async function render() {
    if (ctx.legacy) {
      root.innerHTML = `<div class="card"><h2 class="section">Multiple campaigns</h2>
        <p class="muted">This site hasn't had the multi-campaign database update applied yet, so it's
        running as a single campaign. Once the DM applies <code>supabase/apply-new-features.sql</code>
        (see <code>docs/NEW-FEATURES.md</code>), this page lets you create and manage several campaigns,
        each walled off from the others.</p></div>`;
      return;
    }
    const mine = ctx.campaigns || (await campaigns.mine(ctx.me.email));
    const currentId = ctx.campaign?.id;
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">Your Campaigns</h2>
        <button class="btn" id="new-camp">＋ New campaign</button>
      </div>
      <p class="muted small" style="margin-top:-6px">Each campaign is its own private world — its maps, quests,
      notes, battle maps and dice are visible only to the people you invite to it. Players you add to one
      campaign can't see anything in another.</p>
      <div id="new-slot"></div>
      <div class="grid" id="camp-grid"></div>
      <div id="manage-slot" style="margin-top:26px"></div>`;

    const grid = root.querySelector("#camp-grid");
    if (!mine.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No campaigns yet. Create your first.</div>`;
    mine.forEach((c) => {
      const isOwner = c.owner_email?.toLowerCase() === ctx.me.email;
      const isDM = c.myRole === "dm" || isOwner;
      const isCurrent = c.id === currentId;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="row" style="justify-content:space-between; align-items:baseline">
          <h3 class="char-name" style="margin:0">${esc(c.name)}</h3>
          ${isCurrent ? `<span class="pill gold">viewing now</span>` : ""}
        </div>
        <p class="muted small" style="margin:4px 0 0">${isDM ? "You're the DM" : "You're a player"}${c.created_at ? ` · started ${esc(fmtDate(c.created_at))}` : ""}</p>
        <div class="actions">
          ${isCurrent ? `<button class="btn-ghost" disabled>Current</button>` : `<button class="btn b-switch">Switch to this</button>`}
          ${isDM ? `<button class="btn-ghost b-manage">Manage players</button>` : ""}
          ${isOwner ? `<button class="btn-ghost b-rename">Rename</button><button class="btn-danger b-del">✕</button>` : ""}
        </div>
        <div class="manage-here"></div>`;
      const sw = card.querySelector(".b-switch");
      if (sw) sw.onclick = () => { remember(c.id); location.reload(); };
      const mg = card.querySelector(".b-manage");
      if (mg) mg.onclick = () => manageMembers(card.querySelector(".manage-here"), c);
      const rn = card.querySelector(".b-rename");
      if (rn) rn.onclick = () => guard(async () => {
        const name = prompt("Rename campaign", c.name);
        if (name && name.trim()) { await campaigns.rename(c.id, name.trim()); toast("Renamed"); render(); }
      });
      const dl = card.querySelector(".b-del");
      if (dl) dl.onclick = () => guard(async () => {
        if (!confirm(`Delete "${c.name}" and ALL its content (maps, quests, notes, battles)? This cannot be undone.`)) return;
        await campaigns.remove(c.id);
        if (c.id === currentId) { try { localStorage.removeItem(CAMP_KEY); } catch {} }
        toast("Campaign deleted");
        location.reload();
      });
      grid.appendChild(card);
    });

    root.querySelector("#new-camp").onclick = () => {
      const slot = root.querySelector("#new-slot");
      slot.innerHTML = `
        <div class="card">
          <label class="field">Campaign name</label>
          <input type="text" id="nc-name" placeholder="e.g. Curse of the Ember Crown" />
          <div class="actions">
            <button class="btn" id="nc-go">Create</button>
            <button class="btn-ghost" id="nc-cancel">Cancel</button>
          </div>
        </div>`;
      slot.querySelector("#nc-cancel").onclick = () => (slot.innerHTML = "");
      slot.querySelector("#nc-go").onclick = () => guard(async () => {
        const name = slot.querySelector("#nc-name").value.trim() || "New Campaign";
        const c = await campaigns.create(name);
        toast(`"${name}" created — switching you in`);
        if (c?.id) remember(c.id);
        location.reload();
      });
    };
  }

  // Manage the roster of ONE campaign (only shown for campaigns you DM).
  // Note: the members store is scoped to the CURRENTLY-VIEWED campaign, so
  // roster management applies to the campaign you're currently in. For a
  // campaign you're not viewing, switch to it first.
  async function manageMembers(slot, c) {
    if (c.id !== ctx.campaign?.id) {
      slot.innerHTML = `<p class="muted small" style="margin-top:10px">Switch to <strong>${esc(c.name)}</strong> first to manage its players.</p>`;
      return;
    }
    const list = await members.list();
    slot.innerHTML = `
      <div style="margin-top:12px; border-top:1px solid var(--border-soft); padding-top:12px">
        <div id="m-list"></div>
        <form class="row" style="margin-top:10px">
          <input type="email" class="grow" name="email" placeholder="player@email.com" required />
          <input type="text" class="grow" name="display_name" placeholder="Name shown on notes" required />
          <select name="role" style="width:auto"><option value="player">player</option><option value="dm">co-DM</option></select>
          <button class="btn">Invite</button>
        </form>
        <p class="muted small">They visit the site and <strong>Create account</strong> with that exact email.
        Remove them here and their access to this campaign ends immediately.</p>
      </div>`;
    const mList = slot.querySelector("#m-list");
    list.forEach((m) => {
      const isSelf = m.email.toLowerCase() === ctx.me.email;
      const row = document.createElement("div");
      row.className = "row";
      row.style.cssText = "justify-content:space-between; border-top:1px solid var(--border-soft); padding:8px 0";
      row.innerHTML = `
        <span><strong>${esc(m.display_name || "—")}</strong> <span class="muted small">${esc(m.email)}</span></span>
        <span class="row">
          <span class="pill ${m.role === "dm" ? "gold" : "steel"}">${esc(m.role)}</span>
          ${isSelf ? "" : `<button class="btn-danger b-del">Remove</button>`}
        </span>`;
      const del = row.querySelector(".b-del");
      if (del) del.onclick = () => guard(async () => {
        if (!confirm(`Remove ${m.email} from ${c.name}?`)) return;
        await members.remove(m.id); manageMembers(slot, c);
      });
      mList.appendChild(row);
    });
    slot.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      guard(async () => {
        await members.add(f.get("email"), f.get("display_name"), f.get("role"));
        toast("Invited");
        manageMembers(slot, c);
      });
    };
  }
}
