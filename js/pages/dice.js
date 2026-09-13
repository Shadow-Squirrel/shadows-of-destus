// 🎲 Dice — the table's shared luck.
// Build a pool, roll it, and EVERYONE with this page open sees
// the dice tumble live (Supabase Realtime pushes each new roll).
// Results come from the database's roll_dice() — the browser
// only animates them, so nobody can forge a natural 20.
import { boot, esc, guard, toast } from "../shell.js";
import { dice } from "../db.js";
import { dieSvg, specText, flattenDice, createRollStage } from "../roll-fx.js";
import { dice3dEnabled, setDice3dEnabled } from "../dice3d.js";

const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100];
const MAX_DICE = 40;

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const ctx = await boot("dice.html", "Dice");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");

  /* ── builder state ── */
  let pool = new Map();        // sides -> count
  let modifier = 0;
  let editingPreset = null;    // preset being edited, or null
  const seen = new Set();      // roll ids already shown (dedupe)

  root.innerHTML = `
    <div class="row" style="justify-content:space-between; margin-bottom:14px">
      <h2 class="section" style="margin:0">Roll the Bones</h2>
      <label class="checkline" title="Physics dice tumble across the screen — they always land on the database's real results">
        <input type="checkbox" id="d3-toggle" ${dice3dEnabled() ? "checked" : ""} /> 3D dice
      </label>
    </div>
    <div class="card">
      <div class="die-btns" id="die-btns"></div>
      <div class="row" style="margin-top:12px; align-items:flex-end">
        <div class="grow"><label class="field">This roll</label><div id="pool" class="pool"></div></div>
        <div><label class="field">Modifier</label><input type="number" id="mod" value="0" min="-99" max="99" style="width:90px" /></div>
      </div>
      <div class="row" style="margin-top:12px">
        <input type="text" id="label" class="grow" maxlength="60" placeholder="What's this roll for? (optional — e.g. Fireball)" />
        <button class="btn" id="roll-btn">🎲 ROLL</button>
        <button class="btn-ghost" id="clear-btn">Clear</button>
      </div>
      <div class="row" style="margin-top:12px; border-top:1px solid var(--border-soft); padding-top:12px">
        <input type="text" id="preset-name" class="grow" maxlength="40" placeholder="Save this roll as… (e.g. Fireball)" />
        <button class="btn-ghost" id="save-preset">Save preset</button>
        <button class="btn-ghost" id="cancel-edit" hidden>Cancel edit</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 class="section">My Saved Rolls</h3>
      <div id="presets"></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="row" style="justify-content:space-between">
        <h3 class="section" style="margin:0">The Table's Luck</h3>
        <span class="muted small" id="live-dot">● live</span>
      </div>
      <div id="feed"></div>
    </div>`;

  const stage = createRollStage(ctx.nameOf);
  root.querySelector("#d3-toggle").onchange = (e) => {
    setDice3dEnabled(e.target.checked);
    toast(e.target.checked ? "3D dice on — next roll tumbles in 3D" : "3D dice off — classic tumble");
  };

  /* ── die buttons ── */
  const btnWrap = root.querySelector("#die-btns");
  DIE_TYPES.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "die-btn";
    b.innerHTML = dieSvg(s, "d" + s, "mini");
    b.title = `Add a d${s}`;
    b.onclick = () => {
      const count = [...pool.values()].reduce((a, b2) => a + b2, 0);
      if (count >= MAX_DICE) return toast(`Max ${MAX_DICE} dice per roll`);
      pool.set(s, (pool.get(s) || 0) + 1);
      renderPool();
    };
    btnWrap.appendChild(b);
  });

  function renderPool() {
    const el = root.querySelector("#pool");
    if (!pool.size) { el.innerHTML = `<span class="muted small" style="font-style:italic">Tap dice above to build a roll…</span>`; return; }
    el.innerHTML = "";
    [...pool.entries()].sort((a, b) => a[0] - b[0]).forEach(([sides, count]) => {
      const chip = document.createElement("span");
      chip.className = "pool-chip";
      chip.innerHTML = `${count}×d${sides} <button type="button" title="Remove one">−</button>`;
      chip.querySelector("button").onclick = () => {
        count > 1 ? pool.set(sides, count - 1) : pool.delete(sides);
        renderPool();
      };
      el.appendChild(chip);
    });
  }
  renderPool();

  const currentSpec = () => [...pool.entries()].sort((a, b) => a[0] - b[0]).map(([sides, count]) => ({ sides, count }));
  const readMod = () => Math.max(-99, Math.min(99, parseInt(root.querySelector("#mod").value, 10) || 0));

  /* ── rolling ── */
  root.querySelector("#roll-btn").onclick = () => {
    if (!pool.size) return toast("Tap some dice first");
    guard(async () => {
      const row = await dice.roll(root.querySelector("#label").value.trim(), currentSpec(), readMod());
      showRoll(row);
    });
  };
  root.querySelector("#clear-btn").onclick = () => { pool = new Map(); root.querySelector("#mod").value = 0; root.querySelector("#label").value = ""; renderPool(); };

  /* ── presets ── */
  async function renderPresets() {
    const el = root.querySelector("#presets");
    const list = await dice.presets.list();
    if (!list.length) { el.innerHTML = `<p class="muted small" style="font-style:italic">None yet. Build a roll above, name it, hit Save preset.</p>`; return; }
    el.innerHTML = "";
    list.forEach((p) => {
      const row = document.createElement("div");
      row.className = "row preset-row";
      row.innerHTML = `
        <strong>${esc(p.name)}</strong>
        <span class="pill steel">${esc(specText(p.spec, p.modifier))}</span>
        <span class="row" style="margin-left:auto; gap:6px">
          <button class="btn p-roll">Roll</button>
          <button class="btn-ghost p-edit">Edit</button>
          <button class="btn-danger p-del">✕</button>
        </span>`;
      row.querySelector(".p-roll").onclick = () =>
        guard(async () => { const r = await dice.roll(p.name, p.spec, p.modifier); showRoll(r); });
      row.querySelector(".p-edit").onclick = () => {
        pool = new Map(p.spec.map((s) => [s.sides, s.count]));
        root.querySelector("#mod").value = p.modifier;
        root.querySelector("#label").value = p.name;
        root.querySelector("#preset-name").value = p.name;
        editingPreset = p;
        root.querySelector("#save-preset").textContent = `Update "${p.name}"`;
        root.querySelector("#cancel-edit").hidden = false;
        renderPool();
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
      row.querySelector(".p-del").onclick = () => {
        if (!confirm(`Delete preset "${p.name}"?`)) return;
        guard(async () => { await dice.presets.remove(p.id); renderPresets(); });
      };
      el.appendChild(row);
    });
  }
  renderPresets();

  function resetEditing() {
    editingPreset = null;
    root.querySelector("#preset-name").value = "";
    root.querySelector("#save-preset").textContent = "Save preset";
    root.querySelector("#cancel-edit").hidden = true;
  }
  root.querySelector("#cancel-edit").onclick = resetEditing;
  root.querySelector("#save-preset").onclick = () => {
    const name = root.querySelector("#preset-name").value.trim();
    if (!name) return toast("Give the preset a name first");
    if (!pool.size) return toast("Tap some dice first");
    guard(async () => {
      await dice.presets.save({ id: editingPreset?.id, name, spec: currentSpec(), modifier: readMod() });
      toast(editingPreset ? "Preset updated" : `"${name}" saved`);
      resetEditing();
      renderPresets();
    });
  };

  /* ── the feed ── */
  function rollCard(row) {
    const div = document.createElement("div");
    div.className = "roll-row";
    const chips = flattenDice(row).map((d) => {
      const cls = d.dropped ? " dropped" : d.sides === 20 && d.result === 20 ? " crit" : d.sides === 20 && d.result === 1 ? " fumble" : "";
      return `<span class="die-chip${cls}" title="d${d.sides}${d.dropped ? " (dropped)" : ""}">${d.result}</span>`;
    });
    div.innerHTML = `
      <div class="row" style="gap:8px">
        <strong>${esc(ctx.nameOf(row.roller_email))}</strong>
        ${row.label ? `<span class="pill gold">${esc(row.label)}</span>` : ""}
        <span class="muted small">${esc(specText(row.dice || [], row.modifier))}</span>
        <span class="when" style="margin-left:auto">${fmtTime(row.created_at)}</span>
      </div>
      <div class="row" style="gap:5px; margin-top:6px">
        ${chips.join("")}
        <span class="roll-total">= ${row.total}</span>
      </div>`;
    return div;
  }

  function addToFeed(row) {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const feed = root.querySelector("#feed");
    feed.prepend(rollCard(row));
    while (feed.children.length > 30) feed.lastChild.remove();
  }

  const initial = await dice.list();
  if (!initial.length) root.querySelector("#feed").innerHTML = `<p class="muted small" style="font-style:italic">No rolls yet. Fate awaits.</p>`;
  initial.slice().reverse().forEach(addToFeed);

  /* ── the show: shared overlay (roll-fx.js) ── */
  function showRoll(row) {
    if (seen.has(row.id)) return;
    addToFeed(row);
    stage.show(row);
  }

  /* ── live updates from the rest of the table ── */
  let pollTimer = null;
  dice.onRoll(
    (row) => showRoll(row),
    (status) => {
      const dot = root.querySelector("#live-dot");
      if (status === "SUBSCRIBED") {
        dot.style.color = "var(--moss)";
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      } else if (!pollTimer) {
        // Realtime unavailable — fall back to checking every 15s.
        dot.style.color = "var(--faint)";
        dot.textContent = "● checking every 15s";
        pollTimer = setInterval(() => guard(async () => {
          (await dice.list()).slice().reverse().forEach((r) => { if (!seen.has(r.id)) showRoll(r); });
        }), 15000);
      }
    }
  );
  if (ctx.mode === "demo") root.querySelector("#live-dot").textContent = "● demo (solo)";
}
