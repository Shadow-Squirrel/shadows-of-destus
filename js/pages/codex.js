// Codex — the party's shared field guide. Any member can add a
// person, creature, faction, or place they've met, and anyone
// can pin extra intel notes onto an entry.
import { boot, esc, md, guard, fmtDate, toast } from "../shell.js";
import { codex, images } from "../db.js";

const KINDS = [
  ["person", "🧝", "People"],
  ["creature", "🐲", "Creatures"],
  ["faction", "🛡️", "Factions"],
  ["place", "🏰", "Places"],
];
const STATUS = [
  ["ally", "Ally", "moss"],
  ["neutral", "Neutral", "steel"],
  ["unknown", "Unknown", ""],
  ["hostile", "Hostile", "ember"],
  ["deceased", "Deceased", "mystic"],
];
const kindIcon = (k) => (KINDS.find(([key]) => key === k) || ["", "❓"])[1];
const statusPill = (s) => {
  const [, label, cls] = STATUS.find(([key]) => key === s) || ["", s, ""];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};

const ctx = await boot("codex.html", "Codex");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  let filter = "all";
  await render();

  async function render() {
    const [entries, allNotes] = await Promise.all([codex.list(), codex.notes()]);
    const urls = await images.urls(entries.map((e) => e.image_path));
    const notesFor = {};
    allNotes.forEach((n) => (notesFor[n.entry_id] ??= []).push(n));

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">Codex of Encounters</h2>
        <button class="btn" id="new-e">+ Add entry</button>
      </div>
      <div id="new-slot"></div>
      <div class="codex-tabs" id="tabs"></div>
      <div class="grid" id="grid"></div>`;

    const tabs = root.querySelector("#tabs");
    const mkTab = (key, label, count) => {
      const b = document.createElement("button");
      b.className = filter === key ? "btn" : "btn-ghost";
      b.textContent = `${label} · ${count}`;
      b.onclick = () => { filter = key; render(); };
      return b;
    };
    tabs.appendChild(mkTab("all", "All", entries.length));
    for (const [key, icon, label] of KINDS)
      tabs.appendChild(mkTab(key, `${icon} ${label}`, entries.filter((e) => e.kind === key).length));

    const grid = root.querySelector("#grid");
    const shown = entries.filter((e) => filter === "all" || e.kind === filter);
    if (!shown.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Nothing recorded here yet. Met anyone interesting lately?</div>`;
    shown.forEach((e) => grid.appendChild(entryCard(e, notesFor[e.id] || [], urls)));

    root.querySelector("#new-e").onclick = (ev) => {
      root.querySelector("#new-slot").replaceChildren(entryForm({}));
      ev.target.disabled = true;
    };
  }

  function entryCard(e, notes, urls) {
    const mine = e.author_email?.toLowerCase() === ctx.me.email;
    const portrait = e.image_path && urls[e.image_path];
    const card = document.createElement("div");
    card.className = "card entry";
    card.innerHTML = `
      ${portrait ? `<a href="${esc(portrait)}" target="_blank" rel="noopener"><img class="portrait" src="${esc(portrait)}" alt="${esc(e.name)}" loading="lazy" /></a>` : ""}
      <div class="row" style="justify-content:space-between">
        <p class="name">${kindIcon(e.kind)} ${esc(e.name)}</p>
        ${statusPill(e.status)}
      </div>
      ${e.first_met ? `<p class="meta" style="font-style:italic; color:var(--muted); margin:4px 0 0">First met: ${esc(e.first_met)}</p>` : ""}
      <details class="fold">
        <summary>Details & party intel · ${notes.length}</summary>
        ${md(e.description)}
        ${notes.length ? `<ul class="log">${notes.map((n) => `<li>${esc(n.body)}<span class="when">${esc(ctx.nameOf(n.author_email))} · ${fmtDate(n.created_at)}</span>${(n.author_email?.toLowerCase() === ctx.me.email || ctx.me.isDM) ? `<button class="x-note" data-id="${n.id}" title="Remove this pinned intel">✕</button>` : ""}</li>`).join("")}</ul>` : ""}
        <form class="row" style="margin-top:10px">
          <input type="text" class="grow" name="body" placeholder="Add intel anyone should know…" required />
          <button class="btn-ghost">Pin it</button>
        </form>
      </details>
      <div class="row" style="justify-content:space-between; align-items:center; margin-top:10px">
        <p class="byline" style="margin:0">Recorded by ${esc(ctx.nameOf(e.author_email))} · ${fmtDate(e.created_at)}</p>
        ${(mine || ctx.me.isDM) ? `<span class="row" style="gap:6px">
          <button class="btn-ghost b-edit">Edit</button>
          <button class="btn-danger b-del">Delete</button>
        </span>` : ""}
      </div>`;

    card.querySelector("details form").onsubmit = (ev) => {
      ev.preventDefault();
      const body = new FormData(ev.target).get("body");
      guard(async () => { await codex.addNote(e.id, body); toast("Intel pinned"); render(); });
    };
    const edit = card.querySelector(".b-edit");
    if (edit) edit.onclick = () => card.replaceWith(entryForm(e));
    const del = card.querySelector(".b-del");
    if (del) del.onclick = () => {
      if (!confirm(`Delete "${e.name}" and its intel notes?`)) return;
      guard(async () => { await images.remove(e.image_path); await codex.remove(e.id); toast("Struck from the codex"); render(); });
    };
    card.querySelectorAll(".x-note").forEach((b) => {
      b.onclick = () => {
        if (!confirm("Remove this pinned intel?")) return;
        guard(async () => { await codex.removeNote(b.dataset.id); toast("Intel removed"); render(); });
      };
    });
    return card;
  }

  function entryForm(e) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <form>
        <div class="row">
          <div class="grow"><label class="field">Name</label><input type="text" name="name" required value="${esc(e.name || "")}" /></div>
          <div><label class="field">Kind</label>
            <select name="kind">${KINDS.map(([k, icon, l]) => `<option value="${k}" ${k === (e.kind || "person") ? "selected" : ""}>${icon} ${l.slice(0, -1)}</option>`).join("")}</select>
          </div>
          <div><label class="field">Disposition</label>
            <select name="status">${STATUS.map(([k, l]) => `<option value="${k}" ${k === (e.status || "unknown") ? "selected" : ""}>${l}</option>`).join("")}</select>
          </div>
        </div>
        <label class="field">First met (session / place)</label>
        <input type="text" name="first_met" value="${esc(e.first_met || "")}" placeholder="Session 3 — the toll bridge" />
        <label class="field">What we know</label>
        <textarea name="description">${esc(e.description || "")}</textarea>
        <label class="field">📷 Portrait (optional — the face, the beast, the wanted poster)</label>
        ${e.image_path ? `<p class="muted small" style="margin:2px 0 6px">This entry has a portrait — choosing a new file replaces it.</p>` : ""}
        <input type="file" name="portrait" accept="image/*" />
        <div class="actions">
          <button class="btn" type="submit">${e.id ? "Save entry" : "Inscribe in the codex"}</button>
          <button class="btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    card.querySelector("[data-cancel]").onclick = () => render();
    card.querySelector("form").onsubmit = (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      guard(async () => {
        const file = f.get("portrait");
        let image_path = e.image_path || null;
        if (file && file.size) {
          toast("Uploading portrait…");
          const newPath = await images.upload("codex", file);
          if (newPath) image_path = newPath;
          else toast("Demo mode can't store images");
        }
        const fields = { name: f.get("name"), kind: f.get("kind"), status: f.get("status"), first_met: f.get("first_met"), description: f.get("description"), image_path };
        if (e.id) await codex.update(e.id, fields);
        else await codex.add({ ...fields, author_email: ctx.me.email });
        if (e.image_path && image_path !== e.image_path) await images.remove(e.image_path);
        toast(e.id ? "Entry updated" : "Inscribed");
        render();
      });
    };
    return card;
  }
}
