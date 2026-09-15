// 📖 Adventures — the AI DM-prep accelerator's flagship: describe a
// scenario in a sentence or two and the AI drafts a whole ready-to-run
// adventure — a named location, ordered scenes (combat / puzzle / social /
// exploration) each with BOXED read-aloud text and DM notes, a cast of NPCs
// (with secrets + voices), suggested treasure, and an XP/difficulty budget.
//
// It removes the boring prep; it does NOT play the game for you — everything
// is an editable draft the DM tweaks and runs. Combat scenes stage straight
// onto the Battle map: the roster is handed to the VTT's ⚡ AI-prep builder,
// which draws the map and drops the tokens with HP ready.
//
// Adventures live in `adventures` (per campaign); the party reads, only a DM
// writes. AI drafting shares the `plan-adventure` Edge Function and the AI
// *text* bill cap with monsters/encounters/homebrew.
import { boot, esc, md, guard, toast } from "../shell.js";
import { adventures, characters, ai, getCampaign, isReal } from "../db.js";
import { MONSTERS } from "../dnd/data/monsters.js";

const KINDS = {
  combat: { label: "Combat", pill: "ember", icon: "⚔" },
  puzzle: { label: "Puzzle", pill: "mystic", icon: "🧩" },
  social: { label: "Social", pill: "steel", icon: "💬" },
  exploration: { label: "Exploration", pill: "moss", icon: "🧭" },
};
const kindOf = (k) => KINDS[String(k || "").toLowerCase()] || KINDS.exploration;
const clampInt = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Math.round(Number(v) || dflt)));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const STAGE_KEY = "onyx:stageScene";   // sessionStorage handoff → vtt.html

// Normalize a raw AI draft / stored blob into the canonical adventure shape,
// so a partial or slightly-off payload still renders and saves cleanly.
function toAdventure(raw = {}) {
  const r = raw || {};
  const scenes = Array.isArray(r.scenes) ? r.scenes.map(toScene) : [];
  // guarantee exactly one boss flag (default: the last combat scene, else last)
  if (scenes.length && !scenes.some((s) => s.boss)) {
    const idx = scenes.map((s) => s.kind).lastIndexOf("combat");
    (scenes[idx >= 0 ? idx : scenes.length - 1] || {}).boss = true;
  }
  return {
    title: String(r.title || "").trim() || "New adventure",
    location: String(r.location || "").trim(),
    overview: String(r.overview || "").trim(),
    xp_budget: String(r.xp_budget || "").trim(),
    scenes,
    npcs: Array.isArray(r.npcs) ? r.npcs.map(toNpc) : [],
    treasure_overall: String(r.treasure_overall || "").trim(),
  };
}
function toScene(raw = {}) {
  const r = raw || {};
  const kind = String(r.kind || "").trim().toLowerCase();
  return {
    title: String(r.title || "").trim() || "Scene",
    kind: KINDS[kind] ? kind : "exploration",
    boss: !!r.boss,
    read_aloud: String(r.read_aloud || "").trim(),
    dm_notes: String(r.dm_notes || "").trim(),
    monsters: Array.isArray(r.monsters) ? r.monsters.map(toRosterEntry).filter(Boolean) : [],
    puzzle: String(r.puzzle || "").trim(),
    treasure: String(r.treasure || "").trim(),
  };
}
function toRosterEntry(raw = {}) {
  const r = raw || {};
  const name = String(r.name || "").trim();
  if (!name) return null;
  return {
    name,
    srd_index: String(r.srd_index || "").trim(),
    count: clampInt(r.count, 1, 12, 1),
    cr: String(r.cr || "").trim(),
    homebrew_prompt: String(r.homebrew_prompt || "").trim(),
  };
}
function toNpc(raw = {}) {
  const r = raw || {};
  return {
    name: String(r.name || "").trim() || "Unnamed",
    role: String(r.role || "").trim(),
    personality: String(r.personality || "").trim(),
    secret: String(r.secret || "").trim(),
    voice: String(r.voice || "").trim(),
    lines: Array.isArray(r.lines) ? r.lines.map((l) => String(l || "").trim()).filter(Boolean) : [],
  };
}

const ctx = await boot("adventures.html", "Adventures");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  const isDM = ctx.me.isDM;
  let list = [];
  let chars = [];
  let view = "list";         // "list" | { id | draft }

  await renderList();

  // ── list view: cards + (DM) the AI composer ──
  async function renderList() {
    view = "list";
    [list, chars] = await Promise.all([
      adventures.list().catch(() => []),
      characters.list().catch(() => []),
    ]);

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">Adventures</h2>
      </div>
      <p class="muted small" style="margin-top:-6px">AI-drafted, ready-to-run adventures for this campaign — a location,
        scenes with read-aloud text, NPCs, treasure and an XP budget. It removes the prep; you still run the game.${isDM ? "" : " Your DM prepares these."}</p>
      ${isDM ? `<div id="ai-slot"></div>` : ""}
      <div class="grid" id="grid" style="grid-template-columns:repeat(auto-fill, minmax(300px, 1fr))"></div>`;

    const grid = root.querySelector("#grid");
    if (!list.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No adventures yet${isDM ? " — describe one above and let the AI draft it." : " — your DM hasn't prepared any yet."}</div>`;
    }
    list.forEach((row) => grid.appendChild(card(row)));

    if (isDM) renderComposer();
  }

  function card(row) {
    const a = toAdventure(row.data || {});
    const el = document.createElement("div");
    el.className = "card";
    el.style.cursor = "pointer";
    const combat = a.scenes.filter((s) => s.kind === "combat").length;
    el.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px">
        <strong style="font-family:var(--font-display); color:var(--gold)">${esc(a.title)}</strong>
        <span class="pill">${a.scenes.length} scene${a.scenes.length === 1 ? "" : "s"}</span>
      </div>
      ${a.location ? `<p class="muted small" style="margin:4px 0 0">📍 ${esc(a.location)}</p>` : ""}
      ${a.overview ? `<p class="small" style="margin:8px 0 0">${esc(a.overview.slice(0, 160))}${a.overview.length > 160 ? "…" : ""}</p>` : ""}
      <div class="row" style="gap:6px; margin-top:10px; flex-wrap:wrap">
        ${combat ? `<span class="pill ember">⚔ ${combat} fight${combat === 1 ? "" : "s"}</span>` : ""}
        ${a.npcs.length ? `<span class="pill steel">👤 ${a.npcs.length} NPC${a.npcs.length === 1 ? "" : "s"}</span>` : ""}
      </div>`;
    el.onclick = () => renderDetail(row.id, a);
    return el;
  }

  // ── the AI composer (DM only, real mode) ──
  async function renderComposer() {
    const slot = root.querySelector("#ai-slot");
    if (!slot) return;
    if (!isReal()) {
      slot.innerHTML = `<div class="card ai-card"><strong>✨ Create an adventure with AI</strong>
        <p class="muted small" style="margin:6px 0 0">AI drafting needs the live database — it isn't available in demo mode.</p></div>`;
      return;
    }

    let usage = null;
    try { usage = await ai.textUsage(); } catch { usage = null; }

    if (!usage) {
      slot.innerHTML = `
        <div class="card ai-card">
          <div class="row" style="justify-content:space-between; align-items:center">
            <strong>✨ Create an adventure with AI</strong><span class="pill mystic">not set up</span>
          </div>
          <p class="muted small" style="margin:6px 0 0">AI drafting isn't set up yet. Deploy the
            <code>plan-adventure</code> function and set a provider key — see <code>docs/AI-ADVENTURES.md</code>.</p>
        </div>`;
      return;
    }

    const left = usage.remaining ?? 0;
    const size = clampInt(chars.length || 4, 1, 10, 4);
    slot.innerHTML = `
      <div class="card ai-card">
        <div class="row" style="justify-content:space-between; align-items:center">
          <strong>✨ Create an adventure with AI</strong>
          <span class="pill ${left > 0 ? "moss" : "ember"}" title="Shared with monsters, encounters & homebrew · resets monthly">${left} of ${usage.cap ?? "?"} left this month</span>
        </div>
        <p class="muted small" style="margin:6px 0 8px">Describe the scenario. One draft spends a single planner slot;
          maps and custom monsters are only billed later, when you stage a fight onto the Battle map. Failed drafts don't count.</p>
        <textarea id="ad-brief" style="min-height:74px" placeholder="e.g. an abandoned dwarven mine for four level-6 heroes — a hidden cult in the deep tunnels, a flooded-cavern puzzle, and a bound elemental boss"></textarea>
        <div class="row" style="gap:14px; margin-top:10px; align-items:flex-end; flex-wrap:wrap">
          <div><label class="field">Party level</label>
            <input type="number" id="ad-lvl" min="1" max="20" value="3" style="width:80px" /></div>
          <div><label class="field">Party size</label>
            <input type="number" id="ad-size" min="1" max="10" value="${size}" style="width:80px" /></div>
          <div><label class="field">Difficulty</label>
            <select id="ad-diff" style="width:auto">
              ${["easy", "medium", "hard", "deadly"].map((d) => `<option value="${d}" ${d === "medium" ? "selected" : ""}>${cap(d)}</option>`).join("")}
            </select></div>
          <div><label class="field">Scenes</label>
            <input type="number" id="ad-scenes" min="2" max="6" value="3" style="width:80px" /></div>
        </div>
        <div class="actions" style="margin-top:12px">
          <button class="btn" id="ad-go" ${left > 0 ? "" : "disabled"}>${left > 0 ? "✨ Draft the adventure" : "Monthly limit reached"}</button>
          <span class="muted small" id="ad-msg"></span>
        </div>
      </div>`;

    slot.querySelector("#ad-go").onclick = () => {
      const brief = slot.querySelector("#ad-brief").value.trim();
      if (!brief) { toast("Describe the scenario first"); return; }
      const req = {
        campaignId: getCampaign(), brief,
        partyLevel: clampInt(slot.querySelector("#ad-lvl").value, 1, 20, 3),
        partySize: clampInt(slot.querySelector("#ad-size").value, 1, 10, 4),
        difficulty: slot.querySelector("#ad-diff").value,
        scenes: clampInt(slot.querySelector("#ad-scenes").value, 2, 6, 3),
        srd: Object.values(MONSTERS).map((m) => ({ i: m.index, n: m.name, cr: m.crText })),
      };
      const go = slot.querySelector("#ad-go");
      go.disabled = true;
      slot.querySelector("#ad-msg").textContent = "Consulting the loremasters… (this can take up to a minute)";
      guard(async () => {
        try {
          const draft = await ai.planAdventure(req);
          if (!draft) throw new Error("No adventure came back — try again");
          // open the fresh draft in the detail editor; nothing is saved until the DM hits Save
          renderDetail(null, toAdventure(draft), true);
        } catch (e) {
          go.disabled = false;
          slot.querySelector("#ad-msg").textContent = "";
          if (e.code === "not-configured") { toast("AI isn't set up yet — see docs/AI-ADVENTURES.md"); return; }
          toast("⚠ " + (e.message || "Drafting failed"));
        }
      });
    };
  }

  // ── detail view: the readable prep document (+ DM edit + stage) ──
  // id: the saved row id, or null for an unsaved draft. `a` is a normalized
  // adventure object. `dirty` marks a just-generated draft (offer to save).
  function renderDetail(id, a, dirty = false) {
    view = { id };
    let editing = false;

    function render() {
      const canStage = isDM && isReal();
      root.innerHTML = `
        <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:12px; gap:8px; flex-wrap:wrap">
          <button class="btn-ghost" id="back">← All adventures</button>
          <div class="row" style="gap:8px">
            ${isDM ? (editing
              ? `<button class="btn" id="save">💾 Save</button><button class="btn-ghost" id="cancel-edit">Cancel</button>`
              : `<button class="btn-ghost" id="edit">✏ Edit</button>
                 ${dirty ? `<button class="btn" id="save-draft">💾 Save adventure</button>` : ""}
                 ${id ? `<button class="btn-danger" id="del">✕ Delete</button>` : ""}`) : ""}
          </div>
        </div>
        ${dirty && !editing ? `<p class="pill gold" style="display:inline-block; margin-bottom:10px">✨ Fresh draft — review it, then Save</p>` : ""}
        <div id="doc"></div>`;
      root.querySelector("#back").onclick = () => guard(renderList);
      const doc = root.querySelector("#doc");
      editing ? renderEdit(doc) : renderRead(doc, canStage);

      const eb = root.querySelector("#edit"); if (eb) eb.onclick = () => { editing = true; render(); };
      const ce = root.querySelector("#cancel-edit"); if (ce) ce.onclick = () => { editing = false; render(); };
      const sv = root.querySelector("#save"); if (sv) sv.onclick = onSave;
      const sd = root.querySelector("#save-draft"); if (sd) sd.onclick = onSave;
      const dl = root.querySelector("#del"); if (dl) dl.onclick = onDelete;
    }

    // read-at-the-table rendering
    function renderRead(doc, canStage) {
      doc.innerHTML = `
        <h2 class="section" style="margin:0 0 2px">${esc(a.title)}</h2>
        ${a.location ? `<p class="muted" style="margin:0 0 6px">📍 ${esc(a.location)}</p>` : ""}
        ${a.overview ? `<div class="card" style="margin:10px 0">${md(a.overview)}</div>` : ""}
        ${a.xp_budget ? `<p class="small" style="margin:0 0 14px"><span class="pill gold">XP &amp; pacing</span> ${esc(a.xp_budget)}</p>` : ""}
        <h3 class="section" style="font-size:1rem; margin:6px 0 10px">The scenes</h3>
        <div id="scenes"></div>
        ${a.npcs.length ? `<h3 class="section" style="font-size:1rem; margin:20px 0 10px">The cast</h3><div class="grid" id="npcs" style="grid-template-columns:repeat(auto-fill, minmax(280px, 1fr))"></div>` : ""}
        ${a.treasure_overall ? `<h3 class="section" style="font-size:1rem; margin:20px 0 8px">Rewards</h3><div class="card">${md(a.treasure_overall)}</div>` : ""}`;

      const sc = doc.querySelector("#scenes");
      a.scenes.forEach((s, i) => sc.appendChild(sceneCard(s, i, canStage)));
      const np = doc.querySelector("#npcs");
      if (np) a.npcs.forEach((n) => np.appendChild(npcCard(n)));
    }

    function sceneCard(s, i, canStage) {
      const k = kindOf(s.kind);
      const el = document.createElement("div");
      el.className = "card scene-card";
      const roster = s.monsters.length
        ? `<p class="small" style="margin:8px 0 0"><span class="muted">Roster:</span> ${s.monsters.map((m) =>
            `${esc(m.name)} ×${m.count}${m.cr ? ` <span class="muted">(CR ${esc(m.cr)})</span>` : ""}`).join(" · ")}</p>`
        : "";
      el.innerHTML = `
        <div class="scene-head">
          <span class="scene-num">${i + 1}</span>
          <strong style="font-family:var(--font-display)">${esc(s.title)}</strong>
          <span class="pill ${k.pill}">${k.icon} ${k.label}</span>
          ${s.boss ? `<span class="pill gold">★ Boss</span>` : ""}
          <span class="spacer" style="flex:1"></span>
          ${canStage && s.kind === "combat" && s.monsters.length ? `<button class="btn small" data-stage="${i}" title="Draw the map and drop these monsters as tokens on the Battle map">⚔ Stage on Battle map</button>` : ""}
        </div>
        ${s.read_aloud ? `<div class="read-aloud">${md(s.read_aloud)}</div>` : ""}
        ${s.puzzle ? `<div class="dm-note"><span class="pill mystic">🧩 Puzzle</span> ${md(s.puzzle)}</div>` : ""}
        ${s.dm_notes ? `<div class="dm-note"><span class="muted small" style="text-transform:uppercase; letter-spacing:.1em">DM notes</span>${md(s.dm_notes)}</div>` : ""}
        ${roster}
        ${s.treasure ? `<p class="small" style="margin:8px 0 0"><span class="pill moss">💰 Treasure</span> ${esc(s.treasure)}</p>` : ""}`;
      const stg = el.querySelector("[data-stage]");
      if (stg) stg.onclick = () => stageScene(s);
      return el;
    }

    function npcCard(n) {
      const el = document.createElement("div");
      el.className = "card npc-card";
      el.innerHTML = `
        <strong style="font-family:var(--font-display); color:var(--gold)">${esc(n.name)}</strong>
        ${n.role ? ` <span class="muted small">— ${esc(n.role)}</span>` : ""}
        ${n.personality ? `<p class="small" style="margin:6px 0 0">${esc(n.personality)}</p>` : ""}
        ${n.secret ? `<p class="small" style="margin:6px 0 0"><span class="pill ember">Secret</span> ${esc(n.secret)}</p>` : ""}
        ${n.voice ? `<p class="muted small" style="margin:6px 0 0">🎭 ${esc(n.voice)}</p>` : ""}
        ${n.lines.length ? n.lines.map((l) => `<p class="small npc-line">“${esc(l)}”</p>`).join("") : ""}`;
      return el;
    }

    // edit mode: text fields become inputs/textareas; arrays keep their shape.
    function renderEdit(doc) {
      const ta = (id, val, ph, min = 44) => `<textarea id="${id}" style="min-height:${min}px" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
      doc.innerHTML = `
        <label class="field">Title</label>
        <input type="text" id="e-title" maxlength="120" value="${esc(a.title)}" />
        <label class="field" style="margin-top:10px">Location</label>
        <input type="text" id="e-location" maxlength="160" value="${esc(a.location)}" />
        <label class="field" style="margin-top:10px">Overview</label>
        ${ta("e-overview", a.overview, "the hook, the stakes, what's really going on", 60)}
        <label class="field" style="margin-top:10px">XP &amp; pacing note</label>
        ${ta("e-xp", a.xp_budget, "difficulty & pacing for this party", 40)}
        <h3 class="section" style="font-size:1rem; margin:16px 0 8px">Scenes</h3>
        <div id="e-scenes"></div>
        <h3 class="section" style="font-size:1rem; margin:18px 0 8px">NPCs</h3>
        <div id="e-npcs"></div>
        <label class="field" style="margin-top:14px">Overall rewards</label>
        ${ta("e-treasure", a.treasure_overall, "the total suggested hoard", 44)}`;

      const es = doc.querySelector("#e-scenes");
      a.scenes.forEach((s, i) => {
        const box = document.createElement("div");
        box.className = "card";
        box.style.marginBottom = "10px";
        box.innerHTML = `
          <div class="row" style="gap:8px; align-items:flex-end; flex-wrap:wrap">
            <div style="flex:1; min-width:160px"><label class="field">Scene ${i + 1} title</label>
              <input type="text" id="es-${i}-title" value="${esc(s.title)}" /></div>
            <div><label class="field">Kind</label>
              <select id="es-${i}-kind" style="width:auto">${Object.keys(KINDS).map((k) => `<option value="${k}" ${k === s.kind ? "selected" : ""}>${KINDS[k].label}</option>`).join("")}</select></div>
            <label class="checkline" style="margin:0 0 6px"><input type="checkbox" id="es-${i}-boss" ${s.boss ? "checked" : ""} /> Boss</label>
          </div>
          <label class="field" style="margin-top:8px">Read-aloud</label>
          ${ta(`es-${i}-read`, s.read_aloud, "boxed text for the players", 52)}
          <label class="field" style="margin-top:8px">DM notes</label>
          ${ta(`es-${i}-notes`, s.dm_notes, "tactics, DCs, what unlocks the next scene", 48)}
          ${s.kind === "puzzle" || s.puzzle ? `<label class="field" style="margin-top:8px">Puzzle (with solution)</label>${ta(`es-${i}-puzzle`, s.puzzle, "the puzzle, its solution and a hint", 44)}` : ""}
          <label class="field" style="margin-top:8px">Treasure here</label>
          <input type="text" id="es-${i}-treasure" value="${esc(s.treasure)}" />`;
        es.appendChild(box);
      });

      const en = doc.querySelector("#e-npcs");
      a.npcs.forEach((n, j) => {
        const box = document.createElement("div");
        box.className = "card";
        box.style.marginBottom = "10px";
        box.innerHTML = `
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <div style="flex:1; min-width:140px"><label class="field">Name</label><input type="text" id="en-${j}-name" value="${esc(n.name)}" /></div>
            <div style="flex:1; min-width:140px"><label class="field">Role</label><input type="text" id="en-${j}-role" value="${esc(n.role)}" /></div>
          </div>
          <label class="field" style="margin-top:8px">Personality</label><input type="text" id="en-${j}-pers" value="${esc(n.personality)}" />
          <label class="field" style="margin-top:8px">Secret</label><input type="text" id="en-${j}-secret" value="${esc(n.secret)}" />
          <label class="field" style="margin-top:8px">Voice</label><input type="text" id="en-${j}-voice" value="${esc(n.voice)}" />
          <label class="field" style="margin-top:8px">Sample lines (one per line)</label>
          ${ta(`en-${j}-lines`, n.lines.join("\n"), "a line or two in their voice", 44)}`;
        en.appendChild(box);
      });
    }

    function collectEdits() {
      const val = (id) => { const el = root.querySelector("#" + id); return el ? el.value : ""; };
      const chk = (id) => { const el = root.querySelector("#" + id); return !!(el && el.checked); };
      const next = {
        ...a,
        title: val("e-title").trim() || "Untitled adventure",
        location: val("e-location").trim(),
        overview: val("e-overview").trim(),
        xp_budget: val("e-xp").trim(),
        treasure_overall: val("e-treasure").trim(),
        scenes: a.scenes.map((s, i) => ({
          ...s,
          title: val(`es-${i}-title`).trim() || s.title,
          kind: val(`es-${i}-kind`) || s.kind,
          boss: chk(`es-${i}-boss`),
          read_aloud: val(`es-${i}-read`).trim(),
          dm_notes: val(`es-${i}-notes`).trim(),
          puzzle: root.querySelector(`#es-${i}-puzzle`) ? val(`es-${i}-puzzle`).trim() : s.puzzle,
          treasure: val(`es-${i}-treasure`).trim(),
        })),
        npcs: a.npcs.map((n, j) => ({
          ...n,
          name: val(`en-${j}-name`).trim() || n.name,
          role: val(`en-${j}-role`).trim(),
          personality: val(`en-${j}-pers`).trim(),
          secret: val(`en-${j}-secret`).trim(),
          voice: val(`en-${j}-voice`).trim(),
          lines: val(`en-${j}-lines`).split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        })),
      };
      return toAdventure(next);
    }

    function onSave() {
      const next = editing ? collectEdits() : a;
      guard(async () => {
        try {
          const saved = await adventures.save({ id, title: next.title, location: next.location, data: next });
          const newId = id || saved?.id || null;
          toast(id ? "Adventure saved" : "Adventure created");
          // reopen clean (persisted) so Delete/Stage act on the saved row
          renderDetail(newId, next, false);
        } catch (e) {
          toast("⚠ " + (e.message || "Couldn't save"));
        }
      });
    }

    function onDelete() {
      if (!id) return;
      if (!confirm(`Delete "${a.title}"? This can't be undone.`)) return;
      guard(async () => {
        try { await adventures.remove(id); toast("Adventure deleted"); await renderList(); }
        catch (e) { toast("⚠ " + (e.message || "Couldn't delete")); }
      });
    }

    // Hand a combat scene to the Battle map's ⚡ AI-prep builder. We stash a
    // "plan" (the same shape plan-encounter returns) in sessionStorage and
    // navigate to vtt.html, which pops the review step pre-filled — the DM
    // confirms, then it draws the map and drops the tokens.
    function stageScene(s) {
      const firstSentence = (s.read_aloud || "").split(/(?<=[.!?])\s/)[0] || s.read_aloud || "";
      const terrain = firstSentence.slice(0, 220);
      const mapPrompt =
        `Top-down tabletop battle map of ${s.title}${a.location ? ` in ${a.location}` : ""}. ` +
        `${terrain} Detailed terrain and features, atmospheric lighting — no creatures, no labels, no grid lines.`;
      const seed = {
        wantMap: true,
        plan: {
          title: `${a.title} — ${s.title}`,
          summary: firstSentence,
          map_prompt: mapPrompt,
          monsters: s.monsters.map((m) => ({
            name: m.name, srd_index: m.srd_index, count: m.count,
            cr: m.cr, homebrew_prompt: m.homebrew_prompt,
          })),
        },
      };
      try { sessionStorage.setItem(STAGE_KEY, JSON.stringify(seed)); }
      catch { toast("Couldn't hand off to the Battle map"); return; }
      toast(`Staging “${s.title}” — review it on the Battle map…`);
      location.href = "./vtt.html";
    }

    render();
  }
}
