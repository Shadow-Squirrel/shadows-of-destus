// Maps — the atlas. Images live in a PRIVATE Supabase Storage
// bucket; each map has a `revealed` flag. Players only ever
// receive revealed maps (the database and storage both enforce
// it) — the DM sees everything and flips reveal with one click.
import { boot, esc, guard, fmtDate, toast } from "../shell.js";
import { maps, ai, getCampaign, isReal } from "../db.js";

// Style presets: each appends flavor to the DM's prompt so a couple
// of words ("goblin cave") become a usable battle map.
const MAP_STYLES = [
  ["Top-down battle map", "top-down tactical battle map, grid-friendly, high detail, fantasy RPG"],
  ["Dungeon", "top-down dungeon battle map, stone corridors and rooms, torchlit, fantasy RPG"],
  ["Wilderness", "top-down wilderness battle map, forest clearing and trails, natural terrain, fantasy RPG"],
  ["Town / interior", "top-down building interior battle map, rooms and furniture, fantasy tavern or hall"],
  ["Region map", "hand-drawn fantasy region map, coastline forests and towns, parchment cartography style"],
];

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
      ${ctx.me.isDM ? `<div id="ai-slot"></div>` : ""}
      <div id="new-slot"></div>
      <div class="grid" id="grid" style="grid-template-columns:repeat(auto-fill, minmax(340px, 1fr))"></div>`;

    const grid = root.querySelector("#grid");
    if (!list.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No maps yet — the world is still unmapped.</div>`;
    list.forEach((m) => grid.appendChild(mapCard(m, urls)));

    const nb = root.querySelector("#new-m");
    if (nb) nb.onclick = () => { root.querySelector("#new-slot").replaceChildren(mapForm()); nb.disabled = true; };

    if (ctx.me.isDM) renderAi();
  }

  /* ── ✨ Generate a battle map with AI (DM only) ──
     Wrapped so a missing/unconfigured function NEVER breaks the page. */
  async function renderAi() {
    const slot = root.querySelector("#ai-slot");
    if (!slot) return;
    // demo mode can't store images — offer nothing rather than a broken button
    if (!isReal()) return;

    let usage = null;
    try { usage = await ai.usage(); } catch { usage = null; }

    // usage === null ⇒ the AI migration/function isn't set up yet
    if (!usage) {
      slot.innerHTML = `
        <div class="card ai-card">
          <div class="row" style="justify-content:space-between; align-items:center">
            <strong>✨ Generate a map with AI</strong>
            <span class="pill mystic">not set up</span>
          </div>
          <p class="muted small" style="margin:6px 0 0">AI images aren't set up yet.
            Deploy the <code>generate-image</code> function and set a provider key —
            see <code>docs/AI-IMAGES.md</code>.</p>
        </div>`;
      return;
    }

    const left = usage.remaining ?? 0;
    slot.innerHTML = `
      <div class="card ai-card">
        <div class="row" style="justify-content:space-between; align-items:center">
          <strong>✨ Generate a battle map with AI</strong>
          <span class="pill ${left > 0 ? "moss" : "ember"}" title="Resets at the start of each month">${left} of ${usage.cap ?? "?"} left this month</span>
        </div>
        <p class="muted small" style="margin:6px 0 8px">Describe the scene; FLUX.1 [schnell] draws it. New maps arrive <strong>hidden</strong> — reveal when you're ready. Failed generations don't count against your quota.</p>
        <div class="row ai-styles" style="gap:6px; flex-wrap:wrap; margin-bottom:8px">
          ${MAP_STYLES.map(([label], i) => `<button type="button" class="btn-ghost ai-style" data-i="${i}" style="padding:4px 10px">${esc(label)}</button>`).join("")}
        </div>
        <textarea id="ai-prompt" style="min-height:64px" placeholder="e.g. a ruined watchtower on a foggy marsh, broken bridge, reeds"></textarea>
        <div class="actions">
          <button class="btn" id="ai-go" ${left > 0 ? "" : "disabled"}>${left > 0 ? "✨ Generate map" : "Monthly limit reached"}</button>
          <span class="muted small" id="ai-msg"></span>
        </div>
      </div>`;

    let stylePrefix = "";
    slot.querySelectorAll(".ai-style").forEach((b) => (b.onclick = () => {
      stylePrefix = MAP_STYLES[+b.dataset.i][1];
      slot.querySelectorAll(".ai-style").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      slot.querySelector("#ai-prompt").focus();
    }));

    slot.querySelector("#ai-go").onclick = () => {
      const raw = slot.querySelector("#ai-prompt").value.trim();
      if (!raw) { toast("Describe the map first"); return; }
      const prompt = stylePrefix ? `${stylePrefix}: ${raw}` : raw;
      const go = slot.querySelector("#ai-go");
      go.disabled = true;
      slot.querySelector("#ai-msg").textContent = "Summoning pixels… (a few seconds)";
      guard(async () => {
        try {
          await ai.generate({ campaignId: getCampaign(), kind: "map", prompt });
          toast("Map generated — it's hidden until you reveal it");
          await render(); // list now includes the new (hidden) map
        } catch (e) {
          if (e.code === "not-configured") { renderAi(); toast("AI images aren't set up yet — see docs/AI-IMAGES.md"); return; }
          go.disabled = false;
          slot.querySelector("#ai-msg").textContent = "";
          toast("⚠ " + (e.message || "Generation failed"));
        }
      });
    };
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
