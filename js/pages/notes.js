// Notes — anyone in the party can write. A note marked private
// is visible only to its author (enforced by the database's
// Row Level Security, not just hidden by this page).
import { boot, esc, md, guard, fmtDate, toast } from "../shell.js";
import { notes, images } from "../db.js";

const ctx = await boot("notes.html", "Notes");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  let all = [];

  root.innerHTML = `
    <div class="card">
      <details class="fold" style="border-top:none; margin-top:0; padding-top:0">
        <summary style="font-size:15px">🖋️ Write a note</summary>
        <form id="note-form">
          <div class="row">
            <div class="grow"><label class="field">Title</label><input type="text" name="title" required /></div>
            <div><label class="field">Session #</label><input type="number" name="session_number" min="0" style="width:110px" /></div>
          </div>
          <label class="field">Your note — supports **bold**, *italic*, "- " lists</label>
          <textarea name="body" required placeholder="What happened? What did you learn? What must not be forgotten?"></textarea>
          <label class="field">📷 Attach an image (optional — a sketch, a handout, a suspiciously convenient map)</label>
          <input type="file" name="image" accept="image/*" />
          <div class="actions">
            <button class="btn" type="submit">Add to the record</button>
            <label class="checkline"><input type="checkbox" name="is_private" /> 🔒 Private — only I can see it</label>
          </div>
        </form>
      </details>
    </div>
    <div class="row" style="margin:16px 0 10px">
      <input type="text" id="search" class="grow" placeholder="Search notes…" />
    </div>
    <div id="list"></div>`;

  document.getElementById("note-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    guard(async () => {
      const file = f.get("image");
      let image_path = null;
      if (file && file.size) {
        toast("Uploading image…");
        image_path = await images.upload("notes", file);
        if (!image_path) toast("Demo mode can't store images — note saved without it");
      }
      await notes.add({
        title: f.get("title"),
        body: f.get("body"),
        session_number: f.get("session_number") ? Number(f.get("session_number")) : null,
        is_private: f.get("is_private") === "on",
        author_email: ctx.me.email,
        image_path,
      });
      e.target.reset();
      toast("Noted for posterity");
      refresh();
    });
  };
  document.getElementById("search").oninput = () => renderList();

  let urls = {};
  await refresh();

  async function refresh() {
    all = await notes.list();
    urls = await images.urls(all.map((n) => n.image_path));
    renderList();
  }

  function renderList() {
    const term = document.getElementById("search").value.trim().toLowerCase();
    const list = document.getElementById("list");
    const shown = all.filter((n) => !term || (n.title + " " + n.body).toLowerCase().includes(term));
    list.innerHTML = "";
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${term ? "No notes match that search." : "The record is empty. Be the first to write history."}</div>`;
      return;
    }
    shown.forEach((n) => {
      const mine = n.author_email?.toLowerCase() === ctx.me.email;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="note-head">
          <span class="title">${esc(n.title)}</span>
          ${n.session_number != null ? `<span class="pill steel">Session ${esc(n.session_number)}</span>` : ""}
          ${n.is_private ? `<span class="pill mystic">🔒 private</span>` : ""}
          ${(mine || ctx.me.isDM) ? `<span style="margin-left:auto"><button class="btn-danger b-del">Delete</button></span>` : ""}
        </div>
        <p class="byline">${esc(ctx.nameOf(n.author_email))} · ${fmtDate(n.created_at)}</p>
        ${md(n.body)}
        ${n.image_path && urls[n.image_path] ? `<a href="${esc(urls[n.image_path])}" target="_blank" rel="noopener"><img class="note-img" src="${esc(urls[n.image_path])}" alt="attached image" loading="lazy" /></a>` : ""}`;
      const del = card.querySelector(".b-del");
      if (del) del.onclick = () => {
        if (!confirm(`Delete note "${n.title}"?`)) return;
        guard(async () => { await images.remove(n.image_path); await notes.remove(n.id); refresh(); });
      };
      list.appendChild(card);
    });
  }
}
