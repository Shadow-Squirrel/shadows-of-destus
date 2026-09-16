// Campaigns — a DM's home base: create tables, switch between them,
// rename or delete the ones you own, and manage each campaign's players.
// Every campaign is walled off from every other (the database enforces it);
// this page is just the controls.
import { boot, esc, guard, toast, fmtDate } from "../shell.js";
import { CONFIG } from "../config.js";
import { campaigns, members, invites } from "../db.js";

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
    // Only accounts allowed to create campaigns (Dungeon Lords) get the
    // button — anyone else would just hit the database's "not allowed"
    // error, so point them at the plans instead. canCreate() stays
    // permissive when the gating RPC isn't deployed yet (pre-migration).
    let canCreate = false;
    try { canCreate = await campaigns.canCreate(); } catch (e) { console.error(e); canCreate = false; }
    const dmName = CONFIG.TIERS?.DM?.name || "Dungeon Lord";
    const dmIcon = CONFIG.TIERS?.DM?.icon || "🔥";
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">Your Campaigns</h2>
        ${canCreate
          ? `<button class="btn" id="new-camp">＋ New campaign</button>`
          : `<a class="btn" href="./pricing.html">${esc(dmIcon)} Become a ${esc(dmName)} to run a table</a>`}
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
        ${c.tagline ? `<p class="muted small" style="margin:2px 0 0; font-style:italic">“${esc(c.tagline)}”</p>` : ""}
        <p class="muted small" style="margin:4px 0 0">${isDM ? "You're the DM" : "You're a player"}${c.created_at ? ` · started ${esc(fmtDate(c.created_at))}` : ""}</p>
        <div class="actions">
          ${isCurrent ? `<button class="btn-ghost" disabled>Current</button>` : `<button class="btn b-switch">Switch to this</button>`}
          ${isDM ? `<button class="btn-ghost b-manage">Manage players</button>` : ""}
          ${isOwner ? `<button class="btn-ghost b-rename">Rename</button><button class="btn-ghost b-tagline">Tagline</button><button class="btn-danger b-del">✕</button>` : ""}
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
      const tg = card.querySelector(".b-tagline");
      if (tg) tg.onclick = () => guard(async () => {
        const t = prompt(`Tagline for “${c.name}” — shown under the app name in the header (blank to clear)`, c.tagline || "");
        if (t === null) return;
        await campaigns.setTagline(c.id, t.trim());
        toast("Tagline saved");
        render();
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

    const newBtn = root.querySelector("#new-camp");
    if (newBtn) newBtn.onclick = () => {
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
        <div id="invite-slot" style="margin-top:14px; border-top:1px solid var(--border-soft); padding-top:12px"></div>
      </div>`;
    manageInvites(slot.querySelector("#invite-slot"), c);
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

  // Shareable invite LINKS for one campaign (DM-only). A link lets someone
  // create an account (or sign in) and join without the DM knowing their
  // email in advance — handy for "send this to the group chat".
  async function manageInvites(slot, c) {
    const linkFor = (token) => `${location.origin}/join.html?invite=${token}`;
    const list = await invites.list(c.id);
    slot.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:baseline">
        <strong>Invite links</strong>
        <button class="btn b-new-invite">＋ New invite link</button>
      </div>
      <p class="muted small" style="margin:4px 0 0">Anyone with a link can join <strong>${esc(c.name)}</strong>
      as a player. Share it, and revoke it any time.</p>
      <div id="invite-list" style="margin-top:10px"></div>`;

    slot.querySelector(".b-new-invite").onclick = () => guard(async () => {
      const inv = await invites.create(c.id);
      if (!inv) { toast("Invite links aren't available yet"); return; }
      toast("Invite link created");
      manageInvites(slot, c);
    });

    const listEl = slot.querySelector("#invite-list");
    if (!list.length) {
      listEl.innerHTML = `<p class="muted small">No invite links yet.</p>`;
      return;
    }
    list.forEach((inv) => {
      const url = linkFor(inv.token);
      const bits = [];
      bits.push(inv.max_uses == null ? `${inv.uses} used` : `${inv.uses}/${inv.max_uses} used`);
      if (inv.expires_at) bits.push(`expires ${esc(fmtDate(inv.expires_at))}`);
      const expired = inv.expires_at && new Date(inv.expires_at) <= new Date();
      const maxed = inv.max_uses != null && inv.uses >= inv.max_uses;
      const dead = inv.revoked || expired || maxed;
      const statusPill = inv.revoked ? `<span class="pill ember">revoked</span>`
        : expired ? `<span class="pill steel">expired</span>`
        : maxed ? `<span class="pill steel">used up</span>`
        : `<span class="pill moss">active</span>`;
      const row = document.createElement("div");
      row.style.cssText = "border-top:1px solid var(--border-soft); padding:10px 0";
      row.innerHTML = `
        <div class="row" style="justify-content:space-between; align-items:baseline">
          <span class="row" style="gap:8px">${statusPill}<span class="muted small">${esc(bits.join(" · "))}</span></span>
          ${inv.revoked ? "" : `<button class="btn-danger b-revoke">Revoke</button>`}
        </div>
        <div class="row" style="margin-top:8px; ${dead ? "opacity:.5" : ""}">
          <input type="text" class="grow invite-link" readonly value="${esc(url)}" />
          <button class="btn-ghost b-copy" ${dead ? "disabled" : ""}>Copy</button>
        </div>`;
      const copy = row.querySelector(".b-copy");
      if (copy) copy.onclick = () => guard(async () => {
        try { await navigator.clipboard.writeText(url); toast("Link copied"); }
        catch { row.querySelector(".invite-link").select(); toast("Press Ctrl/⌘-C to copy"); }
      });
      const rev = row.querySelector(".b-revoke");
      if (rev) rev.onclick = () => guard(async () => {
        if (!confirm("Turn off this invite link? Anyone still holding it won't be able to join.")) return;
        await invites.revoke(inv.id);
        toast("Invite revoked");
        manageInvites(slot, c);
      });
      listEl.appendChild(row);
    });
  }
}
