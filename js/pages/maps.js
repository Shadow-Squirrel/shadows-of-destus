// Maps — the atlas. Images live in a PRIVATE Supabase Storage
// bucket; each map has a `revealed` flag. Players only ever
// receive revealed maps (the database and storage both enforce
// it) — the DM sees everything and flips reveal with one click.
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
    const urls = await maps.signedUrls(list.filter((m) => m.storage_path).map((m) => m.storage_path));

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">The Atlas</h2>
        ${ctx.me.isDM ? '<button class="btn" id="new-m">+ Add map</button>' : ""}
      </div>
      ${ctx.me.isDM ? `<p class="muted small" style="margin-top:-6px">Maps marked 🕯️ are invisible to players until you hit <strong>Reveal</strong>.</p>` : ""}
      <div id="new-slot"></div>
      <div class="grid" id="grid" style="grid-template-columns:repeat(auto-fill, minmax(340px, 1fr))"></div>`;

    const grid = root.querySelector("#grid");
    if (!list.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No maps yet — the world is still unmapped.</div>`;
    list.forEach((m) => grid.appendChild(mapCard(m, urls)));

    const nb = root.querySelector("#new-m");
    if (nb) nb.onclick = () => { root.querySelector("#new-slot").replaceChildren(mapForm()); nb.disabled = true; };
  }

  function mapCard(m, urls) {
    const src = m.storage_path ? urls[m.storage_path] : m.image_url;
    const hidden = m.revealed === false;
    const card = document.createElement("div");
    card.className = "card map-card";
    card.innerHTML = `
      ${src
        ? `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(m.title)}" loading="lazy" /></a>`
        : `<div class="map-ph">map image coming soon…</div>`}
      <div class="row" style="justify-content:space-between; margin-top:10px">
        <strong style="font-size:17px">${esc(m.title)}</strong>
        <span class="row" style="gap:6px">
          ${hidden ? `<span class="pill mystic">🕯️ hidden</span>` : ""}
          ${catPill(m.category)}
        </span>
      </div>
      ${m.description ? `<p class="muted small" style="margin:6px 0 0">${esc(m.description)}</p>` : ""}
      <div class="row" style="justify-content:space-between; margin-top:8px">
        <p class="byline" style="margin:0">Added ${fmtDate(m.created_at)}</p>
        ${ctx.me.isDM ? `<span class="row" style="gap:6px">
          <button class="btn-ghost b-edit">Edit</button>
          <button class="${hidden ? "btn" : "btn-ghost"} b-reveal">${hidden ? "Reveal to players" : "Hide"}</button>
          <button class="btn-danger b-del">Remove</button>
        </span>` : ""}
      </div>`;

    if (ctx.me.isDM) {
      card.querySelector(".b-edit").onclick = () => card.replaceWith(mapForm(m));
      card.querySelector(".b-reveal").onclick = () =>
        guard(async () => {
          await maps.setRevealed(m.id, hidden);
          toast(hidden ? `"${m.title}" revealed to the party` : `"${m.title}" hidden again`);
          render();
        });
      card.querySelector(".b-del").onclick = () => {
        if (!confirm(`Remove map "${m.title}" from the atlas? Its image file is deleted too.`)) return;
        guard(async () => { await maps.removeFile(m.storage_path); await maps.remove(m.id); render(); });
      };
    }
    return card;
  }

  function mapForm(m = {}) {
    const hasImage = !!(m.storage_path || m.image_url);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <form>
        <div class="row">
          <div class="grow"><label class="field">Title</label><input type="text" name="title" required value="${esc(m.title || "")}" /></div>
          <div><label class="field">Category</label>
            <select name="category">${CATS.map(([k, l]) => `<option value="${k}" ${k === (m.category || "other") ? "selected" : ""}>${l}</option>`).join("")}</select>
          </div>
          <div><label class="field">Order (lower first)</label><input type="number" name="sort_order" value="${m.sort_order ?? 100}" style="width:110px" /></div>
        </div>
        <label class="field">🗺️ ${hasImage ? "Replace the image (optional — leave empty to keep the current one)" : "Map image — pick a file from your computer (png/jpg/webp, up to 25 MB)"}</label>
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" />
        <label class="field">…or paste an image URL instead (publicly visible — no secrets)</label>
        <input type="text" name="image_url" value="${esc(m.image_url || "")}" placeholder="https://…" />
        <label class="field">Description</label>
        <input type="text" name="description" value="${esc(m.description || "")}" placeholder="What is this a map of?" />
        <div class="actions">
          <button class="btn" type="submit">${m.id ? "Save map" : "Add to the atlas"}</button>
          <label class="checkline"><input type="checkbox" name="revealed" ${m.revealed ? "checked" : ""} /> Visible to players</label>
          <button class="btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    card.querySelector("[data-cancel]").onclick = () => render();
    card.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      guard(async () => {
        const file = f.get("file");
        let storage_path = m.storage_path || null;
        if (file && file.size) {
          if (file.size > 25 * 1024 * 1024) { toast("⚠ That image is over 25 MB — shrink it a little and try again"); return; }
          toast("Uploading map…");
          const newPath = await maps.upload(file);
          if (newPath) storage_path = newPath;
          else toast("Demo mode can't store images");
        }
        const so = parseInt(f.get("sort_order"), 10);
        const fields = {
          title: f.get("title"),
          category: f.get("category"),
          storage_path,
          image_url: f.get("image_url") || "",
          description: f.get("description"),
          sort_order: Number.isFinite(so) ? so : 100,
          revealed: f.get("revealed") === "on",
        };
        if (m.id) await maps.update(m.id, fields);
        else await maps.add(fields);
        if (m.storage_path && storage_path !== m.storage_path) await maps.removeFile(m.storage_path);
        toast(m.id ? "Map updated" : "Map added" + (fields.revealed ? "" : " (hidden from players)"));
        render();
      });
    };
    return card;
  }
}
