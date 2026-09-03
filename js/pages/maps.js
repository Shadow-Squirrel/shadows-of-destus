// Maps — the atlas. Map images live in this repo's maps/ folder
// (or any URL); the DM adds a card pointing at each one.
// Click a map to open it full-size in a new tab.
import { boot, esc, guard, fmtDate, toast } from "../shell.js";
import { maps } from "../db.js";

const CATS = [
  ["world", "World", "gold"],
  ["region", "Region", "moss"],
  ["city", "City / Town", "steel"],
  ["battle", "Battle map", "ember"],
  ["other", "Other", ""],
];
const catPill = (c) => {
  const [, label, cls] = CATS.find(([key]) => key === c) || ["", c, ""];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};

const ctx = await boot("maps.html", "Maps");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  await render();

  async function render() {
    const list = await maps.list();
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">The Atlas</h2>
        ${ctx.me.isDM ? '<button class="btn" id="new-m">+ Add map</button>' : ""}
      </div>
      <div id="new-slot"></div>
      <div class="grid" id="grid" style="grid-template-columns:repeat(auto-fill, minmax(340px, 1fr))"></div>`;

    const grid = root.querySelector("#grid");
    if (!list.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No maps yet — the world is still unmapped.</div>`;
    list.forEach((m) => grid.appendChild(mapCard(m)));

    const nb = root.querySelector("#new-m");
    if (nb) nb.onclick = () => { root.querySelector("#new-slot").replaceChildren(mapForm()); nb.disabled = true; };
  }

  function mapCard(m) {
    const card = document.createElement("div");
    card.className = "card map-card";
    card.innerHTML = `
      ${m.image_url
        ? `<a href="${esc(m.image_url)}" target="_blank" rel="noopener"><img src="${esc(m.image_url)}" alt="${esc(m.title)}" loading="lazy" /></a>`
        : `<div class="map-ph">map image coming soon…</div>`}
      <div class="row" style="justify-content:space-between; margin-top:10px">
        <strong style="font-size:17px">${esc(m.title)}</strong>
        ${catPill(m.category)}
      </div>
      ${m.description ? `<p class="muted small" style="margin:6px 0 0">${esc(m.description)}</p>` : ""}
      <p class="byline">Added ${fmtDate(m.created_at)}${ctx.me.isDM ? ' · <button class="btn-danger b-del">Remove</button>' : ""}</p>`;
    const del = card.querySelector(".b-del");
    if (del) del.onclick = () => {
      if (!confirm(`Remove map "${m.title}"? (The image file itself is not deleted.)`)) return;
      guard(async () => { await maps.remove(m.id); render(); });
    };
    return card;
  }

  function mapForm() {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <form>
        <div class="row">
          <div class="grow"><label class="field">Title</label><input type="text" name="title" required /></div>
          <div><label class="field">Category</label>
            <select name="category">${CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
          </div>
        </div>
        <label class="field">Image location</label>
        <input type="text" name="image_url" placeholder="maps/emberfall-region.jpg  (a file in this repo's maps folder, or any https:// link)" />
        <label class="field">Description</label>
        <input type="text" name="description" placeholder="What is this a map of? Any spoilers players shouldn't see stay OFF the site." />
        <div class="actions">
          <button class="btn" type="submit">Add to the atlas</button>
          <button class="btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    card.querySelector("[data-cancel]").onclick = () => render();
    card.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      guard(async () => {
        await maps.add({ title: f.get("title"), category: f.get("category"), image_url: f.get("image_url"), description: f.get("description") });
        toast("Map added");
        render();
      });
    };
    return card;
  }
}
