// 🎲 Dice — the table's shared luck.
// Build a pool, roll it, and EVERYONE with this page open sees
// the dice tumble live (Supabase Realtime pushes each new roll).
// Results come from the database's roll_dice() — the browser
// only animates them, so nobody can forge a natural 20.
import { boot, esc, guard, toast } from "../shell.js";
import { dice } from "../db.js";

const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100];
const MAX_DICE = 40;

// One flat-ish polygon per die type (viewBox 0 0 100 100).
const SHAPES = {
  4: "50,8 95,88 5,88",
  6: "14,14 86,14 86,86 14,86",
  8: "50,4 96,50 50,96 4,50",
  10: "50,4 90,34 76,94 24,94 10,34",
  12: "50,4 93,37 77,92 23,92 7,37",
  20: "50,3 91,26 91,74 50,97 9,74 9,26",
  100: "50,3 83,15 97,50 83,85 50,97 17,85 3,50 17,15",
};

function dieSvg(sides, value, cls = "") {
  return `<svg class="die ${cls}" viewBox="0 0 100 100" role="img" aria-label="d${sides}">
    <polygon points="${SHAPES[sides]}" />
    <text x="50" y="${sides === 4 ? 66 : 56}">${esc(value)}</text>
  </svg>`;
}

function specText(spec, modifier) {
  let out = spec.map((s) => `${s.count}d${s.sides}`).join(" + ");
  if (modifier > 0) out += ` + ${modifier}`;
  if (modifier < 0) out += ` − ${Math.abs(modifier)}`;
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

  const stage = document.createElement("div");
  stage.id = "roll-stage";
  document.body.appendChild(stage);

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
    const chips = [];
    (row.dice || []).forEach((d) => d.results.forEach((r) => {
      const crit = d.sides === 20 && r === 20 ? " crit" : d.sides === 20 && r === 1 ? " fumble" : "";
      chips.push(`<span class="die-chip${crit}" title="d${d.sides}">${r}</span>`);
    }));
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

  /* ── the show: tumbling dice overlay ── */
  const queue = [];
  let staging = false;
  function showRoll(row) {
    if (seen.has(row.id)) return;
    queue.push(row);
    addToFeed(row);
    if (!staging) nextShow();
  }
  async function nextShow() {
    const row = queue.shift();
    if (!row) { staging = false; return; }
    staging = true;
    const flat = [];
    (row.dice || []).forEach((d) => d.results.forEach((r) => flat.push({ sides: d.sides, result: r })));
    const shownDice = flat.slice(0, 12);
    stage.innerHTML = `
      <div class="who">${esc(ctx.nameOf(row.roller_email))} rolls${row.label ? ` <em>${esc(row.label)}</em>` : ""}…</div>
      <div class="dice-row">${shownDice.map((d) => dieSvg(d.sides, "?", "tumbling")).join("")}</div>
      <div class="sum"></div>`;
    stage.classList.add("show");
    stage.classList.remove("done");
    const dieEls = [...stage.querySelectorAll(".die")];
    const flicker = setInterval(() => {
      dieEls.forEach((el, i) => {
        if (el.classList.contains("tumbling"))
          el.querySelector("text").textContent = 1 + Math.floor(Math.random() * shownDice[i].sides);
      });
    }, 75);
    await sleep(850);
    dieEls.forEach((el, i) => setTimeout(() => {
      const d = shownDice[i];
      el.classList.remove("tumbling");
      el.querySelector("text").textContent = d.result;
      if (d.sides === 20 && d.result === 20) el.classList.add("crit");
      if (d.sides === 20 && d.result === 1) el.classList.add("fumble");
      el.classList.add("landed");
    }, i * 90));
    await sleep(shownDice.length * 90 + 250);
    clearInterval(flicker);
    const extra = flat.length - shownDice.length;
    stage.querySelector(".sum").textContent =
      `${specText(row.dice || [], row.modifier)}${extra > 0 ? ` (+${extra} more)` : ""}  =  ${row.total}`;
    stage.classList.add("done");
    await sleep(2000);
    stage.classList.remove("show");
    await sleep(300);
    nextShow();
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
