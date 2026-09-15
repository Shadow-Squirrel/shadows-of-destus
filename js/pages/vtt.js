// ⚔️ Battle Map — the table's shared battlefield.
// The DM sets a scene (map + grid), stages monsters, and flips it
// LIVE; every open page follows along over Supabase Realtime.
// Players drag their own hero, roll initiative, and cast spells
// whose effects burst on everyone's screen at once (effects.js).
// Demo mode plays the whole thing solo, in memory.
import { boot, esc, guard, toast } from "../shell.js";
import { vtt, characters, dice, maps, homebrewMonsters, ai, getCampaign } from "../db.js";
import { createBoard } from "../vtt/board.js";
import { createFx } from "../vtt/effects.js";
import { createRollStage, dieSvg } from "../roll-fx.js";
import { derive, parseDice, abilityMod, fmtMod } from "../dnd/rules.js";
import { migrateCharacter } from "../dnd/model.js";
import { longRest, shortRest, spendHitDie, currentHp, hitDiceLeft } from "../dnd/rest.js";
import { MONSTERS } from "../dnd/data/monsters.js";
import { CONDITIONS } from "../dnd/data/core.js";
import { SPELLS } from "../dnd/data/spells.js";
import { openModal, advToggle, spellMetaLine, spellText, ordinal, cap } from "./characters/common.js";

const PC_COLORS = ["#7fa860", "#5e8fa8", "#a8895e", "#9b8ec9", "#c0895b", "#8fb0a3"];
const SIZE_OF = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };
const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100];
const MAX_DICE = 40;

// highest key ≤ lv in an atSlot/atChar map — same rule the sheet uses.
function pickAtKey(map, lv) {
  const keys = Object.keys(map || {}).map(Number).sort((a, b) => a - b);
  if (!keys.length) return null;
  let best = null;
  for (const k of keys) if (k <= lv) best = k;
  return best ?? keys[0];
}

// merge several "2d6+5"-style entries into one roll spec
function specFromDamages(damages) {
  const spec = [];
  let modifier = 0, any = false;
  for (const d of damages || []) {
    const p = parseDice(d.dice, 0);
    if (!p) continue;
    any = true;
    spec.push(...p.spec);
    modifier += p.modifier;
  }
  return any ? { spec, modifier } : null;
}

// MONSTER_DETAILS is huge — load it only when someone opens a stat block.
let _mdetails = null;
async function detailsOf(index) {
  _mdetails ??= (await import("../dnd/data/monster-details.js")).MONSTER_DETAILS;
  return _mdetails[index] || null;
}

const ctx = await boot("vtt.html", "Battle Map");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  const isDM = ctx.me.isDM;
  const myEmail = ctx.me.email;

  /* ── page state ── */
  let encounters = [];
  let current = null;          // the encounter being viewed
  let tokens = [];             // tokens of `current` (players: hidden already filtered)
  let allMaps = [];
  let charsAll = [];
  let hbById = {};             // homebrew monsters by id (custom bestiary)
  let sideTab = "tokens";
  let castSelId = "";          // Cast tab: chosen character id
  let bq = "", bcr = "any";    // Bestiary search + CR filter
  let trayPool = new Map(), trayMod = 0, trayLabel = "";   // Dice tab
  let targeting = null;        // {kind:"monster"|"cast"|"attack", ...}
  let menuEl = null, menuTok = null, menuAnchor = { x: 16, y: 16 };
  let liveStatus = ctx.mode === "demo" ? "demo" : "connecting";
  const seenRolls = new Set();

  // derive/migrate caches (cleared per character on save)
  const _sheets = new Map(), _drv = new Map();
  const sheetOf = (row) => {
    if (!_sheets.has(row.id)) _sheets.set(row.id, migrateCharacter(row.sheet || {}));
    return _sheets.get(row.id);
  };
  const drvOf = (row) => {
    if (!_drv.has(row.id)) {
      try { _drv.set(row.id, derive(sheetOf(row))); } catch (e) { console.error(e); _drv.set(row.id, null); }
    }
    return _drv.get(row.id);
  };
  const uncache = (id) => { _sheets.delete(id); _drv.delete(id); };

  const charById = (id) => charsAll.find((c) => c.id === id) || null;
  const ownsChar = (c) => !!c && String(c.owner_email || "").toLowerCase() === myEmail;
  const isMine = (t) => t.kind === "pc" && ownsChar(charById(t.character_id));
  const canEditInit = (t) => isDM || isMine(t);
  const centerOf = (t) => ({ x: t.x + t.size / 2, y: t.y + t.size / 2 });
  const visibleTokens = () => tokens.filter((t) => isDM || !t.hidden);
  const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "Hero";
  // the token whose footprint covers a picked cell (world coords), if any
  const tokenAt = (pt) => visibleTokens().find((t) =>
    pt.x >= t.x && pt.x < t.x + t.size && pt.y >= t.y && pt.y < t.y + t.size) || null;

  // Spells whose effect lingers on whatever token they land on: casting one
  // tags the target so the board shows it for the spell's duration. board.js
  // renders conditions (translucent, stone-gray, toppled, …) and the optional
  // `aura` glow hint entirely from the token's synced fields, so wiring is just
  // "add the condition / set the aura" — it clears when removed from the token
  // menu. Keyed by SRD spell index.
  const SPELL_TOKEN_EFFECT = {
    invisibility:           { cond: "invisible" },
    "greater-invisibility": { cond: "invisible" },
    "flesh-to-stone":       { cond: "petrified" },
    "hold-person":          { cond: "paralyzed" },
    "hold-monster":         { cond: "paralyzed" },
    "power-word-stun":      { cond: "stunned" },
    sleep:                  { cond: "unconscious" },
    web:                    { cond: "restrained" },
    entangle:               { cond: "restrained" },
    "black-tentacles":      { cond: "restrained" },
    bless:                  { aura: "bless" },
    "faerie-fire":          { aura: "holy" },
    stoneskin:              { aura: "stone" },
    "fire-shield":          { aura: "burning" },
    blur:                   { aura: "blur" },
  };

  /* ── skeleton ── */
  root.innerHTML = `
    <div class="vtt-toolbar" id="toolbar"></div>
    <div id="no-enc"></div>
    <div class="vtt-layout" id="layout" style="display:none">
      <div class="board-wrap" id="board-wrap"></div>
      <div class="vtt-side">
        <div class="card">
          <div class="side-tabs" id="side-tabs"></div>
          <div id="side-body"></div>
        </div>
      </div>
    </div>`;
  const wrap = root.querySelector("#board-wrap");
  const advEl = advToggle("normal", () => {});
  const adv = () => advEl.get();

  /* ── the board (pure canvas view) ── */
  const board = createBoard(wrap, {
    canMove: (t) => isDM || isMine(t),
    onMoveToken: (id, x, y) => guard(async () => {
      const t = tokens.find((k) => k.id === id);
      if (!t) return;
      Object.assign(t, { x, y });
      pushTokens();
      await vtt.tokens.update(id, { x, y });
    }),
    // the board hands back its own copy — swap in our live row by id
    onSelectToken: (t, screenPt) => {
      const mine = t && (tokens.find((k) => k.id === t.id) || null);
      mine ? openTokenMenu(mine, screenPt) : closeMenu();
    },
    onPickPoint: (pt) => guard(() => onPick(pt)),
  });
  const hint = document.createElement("div");
  hint.className = "board-hint hidden";
  wrap.appendChild(hint);
  const showHint = (text) => { hint.textContent = text; hint.classList.remove("hidden"); };
  const hideHint = () => hint.classList.add("hidden");

  /* ── effects channel (spells & swings, never stored) ── */
  const fx = createFx(board.fxCanvas, board.view);
  const fxCh = vtt.fx.join((p) => {
    try { p.kind === "spell" ? fx.playSpell(p) : fx.playAttack(p); } catch (e) { console.error(e); }
  });

  /* ── the dice show, identical to every other page ── */
  const rollStage = createRollStage(ctx.nameOf);
  // rolls fired from inside a stat-block modal must ride above it
  const stageEl = document.getElementById("roll-stage");
  if (stageEl) stageEl.style.zIndex = "70";
  function showRoll(row) {
    if (!row || seenRolls.has(row.id)) return;
    seenRolls.add(row.id);
    rollStage.show(row);
  }
  dice.onRoll((row) => showRoll(row));

  async function rollD20(label, modifier, { crits = false } = {}) {
    const row = await dice.rollCheck(String(label).slice(0, 60), modifier, adv());
    showRoll(row);
    if (crits) {
      const d = (row.dice || []).find((x) => x.sides === 20);
      if (d && d.results?.length) {
        const kept = d.results.length === 2
          ? (d.keep === "low" ? Math.min(...d.results) : Math.max(...d.results))
          : d.results[0];
        if (kept === 20) toast("Critical hit! Roll damage twice or double the dice.");
      }
    }
    return row;
  }
  async function rollSpec(label, spec, modifier = 0) {
    const row = await dice.roll(String(label).slice(0, 60), spec, modifier);
    showRoll(row);
    return row;
  }

  /* ── targeting (one pick, then the board disarms itself) ── */
  function armTargeting(t, text) {
    closeMenu();
    targeting = t;
    board.setTargeting(true);
    showHint(text);
  }
  function disarmTargeting() {
    targeting = null;
    board.setTargeting(false);
    hideHint();
  }
  async function onPick(pt) {
    const t = targeting;
    targeting = null;
    hideHint();
    if (!t || !current) return;

    if (t.kind === "monster") {
      const m = t.m;
      const size = SIZE_OF[m.size] || 1;
      const x = Math.round(pt.x - size / 2), y = Math.round(pt.y - size / 2);
      const repeats = tokens.filter((k) => k.kind === "monster" && k.monster_index === m.index).length;
      const letter = String.fromCharCode(65 + (repeats % 26)) + (repeats >= 26 ? Math.floor(repeats / 26) + 1 : "");
      const fresh = await vtt.tokens.add({
        encounter_id: current.id, kind: "monster", monster_index: m.index,
        label: `${m.name} ${letter}`, x, y, size, color: "",
        hp_current: m.hp, hp_max: m.hp, conditions: [], hidden: true, initiative: null,
      });
      if (fresh && !tokens.some((k) => k.id === fresh.id)) tokens.push(fresh);
      pushTokens(); renderSide();
      toast(`${m.name} ${letter} placed hidden — reveal from its menu`);
      return;
    }

    if (t.kind === "attack") {
      const { token, action } = t;
      const ranged = /ranged weapon attack|range \d/i.test(action.desc || "");
      fxCh.send({
        kind: "attack", from: centerOf(token), to: pt,
        ranged, dmgType: (action.damage?.[0]?.type || "").toLowerCase() || null,
      });
      await rollD20(`${token.label} · ${action.name}`, action.attackBonus || 0, { crits: true });
      openTokenMenu(token, null, { showActions: true }); // damage button is right there
      return;
    }

    if (t.kind === "cast") {
      const { crow, sp, custom, slot } = t;
      const sheet = sheetOf(crow), drv = drvOf(crow), sc = drv?.spellcasting || null;
      const myTok = visibleTokens().find((k) => k.kind === "pc" && k.character_id === crow.id);
      fxCh.send({
        kind: "spell",
        spell: custom ? { ...custom } : sp.index,
        from: myTok ? centerOf(myTok) : null,
        to: pt,
      });
      const lv = sp.level > 0 && slot ? slot.lv : 0;
      const label = `${firstName(crow.name)} · ${sp.name}${lv ? ` (${ordinal(lv)})` : ""}`;
      const scMod = sc ? (drv.abilities[sc.ability]?.mod ?? 0) : 0;
      let p = null;
      if (custom) p = custom.dmg ? parseDice(custom.dmg, scMod) : null;
      else if (sp.damage?.atSlot) {
        const k = pickAtKey(sp.damage.atSlot, lv || sp.level);
        p = k != null ? parseDice(sp.damage.atSlot[k], 0) : null;
      } else if (sp.damage?.atChar) {
        const k = pickAtKey(sp.damage.atChar, drv?.level ?? 1);
        p = k != null ? parseDice(sp.damage.atChar[k], 0) : null;
      } else if (sp.heal?.atSlot) {
        const k = pickAtKey(sp.heal.atSlot, lv || sp.level);
        p = k != null ? parseDice(sp.heal.atSlot[k], scMod) : null;
      }
      if (p) await rollSpec(label, p.spec, p.modifier);
      // spend the slot — but never someone else's without asking
      if (sp.level > 0 && sc && slot) {
        if (ownsChar(crow)) {
          if (slot.pact) sheet.spells.pactUsed = (sheet.spells.pactUsed || 0) + 1;
          else sheet.spells.slotsUsed[slot.lv - 1] = (sheet.spells.slotsUsed[slot.lv - 1] || 0) + 1;
          uncache(crow.id);
          _sheets.set(crow.id, sheet);
          await characters.save({ id: crow.id, name: crow.name, sheet }, crow.owner_email);
          crow.sheet = sheet;
        } else toast("slot not spent (not your sheet)");
      }
      // lasting spells leave their mark on the token they land on, so the
      // board shows the effect for the duration (cleared from the token menu)
      const eff = !custom && SPELL_TOKEN_EFFECT[sp.index];
      if (eff) {
        const tgt = tokenAt(pt);
        if (tgt && (isDM || isMine(tgt))) {
          const patch = {};
          if (eff.cond) {
            const cur = Array.isArray(tgt.conditions) ? tgt.conditions.map(String) : [];
            if (!cur.includes(eff.cond)) patch.conditions = [...cur, eff.cond];
          }
          if (eff.aura && tgt.aura !== eff.aura) patch.aura = eff.aura;
          if (Object.keys(patch).length) {
            await updateToken(tgt, patch);
            const noun = eff.cond ? (CONDITIONS[eff.cond]?.name || eff.cond) : sp.name;
            toast(`${tgt.label}: ${noun} — clear from its token menu when it ends`);
          }
        }
      }
      renderSide();
    }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (targeting) disarmTargeting();
    closeMenu();
  });

  /* ═══════════ data loading ═══════════ */
  async function refreshAll(keepId) {
    let hbList = [];
    [encounters, allMaps, charsAll, hbList] = await Promise.all([
      vtt.encounters.list(), maps.list(), characters.list(),
      homebrewMonsters.list().catch(() => []),
    ]);
    hbById = {};
    hbList.forEach((h) => { hbById[h.id] = h; });
    const active = encounters.find((e) => e.active) || null;
    if (isDM) current = encounters.find((e) => e.id === keepId) || active || encounters[0] || null;
    else current = active;
    await loadEncounter();
  }

  async function loadEncounter() {
    closeMenu();
    disarmTargeting();
    if (!current) { tokens = []; renderAll(); return; }
    board.setGrid(current.grid || { cell: 70, feet: 5, show: true });
    let rows = await vtt.tokens.list(current.id);
    if (!isDM) rows = rows.filter((t) => !t.hidden);
    tokens = rows;
    await applyMap();
    board.fit();
    renderAll();
  }

  async function applyMap() {
    let url = null;
    const m = current?.map_id ? allMaps.find((x) => x.id === current.map_id) : null;
    // Uploaded maps live in private storage (storage_path) and need a signed
    // URL; a map may instead point at an external image via image_url. Mirror
    // the Maps page exactly: prefer the uploaded file, else the direct link.
    if (m?.storage_path) {
      try {
        const urls = await maps.signedUrls([m.storage_path]);
        url = urls[m.storage_path] || null;
      } catch (e) { console.error(e); }
    } else if (m?.image_url) {
      url = m.image_url;
    }
    board.setMap(url);
  }

  function pushTokens() {
    board.setTokens(visibleTokens().map((t) => ({ ...t, _turn: !!current && current.turn === t.id })));
  }

  function renderAll() {
    root.querySelector("#layout").style.display = current ? "" : "none";
    pushTokens();
    renderToolbar();
    renderEmptyState();
    renderSide();
  }

  /* ═══════════ live sync ═══════════ */
  vtt.tokens.onChange((ev) => guard(async () => {
    if (ev.table === "tokens") {
      if (!current) return;
      if (ev.type === "DELETE") {
        const id = ev.old?.id;
        if (!id || !tokens.some((t) => t.id === id)) return;
        tokens = tokens.filter((t) => t.id !== id);
        if (menuTok?.id === id) closeMenu();
      } else {
        const row = ev.new;
        if (!row || row.encounter_id !== current.id) return;
        if (row.hidden && !isDM) {
          tokens = tokens.filter((t) => t.id !== row.id);
          if (menuTok?.id === row.id) closeMenu();
        } else {
          const i = tokens.findIndex((t) => t.id === row.id);
          i >= 0 ? (tokens[i] = row) : tokens.push(row);
        }
      }
      pushTokens(); renderSide();
      return;
    }
    // encounters
    if (ev.type === "INSERT" && ev.new) {
      if (!encounters.some((e) => e.id === ev.new.id)) encounters.unshift(ev.new);
      if (!current && (isDM || ev.new.active)) { current = ev.new; await loadEncounter(); return; }
      renderToolbar();
      return;
    }
    if (ev.type === "DELETE") {
      const id = ev.old?.id;
      encounters = encounters.filter((e) => e.id !== id);
      if (current?.id === id) { current = encounters.find((e) => e.active) || (isDM ? encounters[0] : null) || null; await loadEncounter(); }
      else renderToolbar();
      return;
    }
    if (ev.type === "UPDATE" && ev.new) {
      const i = encounters.findIndex((e) => e.id === ev.new.id);
      if (i >= 0) encounters[i] = ev.new;
      if (current && ev.new.id === current.id) {
        const gridChanged = JSON.stringify(ev.new.grid) !== JSON.stringify(current.grid);
        const mapChanged = ev.new.map_id !== current.map_id;
        current = ev.new;
        if (mapChanged) await applyMap();
        if (gridChanged) board.setGrid(current.grid);
        pushTokens(); renderToolbar(); renderSide();
      } else if (ev.new.active && !isDM) {
        // the DM went live with a different battle — follow them
        current = ev.new;
        await loadEncounter();
      } else renderToolbar();
    }
  }), (status) => {
    liveStatus = status === "SUBSCRIBED" ? "live" : "off";
    const dot = root.querySelector("#live-dot");
    if (dot) applyDot(dot);
  });

  // players can miss "token became hidden" events (the database no
  // longer shows them the row) — reconcile quietly now and then.
  if (ctx.mode === "real" && !isDM) {
    setInterval(() => guard(async () => {
      if (!current) return;
      const fresh = (await vtt.tokens.list(current.id)).filter((t) => !t.hidden);
      if (JSON.stringify(fresh) === JSON.stringify(tokens)) return;
      tokens = fresh;
      pushTokens(); renderSide();
    }), 30000);
  }

  function applyDot(dot) {
    if (ctx.mode === "demo") { dot.textContent = "● demo (solo)"; dot.style.color = "var(--faint)"; return; }
    if (liveStatus === "live") { dot.textContent = "● live"; dot.style.color = "var(--moss)"; }
    else { dot.textContent = "● connecting…"; dot.style.color = "var(--faint)"; }
  }

  /* ═══════════ toolbar ═══════════ */
  function renderToolbar() {
    const bar = root.querySelector("#toolbar");
    if (isDM) {
      bar.innerHTML = `
        <select id="enc-sel" ${encounters.length ? "" : "hidden"}></select>
        <button class="btn" id="ai-prep" title="Describe a fight — the AI drafts a map, monsters and tokens">⚡ AI Prep</button>
        ${current ? `
          ${current.active
            ? `<span class="pill gold">LIVE</span>`
            : `<button class="btn" id="go-live" title="Everyone's Battle page switches to this encounter">⚑ Go live</button>`}
          <button class="btn-ghost" id="grid-btn" title="Map & grid settings">⚙ Grid</button>
          <button class="btn-danger" id="del-btn" title="Delete this encounter">✕</button>
        ` : ""}
        <span class="spacer"></span>
        ${current ? `<button class="btn-ghost" id="fit-btn">Fit</button>` : ""}
        <span class="muted small">d20:</span><span id="adv-slot"></span>
        <span class="muted small" id="live-dot">●</span>`;
      const sel = bar.querySelector("#enc-sel");
      sel.innerHTML = encounters.map((e) =>
        `<option value="${esc(e.id)}" ${current?.id === e.id ? "selected" : ""}>${esc(e.name)}${e.active ? " · LIVE" : ""}</option>`
      ).join("") + `<option value="__new">▸ new encounter…</option>`;
      sel.onchange = () => guard(async () => {
        if (sel.value === "__new") { sel.value = current?.id || ""; openEncounterModal(null); return; }
        current = encounters.find((e) => e.id === sel.value) || current;
        await loadEncounter();
      });
      const aip = bar.querySelector("#ai-prep");
      if (aip) aip.onclick = () => openAiPrep();
      const go = bar.querySelector("#go-live");
      if (go) go.onclick = () => guard(async () => {
        await vtt.encounters.setActive(current.id);
        encounters.forEach((e) => (e.active = e.id === current.id));
        renderToolbar();
        toast(`"${current.name}" is live — the table sees it now`);
      });
      const gb = bar.querySelector("#grid-btn");
      if (gb) gb.onclick = () => openEncounterModal(current);
      const del = bar.querySelector("#del-btn");
      if (del) del.onclick = () => {
        if (!confirm(`Delete encounter "${current.name}"? Its tokens go with it.`)) return;
        guard(async () => {
          await vtt.encounters.remove(current.id);
          await refreshAll();
        });
      };
    } else {
      bar.innerHTML = `
        ${current
          ? `<strong style="font-family:var(--font-display); color:var(--gold); letter-spacing:.05em">${esc(current.name)}</strong>
             ${current.active ? `<span class="pill gold">LIVE</span>` : ""}`
          : `<span class="muted" style="font-style:italic">The DM hasn't opened a battle yet.</span>`}
        <span class="spacer"></span>
        ${current ? `<button class="btn-ghost" id="fit-btn">Fit</button>` : ""}
        <span class="muted small">d20:</span><span id="adv-slot"></span>
        <span class="muted small" id="live-dot">●</span>`;
    }
    bar.querySelector("#adv-slot").appendChild(advEl);
    const fit = bar.querySelector("#fit-btn");
    if (fit) fit.onclick = () => board.fit();
    applyDot(bar.querySelector("#live-dot"));
  }

  function renderEmptyState() {
    const slot = root.querySelector("#no-enc");
    if (current) { slot.innerHTML = ""; return; }
    slot.innerHTML = isDM ? `
      <div class="card" style="text-align:center; padding:44px 20px">
        <h2 class="section" style="margin-bottom:6px">Set the first scene</h2>
        <p class="muted" style="margin:0 0 18px">Pick a battle map, size the grid, stage your monsters —
        then flip it live when the party walks in. Or let the AI draft the whole fight from a sentence.</p>
        <div class="row" style="justify-content:center; gap:10px; flex-wrap:wrap">
          <button class="btn" id="ai-prep-empty">⚡ AI Prep an encounter</button>
          <button class="btn-ghost" id="first-enc">⚑ New encounter by hand</button>
        </div>
      </div>` : `
      <div class="empty" style="margin-top:10px">No battle raging right now. When the DM goes live,
      the battlefield appears here on its own — keep this page open.</div>`;
    const b = slot.querySelector("#first-enc");
    if (b) b.onclick = () => openEncounterModal(null);
    const ap = slot.querySelector("#ai-prep-empty");
    if (ap) ap.onclick = () => openAiPrep();
  }

  /* encounter create/edit modal (DM) */
  function openEncounterModal(enc) {
    const isNew = !enc;
    const grid = enc?.grid || { cell: 70, feet: 5, show: true };
    const modal = openModal(isNew ? "New encounter" : "Map & grid", `
      <label class="field">Name</label>
      <input type="text" id="em-name" maxlength="80" value="${esc(enc?.name || "")}" placeholder="Ambush on the Mine Road" />
      <label class="field">Battle map</label>
      <select id="em-map">
        <option value="">— no map (blank parchment grid) —</option>
        ${allMaps.map((m) => `<option value="${esc(m.id)}" ${enc?.map_id === m.id ? "selected" : ""}>
          ${esc(m.title)}${m.revealed ? "" : " (hidden from players)"}${(m.storage_path || m.image_url) ? "" : " — no image"}</option>`).join("")}
      </select>
      <div class="row" style="margin-top:10px; align-items:flex-end">
        <div><label class="field">Map pixels per 5-ft square</label>
          <input type="number" id="em-cell" min="8" max="512" value="${esc(grid.cell)}" style="width:110px" /></div>
        <label class="checkline" style="margin-bottom:8px"><input type="checkbox" id="em-show" ${grid.show ? "checked" : ""} /> draw grid lines</label>
      </div>
      <p class="muted small" style="margin:8px 0 0">The cell size calibrates the image: measure one painted
      square of the map in its own pixels. No map? 70 is fine.</p>
      <div class="actions">
        <button class="btn" id="em-save">${isNew ? "Create" : "Save"}</button>
        <button class="btn-ghost" id="em-cancel">Cancel</button>
      </div>`);
    modal.el.querySelector("#em-cancel").onclick = modal.close;
    modal.el.querySelector("#em-save").onclick = () => guard(async () => {
      const name = modal.el.querySelector("#em-name").value.trim() || "Encounter";
      const map_id = modal.el.querySelector("#em-map").value || null;
      const cell = Math.max(8, Math.min(512, parseInt(modal.el.querySelector("#em-cell").value, 10) || 70));
      const show = modal.el.querySelector("#em-show").checked;
      const g = { cell, feet: 5, show };
      if (isNew) {
        const fresh = await vtt.encounters.save({ name, map_id, grid: g, active: false });
        if (fresh && !encounters.some((e) => e.id === fresh.id)) encounters.unshift(fresh);
        current = fresh || encounters[0];
        modal.close();
        await loadEncounter();
        toast(`"${name}" is set — stage it, then ⚑ Go live`);
      } else {
        await vtt.encounters.save({ id: enc.id, name, map_id, grid: g });
        Object.assign(enc, { name, map_id, grid: g });
        modal.close();
        board.setGrid(g);
        await applyMap();
        pushTokens(); renderToolbar();
      }
    });
  }

  /* ═══════════ AI DM-prep accelerator (DM) ═══════════
     Describe a fight in a sentence; the planner (plan-encounter Edge
     Function) drafts a balanced roster + a battle-map prompt, picking
     monsters from the SRD catalogue we hand it. We PREVIEW it — so the DM
     sees exactly what will be spent — then orchestrate: create the
     encounter, draw the map (generate-image), pull each SRD monster or
     generate a homebrew stat block, and drop the tokens, ready to run.
     Every paid step is capped in the database before it fires; failures
     are non-fatal (skipped and reported), so a half-built plan still
     leaves a usable encounter. Nothing goes live until the DM flips it. */
  const clampInt = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Math.round(Number(v) || dflt)));

  // A planned monster → an SRD/homebrew monster object, or null (=> generate).
  function resolvePlanned(mo) {
    const idx = String(mo.srd_index || "").trim().toLowerCase();
    if (idx && MONSTERS[idx]) return MONSTERS[idx];
    const name = String(mo.name || "").trim().toLowerCase();
    if (name) {
      const srd = Object.values(MONSTERS);
      const hit = srd.find((m) => m.name.toLowerCase() === name)
        || srd.find((m) => m.name.toLowerCase() === name.replace(/s$/, ""))
        || Object.values(hbById).map(hbToMonster).find((m) => m.name.toLowerCase() === name);
      if (hit) return hit;
    }
    return null;
  }

  function openAiPrep() {
    if (ctx.mode !== "real") { toast("AI prep needs the live database — not available in demo mode."); return; }
    const state = {
      description: "",
      partyLevel: (() => {
        const lv = charsAll.map((c) => drvOf(c)?.level).filter(Boolean);
        return lv.length ? clampInt(lv.reduce((a, b) => a + b, 0) / lv.length, 1, 20, 3) : 3;
      })(),
      partySize: clampInt(tokens.filter((t) => t.kind === "pc").length || charsAll.length || 4, 1, 10, 4),
      difficulty: "medium",
      wantMap: true,
    };

    const modal = openModal("⚡ AI DM-prep", `<div id="ap-body"></div>`);
    const body = modal.el.querySelector("#ap-body");
    const msg = (s) => { const m = body.querySelector("#ap-msg"); if (m) m.textContent = s || ""; };

    renderCompose();

    /* ── step 1: describe the fight ── */
    function renderCompose() {
      body.innerHTML = `
        <p class="muted small" style="margin:0 0 10px">Describe the fight in a sentence. The AI drafts a balanced
          roster and a battle-map prompt — you review everything before it's built. Nothing is placed until you approve.</p>
        <label class="field">The scene</label>
        <textarea id="ap-desc" style="min-height:70px" placeholder="e.g. a goblin ambush in a pine gorge at dusk — a couple of archers up on the ridge and a snarling worg">${esc(state.description)}</textarea>
        <div class="row" style="gap:14px; margin-top:10px; align-items:flex-end; flex-wrap:wrap">
          <div><label class="field">Party level</label>
            <input type="number" id="ap-lvl" min="1" max="20" value="${state.partyLevel}" style="width:84px" /></div>
          <div><label class="field">Party size</label>
            <input type="number" id="ap-size" min="1" max="10" value="${state.partySize}" style="width:84px" /></div>
          <div><label class="field">Difficulty</label>
            <select id="ap-diff" style="width:auto">
              ${["easy", "medium", "hard", "deadly"].map((d) => `<option value="${d}" ${state.difficulty === d ? "selected" : ""}>${cap(d)}</option>`).join("")}
            </select></div>
        </div>
        <label class="checkline" style="margin-top:12px"><input type="checkbox" id="ap-map" ${state.wantMap ? "checked" : ""} /> also draw a battle map (uses one AI image)</label>
        <div class="actions" style="margin-top:14px">
          <button class="btn" id="ap-plan">✨ Plan the encounter</button>
          <button class="btn-ghost" id="ap-cancel">Cancel</button>
          <span class="muted small" id="ap-msg"></span>
        </div>
        <p class="muted small" id="ap-quota" style="margin:8px 0 0"></p>`;
      body.querySelector("#ap-cancel").onclick = modal.close;
      body.querySelector("#ap-plan").onclick = onPlan;
      (async () => {
        let usage = null;
        try { usage = await ai.textUsage(); } catch {}
        const q = body.querySelector("#ap-quota");
        if (!q) return;
        if (!usage) q.innerHTML = `<span class="pill mystic">AI not set up</span> Deploy <code>plan-encounter</code> and set a provider key — see <code>docs/AI-DM-PREP.md</code>. You can still build encounters by hand.`;
        else q.textContent = `Planner budget: ${usage.remaining ?? 0} of ${usage.cap ?? "?"} left this month. The map and any custom monsters draw their own budgets.`;
      })();
    }

    function readCompose() {
      state.description = body.querySelector("#ap-desc").value.trim();
      state.partyLevel = clampInt(body.querySelector("#ap-lvl").value, 1, 20, 3);
      state.partySize = clampInt(body.querySelector("#ap-size").value, 1, 10, 4);
      state.difficulty = body.querySelector("#ap-diff").value;
      state.wantMap = body.querySelector("#ap-map").checked;
    }

    function onPlan() {
      readCompose();
      if (!state.description) { toast("Describe the fight first"); return; }
      const btn = body.querySelector("#ap-plan");
      btn.disabled = true; msg("Consulting the loremasters… (a few seconds)");
      guard(async () => {
        try {
          const srd = Object.values(MONSTERS).map((m) => ({ i: m.index, n: m.name, cr: m.crText }));
          const plan = await ai.planEncounter({
            campaignId: getCampaign(), description: state.description,
            partyLevel: state.partyLevel, partySize: state.partySize,
            difficulty: state.difficulty, srd,
          });
          if (!plan || !Array.isArray(plan.monsters)) throw new Error("No plan came back — try again");
          renderPreview(plan);
        } catch (e) {
          btn.disabled = false; msg("");
          if (e.code === "not-configured") { toast("AI prep isn't set up yet — see docs/AI-DM-PREP.md"); return; }
          toast("⚠ " + (e.message || "Planning failed"));
        }
      });
    }

    /* ── step 2: review the plan (what will be built + spent) ── */
    function renderPreview(plan) {
      const rows = (plan.monsters || []).map((mo) => {
        const resolved = resolvePlanned(mo);
        return {
          name: mo.name || (resolved ? resolved.name : "Creature"),
          count: clampInt(mo.count, 1, 12, 1),
          cr: String(mo.cr || (resolved ? resolved.crText : "?")),
          homebrew_prompt: mo.homebrew_prompt || mo.name || "",
          resolved, include: true,
        };
      });
      body.innerHTML = `
        <label class="field">Encounter name</label>
        <input type="text" id="ap-title" maxlength="80" value="${esc(plan.title || "AI encounter")}" />
        ${plan.summary ? `<p class="muted small" style="margin:8px 0 0; font-style:italic">${esc(plan.summary)}</p>` : ""}
        ${state.wantMap ? `
          <label class="field" style="margin-top:12px">Battle-map prompt <span class="muted small">(FLUX draws this)</span></label>
          <textarea id="ap-mapprompt" style="min-height:52px">${esc(plan.map_prompt || "")}</textarea>` : ""}
        <label class="field" style="margin-top:12px">Roster <span class="muted small">(untick any you don't want)</span></label>
        <div id="ap-roster"></div>
        <p class="muted small" id="ap-tally" style="margin:10px 0 0"></p>
        <div class="actions" style="margin-top:12px">
          <button class="btn" id="ap-build">⚔ Build encounter</button>
          <button class="btn-ghost" id="ap-back">← Re-describe</button>
          <span class="muted small" id="ap-msg"></span>
        </div>`;
      const roster = body.querySelector("#ap-roster");
      roster.innerHTML = rows.length ? rows.map((r, i) => `
        <div class="row" style="justify-content:space-between; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--border-soft)">
          <label class="checkline" style="margin:0; flex:1">
            <input type="checkbox" data-inc="${i}" checked />
            <span>${esc(r.name)} <span class="muted small">×${r.count} · CR ${esc(r.cr)}</span></span>
          </label>
          <span class="pill ${r.resolved ? (r.resolved.homebrew ? "mystic" : "moss") : "gold"}">${r.resolved ? (r.resolved.homebrew ? "homebrew" : "SRD") : "generate"}</span>
        </div>`).join("") : `<p class="muted small" style="font-style:italic">The plan has no monsters — Re-describe with some foes.</p>`;
      const tally = body.querySelector("#ap-tally");
      const updateTally = () => {
        const chosen = rows.filter((r) => r.include);
        const gen = chosen.filter((r) => !r.resolved).length;
        const placing = chosen.reduce((a, r) => a + r.count, 0);
        tally.innerHTML =
          `Will place <strong>${placing}</strong> token${placing === 1 ? "" : "s"}.` +
          (state.wantMap ? " Draws <strong>1</strong> map image." : "") +
          (gen ? ` Generates <strong>${gen}</strong> custom stat block${gen === 1 ? "" : "s"} (each spends a planner-budget slot).` : " No extra monster generations.");
      };
      updateTally();
      roster.querySelectorAll("[data-inc]").forEach((el) =>
        (el.onchange = () => { rows[+el.dataset.inc].include = el.checked; updateTally(); }));
      body.querySelector("#ap-back").onclick = renderCompose;
      body.querySelector("#ap-build").onclick = () => {
        const title = body.querySelector("#ap-title").value.trim() || "AI encounter";
        const mapPrompt = state.wantMap ? (body.querySelector("#ap-mapprompt").value.trim() || plan.map_prompt || "") : "";
        const chosen = rows.filter((r) => r.include);
        if (!chosen.length) { toast("Pick at least one monster, or Re-describe"); return; }
        runBuild({ title, wantMap: state.wantMap, mapPrompt, rows: chosen });
      };
    }

    /* ── step 3: orchestrate the build, with a live checklist ── */
    function runBuild({ title, wantMap, mapPrompt, rows }) {
      const steps = [{ key: "enc", label: "Create encounter", st: "run" }];
      if (wantMap) steps.push({ key: "map", label: "Draw the battle map", st: "wait" });
      rows.forEach((r, i) => steps.push({ key: "mon" + i, label: `${r.resolved ? "Place" : "Generate + place"} ${r.name} ×${r.count}`, st: "wait" }));
      steps.push({ key: "open", label: "Open the encounter", st: "wait" });
      const glyph = (s) => s === "done" ? "✓" : s === "run" ? "⏳" : s === "err" ? "⚠" : "·";
      const render = () => {
        body.innerHTML = `
          <p class="muted small" style="margin:0 0 10px">Building your encounter — keep this open…</p>
          <div>${steps.map((s) => `
            <div class="row" style="gap:8px; padding:4px 0; align-items:flex-start">
              <span style="width:1.2em; text-align:center; color:${s.st === "done" ? "var(--moss)" : s.st === "err" ? "var(--ember)" : "var(--muted)"}">${glyph(s.st)}</span>
              <span style="${s.st === "wait" ? "color:var(--faint)" : ""}">${esc(s.label)}${s.note ? ` <span class="muted small">— ${esc(s.note)}</span>` : ""}</span>
            </div>`).join("")}</div>
          <div class="actions" id="ap-fin" style="margin-top:12px" hidden></div>`;
      };
      const set = (key, st, note) => { const s = steps.find((x) => x.key === key); if (s) { s.st = st; if (note !== undefined) s.note = note; } render(); };
      render();

      // token layout: a compact block near the top-left; the DM drags to taste
      const placed = {};                 // monster_index → count (for A/B/C labels)
      const lay = { x: 2, y: 2, rowH: 1, startX: 2, wrapW: 14 };
      const nextSlot = (size) => {
        if (lay.x + size > lay.startX + lay.wrapW) { lay.x = lay.startX; lay.y += lay.rowH + 1; lay.rowH = 1; }
        const p = { x: lay.x, y: lay.y };
        lay.x += size + 1; lay.rowH = Math.max(lay.rowH, size);
        return p;
      };
      async function placeGroup(encId, m, count) {
        const size = SIZE_OF[m.size] || 1;
        for (let n = 0; n < count; n++) {
          const repeats = placed[m.index] || 0; placed[m.index] = repeats + 1;
          const letter = String.fromCharCode(65 + (repeats % 26)) + (repeats >= 26 ? Math.floor(repeats / 26) + 1 : "");
          const p = nextSlot(size);
          await vtt.tokens.add({
            encounter_id: encId, kind: "monster", monster_index: m.index,
            label: `${m.name} ${letter}`, x: p.x, y: p.y, size, color: "",
            hp_current: m.hp, hp_max: m.hp, conditions: [], hidden: false, initiative: null,
          });
        }
      }

      guard(async () => {
        const warnings = [];
        // 1. create the encounter (inactive; the DM reviews, then Go live)
        let enc;
        try {
          enc = await vtt.encounters.save({ name: title, map_id: null, grid: { cell: 70, feet: 5, show: true }, active: false });
          if (enc && !encounters.some((e) => e.id === enc.id)) encounters.unshift(enc);
          set("enc", "done");
        } catch (e) {
          set("enc", "err", e.message || "failed");
          finish(null, ["Couldn't create the encounter — nothing was built."]);
          return;
        }

        // 2. battle map (optional, non-fatal)
        if (wantMap) {
          set("map", "run");
          try {
            const r = await ai.generate({ campaignId: getCampaign(), kind: "map", prompt: mapPrompt });
            if (r?.mapId) {
              await vtt.encounters.save({ id: enc.id, map_id: r.mapId });
              enc.map_id = r.mapId;
              allMaps = await maps.list().catch(() => allMaps);   // so applyMap can find it
              set("map", "done");
            } else set("map", "done", "drawn, but no map id returned");
          } catch (e) {
            const m = e.code === "not-configured" ? "AI images not set up — skipped" : (e.message || "map failed");
            set("map", "err", m); warnings.push("Map: " + m);
          }
        }

        // 3. monsters: resolve to SRD/homebrew, generating custom ones as needed
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i], key = "mon" + i;
          set(key, "run");
          let m = r.resolved;
          if (!m) {
            try {
              const gen = await ai.generateMonster({ campaignId: getCampaign(), prompt: r.homebrew_prompt || r.name });
              if (!gen) throw new Error("no stat block");
              const cr = String(gen.cr || r.cr || "");
              const saved = await homebrewMonsters.save({ name: gen.name || r.name, cr, data: gen, art_path: null });
              const id = saved?.id;
              if (!id) throw new Error("couldn't save");
              hbById[id] = { id, name: gen.name || r.name, cr, data: gen, art_path: null };  // resolve immediately
              m = hbToMonster(hbById[id]);
            } catch (e) {
              const note = e.code === "not-configured" ? "AI monsters not set up — skipped" : (e.message || "generation failed");
              set(key, "err", note); warnings.push(`${r.name}: ${note}`);
              continue;
            }
          }
          try { await placeGroup(enc.id, m, r.count); set(key, "done"); }
          catch (e) { set(key, "err", e.message || "placement failed"); warnings.push(`${r.name}: couldn't place`); }
        }

        // 4. open it (loads tokens + map, renders board & panels)
        set("open", "run");
        try {
          current = enc;
          await loadEncounter();
          set("open", "done");
        } catch (e) {
          set("open", "err", e.message || "couldn't open");
          warnings.push("Built, but couldn't open it automatically — pick it from the encounter list.");
        }
        finish(enc, warnings);
      });

      function finish(enc, warnings) {
        const fin = body.querySelector("#ap-fin");
        if (fin) {
          fin.hidden = false;
          fin.innerHTML = `
            ${warnings.length
              ? `<p class="small" style="color:var(--ember); margin:0 0 8px">${warnings.map(esc).join("<br>")}</p>`
              : `<p class="small" style="color:var(--moss); margin:0 0 8px">Ready. Review the board, then <strong>⚑ Go live</strong> when the party arrives.</p>`}
            <button class="btn" id="ap-done">Done</button>`;
          const d = fin.querySelector("#ap-done"); if (d) d.onclick = modal.close;
        }
        if (enc) toast(warnings.length ? "Encounter built (a couple of steps were skipped)" : "Encounter ready — ⚑ Go live when you're set");
      }
    }
  }

  /* ═══════════ side panel ═══════════ */
  const TABS = () => [
    ["tokens", "Tokens"],
    ...(isDM ? [["bestiary", "Bestiary"]] : []),
    ["init", "Initiative"],
    ["cast", "Cast"],
    ["dice", "Dice"],
  ];

  function renderSide() {
    if (!current) return;
    const tabs = root.querySelector("#side-tabs");
    tabs.innerHTML = TABS().map(([k, label]) =>
      `<button class="${sideTab === k ? "btn" : "btn-ghost"}" data-tab="${k}">${label}</button>`).join("");
    tabs.querySelectorAll("button").forEach((b) => (b.onclick = () => { sideTab = b.dataset.tab; renderSide(); }));
    const body = root.querySelector("#side-body");
    if (sideTab === "tokens") renderTokensTab(body);
    else if (sideTab === "bestiary") renderBestiaryTab(body);
    else if (sideTab === "init") renderInitTab(body);
    else if (sideTab === "cast") renderCastTab(body);
    else renderDiceTab(body);
  }

  /* ── Tokens tab ── */
  function tokenSub(t) {
    if (t.kind === "monster") {
      const m = monsterByIndex(t.monster_index);
      return m ? `CR ${m.crText}` : "monster";
    }
    if (t.kind === "pc") {
      const c = charById(t.character_id);
      return c ? ctx.nameOf(c.owner_email) : "PC";
    }
    return "marker";
  }

  function renderTokensTab(body) {
    const list = visibleTokens();
    body.innerHTML = `
      ${isDM ? `
        <div class="row" style="margin-bottom:8px">
          <button class="btn-ghost" id="add-party">＋ the party</button>
          <button class="btn-ghost" id="add-marker">＋ marker</button>
        </div>` : ""}
      <div id="tok-rows">
        ${list.length ? "" : `<p class="muted small" style="font-style:italic">
          Nobody on the board yet.${isDM ? " Add the party, then stage monsters from the Bestiary." : " The DM is still setting the scene."}</p>`}
      </div>`;
    const rowsEl = body.querySelector("#tok-rows");
    list.forEach((t) => {
      const row = document.createElement("div");
      row.className = "tok-row";
      const color = t.color || (t.kind === "pc" ? "#7fa860" : t.kind === "monster" ? "#c05b4d" : "#8fa3b0");
      row.innerHTML = `
        <span class="tok-dot" style="background:${esc(color)}"></span>
        <span style="cursor:pointer" class="t-name"><strong>${esc(t.label)}</strong>
          <span class="muted small"> · ${esc(tokenSub(t))}</span>
          ${t.hidden ? `<span class="t-hidden"> · hidden</span>` : ""}</span>
        <span class="t-hp">${isDM && t.kind === "monster"
          ? `<input type="number" class="t-hp-in" value="${t.hp_current ?? ""}" style="width:54px; padding:2px 4px; text-align:center" /> / ${t.hp_max ?? "?"}`
          : t.hp_max != null ? `${t.hp_current ?? t.hp_max}/${t.hp_max}` : ""}</span>
        ${isDM ? `
          <button class="btn-ghost t-eye" title="${t.hidden ? "Reveal to players" : "Hide from players"}" style="padding:2px 8px">${t.hidden ? "🙈" : "👁"}</button>
          <button class="btn-danger t-del" title="Remove token" style="padding:2px 8px">✕</button>` : ""}`;
      row.querySelector(".t-name").onclick = () => {
        board.setSelected(t.id);
        openTokenMenu(t, null);
      };
      const hpIn = row.querySelector(".t-hp-in");
      if (hpIn) hpIn.onchange = () => guard(() => updateToken(t, { hp_current: clampHp(t, parseInt(hpIn.value, 10)) }));
      const eye = row.querySelector(".t-eye");
      if (eye) eye.onclick = () => guard(() => updateToken(t, { hidden: !t.hidden }));
      const del = row.querySelector(".t-del");
      if (del) del.onclick = () => {
        if (!confirm(`Remove "${t.label}" from the board?`)) return;
        guard(async () => {
          await vtt.tokens.remove(t.id);
          tokens = tokens.filter((k) => k.id !== t.id);
          if (menuTok?.id === t.id) closeMenu();
          pushTokens(); renderSide();
        });
      };
      rowsEl.appendChild(row);
    });
    const ap = body.querySelector("#add-party");
    if (ap) ap.onclick = () => guard(async () => {
      charsAll = await characters.list();
      const missing = charsAll.filter((c) => !tokens.some((t) => t.character_id === c.id));
      if (!missing.length) return toast(charsAll.length ? "Everyone's already on the board" : "No character sheets yet — build them on the Characters page");
      const taken = new Set(tokens.map((t) => `${Math.round(t.x)},${Math.round(t.y)}`));
      let placed = 0;
      for (let i = 0; i < missing.length; i++) {
        const c = missing[i];
        let x = 2, y = 2;
        while (taken.has(`${x},${y}`)) { x++; if (x > 14) { x = 2; y++; } }
        taken.add(`${x},${y}`);
        const fresh = await vtt.tokens.add({
          encounter_id: current.id, kind: "pc", character_id: c.id, monster_index: "",
          label: firstName(c.name), x, y, size: 1, color: PC_COLORS[i % PC_COLORS.length],
          hp_current: null, hp_max: null, conditions: [], hidden: false, initiative: null,
        });
        if (fresh && !tokens.some((k) => k.id === fresh.id)) tokens.push(fresh);
        placed++;
      }
      pushTokens(); renderSide();
      toast(`${placed} hero${placed > 1 ? "es" : ""} took the field`);
    });
    const am = body.querySelector("#add-marker");
    if (am) am.onclick = () => {
      const label = prompt("Marker label? (a door, a brazier, the objective…)");
      if (label == null) return;
      guard(async () => {
        const fresh = await vtt.tokens.add({
          encounter_id: current.id, kind: "marker", monster_index: "", character_id: null,
          label: label.trim().slice(0, 30) || "Marker", x: 2 + (tokens.length % 10), y: 2,
          size: 1, color: "#8fa3b0", hp_current: null, hp_max: null, conditions: [], hidden: false, initiative: null,
        });
        if (fresh && !tokens.some((k) => k.id === fresh.id)) tokens.push(fresh);
        pushTokens(); renderSide();
      });
    };
  }

  function clampHp(t, v) {
    if (Number.isNaN(v)) return t.hp_current ?? 0;
    const cap = t.hp_max != null ? t.hp_max : 999;
    return Math.max(0, Math.min(cap, v));
  }

  async function updateToken(t, fields) {
    Object.assign(t, fields);
    pushTokens(); renderSide();
    await vtt.tokens.update(t.id, fields);
  }

  // Persist a PC's sheet (HP, slots, rest state) and mirror the live HP onto
  // that character's board token so the sheet stays the source of truth.
  async function persistSheet(crow, sheet, tok) {
    uncache(crow.id);
    _sheets.set(crow.id, sheet);
    crow.sheet = sheet;
    await characters.save({ id: crow.id, name: crow.name, sheet }, crow.owner_email);
    const drv = drvOf(crow);
    if (tok) await updateToken(tok, { hp_current: currentHp(sheet, drv), hp_max: drv?.hp?.max ?? tok.hp_max });
  }

  /* ── homebrew monsters: adapt a stored stat block to the same shape
        the SRD MONSTERS use, and resolve a token's monster_index (an
        "hb:<id>" prefix means a custom monster) to either source. ── */
  function crNum(cr) {
    const s = String(cr ?? "").trim();
    if (s.includes("/")) { const [a, b] = s.split("/").map(Number); return b ? a / b : 0; }
    const n = parseFloat(s); return Number.isFinite(n) ? n : 0;
  }
  function hbToMonster(hb) {
    const d = hb.data || {};
    return {
      index: "hb:" + hb.id, name: hb.name, homebrew: true, art_path: hb.art_path || null,
      cr: crNum(hb.cr || d.cr), crText: String(hb.cr || d.cr || "?"),
      size: d.size || "Medium", type: d.type || "monster", alignment: d.alignment || "",
      ac: d.ac ?? 12, acType: d.ac_note || "", hp: d.hp ?? 10, hpRoll: d.hp_dice || "",
      speed: d.speed || "",
      abilities: { str: d.str ?? 10, dex: d.dex ?? 10, con: d.con ?? 10, int: d.int ?? 10, wis: d.wis ?? 10, cha: d.cha ?? 10 },
      _hb: d,
    };
  }
  function monsterByIndex(idx) {
    if (typeof idx === "string" && idx.startsWith("hb:")) {
      const hb = hbById[idx.slice(3)];
      return hb ? hbToMonster(hb) : null;
    }
    return MONSTERS[idx] || null;
  }

  /* ── Bestiary tab (DM) ── */
  const CR_RANGES = { any: [0, 99], "0-1": [0, 1], "2-4": [2, 4], "5-10": [5, 10], "11+": [11, 99] };
  function renderBestiaryTab(body) {
    body.innerHTML = `
      <div class="beast-search">
        <input type="text" id="b-q" placeholder="Search the bestiary… (goblin, wolf, dragon)" value="${esc(bq)}" />
        <div class="row" style="margin-bottom:6px">
          <span class="muted small">CR</span>
          <select id="b-cr" style="width:auto">
            ${Object.keys(CR_RANGES).map((k) => `<option value="${k}" ${bcr === k ? "selected" : ""}>${k}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="beast-list" id="b-list"></div>`;
    const listEl = body.querySelector("#b-list");
    const q = body.querySelector("#b-q");
    q.oninput = () => { bq = q.value; fill(); };
    const crSel = body.querySelector("#b-cr");
    crSel.onchange = () => { bcr = crSel.value; fill(); };
    function fill() {
      const [lo, hi] = CR_RANGES[bcr] || CR_RANGES.any;
      const needle = bq.trim().toLowerCase();
      const match = (m) => (!needle || m.name.toLowerCase().includes(needle)) && m.cr >= lo && m.cr <= hi;
      const srd = Object.values(MONSTERS).filter(match);
      const custom = Object.values(hbById).map(hbToMonster).filter(match);
      const bycr = (a, b) => a.cr - b.cr || a.name.localeCompare(b.name);
      srd.sort(bycr); custom.sort(bycr);
      const hits = [...custom, ...srd];         // your homebrew monsters first
      const shown = hits.slice(0, 40);
      listEl.innerHTML = shown.map((m, i) => `
        <div class="beast-row">
          <span>
            <span class="b-name" data-i="${i}">${esc(m.name)}</span>${m.homebrew ? '<span class="pill mystic" style="margin-left:5px">homebrew</span>' : ""}<br>
            <span class="b-meta">CR ${esc(m.crText)} · ${esc(m.size.toLowerCase())} ${esc(m.type)}</span>
          </span>
          <button class="btn-ghost b-add" data-i="${i}" style="padding:3px 10px">Add</button>
        </div>`).join("") +
        (hits.length > shown.length ? `<p class="muted small" style="font-style:italic">…and ${hits.length - shown.length} more — narrow the search.</p>` : "") +
        (hits.length ? "" : `<p class="muted small" style="font-style:italic">Nothing prowls here. Loosen the search.</p>`);
      listEl.querySelectorAll(".b-name").forEach((el) =>
        (el.onclick = () => guard(() => openStatBlock(shown[+el.dataset.i]))));
      listEl.querySelectorAll(".b-add").forEach((el) =>
        (el.onclick = () => armTargeting({ kind: "monster", m: shown[+el.dataset.i] }, `tap the map to place ${shown[+el.dataset.i].name}`)));
    }
    fill();
  }

  /* ── Initiative tab ── */
  function initSorted() {
    return [...visibleTokens()].sort((a, b) =>
      ((b.initiative ?? -Infinity) - (a.initiative ?? -Infinity)) || String(a.label).localeCompare(String(b.label)));
  }
  function dexModOf(t) {
    if (t.kind === "monster") {
      const m = monsterByIndex(t.monster_index);
      return m ? abilityMod(m.abilities.dex) : 0;
    }
    if (t.kind === "pc") {
      const c = charById(t.character_id);
      return c ? (drvOf(c)?.initiative ?? 0) : 0;
    }
    return 0;
  }
  function renderInitTab(body) {
    const list = initSorted();
    body.innerHTML = `
      ${isDM ? `
        <div class="row" style="margin-bottom:8px">
          <button class="btn" id="i-next">Next turn ▸</button>
          <button class="btn-ghost" id="i-clear">Clear</button>
        </div>` : ""}
      <div id="i-rows">${list.length ? "" : `<p class="muted small" style="font-style:italic">No combatants yet.</p>`}</div>`;
    const rowsEl = body.querySelector("#i-rows");
    list.forEach((t) => {
      const mine = canEditInit(t);
      const row = document.createElement("div");
      row.className = "init-row" + (current.turn === t.id ? " current" : "");
      row.innerHTML = `
        <span class="i-val">${t.initiative ?? "—"}</span>
        <span style="flex:1">${esc(t.label)}${t.hidden ? ` <span class="t-hidden">hidden</span>` : ""}</span>
        ${mine ? `
          <input type="number" class="i-in" value="${t.initiative ?? ""}" placeholder="—" title="Set initiative" />
          <button class="btn-ghost i-roll" title="Roll initiative (DEX ${fmtMod(dexModOf(t))})" style="padding:2px 8px">🎲</button>` : ""}`;
      const input = row.querySelector(".i-in");
      if (input) input.onchange = () => guard(() => {
        const v = input.value.trim() === "" ? null : Math.max(-20, Math.min(99, parseInt(input.value, 10) || 0));
        return updateToken(t, { initiative: v });
      });
      const rb = row.querySelector(".i-roll");
      if (rb) rb.onclick = () => guard(async () => {
        const roll = await rollD20(`${t.label} · Initiative`, dexModOf(t));
        await updateToken(t, { initiative: roll.total });
      });
      rowsEl.appendChild(row);
    });
    const next = body.querySelector("#i-next");
    if (next) next.onclick = () => guard(async () => {
      const order = initSorted();
      if (!order.length) return;
      const i = order.findIndex((t) => t.id === current.turn);
      const turn = order[(i + 1) % order.length].id;
      current.turn = turn;
      await vtt.encounters.save({ id: current.id, turn });
      pushTokens(); renderSide();
    });
    const clear = body.querySelector("#i-clear");
    if (clear) clear.onclick = () => guard(async () => {
      for (const t of tokens) if (t.initiative != null) { t.initiative = null; await vtt.tokens.update(t.id, { initiative: null }); }
      current.turn = null;
      await vtt.encounters.save({ id: current.id, turn: null });
      pushTokens(); renderSide();
    });
  }

  /* ── Cast tab ── */
  function hasAnySpells(crow) {
    const s = sheetOf(crow).spells;
    return (s.cantrips.length + s.known.length + s.prepared.length + s.custom.length) > 0;
  }
  function castableRows(crow) {
    const sheet = sheetOf(crow), drv = drvOf(crow), sc = drv?.spellcasting || null;
    const out = [], seen = new Set();
    const add = (idx) => {
      const sp = SPELLS[idx];
      if (sp && !seen.has(idx)) { seen.add(idx); out.push({ sp, custom: null }); }
    };
    for (const i of sheet.spells.cantrips || []) add(i);
    const prepared = sc && (sc.kind === "prepared-list" || sc.kind === "prepared-book");
    for (const i of (prepared ? sheet.spells.prepared : sheet.spells.known) || []) add(i);
    for (const cs of sheet.spells.custom || []) if (cs?.name) out.push({ sp: cs, custom: cs });
    out.sort((a, b) => ((a.sp.level || 0) - (b.sp.level || 0)) || String(a.sp.name).localeCompare(String(b.sp.name)));
    return { out, sheet, drv, sc };
  }
  function slotOptions(sc, sheet, spLevel) {
    if (!sc) return [];
    const used = sheet.spells.slotsUsed || [];
    const opts = [];
    for (const s of sc.slots || []) {
      if (s.level < spLevel) continue;
      const left = s.max - (used[s.level - 1] || 0);
      if (left > 0) opts.push({ lv: s.level, left, pact: false });
    }
    if (sc.pact && sc.pact.level >= spLevel) {
      const left = sc.pact.count - (sheet.spells.pactUsed || 0);
      if (left > 0) opts.push({ lv: sc.pact.level, left, pact: true });
    }
    return opts;
  }
  function renderCastTab(body) {
    const sources = (isDM ? charsAll : charsAll.filter((c) => ownsChar(c) && hasAnySpells(c)));
    if (!sources.length) {
      body.innerHTML = `<p class="muted small" style="font-style:italic">
        ${isDM ? "No character sheets exist yet — build them on the Characters page." :
          "None of your characters know any spells. Sheets live on the Characters page."}</p>`;
      return;
    }
    if (!sources.some((c) => c.id === castSelId)) castSelId = sources[0].id;
    body.innerHTML = `
      <select id="cast-src" style="margin-bottom:8px">
        ${sources.map((c) => `<option value="${esc(c.id)}" ${c.id === castSelId ? "selected" : ""}>${esc(c.name || "Unnamed hero")}</option>`).join("")}
        <option value="" disabled>— monster tokens don't cast here yet —</option>
      </select>
      <div class="cast-list" id="cast-list"></div>`;
    body.querySelector("#cast-src").onchange = (e) => { castSelId = e.target.value; renderSide(); };
    const crow = charById(castSelId);
    const listEl = body.querySelector("#cast-list");
    if (!crow) { listEl.innerHTML = ""; return; }
    const { out, sheet, sc } = castableRows(crow);
    if (!out.length) {
      listEl.innerHTML = `<p class="muted small" style="font-style:italic">
        ${esc(firstName(crow.name))} doesn't know any spells — steel and cunning will have to do.</p>`;
      return;
    }
    out.forEach(({ sp, custom }) => {
      const row = document.createElement("div");
      row.className = "cast-row";
      const leveled = (sp.level || 0) > 0;
      const opts = leveled ? slotOptions(sc, sheet, sp.level) : [];
      const noSlots = leveled && sc && !opts.length;
      row.innerHTML = `
        <span style="flex:1; min-width:0">
          <strong class="c-name" title="View spell details" style="cursor:pointer; text-decoration:underline; text-decoration-style:dotted; text-underline-offset:3px">${esc(sp.name)}</strong>
          <span class="pill ${sp.level ? "mystic" : "steel"}" style="margin-left:4px">${sp.level ? ordinal(sp.level) : "Cantrip"}</span><br>
          <span class="muted" style="font-size:12px">${esc(spellMetaLine(sp))}</span>
        </span>
        <button class="btn-ghost c-info" title="View spell details" style="padding:3px 9px; font-size:15px; line-height:1">ⓘ</button>
        ${opts.length ? `
          <select class="c-slot" style="width:auto; padding:4px 6px; font-size:13px">
            ${opts.map((o, i) => `<option value="${i}">${o.pact ? `pact ${ordinal(o.lv)}` : ordinal(o.lv)} (${o.left} left)</option>`).join("")}
          </select>` : ""}
        <button class="btn c-cast" style="padding:4px 12px" ${noSlots ? "disabled title='No slots left — long rest?'" : ""}>Cast</button>`;
      row.querySelector(".c-cast").onclick = () => {
        const selEl = row.querySelector(".c-slot");
        const slot = selEl ? opts[+selEl.value] : null;
        armTargeting({ kind: "cast", crow, sp, custom, slot }, `tap the target point for ${sp.name}`);
      };
      const showDetails = () => openSpellDetails(sp);
      row.querySelector(".c-info").onclick = showDetails;
      row.querySelector(".c-name").onclick = showDetails;
      listEl.appendChild(row);
    });
    if (noSlotNote(sc, sheet, out)) {
      const p = document.createElement("p");
      p.className = "muted small";
      p.style.fontStyle = "italic";
      p.textContent = "Grayed spells are out of slots — a long rest on the sheet restores them.";
      listEl.appendChild(p);
    }
  }
  const noSlotNote = (sc, sheet, rows) =>
    !!sc && rows.some(({ sp }) => (sp.level || 0) > 0 && !slotOptions(sc, sheet, sp.level).length);

  /* Spell details popup — casting time, range, save/attack, damage, area, and
     the full SRD rules text (loaded lazily). Works for SRD and custom spells. */
  async function openSpellDetails(sp) {
    const stat = (label, val) =>
      val ? `<div><div class="muted" style="font-size:11px; text-transform:uppercase; letter-spacing:.05em">${esc(label)}</div>
             <div style="font-size:13px">${esc(String(val))}</div></div>` : "";
    // SRD spells carry a `dc` object and a string `attack`; custom/homebrew
    // spells carry a `save` ability string and a boolean `attack` — handle both.
    const saveLine = sp.dc
      ? `${String(sp.dc.ability || "").toUpperCase()} save${sp.dc.success ? ` · ${sp.dc.success} on save` : ""}`
      : sp.save
        ? `${String(sp.save).toUpperCase()} save`
        : (sp.attack ? (typeof sp.attack === "string" ? `${cap(sp.attack)} spell attack` : "Spell attack") : "");
    let dmg = "";
    if (sp.damage) {
      const d = sp.damage;
      const base = d.atSlot ? (d.atSlot[sp.level] || Object.values(d.atSlot)[0])
                 : d.atChar ? Object.values(d.atChar)[0] : (d.dice || "");
      dmg = [base, d.type].filter(Boolean).join(" ");
    } else if (sp.heal) dmg = "Healing";
    else if (sp.dmg) dmg = [sp.dmg, sp.dmgType].filter(Boolean).join(" ");
    const body = `
      <div class="small muted" style="margin:-6px 0 12px">${esc(spellMetaLine(sp))}${sp.concentration ? " · Concentration" : ""}${sp.ritual ? " · Ritual" : ""}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; margin-bottom:14px">
        ${stat("Casting Time", sp.time)}
        ${stat("Range", sp.range)}
        ${stat("Components", sp.components)}
        ${stat("Duration", sp.duration)}
        ${stat("Attack / Save", saveLine)}
        ${stat("Damage / Effect", dmg)}
        ${sp.aoe ? stat("Area", `${sp.aoe.size} ft ${sp.aoe.type}`) : ""}
        ${sp.classes && sp.classes.length ? stat("Classes", sp.classes.map(cap).join(", ")) : ""}
      </div>
      <div id="sp-desc" class="small" style="font-style:italic; opacity:.7">Loading description…</div>`;
    const { el } = openModal(sp.name || "Spell", body);
    let txt = null;
    try { const t = sp.index ? await spellText(sp.index) : null; txt = t && (t.desc || t); } catch { /* fine */ }
    if (!txt) txt = sp.desc || sp.text || "";
    const descEl = el.querySelector("#sp-desc");
    if (descEl) {
      descEl.style.fontStyle = "normal";
      descEl.style.opacity = "1";
      descEl.innerHTML = txt
        ? String(txt).split(/\n\n+/).map((p) => `<p style="margin:0 0 8px; line-height:1.5">${esc(p)}</p>`).join("")
        : `<span class="muted" style="font-style:italic">No rules text on file for this spell.</span>`;
    }
  }

  /* ── Dice tab (compact tray; the feed lives on the Dice page) ── */
  function renderDiceTab(body) {
    body.innerHTML = `
      <div class="dice-tray" id="tray-btns"></div>
      <div class="pool" id="tray-pool" style="margin-top:8px"></div>
      <div class="row" style="margin-top:8px">
        <input type="number" id="tray-mod" value="${trayMod}" min="-99" max="99" title="Modifier" />
        <input type="text" id="tray-label" class="grow" maxlength="60" placeholder="What for? (optional)" value="${esc(trayLabel)}" />
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn" id="tray-roll">🎲 ROLL</button>
        <button class="btn-ghost" id="tray-clear">Clear</button>
      </div>
      <p class="muted small" style="margin:10px 0 0">Rolls land on the whole table — the full feed lives on the Dice page.</p>`;
    const btns = body.querySelector("#tray-btns");
    DIE_TYPES.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "die-btn";
      b.innerHTML = dieSvg(s, "d" + s, "mini");
      b.title = `Add a d${s}`;
      b.onclick = () => {
        const count = [...trayPool.values()].reduce((a, n) => a + n, 0);
        if (count >= MAX_DICE) return toast(`Max ${MAX_DICE} dice per roll`);
        trayPool.set(s, (trayPool.get(s) || 0) + 1);
        renderPool();
      };
      btns.appendChild(b);
    });
    const poolEl = body.querySelector("#tray-pool");
    function renderPool() {
      if (!trayPool.size) { poolEl.innerHTML = `<span class="muted small" style="font-style:italic">Tap dice to build a roll…</span>`; return; }
      poolEl.innerHTML = "";
      [...trayPool.entries()].sort((a, b) => a[0] - b[0]).forEach(([sides, count]) => {
        const chip = document.createElement("span");
        chip.className = "pool-chip";
        chip.innerHTML = `${count}×d${sides} <button type="button" title="Remove one">−</button>`;
        chip.querySelector("button").onclick = () => {
          count > 1 ? trayPool.set(sides, count - 1) : trayPool.delete(sides);
          renderPool();
        };
        poolEl.appendChild(chip);
      });
    }
    renderPool();
    body.querySelector("#tray-mod").oninput = (e) => { trayMod = Math.max(-99, Math.min(99, parseInt(e.target.value, 10) || 0)); };
    body.querySelector("#tray-label").oninput = (e) => { trayLabel = e.target.value; };
    body.querySelector("#tray-clear").onclick = () => { trayPool = new Map(); trayMod = 0; trayLabel = ""; renderSide(); };
    body.querySelector("#tray-roll").onclick = () => {
      if (!trayPool.size) return toast("Tap some dice first");
      guard(async () => {
        const spec = [...trayPool.entries()].sort((a, b) => a[0] - b[0]).map(([sides, count]) => ({ sides, count }));
        await rollSpec(trayLabel.trim(), spec, trayMod);
      });
    };
  }

  /* ═══════════ floating token menu ═══════════ */
  function closeMenu() {
    if (menuEl) menuEl.remove();
    menuEl = null;
    menuTok = null;
    board.setSelected(null);
  }
  document.addEventListener("pointerdown", (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }, true);

  function menuPoint(screenPt) {
    if (!screenPt) return { ...menuAnchor };          // reopened menus keep their spot
    return { x: screenPt.x + 12, y: screenPt.y + 12 }; // board points are wrap-relative
  }

  function openTokenMenu(t, screenPt, opts = {}) {
    closeMenu();
    board.setSelected(t.id);
    menuTok = t;
    menuAnchor = menuPoint(screenPt);
    const mine = isMine(t);
    const m = t.kind === "monster" ? monsterByIndex(t.monster_index) : null;
    const kindLine = t.kind === "monster"
      ? `${m ? m.name : "monster"} · CR ${m ? m.crText : "?"}${t.hidden ? " · hidden" : ""}`
      : t.kind === "pc" ? `PC · ${tokenSub(t)}` : "marker";
    const showHp = (isDM || mine) && (t.kind === "monster" ? true : t.hp_max != null);
    const conds = Array.isArray(t.conditions) ? t.conditions : [];

    menuEl = document.createElement("div");
    menuEl.className = "tok-menu";
    menuEl.style.maxWidth = "300px";
    menuEl.style.maxHeight = "72%";
    menuEl.style.overflow = "auto";
    // the menu floats INSIDE the board wrap — don't let its clicks
    // fall through to the board (pan/select) or its scroll zoom the map
    for (const evName of ["pointerdown", "pointerup", "pointermove", "wheel", "contextmenu"])
      menuEl.addEventListener(evName, (e) => e.stopPropagation());

    if (!isDM && !mine) {
      // someone else's piece: a nameplate, nothing more
      menuEl.innerHTML = `
        <h4>${esc(t.label)}</h4>
        <div class="muted small">${esc(kindLine)}</div>
        ${t.hp_max != null ? `<div class="muted small">HP ${t.hp_current ?? t.hp_max}/${t.hp_max}</div>` : ""}
        ${conds.length ? `<div class="cond-grid">${conds.map((c) => `<span class="cond-chip on">${esc(CONDITIONS[c]?.name || c)}</span>`).join("")}</div>` : ""}`;
      placeMenu();
      return;
    }

    // For a PC token linked to a character sheet, the sheet is the source of
    // truth: show HP + temp + rest controls that edit the sheet (and mirror
    // onto the token). Monsters/markers keep the plain token-HP row.
    const crow = t.kind === "pc" && t.character_id ? charById(t.character_id) : null;
    const sheetCtl = !!(crow && (isDM || mine) && drvOf(crow));
    let charBlock = "";
    if (sheetCtl) {
      const s = sheetOf(crow), d = drvOf(crow);
      const max = d?.hp?.max ?? 0, cur = currentHp(s, d), temp = s.hp?.temp || 0;
      const hdLeft = hitDiceLeft(s, d), hdTotal = d?.hp?.hitDiceCount ?? 0, hitDie = d?.hp?.hitDie ?? 8;
      charBlock = `
        <div class="tm-char" style="border-top:1px solid var(--border-soft); margin:2px 0 6px; padding-top:6px">
          <div class="row" style="gap:5px; margin-bottom:6px">
            <span class="muted small">HP</span>
            <button class="btn-ghost" id="tm-c-minus" style="padding:2px 9px">−</button>
            <input type="number" id="tm-c-hp" value="${cur}" style="width:54px; text-align:center; padding:3px 4px" />
            <button class="btn-ghost" id="tm-c-plus" style="padding:2px 9px">＋</button>
            <span class="muted small">/ ${max}</span>
            ${temp ? `<span class="pill steel" title="temporary HP">+${temp}</span>` : ""}
          </div>
          <div class="row" style="gap:5px; margin-bottom:6px">
            <button class="btn-ghost" id="tm-c-dmg" style="padding:2px 9px" title="Apply damage">🗡</button>
            <button class="btn-ghost" id="tm-c-heal" style="padding:2px 9px" title="Heal">✚</button>
            <input type="number" id="tm-c-amt" placeholder="amt" style="width:52px; text-align:center; padding:3px 4px" />
            <input type="number" id="tm-c-temp" placeholder="tmp" title="Set temporary HP" value="${temp || ""}" style="width:50px; text-align:center; padding:3px 4px" />
          </div>
          <div class="row" style="gap:5px; margin-bottom:4px">
            <button class="btn-ghost" id="tm-c-long" title="Full HP, all spell slots, hit dice back">🌙 Long</button>
            <button class="btn-ghost" id="tm-c-short" title="Pact slots back; spend hit dice to heal">🔆 Short</button>
            <button class="btn-ghost" id="tm-c-hd" ${hdLeft <= 0 ? "disabled" : ""} title="Spend a hit die to heal">🎲 d${hitDie}</button>
            <span class="muted small">HD ${hdLeft}/${hdTotal}</span>
          </div>
        </div>`;
    }

    menuEl.innerHTML = `
      ${isDM
        ? `<input type="text" id="tm-label" maxlength="30" value="${esc(t.label)}" style="font-family:var(--font-display); font-weight:700; padding:4px 8px; margin-bottom:4px" />`
        : `<h4>${esc(t.label)}</h4>`}
      <div class="muted small" style="margin-bottom:6px">${esc(kindLine)}</div>
      ${sheetCtl ? charBlock : (showHp ? `
        <div class="row" style="gap:5px; margin-bottom:6px">
          <span class="muted small">HP</span>
          <button class="btn-ghost" id="tm-hp-minus" style="padding:2px 9px">−</button>
          <input type="number" id="tm-hp" value="${t.hp_current ?? ""}" style="width:56px; text-align:center; padding:3px 4px" />
          <button class="btn-ghost" id="tm-hp-plus" style="padding:2px 9px">＋</button>
          <span class="muted small">/ ${t.hp_max ?? "?"}</span>
        </div>` : "")}
      ${isDM ? `<div class="cond-grid" id="tm-conds">
        ${Object.keys(CONDITIONS).map((k) =>
          `<button type="button" class="cond-chip ${conds.includes(k) ? "on" : ""}" data-c="${esc(k)}" title="${esc(CONDITIONS[k].name)}">${esc(CONDITIONS[k].name.toLowerCase())}</button>`).join("")}
      </div>` : conds.length ? `<div class="cond-grid">${conds.map((c) => `<span class="cond-chip on">${esc(CONDITIONS[c]?.name || c)}</span>`).join("")}</div>` : ""}
      <div class="row" style="gap:5px; margin:6px 0">
        <span class="muted small">Initiative</span>
        <input type="number" id="tm-init" value="${t.initiative ?? ""}" placeholder="—" style="width:56px; text-align:center; padding:3px 4px" />
      </div>
      <div class="row">
        ${isDM ? `<button class="btn-ghost" id="tm-hide">${t.hidden ? "👁 Reveal" : "🙈 Hide"}</button>` : ""}
        ${t.kind === "monster" && m ? `<button class="btn-ghost" id="tm-stat">Stat block</button>` : ""}
        ${isDM && t.kind === "monster" && m ? `<button class="btn-ghost" id="tm-acts">⚔ Actions</button>` : ""}
        ${isDM ? `<button class="btn-danger" id="tm-del">✕</button>` : ""}
      </div>
      <div id="tm-act-list"></div>`;

    const on = (sel, fn) => { const el = menuEl.querySelector(sel); if (el) el.onclick = () => guard(fn); return el; };
    const lab = menuEl.querySelector("#tm-label");
    if (lab) lab.onchange = () => guard(() => updateToken(t, { label: lab.value.trim().slice(0, 30) || t.label }));
    const hpIn = menuEl.querySelector("#tm-hp");
    if (hpIn) hpIn.onchange = () => guard(() => updateToken(t, { hp_current: clampHp(t, parseInt(hpIn.value, 10)) }));
    on("#tm-hp-minus", async () => { await updateToken(t, { hp_current: clampHp(t, (t.hp_current ?? t.hp_max ?? 0) - 1) }); hpIn.value = t.hp_current; });
    on("#tm-hp-plus", async () => { await updateToken(t, { hp_current: clampHp(t, (t.hp_current ?? 0) + 1) }); hpIn.value = t.hp_current; });
    if (sheetCtl) {
      const s = sheetOf(crow);
      const amtEl = menuEl.querySelector("#tm-c-amt");
      const amt = () => Math.max(0, parseInt(amtEl?.value, 10) || 0);
      const setCur = (v) => { const mx = drvOf(crow)?.hp?.max ?? 0; s.hp = { ...s.hp, current: Math.max(0, Math.min(mx, v)) }; };
      const done = async (msg) => { await persistSheet(crow, s, t); if (msg) toast(msg); openTokenMenu(t, null); };
      const hpEl = menuEl.querySelector("#tm-c-hp");
      if (hpEl) hpEl.onchange = () => guard(async () => { setCur(parseInt(hpEl.value, 10) || 0); await done(); });
      on("#tm-c-minus", async () => { setCur(currentHp(s, drvOf(crow)) - 1); await done(); });
      on("#tm-c-plus", async () => { setCur(currentHp(s, drvOf(crow)) + 1); await done(); });
      on("#tm-c-dmg", async () => {
        const a = amt(); if (!a) return;
        const fromTemp = Math.min(s.hp?.temp || 0, a);
        s.hp = { ...s.hp, temp: (s.hp?.temp || 0) - fromTemp };
        setCur(currentHp(s, drvOf(crow)) - (a - fromTemp));
        await done(`${firstName(crow.name)} takes ${a} damage`);
      });
      on("#tm-c-heal", async () => {
        const a = amt(); if (!a) return;
        setCur(currentHp(s, drvOf(crow)) + a);
        await done(`${firstName(crow.name)} heals ${a}`);
      });
      const tempEl = menuEl.querySelector("#tm-c-temp");
      if (tempEl) tempEl.onchange = () => guard(async () => {
        s.hp = { ...s.hp, temp: Math.max(0, parseInt(tempEl.value, 10) || 0) };
        await done();
      });
      on("#tm-c-long", async () => { longRest(s, drvOf(crow)); await done(`${firstName(crow.name)}: long rest — HP, spell slots & hit dice restored`); });
      on("#tm-c-short", async () => { shortRest(s); await done(`${firstName(crow.name)}: short rest — pact slots back; spend hit dice to heal`); });
      on("#tm-c-hd", async () => {
        const r = spendHitDie(s, drvOf(crow));
        if (!r) return toast("No hit dice left");
        await done(`Hit die d${r.die}: ${r.roll}${r.con ? " " + fmtMod(r.con) : ""} = +${r.healed} HP → ${r.current}/${r.max} · ${r.remaining} HD left`);
      });
    }
    const init = menuEl.querySelector("#tm-init");
    if (init) init.onchange = () => guard(() => {
      const v = init.value.trim() === "" ? null : Math.max(-20, Math.min(99, parseInt(init.value, 10) || 0));
      return updateToken(t, { initiative: v });
    });
    menuEl.querySelectorAll("#tm-conds .cond-chip").forEach((chip) => {
      chip.onclick = () => guard(async () => {
        const k = chip.dataset.c;
        const next = conds.includes(k) ? conds.filter((c) => c !== k) : [...conds, k];
        await updateToken(t, { conditions: next });
        chip.classList.toggle("on");
      });
    });
    on("#tm-hide", async () => {
      await updateToken(t, { hidden: !t.hidden });
      openTokenMenu(t, null);
    });
    on("#tm-stat", () => openStatBlock(m));
    on("#tm-del", async () => {
      if (!confirm(`Remove "${t.label}"?`)) return;
      await vtt.tokens.remove(t.id);
      tokens = tokens.filter((k) => k.id !== t.id);
      closeMenu();
      pushTokens(); renderSide();
    });
    const actsBtn = menuEl.querySelector("#tm-acts");
    if (actsBtn) actsBtn.onclick = () => guard(async () => {
      const slot = menuEl.querySelector("#tm-act-list");
      if (slot.innerHTML) { slot.innerHTML = ""; return; }
      slot.innerHTML = `<p class="muted small" style="font-style:italic">consulting the bestiary…</p>`;
      const det = await detailsOf(t.monster_index);
      const acts = det?.actions?.length ? det.actions : [];
      if (!menuEl || menuTok !== t) return;
      if (!acts.length) { slot.innerHTML = `<p class="muted small" style="font-style:italic">No listed actions.</p>`; return; }
      slot.innerHTML = acts.map((a, i) => `
        <div class="sb-act" style="font-size:13.5px">
          <strong>${esc(a.name)}</strong>
          <div class="roll-links">
            ${a.attackBonus != null ? `<button class="btn-ghost tm-hit" data-i="${i}" style="padding:2px 9px; font-size:12px">${esc(fmtMod(a.attackBonus))} to hit</button>` : ""}
            ${a.damage?.length ? `<button class="btn-ghost tm-dmg" data-i="${i}" style="padding:2px 9px; font-size:12px">${esc(a.damage.map((d) => d.dice).filter(Boolean).join(" + ") || "damage")}</button>` : ""}
          </div>
        </div>`).join("");
      slot.querySelectorAll(".tm-hit").forEach((b) => (b.onclick = () => {
        const a = acts[+b.dataset.i];
        armTargeting({ kind: "attack", token: t, action: a }, `tap ${t.label}'s target`);
      }));
      slot.querySelectorAll(".tm-dmg").forEach((b) => (b.onclick = () => guard(async () => {
        const a = acts[+b.dataset.i];
        const p = specFromDamages(a.damage);
        if (!p) return toast("No parseable damage dice on that action");
        await rollSpec(`${t.label} · ${a.name} damage`, p.spec, p.modifier);
      })));
      placeMenu();
    });
    placeMenu();
    if (opts.showActions && actsBtn) actsBtn.onclick();
  }

  function placeMenu() {
    if (!menuEl) return;
    if (!menuEl.parentNode) wrap.appendChild(menuEl);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    let x = Math.max(8, Math.min(menuAnchor.x, W - menuEl.offsetWidth - 8));
    let y = Math.max(8, Math.min(menuAnchor.y, H - menuEl.offsetHeight - 8));
    menuEl.style.left = x + "px";
    menuEl.style.top = y + "px";
  }

  /* ═══════════ homebrew (custom) stat block modal ═══════════ */
  function openHomebrewStatBlock(m) {
    const d = m._hb || {};
    const modal = openModal(m.name, `<div class="statblock"></div>`);
    const box = modal.el.querySelector(".statblock");
    const A = m.abilities;
    const line = (label, v) => (v && String(v).length ? `<div class="sb-line"><strong>${label}</strong> ${esc(v)}</div>` : "");
    const sect = (title, arr) => (arr && arr.length)
      ? `<h4 style="font-family:var(--font-display); color:var(--gold); letter-spacing:.05em; font-size:14px; margin:14px 0 2px">${esc(title)}</h4>
         ${arr.map((a) => `<div class="sb-act"><strong>${esc(a.name)}.</strong> ${esc(a.text)}</div>`).join("")}`
      : "";
    box.innerHTML = `
      <div class="sb-sub">${esc(m.size)} ${esc(m.type)}${m.alignment ? ", " + esc(m.alignment) : ""}</div>
      <div class="sb-line"><strong>AC</strong> ${esc(String(m.ac))}${m.acType ? ` (${esc(m.acType)})` : ""} · <strong>HP</strong> ${esc(String(m.hp))}${m.hpRoll ? ` (${esc(m.hpRoll)})` : ""} · <strong>Speed</strong> ${esc(m.speed)}</div>
      <div class="sb-abils">
        ${["str", "dex", "con", "int", "wis", "cha"].map((k) => `<div><strong>${k.toUpperCase()}</strong>${A[k]} (${fmtMod(abilityMod(A[k]))})</div>`).join("")}
      </div>
      ${line("Saves", d.saves)}
      ${line("Skills", d.skills)}
      ${line("Resist", d.damage_resistances)}
      ${line("Immune", d.damage_immunities)}
      ${line("Condition immune", d.condition_immunities)}
      ${line("Senses", d.senses)}
      ${line("Languages", d.languages)}
      <div class="sb-line"><strong>CR</strong> ${esc(m.crText)}</div>
      ${sect("Traits", d.traits)}
      ${sect("Actions", d.actions)}
      ${sect("Reactions", d.reactions)}
      ${sect("Legendary Actions", d.legendary)}
      <p class="muted small" style="margin-top:12px; font-style:italic">Custom monster — roll its attacks and damage from the Dice tray.</p>`;
  }

  /* ═══════════ SRD stat block modal ═══════════ */
  async function openStatBlock(m) {
    if (!m) return;
    if (m.homebrew) return openHomebrewStatBlock(m);
    const modal = openModal(m.name, `<div class="statblock"><p class="muted small" style="font-style:italic">turning the bestiary's pages…</p></div>`);
    const det = await detailsOf(m.index);
    const box = modal.el.querySelector(".statblock");
    if (!box.isConnected) return;
    const A = m.abilities;
    const line = (label, v) => (v && String(v).length ? `<div class="sb-line"><strong>${label}</strong> ${esc(Array.isArray(v) ? v.join(", ") : v)}</div>` : "");
    const sections = [["Traits", det?.traits], ["Actions", det?.actions], ["Reactions", det?.reactions], ["Legendary Actions", det?.legendary]]
      .filter(([, arr]) => arr?.length);
    let bi = 0;
    const bindables = [];
    box.innerHTML = `
      <div class="sb-sub">${esc(m.size)} ${esc(m.type)}, ${esc(m.alignment)}</div>
      <div class="sb-line"><strong>AC</strong> ${m.ac}${m.acType ? ` (${esc(m.acType)})` : ""} · <strong>HP</strong> ${m.hp} (${esc(m.hpRoll)}) · <strong>Speed</strong> ${esc(m.speed)}</div>
      <div class="sb-abils">
        ${["str", "dex", "con", "int", "wis", "cha"].map((k) => `<div><strong>${k.toUpperCase()}</strong>${A[k]} (${fmtMod(abilityMod(A[k]))})</div>`).join("")}
      </div>
      ${line("Saves", m.saves)}
      ${line("Skills", m.skills)}
      ${line("Vulnerable", m.vuln)}
      ${line("Resist", m.resist)}
      ${line("Immune", m.immune)}
      ${line("Condition immune", m.condImmune)}
      ${line("Senses", m.senses)}
      ${line("Languages", m.languages)}
      <div class="sb-line"><strong>CR</strong> ${esc(m.crText)} · ${m.xp} XP · PB +${m.pb}</div>
      ${sections.map(([title, arr]) => `
        <h4 style="font-family:var(--font-display); color:var(--gold); letter-spacing:.05em; font-size:14px; margin:14px 0 2px">${title}</h4>
        ${arr.map((a) => {
          const hitBtn = a.attackBonus != null ? `<button class="btn-ghost sb-roll" data-b="${bi}" style="padding:2px 10px; font-size:12px">${esc(fmtMod(a.attackBonus))} to hit</button>` : "";
          if (a.attackBonus != null) bindables[bi++] = { kind: "hit", a };
          const p = specFromDamages(a.damage);
          const dmgBtn = p ? `<button class="btn-ghost sb-roll" data-b="${bi}" style="padding:2px 10px; font-size:12px">${esc(a.damage.map((d) => d.dice).filter(Boolean).join(" + "))} dmg</button>` : "";
          if (p) bindables[bi++] = { kind: "dmg", a, p };
          return `<div class="sb-act"><strong>${esc(a.name)}.</strong> ${esc(a.desc)}
            ${hitBtn || dmgBtn ? `<div class="roll-links">${hitBtn}${dmgBtn}</div>` : ""}</div>`;
        }).join("")}`).join("")}
      ${det?.desc ? `<p class="muted small" style="margin-top:12px">${esc(det.desc)}</p>` : ""}`;
    box.querySelectorAll(".sb-roll").forEach((b) => {
      const bind = bindables[+b.dataset.b];
      if (!bind) return;
      b.onclick = () => guard(async () => {
        if (bind.kind === "hit") await rollD20(`${m.name} · ${bind.a.name}`, bind.a.attackBonus, { crits: true });
        else await rollSpec(`${m.name} · ${bind.a.name} damage`, bind.p.spec, bind.p.modifier);
      });
    });
  }

  /* ═══════════ go ═══════════ */
  await guard(() => refreshAll());
}
