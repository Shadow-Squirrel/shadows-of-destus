// Party — the roster. Character sheets stay on D&D Beyond
// (there's no official public API, and embedding is blocked),
// so each card links straight to the sheet. This page is also
// where the DM manages the invite list.
import { boot, esc, guard, toast } from "../shell.js";
import { party, members } from "../db.js";

const ctx = await boot("party.html", "Party");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  await render();

  async function render() {
    const chars = await party.list();
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">The Party</h2>
        ${ctx.me.isDM ? '<button class="btn" id="new-c">+ Add character</button>' : ""}
      </div>
      <p class="muted small" style="margin-top:-6px">Sheets and stats live on <strong>D&D Beyond</strong> — each card links straight to one.
      (Tip: on D&D Beyond, set the character's privacy to <em>Public</em> so the whole table can open it.)</p>
      <div id="new-slot"></div>
      <div class="grid" id="grid"></div>
      ${ctx.me.isDM ? `<div id="roster-slot" style="margin-top:26px"></div>` : ""}`;

    const grid = root.querySelector("#grid");
    if (!chars.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No heroes enlisted yet.</div>`;
    chars.forEach((c) => grid.appendChild(charCard(c)));

    const nb = root.querySelector("#new-c");
    if (nb) nb.onclick = () => { root.querySelector("#new-slot").replaceChildren(charForm()); nb.disabled = true; };

    if (ctx.me.isDM) renderRoster();
  }

  function charCard(c) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <strong style="font-size:19px">${esc(c.character_name)}</strong>
        ${c.class_text ? `<span class="pill gold">${esc(c.class_text)}</span>` : ""}
      </div>
      ${c.player_name ? `<p class="muted small" style="margin:4px 0 0">played by ${esc(c.player_name)}</p>` : ""}
      ${c.blurb ? `<p style="margin:10px 0 0">${esc(c.blurb)}</p>` : ""}
      <div class="actions">
        ${c.ddb_url ? `<a class="btn" style="text-decoration:none" href="${esc(c.ddb_url)}" target="_blank" rel="noopener">Open sheet ↗</a>` : `<span class="muted small">No sheet linked yet</span>`}
        ${ctx.me.isDM ? `<button class="btn-danger b-del">Remove</button>` : ""}
      </div>`;
    const del = card.querySelector(".b-del");
    if (del) del.onclick = () => {
      if (!confirm(`Remove ${c.character_name} from the roster?`)) return;
      guard(async () => { await party.remove(c.id); render(); });
    };
    return card;
  }

  function charForm() {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <form>
        <div class="row">
          <div class="grow"><label class="field">Character name</label><input type="text" name="character_name" required /></div>
          <div class="grow"><label class="field">Player</label><input type="text" name="player_name" /></div>
          <div class="grow"><label class="field">Class & level</label><input type="text" name="class_text" placeholder="Half-orc Barbarian 4" /></div>
        </div>
        <label class="field">D&D Beyond sheet link</label>
        <input type="text" name="ddb_url" placeholder="https://www.dndbeyond.com/characters/12345678" />
        <label class="field">One-line legend</label>
        <input type="text" name="blurb" placeholder="Has never met a lock she respected." />
        <div class="actions">
          <button class="btn" type="submit">Enlist</button>
          <button class="btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    card.querySelector("[data-cancel]").onclick = () => render();
    card.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      guard(async () => {
        await party.add({ character_name: f.get("character_name"), player_name: f.get("player_name"), class_text: f.get("class_text"), ddb_url: f.get("ddb_url"), blurb: f.get("blurb") });
        toast("Welcomed to the party");
        render();
      });
    };
    return card;
  }

  /* ── DM only: the invite list ── */
  async function renderRoster() {
    const slot = root.querySelector("#roster-slot");
    const list = await members.list();
    slot.innerHTML = `
      <div class="card">
        <h3 class="section">🗝️ Invite players <span class="pill gold">DM only</span></h3>
        <p class="muted small">Add a player's email here, then have them visit the site and
        <strong>Create account</strong> with that exact email. Until an email is on this list,
        an account for it sees nothing at all.</p>
        <div id="m-list"></div>
        <form class="row" style="margin-top:12px">
          <input type="email" class="grow" name="email" placeholder="player@email.com" required />
          <input type="text" class="grow" name="display_name" placeholder="Name shown on notes" required />
          <select name="role" style="width:auto"><option value="player">player</option><option value="dm">dm</option></select>
          <button class="btn">Invite</button>
        </form>
      </div>`;
    const mList = slot.querySelector("#m-list");
    list.forEach((m) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.cssText = "justify-content:space-between; border-top:1px solid var(--border-soft); padding:8px 0";
      const isSelf = m.email.toLowerCase() === ctx.me.email;
      row.innerHTML = `
        <span><strong>${esc(m.display_name || "—")}</strong> <span class="muted small">${esc(m.email)}</span></span>
        <span class="row">
          <span class="pill ${m.role === "dm" ? "gold" : "steel"}">${esc(m.role)}</span>
          ${isSelf ? "" : `<button class="btn-danger b-del">Remove</button>`}
        </span>`;
      const del = row.querySelector(".b-del");
      if (del) del.onclick = () => {
        if (!confirm(`Remove ${m.email} from the party? They'll lose access immediately.`)) return;
        guard(async () => { await members.remove(m.id); render(); });
      };
      mList.appendChild(row);
    });
    slot.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      guard(async () => {
        await members.add(f.get("email"), f.get("display_name"), f.get("role"));
        toast("Invited — tell them to create their account");
        render();
      });
    };
  }
}
