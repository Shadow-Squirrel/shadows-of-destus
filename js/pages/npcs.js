// 🎭 NPCs — the DM's private cast of characters.
//
// Describe someone in a sentence — "a nervous goblin fence who secretly
// works for the thieves' guild" — and the AI drafts a full NPC: name, race,
// role, personality, a real SECRET, a table voice, and a small inventory,
// plus an optional portrait. NPCs live in `campaign_npcs`, which is DM-ONLY
// (secrets never reach players — the database enforces it). When the DM is
// ready, "Reveal to Codex" publishes just the public-facing details +
// portrait into the shared 🐉 Codex the whole party sees.
//
// AI drafting reuses the generate-homebrew Edge Function (kind: npc) and the
// shared AI *text* budget; portraits reuse the AI *image* budget.
import { boot, esc, guard, toast } from "../shell.js";
import { npcs, codex, ai, getCampaign, isReal } from "../db.js";
import { openModal } from "./characters/common.js";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Normalize an AI draft / stored blob into the canonical NPC shape.
function toNpc(raw = {}) {
  const r = raw || {};
  return {
    name: String(r.name || "").trim() || "New NPC",
    race: String(r.race || "").trim(),
    role: String(r.role || "").trim(),
    alignment: String(r.alignment || "").trim(),
    appearance: String(r.appearance || "").trim(),
    personality: String(r.personality || "").trim(),
    secret: String(r.secret || "").trim(),
    voice: String(r.voice || "").trim(),
    inventory: Array.isArray(r.inventory)
      ? r.inventory.map((it) => ({ item: String(it?.item || "").trim(), price: String(it?.price || "").trim() }))
          .filter((it) => it.item)
      : [],
  };
}
const subtitle = (n) => [n.race, n.role].filter(Boolean).join(" · ");

// The public-facing blurb that goes into the Codex — deliberately WITHOUT the
// secret, voice notes or inventory (those stay the DM's).
function publicBlurb(n) {
  const bits = [];
  if (n.appearance) bits.push(n.appearance);
  if (n.personality) bits.push(n.personality);
  const tag = [n.race, n.role].filter(Boolean).join(" · ");
  if (tag) bits.push(`*${tag}*`);
  return bits.join("\n\n");
}

const ctx = await boot("npcs.html", "NPCs");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  const isDM = ctx.me.isDM;

  // Players don't get the workshop — NPCs they've met live in their Codex.
  if (!isDM) {
    root.innerHTML = `
      <h2 class="section" style="margin:0 0 6px">The NPC Workshop</h2>
      <div class="empty">This is the DM's cast of characters. NPCs your party has met appear in your
        <a href="./codex.html">🐉 Codex</a>.</div>`;
    return;
  }

  let list = [];
  let artUrls = {};

  await render();

  async function render() {
    list = (await npcs.list().catch(() => [])).map((row) => ({ ...row, npc: toNpc(row.data) }));
    // portraits live in the private 'ai-art' bucket → signed URLs
    const paths = list.map((r) => r.art_path).filter(Boolean);
    artUrls = paths.length ? await ai.artUrls(paths).catch(() => ({})) : {};

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">The Cast</h2>
        <button class="btn" id="new-npc">+ Add by hand</button>
      </div>
      <p class="muted small" style="margin-top:-6px">Your private roster of NPCs — secrets and all. Only you can see this page;
        press <strong>Reveal to Codex</strong> to share an NPC's face and public details with the party.</p>
      <div id="ai-slot"></div>
      <div class="grid" id="grid" style="grid-template-columns:repeat(auto-fill, minmax(300px, 1fr))"></div>`;

    const grid = root.querySelector("#grid");
    if (!list.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No NPCs yet — draft one with AI above, or add one by hand.</div>`;
    list.forEach((row) => grid.appendChild(card(row)));

    root.querySelector("#new-npc").onclick = () => openForm(toNpc({}), null);
    renderAi();
  }

  /* ── ✨ Generate an NPC with AI ── */
  async function renderAi() {
    const slot = root.querySelector("#ai-slot");
    if (!slot) return;
    if (!isReal()) {
      slot.innerHTML = `<div class="card ai-card"><strong>✨ Generate an NPC with AI</strong>
        <p class="muted small" style="margin:6px 0 0">AI drafting needs the live database — not available in demo mode.</p></div>`;
      return;
    }
    let usage = null;
    try { usage = await ai.textUsage(); } catch { usage = null; }
    if (!usage) {
      slot.innerHTML = `
        <div class="card ai-card">
          <div class="row" style="justify-content:space-between; align-items:center">
            <strong>✨ Generate an NPC with AI</strong><span class="pill mystic">not set up</span>
          </div>
          <p class="muted small" style="margin:6px 0 0">Deploy the <code>generate-homebrew</code> function and set a provider key —
            see <code>docs/AI-NPCS.md</code>. You can still add NPCs by hand.</p>
        </div>`;
      return;
    }
    const left = usage.remaining ?? 0;
    slot.innerHTML = `
      <div class="card ai-card">
        <div class="row" style="justify-content:space-between; align-items:center">
          <strong>✨ Generate an NPC with AI</strong>
          <span class="pill ${left > 0 ? "moss" : "ember"}" title="Shared with monsters, spells, items & adventures · resets monthly">${left} of ${usage.cap ?? "?"} left this month</span>
        </div>
        <p class="muted small" style="margin:6px 0 8px">Describe them and the AI drafts a full NPC — secret, voice and all — for you to review and edit. Failed drafts don't count.</p>
        <textarea id="ai-prompt" style="min-height:56px" placeholder="e.g. a nervous goblin merchant who secretly works for the thieves' guild"></textarea>
        <div class="actions">
          <button class="btn" id="ai-go" ${left > 0 ? "" : "disabled"}>${left > 0 ? "✨ Draft NPC" : "Monthly limit reached"}</button>
          <span class="muted small" id="ai-msg"></span>
        </div>
      </div>`;
    slot.querySelector("#ai-go").onclick = () => {
      const prompt = slot.querySelector("#ai-prompt").value.trim();
      if (!prompt) { toast("Describe the NPC first"); return; }
      const go = slot.querySelector("#ai-go");
      go.disabled = true;
      slot.querySelector("#ai-msg").textContent = "Consulting the loremasters… (a few seconds)";
      guard(async () => {
        try {
          const draft = await ai.generateHomebrew({ campaignId: getCampaign(), kind: "npc", prompt });
          if (!draft) throw new Error("No NPC came back — try again");
          openForm(toNpc(draft), null, true);
        } catch (e) {
          go.disabled = false;
          slot.querySelector("#ai-msg").textContent = "";
          if (e.code === "not-configured") { toast("AI isn't set up yet — see docs/AI-NPCS.md"); return; }
          toast("⚠ " + (e.message || "Drafting failed"));
        }
      });
    };
  }

  /* ── an NPC card (full detail — DM only) ── */
  function card(row) {
    const n = row.npc;
    const el = document.createElement("div");
    el.className = "card npc-card";
    const art = row.art_path && artUrls[row.art_path];
    const inv = n.inventory.length
      ? `<p class="small" style="margin:6px 0 0"><span class="muted">Carries:</span> ${n.inventory.map((i) => `${esc(i.item)}${i.price ? ` <span class="muted">(${esc(i.price)})</span>` : ""}`).join(" · ")}</p>`
      : "";
    el.innerHTML = `
      <div class="row" style="gap:10px; align-items:flex-start">
        ${art ? `<img src="${esc(art)}" alt="" style="width:64px; height:64px; border-radius:8px; object-fit:cover; flex:none; border:1px solid var(--border-soft)" />` : ""}
        <div style="flex:1; min-width:0">
          <strong style="font-family:var(--font-display); color:var(--gold)">${esc(n.name)}</strong>
          ${subtitle(n) ? `<span class="muted small"> — ${esc(subtitle(n))}</span>` : ""}
          ${row.codex_entry_id ? `<span class="pill moss" style="margin-left:6px" title="Shared with the party in the Codex">✓ in Codex</span>` : ""}
          ${n.alignment ? `<div class="muted small" style="margin-top:2px">${esc(n.alignment)}</div>` : ""}
        </div>
      </div>
      ${n.personality ? `<p class="small" style="margin:8px 0 0">${esc(n.personality)}</p>` : ""}
      ${n.secret ? `<p class="small" style="margin:6px 0 0"><span class="pill ember">Secret</span> ${esc(n.secret)}</p>` : ""}
      ${n.voice ? `<p class="muted small" style="margin:6px 0 0">🎭 ${esc(n.voice)}</p>` : ""}
      ${inv}
      <div class="actions" style="margin-top:10px; flex-wrap:wrap">
        <button class="btn" data-reveal>${row.codex_entry_id ? "↻ Update in Codex" : "👁 Reveal to Codex"}</button>
        ${isReal() ? `<button class="btn-ghost" data-portrait>${row.art_path ? "✨ Redo portrait" : "✨ Portrait"}</button>` : ""}
        <button class="btn-ghost" data-edit>✏ Edit</button>
        <button class="btn-danger" data-del>✕</button>
      </div>`;
    el.querySelector("[data-edit]").onclick = () => openForm(n, row.id);
    el.querySelector("[data-reveal]").onclick = () => reveal(row);
    el.querySelector("[data-del]").onclick = () => del(row);
    const pb = el.querySelector("[data-portrait]");
    if (pb) pb.onclick = () => makePortrait(row, pb);
    return el;
  }

  /* ── create / edit form (hand-built or AI draft) ── */
  function openForm(n, id, isDraft = false) {
    const invText = n.inventory.map((i) => (i.price ? `${i.item} | ${i.price}` : i.item)).join("\n");
    const modal = openModal(id ? "Edit NPC" : isDraft ? "Review AI NPC" : "New NPC", `
      <div class="row" style="gap:10px; flex-wrap:wrap">
        <div style="flex:1; min-width:160px"><label class="field">Name</label><input type="text" id="f-name" maxlength="80" value="${esc(n.name)}" /></div>
        <div style="flex:1; min-width:120px"><label class="field">Race</label><input type="text" id="f-race" maxlength="60" value="${esc(n.race)}" /></div>
      </div>
      <div class="row" style="gap:10px; flex-wrap:wrap; margin-top:8px">
        <div style="flex:1; min-width:160px"><label class="field">Role / occupation</label><input type="text" id="f-role" maxlength="80" value="${esc(n.role)}" /></div>
        <div style="flex:1; min-width:120px"><label class="field">Alignment</label><input type="text" id="f-align" maxlength="40" value="${esc(n.alignment)}" /></div>
      </div>
      <label class="field" style="margin-top:8px">Appearance <span class="muted small">(also the portrait prompt)</span></label>
      <textarea id="f-appear" style="min-height:44px">${esc(n.appearance)}</textarea>
      <label class="field" style="margin-top:8px">Personality</label>
      <textarea id="f-pers" style="min-height:44px">${esc(n.personality)}</textarea>
      <label class="field" style="margin-top:8px">Secret <span class="muted small">(DM only)</span></label>
      <textarea id="f-secret" style="min-height:44px">${esc(n.secret)}</textarea>
      <label class="field" style="margin-top:8px">Voice / mannerism</label>
      <input type="text" id="f-voice" maxlength="160" value="${esc(n.voice)}" />
      <label class="field" style="margin-top:8px">Inventory <span class="muted small">(one per line: item | price)</span></label>
      <textarea id="f-inv" style="min-height:52px" placeholder="a rusted key | —\nvial of poison | 50 gp">${esc(invText)}</textarea>
      <div class="actions" style="margin-top:12px">
        <button class="btn" id="f-save">${id ? "Save changes" : "Save NPC"}</button>
        <button class="btn-ghost" id="f-cancel">Cancel</button>
      </div>`);
    const $ = (s) => modal.el.querySelector(s);
    $("#f-cancel").onclick = modal.close;
    $("#f-save").onclick = () => {
      const data = toNpc({
        name: $("#f-name").value, race: $("#f-race").value, role: $("#f-role").value,
        alignment: $("#f-align").value, appearance: $("#f-appear").value,
        personality: $("#f-pers").value, secret: $("#f-secret").value, voice: $("#f-voice").value,
        inventory: $("#f-inv").value.split(/\r?\n/).map((ln) => {
          const [item, price] = ln.split("|");
          return { item: (item || "").trim(), price: (price || "").trim() };
        }),
      });
      guard(async () => {
        try {
          await npcs.save({ id, name: data.name, data });
          modal.close();
          toast(id ? "NPC saved" : "NPC added");
          await render();
        } catch (e) { toast("⚠ " + (e.message || "Couldn't save")); }
      });
    };
  }

  /* ── generate a portrait (AI image budget) ── */
  function makePortrait(row, btn) {
    const n = row.npc;
    const prompt = n.appearance || `${n.race} ${n.role}`.trim() || n.name;
    if (!prompt) { toast("Add an appearance first"); return; }
    btn.disabled = true;
    const old = btn.textContent; btn.textContent = "Painting…";
    guard(async () => {
      try {
        const r = await ai.generate({ campaignId: getCampaign(), kind: "portrait", prompt: `character portrait, ${prompt}` });
        if (!r?.path) throw new Error("no portrait returned");
        await npcs.save({ id: row.id, name: n.name, data: row.data, art_path: r.path, codex_entry_id: row.codex_entry_id });
        // keep the revealed Codex entry's portrait in sync, if any
        if (row.codex_entry_id) await codex.update(row.codex_entry_id, { art_path: r.path }).catch(() => {});
        toast("Portrait ready");
        await render();
      } catch (e) {
        btn.disabled = false; btn.textContent = old;
        if (e.code === "not-configured") { toast("AI images aren't set up — see docs/AI-IMAGES.md"); return; }
        toast("⚠ " + (e.message || "Portrait failed"));
      }
    });
  }

  /* ── reveal to the shared Codex (public details + portrait only) ── */
  function reveal(row) {
    const n = row.npc;
    guard(async () => {
      try {
        const fields = { name: n.name, kind: "person", status: "neutral", description: publicBlurb(n), art_path: row.art_path ?? null };
        if (row.codex_entry_id) {
          await codex.update(row.codex_entry_id, fields);
          toast(`Updated ${n.name} in the Codex`);
        } else {
          const created = await codex.add(fields);
          await npcs.save({ id: row.id, name: n.name, data: row.data, art_path: row.art_path, codex_entry_id: created?.id ?? null });
          toast(`${n.name} revealed to the party`);
        }
        await render();
      } catch (e) { toast("⚠ " + (e.message || "Couldn't reveal")); }
    });
  }

  function del(row) {
    if (!confirm(`Delete "${row.npc.name}"? This can't be undone.${row.codex_entry_id ? " (Their Codex entry stays.)" : ""}`)) return;
    guard(async () => {
      try { await npcs.remove(row.id); toast("NPC deleted"); await render(); }
      catch (e) { toast("⚠ " + (e.message || "Couldn't delete")); }
    });
  }
}
