// Home — campaign details, written as "sections" the DM can
// add, edit, reorder, and delete right on the page.
import { boot, esc, md, guard, fmtDate, toast } from "../shell.js";
import { sections, notes } from "../db.js";

const ctx = await boot("index.html", "Home");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  await render();

  async function render() {
    const secs = await sections.list();
    let latest = [];
    try { latest = (await notes.list()).filter((n) => !n.is_private).slice(0, 3); } catch {}

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">Campaign Chronicle</h2>
        ${ctx.me.isDM ? '<button class="btn" id="add-sec">+ Add section</button>' : ""}
      </div>
      <div id="sec-list"></div>
      ${latest.length ? `
      <div class="card" style="margin-top:16px">
        <h3 class="section">Fresh ink — latest notes</h3>
        <ul class="log">${latest.map((n) => `<li><a href="./notes.html" style="color:var(--ink)">${esc(n.title)}</a><span class="when">${esc(ctx.nameOf(n.author_email))} · ${fmtDate(n.created_at)}</span></li>`).join("")}</ul>
      </div>` : ""}`;

    const list = root.querySelector("#sec-list");
    if (!secs.length) list.innerHTML = `<div class="empty">No campaign details yet — the DM will inscribe them soon.</div>`;
    secs.forEach((s) => list.appendChild(sectionCard(s)));

    const add = root.querySelector("#add-sec");
    if (add) add.onclick = () => { list.prepend(sectionForm({ sort_order: secs.length + 1 })); add.disabled = true; };
  }

  function sectionCard(s) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <h2 class="section" style="margin:0">${esc(s.title)}</h2>
        ${ctx.me.isDM ? `<span class="row"><button class="btn-ghost b-edit">Edit</button><button class="btn-danger b-del">Delete</button></span>` : ""}
      </div>
      ${md(s.body)}`;
    if (ctx.me.isDM) {
      card.querySelector(".b-edit").onclick = () => card.replaceWith(sectionForm(s));
      card.querySelector(".b-del").onclick = () => {
        if (!confirm(`Delete section "${s.title}"?`)) return;
        guard(async () => { await sections.remove(s.id); render(); });
      };
    }
    return card;
  }

  function sectionForm(s) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <form>
        <label class="field">Section title</label>
        <input type="text" name="title" required value="${esc(s.title || "")}" />
        <label class="field">Order (lower shows first)</label>
        <input type="number" name="sort_order" value="${s.sort_order ?? 0}" style="width:100px" />
        <label class="field">Text — supports **bold**, *italic*, "# " headings, "- " lists</label>
        <textarea name="body" style="min-height:160px">${esc(s.body || "")}</textarea>
        <div class="actions">
          <button class="btn" type="submit">Save</button>
          <button class="btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    card.querySelector("[data-cancel]").onclick = () => render();
    card.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      guard(async () => {
        await sections.save({ id: s.id, title: f.get("title"), body: f.get("body"), sort_order: Number(f.get("sort_order")) || 0 });
        toast("Saved to the chronicle");
        render();
      });
    };
    return card;
  }
}
