// ─────────────────────────────────────────────────────────────
//  sheet.js — the living character sheet. Everything derivable
//  (AC, saves, attacks, slots…) comes fresh from rules.derive()
//  each render; this file only mutates the stored choices and
//  trackers (HP, slots used, prepared spells, notes) and saves
//  them back through opts.onSaveSheet.
//
//  renderSheet(root, ctx, opts) — see characters.js for opts.
// ─────────────────────────────────────────────────────────────
import { esc, md, guard, toast } from "../../shell.js";
import { dice, ai, getCampaign, isReal } from "../../db.js";
import {
  derive, eligibleSpells, pendingChoices, levelUpSummary, classInfo,
  fmtMod, parseDice,
} from "../../dnd/rules.js";
import { longRest, shortRest, spendHitDie, hitDiceLeft } from "../../dnd/rest.js";
import { ABILITIES, ABILITY_NAMES, SKILLS } from "../../dnd/data/core.js";
import { SPELLS } from "../../dnd/data/spells.js";
import { WEAPONS, ARMOR, GEAR, PACKS } from "../../dnd/data/equipment.js";
import {
  cap, ordinal, prettyKey, statTile, spellMetaLine, spellTags,
  spellText, featureText, openModal, advToggle,
} from "./common.js";

const REF_LINKS = `Spells and options from other books can't ship here — look them up on
  <a href="https://www.dndbeyond.com/sources" target="_blank" rel="noopener">D&amp;D Beyond</a> or the free
  <a href="https://open5e.com" target="_blank" rel="noopener">Open5e</a>, then add them as custom entries.`;

const ITEM_SOURCES = { weapon: WEAPONS, armor: ARMOR, gear: GEAR, pack: PACKS };

// highest key ≤ lv in an atSlot/atChar map ("3":"8d6",…); falls
// back to the lowest key so something sensible always comes back.
function pickAtKey(map, lv) {
  const keys = Object.keys(map || {}).map(Number).sort((a, b) => a - b);
  if (!keys.length) return null;
  let best = null;
  for (const k of keys) if (k <= lv) best = k;
  return best ?? keys[0];
}

export function renderSheet(root, ctx, opts) {
  const char = opts.char;
  const canEdit = !!opts.canEdit;
  // rolls: the owner and the DM (today identical to canEdit — kept apart on purpose)
  const canRoll = !!(opts.mine || ctx.me.isDM);

  /* ── page state that survives re-renders ── */
  let tab = "actions";
  let hpAmt = 1;
  let afterLevelUp = null;    // level just reached (banner wording)
  let featEdit = -1;          // customFeatures index being edited
  const advEl = advToggle("normal", () => {});
  const adv = () => (canRoll ? advEl.get() : "normal");

  const heroName = () => char.name || opts.row.name || "Hero";
  const L = (what) => `${heroName()} · ${what}`.slice(0, 60);

  /* ── saving (debounced; trackers save immediately) ── */
  let saveTimer = null;
  function save(immediate = false, delay = 700) {
    if (!canEdit) return;
    clearTimeout(saveTimer);
    if (immediate) { guard(() => opts.onSaveSheet(char)); return; }
    saveTimer = setTimeout(() => guard(() => opts.onSaveSheet(char)), delay);
  }

  /* ── rolling ── */
  async function rollD20(label, modifier, isAttack = false) {
    await guard(async () => {
      const row = await dice.rollCheck(label, modifier, adv());
      opts.rollFx.show(row);
      if (row.local === true) toast("Rolled locally — shared advantage rolls need the new database migration");
      if (isAttack) {
        const d = (row.dice || []).find((x) => x.sides === 20);
        if (d && d.results?.length) {
          const kept = d.results.length === 2
            ? (d.keep === "low" ? Math.min(...d.results) : Math.max(...d.results))
            : d.results[0];
          if (kept === 20) toast("Critical hit! Roll damage twice or double the dice.");
        }
      }
    });
  }
  async function rollSpec(label, spec, modifier = 0) {
    await guard(async () => {
      const row = await dice.roll(label, spec, modifier);
      opts.rollFx.show(row);
      if (row.local === true) toast("Rolled locally — shared advantage rolls need the new database migration");
    });
  }

  function safeDerive() {
    try { return derive(char); } catch (e) { console.error(e); return null; }
  }

  /* ════════════════ main render ════════════════ */
  function render() {
    const drv = safeDerive();
    if (!drv) {
      root.innerHTML = `
        <div class="card">
          <h3 class="section">This sheet failed to load</h3>
          <p class="muted">Something in the saved data confused the rules engine — the builder can usually fix it.</p>
          <div class="row" style="margin-top:12px">
            ${canEdit ? `<button class="btn" id="b-edit">Open in the builder</button>` : ""}
            <a class="btn-ghost" style="text-decoration:none" href="#">Back to the roster</a>
          </div>
        </div>`;
      const be = root.querySelector("#b-edit");
      if (be) be.onclick = () => opts.onEdit();
      return;
    }
    const pend = pendingChoices(char, drv);
    root.innerHTML = `
      <div id="portrait-bar" class="portrait-bar"></div>
      ${headHtml(drv)}
      ${bannerHtml(drv, pend)}
      ${canRoll ? `
        <div class="row" style="justify-content:flex-end; margin-top:6px">
          <span class="muted small">d20 rolls:</span><span id="adv-slot"></span>
        </div>` : ""}
      ${statRowHtml(drv)}
      <div class="sheet-cols">
        <div>
          ${hpCardHtml(drv)}
          ${abilityCardHtml(drv)}
          ${skillCardHtml(drv)}
        </div>
        <div>
          ${tabsHtml(drv)}
          <div id="tab-panel"></div>
        </div>
      </div>`;
    const slot = root.querySelector("#adv-slot");
    if (slot) slot.appendChild(advEl);
    wireShell(drv);
    renderTab(drv);
  }

  /* ── head ── */
  function headHtml(drv) {
    const sub = [drv.raceName, drv.className].filter((x) => x && x !== "—").join(" ")
      + (drv.subclassName ? ` (${drv.subclassName})` : "");
    return `
      <div class="sheet-head">
        <h2>${esc(heroName())}</h2>
        <span class="pill gold">Level ${drv.level}</span>
        ${sub.trim() ? `<span class="pill steel">${esc(sub)}</span>` : ""}
        ${drv.backgroundName ? `<span class="pill">${esc(drv.backgroundName)}</span>` : ""}
        <span class="pill">played by ${esc(ctx.nameOf(opts.row.owner_email))}</span>
        ${canEdit ? `
          <span class="row" style="margin-left:auto">
            ${drv.level < 20 ? `<button class="btn" id="b-levelup">⬆ Level up</button>` : ""}
            <button class="btn-ghost" id="b-edit">Edit</button>
            <button class="btn-danger" id="b-del" title="Delete this character">✕</button>
          </span>` : ""}
      </div>`;
  }

  function bannerHtml(drv, pend) {
    const extra = drv.problems.filter((p) => !/No (race|class) chosen/i.test(p) || !pend.length);
    const all = [...new Set([...pend.map((p) => p.label), ...extra])];
    if (!all.length) return "";
    const shown = all.slice(0, 4);
    return `
      <div class="banner" style="margin:0 0 12px; max-width:none">
        ⚠️ <strong>${all.length} unfinished choice${all.length > 1 ? "s" : ""}:</strong>
        ${esc(shown.join(" · "))}${all.length > shown.length ? " · …" : ""}
        ${canEdit ? `<button class="btn-ghost" id="b-finish" style="margin-left:10px">${
          afterLevelUp ? `Finish your level-${afterLevelUp} choices` : "Open the builder"}</button>` : ""}
      </div>`;
  }

  /* ── stat tiles ── */
  function statRowHtml(drv) {
    const initTile = canRoll ? `
      <div class="stat-tile">
        <div class="stat-label">Initiative</div>
        <div class="stat-big"><button class="rollable" id="b-init" title="Roll initiative"><span class="r-mod">${fmtMod(drv.initiative)}</span></button></div>
        <div class="stat-sub">click to roll</div>
      </div>` : statTile("Initiative", fmtMod(drv.initiative));
    return `
      <div class="stat-row">
        ${statTile("Armor Class", String(drv.ac.value), drv.ac.desc)}
        ${initTile}
        ${statTile("Speed", `${drv.speed} ft`)}
        ${statTile("Prof bonus", fmtMod(drv.profBonus))}
        ${statTile("Passive Perception", String(drv.passivePerception))}
        ${statTile("Hit dice", `${drv.level}d${drv.hp.hitDie}`)}
      </div>`;
  }

  /* ── HP card ── */
  function curHp(drv) {
    const max = drv.hp.max;
    return Math.max(0, Math.min(max, char.hp.current ?? max));
  }
  function hpCardHtml(drv) {
    const max = drv.hp.max;
    const cur = curHp(drv);
    const frac = max ? cur / max : 0;
    const cls = frac < 0.25 ? " dying" : frac < 0.5 ? " hurt" : "";
    const temp = char.hp.temp || 0;
    const hdLeft = hitDiceLeft(char, drv);
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h3 class="section" style="margin:0">Hit points</h3>
          ${canEdit ? `<span class="row" style="gap:6px">
            <button class="btn-ghost" id="b-shortrest" title="Warlock pact slots return; spend hit dice to heal">🔆 Short rest</button>
            <button class="btn-ghost" id="b-longrest" title="Restore HP, all spell slots and half your hit dice">🌙 Long rest</button>
          </span>` : ""}
        </div>
        <div class="hp-wrap" style="margin-top:10px">
          <div class="hp-bar"><div class="hp-fill${cls}" style="width:${(frac * 100).toFixed(1)}%"></div></div>
          <span><strong>${cur}</strong> <span class="muted">/ ${max}</span>${temp > 0 ? ` <span class="pill steel">+${temp} temp</span>` : ""}</span>
        </div>
        ${canEdit ? `
        <div class="row" style="margin-top:12px">
          <span class="hp-num"><input type="number" id="hp-amt" min="1" max="999" value="${hpAmt}" aria-label="Amount" /></span>
          <button class="btn-ghost" id="b-dmg">🗡 Damage</button>
          <button class="btn-ghost" id="b-heal">✚ Heal</button>
          <span class="hp-num" style="margin-left:auto"><label class="muted small" for="hp-temp">temp </label><input type="number" id="hp-temp" min="0" max="999" value="${temp}" /></span>
        </div>` : ""}
        <div class="row" style="margin-top:10px; gap:8px; align-items:center">
          <span class="muted small">Hit dice ${hdLeft} / ${drv.hp.hitDiceCount} (d${drv.hp.hitDie})</span>
          ${canEdit ? `<button class="btn-ghost" id="b-hd" ${hdLeft <= 0 ? "disabled" : ""} title="Spend a hit die to heal">🎲 Spend</button>` : ""}
        </div>
      </div>`;
  }

  /* ── abilities + saves ── */
  function abilityCardHtml(drv) {
    const boxes = ABILITIES.map((a) => {
      const ab = drv.abilities[a];
      const inner = `
        <span class="ab-name" style="display:block">${a.toUpperCase()}</span>
        <span class="ab-mod" style="display:block">${fmtMod(ab.mod)}</span>
        <span class="ab-score" style="display:block">${ab.score}</span>`;
      return canRoll
        ? `<button class="ability-box roll" data-ab="${a}" title="Roll a ${esc(ABILITY_NAMES[a])} check">${inner}</button>`
        : `<div class="ability-box">${inner}</div>`;
    }).join("");
    const saves = ABILITIES.map((a) => {
      const s = drv.saves[a];
      const inner = `
        <span class="prof-dot${s.prof ? " on" : ""}"></span>
        <span style="flex:1">${esc(ABILITY_NAMES[a])}</span>
        <span class="sk-mod">${fmtMod(s.mod)}</span>`;
      return canRoll
        ? `<button class="skill-row" data-save="${a}" title="Roll a ${esc(ABILITY_NAMES[a])} saving throw">${inner}</button>`
        : `<div class="skill-row">${inner}</div>`;
    }).join("");
    return `
      <div class="card">
        <h3 class="section">Abilities</h3>
        <div class="ability-grid">${boxes}</div>
        <h3 class="section" style="margin-top:16px">Saving throws</h3>
        ${saves}
      </div>`;
  }

  function skillCardHtml(drv) {
    const rows = Object.keys(SKILLS).map((idx) => {
      const s = drv.skills[idx];
      const dot = s.expertise ? " exp" : s.prof ? " on" : "";
      const inner = `
        <span class="prof-dot${dot}"></span>
        <span style="flex:1">${esc(s.name)}</span>
        <span class="sk-ab">${s.ability}</span>
        <span class="sk-mod">${fmtMod(s.mod)}</span>`;
      return canRoll
        ? `<button class="skill-row" data-skill="${idx}" title="Roll ${esc(s.name)}">${inner}</button>`
        : `<div class="skill-row">${inner}</div>`;
    }).join("");
    return `<div class="card"><h3 class="section">Skills</h3><div class="skill-list">${rows}</div></div>`;
  }

  /* ── tabs ── */
  function showSpellsTab(drv) {
    return !!(drv.spellcasting || drv.racialSpells.length || (char.spells.custom || []).length);
  }
  function tabsHtml(drv) {
    const defs = [["actions", "⚔ Actions"]];
    if (showSpellsTab(drv)) defs.push(["spells", "✨ Spells"]);
    defs.push(["features", "📖 Features"], ["inventory", "🎒 Inventory"], ["notes", "🖋 Notes"]);
    if (!defs.some(([t]) => t === tab)) tab = "actions";
    return `<div class="sheet-tabs">${defs.map(([t, l]) =>
      `<button class="${t === tab ? "btn" : "btn-ghost"}" data-tab="${t}">${l}</button>`).join("")}</div>`;
  }

  /* ── shell wiring (head, stats, HP, abilities, tabs) ── */
  function wireShell(drv) {
    const on = (sel, fn) => { const el = root.querySelector(sel); if (el) el.onclick = fn; };
    on("#b-edit", () => opts.onEdit());
    on("#b-finish", () => opts.onEdit());
    on("#b-levelup", () => openLevelUp(drv));
    on("#b-del", () => {
      if (!confirm(`Remove ${heroName()} forever? There is no resurrection spell for this.`)) return;
      guard(() => opts.onDelete());
    });
    on("#b-init", () => rollD20(L("Initiative"), drv.initiative));
    on("#b-longrest", () => {
      longRest(char, drv);
      save(true);
      toast("🌙 Long rest — HP, spell slots and hit dice restored");
      render();
    });
    on("#b-shortrest", () => {
      shortRest(char);
      save(true);
      toast("🔆 Short rest — pact slots restored; spend hit dice to heal");
      render();
    });
    on("#b-hd", () => {
      const r = spendHitDie(char, drv);
      if (!r) return toast("No hit dice left");
      save(true);
      toast(`🎲 Hit die d${r.die}: ${r.roll}${r.con ? " " + fmtMod(r.con) : ""} = +${r.healed} HP → ${r.current}/${r.max}`);
      render();
    });
    on("#b-dmg", () => {
      const cur = curHp(drv);
      const amt = Math.max(0, hpAmt);
      const fromTemp = Math.min(char.hp.temp || 0, amt);
      char.hp.temp = (char.hp.temp || 0) - fromTemp;
      char.hp.current = Math.max(0, cur - (amt - fromTemp));
      save(true); render();
    });
    on("#b-heal", () => {
      char.hp.current = Math.min(drv.hp.max, curHp(drv) + Math.max(0, hpAmt));
      save(true); render();
    });
    const amt = root.querySelector("#hp-amt");
    if (amt) amt.oninput = () => { hpAmt = Math.max(1, parseInt(amt.value, 10) || 1); };
    const tmp = root.querySelector("#hp-temp");
    if (tmp) tmp.onchange = () => {
      char.hp.temp = Math.max(0, parseInt(tmp.value, 10) || 0);
      save(true); render();
    };
    root.querySelectorAll("[data-ab]").forEach((b) => b.onclick = () =>
      rollD20(L(`${ABILITY_NAMES[b.dataset.ab]} check`), drv.abilities[b.dataset.ab].mod));
    root.querySelectorAll("[data-save]").forEach((b) => b.onclick = () =>
      rollD20(L(`${ABILITY_NAMES[b.dataset.save]} save`), drv.saves[b.dataset.save].mod));
    root.querySelectorAll("[data-skill]").forEach((b) => b.onclick = () =>
      rollD20(L(drv.skills[b.dataset.skill].name), drv.skills[b.dataset.skill].mod));
    root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
      tab = b.dataset.tab;
      root.querySelectorAll("[data-tab]").forEach((x) => { x.className = x.dataset.tab === tab ? "btn" : "btn-ghost"; });
      renderTab();
    });
    renderPortrait(drv);
  }

  /* ── AI portrait (view for everyone; generate = DM only) ──
     Fully guarded so an unset/failed AI state never breaks the sheet. */
  async function renderPortrait(drv) {
    const bar = root.querySelector("#portrait-bar");
    if (!bar) return;
    const canGen = ctx.me.isDM && isReal();

    let imgHtml = "";
    if (char.portrait) {
      try {
        const urls = await ai.artUrls([char.portrait]);
        const u = urls[char.portrait];
        if (u) imgHtml = `<a href="${esc(u)}" target="_blank" rel="noopener" title="Open full size"><img class="portrait-img" src="${esc(u)}" alt="${esc(heroName())}"></a>`;
      } catch { /* leave imgHtml empty */ }
    }

    if (!canGen) { bar.innerHTML = imgHtml; return; }

    let usage = null;
    try { usage = await ai.usage(); } catch { usage = null; }

    if (!usage) {
      // AI isn't set up yet — a quiet note, only the DM sees it, and
      // only when there's no portrait to show already.
      bar.innerHTML = imgHtml || `<p class="muted small portrait-note">✨ AI portraits aren't set up yet — see <code>docs/AI-IMAGES.md</code>.</p>`;
      return;
    }

    const left = usage.remaining ?? 0;
    const label = char.portrait ? "Regenerate" : "✨ Generate portrait";
    bar.innerHTML = `
      ${imgHtml}
      <span class="portrait-tools">
        <button class="btn-ghost" id="p-gen" ${left > 0 ? "" : "disabled"}>${left > 0 ? label : "Monthly limit reached"}</button>
        ${char.portrait ? `<button class="btn-ghost" id="p-rm">Remove</button>` : ""}
        <span class="muted small">${left} of ${usage.cap ?? "?"} AI images left this month</span>
      </span>`;

    const rm = bar.querySelector("#p-rm");
    if (rm) rm.onclick = () => { char.portrait = null; save(true); render(); };

    const gen = bar.querySelector("#p-gen");
    if (gen) gen.onclick = () => {
      const prefill = ["fantasy character portrait, head and shoulders",
        [drv.raceName, drv.className].filter((x) => x && x !== "—").join(" "),
        (char.details?.appearance || "").trim()].filter(Boolean).join(", ");
      const m = openModal(`Portrait for ${heroName()}`, `
        <p class="muted small">Describe them; FLUX.1 [schnell] paints it. Failed generations don't count against your quota.</p>
        <textarea id="pp-prompt" style="min-height:90px">${esc(prefill)}</textarea>
        <div class="actions">
          <button class="btn" id="pp-go">✨ Generate</button>
          <button class="btn-ghost" id="pp-cancel">Cancel</button>
          <span class="muted small" id="pp-msg"></span>
        </div>`);
      m.el.querySelector("#pp-cancel").onclick = m.close;
      m.el.querySelector("#pp-go").onclick = () => {
        const prompt = m.el.querySelector("#pp-prompt").value.trim();
        if (!prompt) { toast("Describe the portrait first"); return; }
        m.el.querySelector("#pp-go").disabled = true;
        m.el.querySelector("#pp-msg").textContent = "Painting…";
        guard(async () => {
          try {
            const res = await ai.generate({ campaignId: getCampaign(), kind: "portrait", prompt });
            char.portrait = res.path;
            save(true);
            m.close();
            toast("Portrait generated");
            render();
          } catch (e) {
            if (e.code === "not-configured") { m.close(); toast("AI images aren't set up yet — see docs/AI-IMAGES.md"); return; }
            m.el.querySelector("#pp-go").disabled = false;
            m.el.querySelector("#pp-msg").textContent = "";
            toast("⚠ " + (e.message || "Generation failed"));
          }
        });
      };
    };
  }

  function renderTab(drv) {
    drv = drv || safeDerive();
    const panel = root.querySelector("#tab-panel");
    if (!panel || !drv) return;
    if (tab === "actions") { panel.innerHTML = actionsHtml(drv); wireActions(panel, drv); }
    else if (tab === "spells") { panel.innerHTML = spellsHtml(drv); wireSpells(panel, drv); }
    else if (tab === "features") { panel.innerHTML = featuresHtml(); wireFeatures(panel); }
    else if (tab === "inventory") { panel.innerHTML = inventoryHtml(drv); wireInventory(panel); }
    else { panel.innerHTML = notesHtml(); wireNotes(panel); }
  }

  /* ════════════════ ACTIONS tab ════════════════ */
  function fmtCounter(v) {
    if (v == null || v === 0 || v === false || v === "") return null;
    if (typeof v === "object") {
      if (v.dice_count != null && v.dice_value != null) return `${v.dice_count}d${v.dice_value}`;
      return null;
    }
    return String(v);
  }
  function classCountersHtml(drv) {
    const entries = Object.entries(drv.classSpecific || {})
      .map(([k, v]) => [k, fmtCounter(v)])
      .filter(([, v]) => v);
    if (!entries.length) return "";
    return `
      <div class="card">
        <h3 class="section">Class resources</h3>
        <div class="row">${entries.map(([k, v]) =>
          `<span class="pill steel">${esc(prettyKey(k))}: ${esc(v)}</span>`).join(" ")}</div>
        <p class="muted small" style="margin:8px 0 0">Informational — track uses however your table prefers.</p>
      </div>`;
  }

  function actionsHtml(drv) {
    const customStart = drv.attacks.length - (char.attacksCustom || []).length;
    const rows = drv.attacks.map((a, i) => {
      const dmgTxt = a.dmg
        ? `${a.dmg}${a.dmgMod ? ` ${fmtMod(a.dmgMod)}` : ""}${a.dmgType ? ` ${a.dmgType}` : ""}`
        : a.dmgFlat != null ? `${a.dmgFlat}${a.dmgType ? ` ${a.dmgType}` : ""}` : "";
      return `
        <div class="spell-row">
          <div class="row">
            <span class="sp-name">${esc(a.name)}</span>
            ${canRoll
              ? `<button class="rollable" data-atk-hit="${i}" title="Attack roll">to hit <span class="r-mod">${fmtMod(a.toHit)}</span></button>`
              : `<span class="sp-meta">to hit <strong>${fmtMod(a.toHit)}</strong></span>`}
            ${dmgTxt ? (canRoll
              ? `<button class="rollable" data-atk-dmg="${i}" title="Damage roll">${esc(dmgTxt)}</button>`
              : `<span class="sp-meta">${esc(dmgTxt)}</span>`) : ""}
            ${a.custom && canEdit ? `<button class="x-note" data-atk-del="${i - customStart}" title="Remove">✕</button>` : ""}
          </div>
          ${a.note ? `<div class="sp-meta">${esc(a.note)}</div>` : ""}
        </div>`;
    }).join("");
    const extras = [];
    if (drv.sneakAttack) extras.push(`
      <div class="spell-row"><div class="row">
        <span class="sp-name">Sneak Attack</span>
        ${canRoll ? `<button class="rollable" data-sneak title="Roll sneak attack damage">+${esc(drv.sneakAttack)}</button>`
                  : `<span class="sp-meta">+${esc(drv.sneakAttack)}</span>`}
        <span class="sp-meta">once per turn — needs advantage, or an ally within 5 ft of the target</span>
      </div></div>`);
    if (drv.breath) extras.push(`
      <div class="spell-row"><div class="row">
        <span class="sp-name">${esc(drv.breath.name)}</span>
        ${canRoll ? `<button class="rollable" data-breath title="Roll breath damage">${esc(drv.breath.dmg)} ${esc(drv.breath.dmgType)}</button>`
                  : `<span class="sp-meta">${esc(drv.breath.dmg)} ${esc(drv.breath.dmgType)}</span>`}
        <span class="sp-meta">DC ${drv.breath.dc} — ${esc(drv.breath.shape)} · recharges on a short or long rest</span>
      </div></div>`);
    const form = canEdit ? `
      <details class="fold">
        <summary>＋ Add a custom attack</summary>
        <div class="row" style="margin-top:10px">
          <input type="text" id="ca-name" placeholder="Name (e.g. Flame Whip)" class="grow" />
          <select id="ca-ab" style="width:auto">${ABILITIES.map((a) =>
            `<option value="${a}">${ABILITY_NAMES[a]}</option>`).join("")}</select>
          <label class="checkline"><input type="checkbox" id="ca-prof" checked /> proficient</label>
        </div>
        <div class="row" style="margin-top:8px">
          <input type="text" id="ca-dmg" placeholder="Damage dice (e.g. 2d6+3)" style="width:180px" />
          <input type="text" id="ca-type" placeholder="Damage type" style="width:140px" />
          <input type="text" id="ca-note" placeholder="Note" class="grow" />
          <button class="btn" id="ca-add">Add</button>
        </div>
      </details>` : "";
    return `
      <div class="card">
        <h3 class="section">Attacks</h3>
        ${rows || `<div class="empty">No attacks yet.</div>`}
        ${extras.join("")}
        ${form}
      </div>
      ${classCountersHtml(drv)}`;
  }

  function wireActions(panel, drv) {
    panel.querySelectorAll("[data-atk-hit]").forEach((b) => b.onclick = () => {
      const a = drv.attacks[+b.dataset.atkHit];
      rollD20(L(a.name), a.toHit, true);
    });
    panel.querySelectorAll("[data-atk-dmg]").forEach((b) => b.onclick = () => {
      const a = drv.attacks[+b.dataset.atkDmg];
      if (!a.dmg) { toast(`${a.name} — ${a.dmgFlat} ${a.dmgType || "damage"}`); return; }
      const p = parseDice(a.dmg, 0);
      if (!p) { toast(`${a.name} damage: ${a.dmg}${a.dmgMod ? " " + fmtMod(a.dmgMod) : ""}`); return; }
      rollSpec(L(`${a.name} (damage)`), p.spec, p.modifier + (a.dmgMod || 0));
    });
    panel.querySelectorAll("[data-atk-del]").forEach((b) => b.onclick = () => {
      char.attacksCustom.splice(+b.dataset.atkDel, 1);
      save(); renderTab();
    });
    const bSneak = panel.querySelector("[data-sneak]");
    if (bSneak) bSneak.onclick = () => {
      const p = parseDice(drv.sneakAttack, 0);
      if (p) rollSpec(L("Sneak Attack"), p.spec, p.modifier);
    };
    const bBreath = panel.querySelector("[data-breath]");
    if (bBreath) bBreath.onclick = () => {
      const p = parseDice(drv.breath.dmg, 0);
      if (p) rollSpec(L(`${drv.breath.name} (damage)`), p.spec, 0);
    };
    const add = panel.querySelector("#ca-add");
    if (add) add.onclick = () => {
      const name = panel.querySelector("#ca-name").value.trim();
      if (!name) { toast("Give the attack a name first"); return; }
      char.attacksCustom.push({
        name,
        toHit: null,
        ability: panel.querySelector("#ca-ab").value,
        proficient: panel.querySelector("#ca-prof").checked,
        dmg: panel.querySelector("#ca-dmg").value.trim(),
        dmgType: panel.querySelector("#ca-type").value.trim(),
        note: panel.querySelector("#ca-note").value.trim(),
      });
      save(); renderTab();
    };
  }

  /* ════════════════ SPELLS tab ════════════════ */
  const foldFor = (index) => `
    <details class="fold" data-sp-text="${esc(index)}">
      <summary>description</summary>
      <div class="sp-body"><span class="muted small">…</span></div>
    </details>`;

  function spellsHtml(drv) {
    const sc = drv.spellcasting;
    const out = [];
    if (sc) out.push(spellHeaderHtml(sc));
    if (drv.racialSpells.length) out.push(racialSpellsHtml(drv));
    if (sc) {
      out.push(cantripsHtml(drv, sc));
      out.push(leveledSpellsHtml(drv, sc));
    }
    out.push(customSpellsHtml(drv));
    out.push(`<p class="srd-note">${REF_LINKS}</p>`);
    return out.filter(Boolean).join("");
  }

  function spellHeaderHtml(sc) {
    const used = char.spells.slotsUsed || [];
    const slotRows = sc.slots.map((s) => {
      const u = Math.min(s.max, used[s.level - 1] || 0);
      const pips = Array.from({ length: s.max }, (_, i) => {
        const isUsed = i < u;
        return canEdit
          ? `<button class="pip${isUsed ? " used" : ""}" data-pip="${s.level}:${i}" title="${ordinal(s.level)}-level slot — click to ${isUsed ? "restore" : "spend"}"></button>`
          : `<span class="pip${isUsed ? " used" : ""}"></span>`;
      }).join("");
      return `<div class="row" style="margin-top:6px">
        <span class="sp-meta" style="width:44px">${ordinal(s.level)}</span>
        <span class="slot-pips">${pips}</span>
        <span class="sp-meta">${s.max - u} of ${s.max} left</span>
      </div>`;
    }).join("");
    let pactRow = "";
    if (sc.pact) {
      const u = Math.min(sc.pact.count, char.spells.pactUsed || 0);
      const pips = Array.from({ length: sc.pact.count }, (_, i) => {
        const isUsed = i < u;
        return canEdit
          ? `<button class="pip${isUsed ? " used" : ""}" data-pact-pip="${i}" title="Pact slot — click to ${isUsed ? "restore" : "spend"}"></button>`
          : `<span class="pip${isUsed ? " used" : ""}"></span>`;
      }).join("");
      pactRow = `<div class="row" style="margin-top:6px">
        <span class="sp-meta">Pact slots (${ordinal(sc.pact.level)} level)</span>
        <span class="slot-pips">${pips}</span>
        <span class="sp-meta">${sc.pact.count - u} of ${sc.pact.count} — all refresh on a short rest</span>
      </div>`;
    }
    const counters = [
      `<span class="pill gold">Save DC ${sc.dc}</span>`,
      canRoll
        ? `<button class="rollable" data-spell-atk>Spell attack <span class="r-mod">${fmtMod(sc.attackBonus)}</span></button>`
        : `<span class="pill">Spell attack ${fmtMod(sc.attackBonus)}</span>`,
      `<span class="pill steel">${esc(sc.abilityName)}</span>`,
      `<span class="pill mystic">Cantrips ${(char.spells.cantrips || []).length}/${sc.cantripsMax}</span>`,
    ];
    if (sc.kind === "prepared-book") counters.push(`<span class="pill">Spellbook ${(char.spells.known || []).length}</span>`);
    else if (sc.knownMax != null) counters.push(`<span class="pill">Known ${(char.spells.known || []).length}/${sc.knownMax}</span>`);
    if (sc.preparedMax != null) counters.push(`<span class="pill">Prepared ${(char.spells.prepared || []).length}/${sc.preparedMax}</span>`);
    return `<div class="card">
      <h3 class="section">Spellcasting</h3>
      <div class="row">${counters.join(" ")}</div>
      ${slotRows}${pactRow}
    </div>`;
  }

  function racialSpellsHtml(drv) {
    const rows = drv.racialSpells.map((rs, i) => {
      const s = SPELLS[rs.spell];
      if (!s) return "";
      const atkBonus = drv.profBonus + drv.abilities[rs.ability || "cha"].mod;
      const lvMatch = /(\d+)(?:st|nd|rd|th)[- ]level/i.exec(rs.note || "");
      const castLv = lvMatch ? +lvMatch[1] : s.level;
      let diceStr = null;
      if (s.damage?.atSlot) {
        const k = pickAtKey(s.damage.atSlot, castLv);
        diceStr = k != null ? s.damage.atSlot[k] : null;
      } else if (s.damage?.atChar) {
        const k = pickAtKey(s.damage.atChar, drv.level);
        diceStr = k != null ? s.damage.atChar[k] : null;
      }
      const controls = [];
      if (canRoll && s.attack) controls.push(`<button class="rollable" data-racial-atk="${i}">to hit <span class="r-mod">${fmtMod(atkBonus)}</span></button>`);
      if (diceStr) controls.push(canRoll
        ? `<button class="rollable" data-racial-dmg="${i}" data-cast-lv="${castLv}">${esc(diceStr)}${s.damage.type ? ` ${esc(s.damage.type)}` : ""}</button>`
        : `<span class="sp-meta">${esc(diceStr)} ${esc(s.damage.type || "")}</span>`);
      if (s.dc) controls.push(`<span class="sp-meta">DC ${8 + atkBonus} ${esc(String(s.dc.ability || "").toUpperCase())}</span>`);
      return `<div class="spell-row">
        <div class="row">
          <span class="sp-name">${esc(s.name)}</span><span class="sp-tags">${spellTags(s)}</span>
          <span class="sp-meta" style="flex:1">${esc(rs.note || "")}</span>
          ${controls.join(" ")}
        </div>
        <div class="sp-meta">${esc(spellMetaLine(s))}</div>
        ${foldFor(s.index)}
      </div>`;
    }).join("");
    return `<div class="card"><h3 class="section">Racial magic</h3>${rows}</div>`;
  }

  function cantripsHtml(drv, sc) {
    const rows = (char.spells.cantrips || []).map((idx) => {
      const s = SPELLS[idx];
      if (!s) return "";
      const controls = [];
      if (canRoll && s.attack) controls.push(`<button class="rollable" data-sp-hit="${esc(idx)}">to hit <span class="r-mod">${fmtMod(sc.attackBonus)}</span></button>`);
      if (s.damage?.atChar) {
        const k = pickAtKey(s.damage.atChar, drv.level);
        const diceStr = k != null ? s.damage.atChar[k] : null;
        if (diceStr) controls.push(canRoll
          ? `<button class="rollable" data-cantrip-dmg="${esc(idx)}">${esc(diceStr)}${s.damage.type ? ` ${esc(s.damage.type)}` : ""}</button>`
          : `<span class="sp-meta">${esc(diceStr)} ${esc(s.damage.type || "")}</span>`);
      }
      if (s.dc) controls.push(`<span class="sp-meta">DC ${sc.dc} ${esc(String(s.dc.ability || "").toUpperCase())}</span>`);
      return `<div class="spell-row">
        <div class="row">
          <span class="sp-name">${esc(s.name)}</span><span class="sp-tags">${spellTags(s)}</span>
          <span class="sp-meta" style="flex:1">${esc(spellMetaLine(s))}</span>
          ${controls.join(" ")}
        </div>
        ${foldFor(idx)}
      </div>`;
    }).join("");
    return `<div class="card">
      <h3 class="section">Cantrips</h3>
      ${rows || `<div class="empty">No cantrips picked yet${canEdit ? " — choose them in the builder" : ""}.</div>`}
    </div>`;
  }

  function availableCastLevels(sc, spellLevel) {
    if (sc.pact) return sc.pact.level >= spellLevel ? [sc.pact.level] : [];
    return sc.slots.map((x) => x.level).filter((l) => l >= spellLevel);
  }

  function castControlsHtml(s, sc) {
    const bits = [];
    if (!sc) return "";
    if (canRoll && s.attack) bits.push(`<button class="rollable" data-sp-hit="${esc(s.index)}">to hit <span class="r-mod">${fmtMod(sc.attackBonus)}</span></button>`);
    if (s.dc) bits.push(`<span class="sp-meta">DC ${sc.dc} ${esc(String(s.dc.ability || "").toUpperCase())}${s.dc.success && s.dc.success !== "none" ? ` (${esc(s.dc.success)} on save)` : ""}</span>`);
    if (canEdit && (s.damage?.atSlot || s.heal?.atSlot)) {
      const levels = availableCastLevels(sc, s.level);
      if (levels.length) {
        const sel = levels.length > 1
          ? `<select data-slot-for="${esc(s.index)}" style="width:auto">${levels.map((l) =>
              `<option value="${l}">${ordinal(l)}</option>`).join("")}</select>`
          : `<input type="hidden" data-slot-for="${esc(s.index)}" value="${levels[0]}" /><span class="sp-meta">${ordinal(levels[0])}</span>`;
        bits.push(`<span class="row" style="gap:6px">${sel}<button class="btn-ghost" data-cast="${esc(s.index)}">Cast ⚡</button></span>`);
      }
    }
    return bits.join(" ");
  }

  function castableRowHtml(s, sc) {
    return `<div class="spell-row">
      <div class="row">
        <span class="sp-name">${esc(s.name)}</span><span class="sp-tags">${spellTags(s)}</span>
        <span class="sp-meta" style="flex:1">${esc(spellMetaLine(s))}</span>
        ${castControlsHtml(s, sc)}
      </div>
      ${foldFor(s.index)}
    </div>`;
  }

  function prepRowHtml(s) {
    const on = (char.spells.prepared || []).includes(s.index);
    const chip = canEdit
      ? `<button class="choice-chip${on ? " on" : ""}" data-prep="${esc(s.index)}">${on ? "✓ prepared" : "prepare"}</button>`
      : (on ? `<span class="choice-chip on">prepared</span>` : "");
    return `<div class="spell-row">
      <div class="row">
        <span class="sp-name">${esc(s.name)}</span><span class="sp-tags">${spellTags(s)}</span>
        <span class="sp-meta" style="flex:1">${esc(spellMetaLine(s))}</span>
        ${chip}
      </div>
      ${foldFor(s.index)}
    </div>`;
  }

  function leveledSpellsHtml(drv, sc) {
    const isPrepared = sc.kind === "prepared-list" || sc.kind === "prepared-book";
    const source = isPrepared
      ? (sc.kind === "prepared-book" ? (char.spells.known || []) : eligibleSpells(char, drv).spells)
      : (char.spells.known || []);
    const parts = [];
    if (isPrepared) {
      const prepped = (char.spells.prepared || [])
        .map((i) => SPELLS[i]).filter(Boolean)
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      parts.push(`<div class="card">
        <h3 class="section">Prepared spells</h3>
        ${prepped.length ? prepped.map((s) => castableRowHtml(s, sc)).join("")
          : `<div class="empty">Nothing prepared${canEdit ? " — tick spells below to prepare them" : ""}.</div>`}
      </div>`);
    }
    const byLevel = new Map();
    for (const idx of source) {
      const s = SPELLS[idx];
      if (!s || s.level === 0) continue;
      if (!byLevel.has(s.level)) byLevel.set(s.level, []);
      byLevel.get(s.level).push(s);
    }
    const groups = [...byLevel.keys()].sort((a, b) => a - b).map((lv) => {
      const rows = byLevel.get(lv)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => (isPrepared ? prepRowHtml(s) : castableRowHtml(s, sc)))
        .join("");
      return `<div class="spell-lvl-head">${ordinal(lv)} level</div>${rows}`;
    }).join("");
    const title = isPrepared
      ? (sc.kind === "prepared-book" ? "Spellbook — prepare from these" : `${cap(sc.list)} spell list — prepare from these`)
      : "Spells known";
    parts.push(`<div class="card">
      <h3 class="section">${esc(title)}</h3>
      ${groups || `<div class="empty">Nothing here yet${canEdit ? " — add spells in the builder" : ""}.</div>`}
    </div>`);
    return parts.join("");
  }

  function customSpellsHtml(drv) {
    const list = char.spells.custom || [];
    if (!list.length && !canEdit) return "";
    const sc = drv.spellcasting;
    const atk = sc ? sc.attackBonus
      : drv.profBonus + Math.max(drv.abilities.int.mod, drv.abilities.wis.mod, drv.abilities.cha.mod);
    const rows = list.map((sp, i) => {
      const controls = [];
      if (canRoll && sp.attack) controls.push(`<button class="rollable" data-cu-hit="${i}">to hit <span class="r-mod">${fmtMod(atk)}</span></button>`);
      if (sp.save) controls.push(`<span class="sp-meta">DC ${sc ? sc.dc : 8 + atk} ${esc(String(sp.save).toUpperCase())}</span>`);
      if (sp.dmg) controls.push(canRoll
        ? `<button class="rollable" data-cu-dmg="${i}">${esc(sp.dmg)}${sp.dmgType ? ` ${esc(sp.dmgType)}` : ""}</button>`
        : `<span class="sp-meta">${esc(sp.dmg)} ${esc(sp.dmgType || "")}</span>`);
      return `<div class="spell-row">
        <div class="row">
          <span class="sp-name">${esc(sp.name || "Custom spell")}</span><span class="sp-tags">${spellTags(sp)}</span>
          <span class="sp-meta" style="flex:1">${esc(spellMetaLine(sp))}</span>
          ${controls.join(" ")}
          ${canEdit ? `<button class="x-note" data-cu-del="${i}" title="Remove">✕</button>` : ""}
        </div>
        ${sp.desc ? `<details class="fold"><summary>description</summary>${md(sp.desc)}</details>` : ""}
      </div>`;
    }).join("");
    const form = canEdit ? `
      <details class="fold">
        <summary>＋ Add a custom spell</summary>
        <div class="row" style="margin-top:10px">
          <input type="text" id="cu-name" placeholder="Spell name" class="grow" />
          <select id="cu-level" style="width:auto">${Array.from({ length: 10 }, (_, l) =>
            `<option value="${l}">${l === 0 ? "Cantrip" : ordinal(l) + " level"}</option>`).join("")}</select>
          <input type="text" id="cu-school" placeholder="School" style="width:130px" />
        </div>
        <div class="row" style="margin-top:8px">
          <input type="text" id="cu-time" placeholder="Casting time" style="width:130px" />
          <input type="text" id="cu-range" placeholder="Range" style="width:110px" />
          <input type="text" id="cu-comp" placeholder="Components (V, S, M)" style="width:180px" />
          <input type="text" id="cu-dur" placeholder="Duration" class="grow" />
        </div>
        <div class="row" style="margin-top:8px">
          <label class="checkline"><input type="checkbox" id="cu-conc" /> concentration</label>
          <label class="checkline"><input type="checkbox" id="cu-rit" /> ritual</label>
          <label class="checkline"><input type="checkbox" id="cu-atk" /> spell attack</label>
          <select id="cu-save" style="width:auto">
            <option value="">no save</option>
            ${ABILITIES.map((a) => `<option value="${a}">${ABILITY_NAMES[a]} save</option>`).join("")}
          </select>
        </div>
        <div class="row" style="margin-top:8px">
          <input type="text" id="cu-dmg" placeholder="Damage dice (e.g. 8d6)" style="width:180px" />
          <input type="text" id="cu-dmgtype" placeholder="Damage type" style="width:140px" />
        </div>
        <label class="field">Description</label>
        <textarea id="cu-desc" placeholder="What it does…"></textarea>
        <div class="row" style="margin-top:10px"><button class="btn" id="cu-add">Add spell</button></div>
      </details>` : "";
    return `<div class="card">
      <h3 class="section">Custom spells</h3>
      ${rows || `<div class="empty">No custom spells.</div>`}
      ${form}
    </div>`;
  }

  function castSpell(panel, drv, index) {
    const sc = drv.spellcasting;
    const s = SPELLS[index];
    if (!s || !sc) return;
    const slotEl = panel.querySelector(`[data-slot-for="${index}"]`);
    const lv = Math.max(s.level, parseInt(slotEl?.value, 10) || s.level);
    if (sc.pact) {
      const used = char.spells.pactUsed || 0;
      if (used >= sc.pact.count) toast("No pact slots left — casting anyway (short rest to refresh)");
      char.spells.pactUsed = Math.min(sc.pact.count, used + 1);
    } else {
      const max = sc.slots.find((x) => x.level === lv)?.max || 0;
      const used = char.spells.slotsUsed[lv - 1] || 0;
      if (used >= max) toast(`No ${ordinal(lv)}-level slots left — casting anyway`);
      char.spells.slotsUsed[lv - 1] = Math.min(max, used + 1);
    }
    save(true);
    const label = L(`${s.name} (${ordinal(lv)})`);
    if (s.damage?.atSlot) {
      const k = pickAtKey(s.damage.atSlot, lv);
      const p = k != null ? parseDice(s.damage.atSlot[k], 0) : null;
      if (p) rollSpec(label, p.spec, p.modifier);
    } else if (s.heal?.atSlot) {
      const scMod = drv.abilities[sc.ability].mod;
      const k = pickAtKey(s.heal.atSlot, lv);
      const str = k != null ? s.heal.atSlot[k] : null;
      const p = str ? parseDice(str, scMod) : null;
      if (p) rollSpec(label, p.spec, p.modifier);
      else if (str) toast(`${s.name}: +${str} HP (no roll needed)`);
    }
    renderTab();
  }

  function wireSpells(panel, drv) {
    const sc = drv.spellcasting;
    wireFolds(panel);
    panel.querySelectorAll("[data-pip]").forEach((p) => p.onclick = () => {
      const [lv, i] = p.dataset.pip.split(":").map(Number);
      const max = sc.slots.find((s) => s.level === lv)?.max || 0;
      const used = char.spells.slotsUsed[lv - 1] || 0;
      char.spells.slotsUsed[lv - 1] = Math.max(0, Math.min(max, i < used ? i : i + 1));
      save(true); renderTab();
    });
    panel.querySelectorAll("[data-pact-pip]").forEach((p) => p.onclick = () => {
      const i = +p.dataset.pactPip;
      const used = char.spells.pactUsed || 0;
      char.spells.pactUsed = Math.max(0, Math.min(sc.pact.count, i < used ? i : i + 1));
      save(true); renderTab();
    });
    const atk = panel.querySelector("[data-spell-atk]");
    if (atk) atk.onclick = () => rollD20(L("Spell attack"), sc.attackBonus, true);
    panel.querySelectorAll("[data-sp-hit]").forEach((b) => b.onclick = () => {
      const s = SPELLS[b.dataset.spHit];
      rollD20(L(s ? s.name : "Spell attack"), sc.attackBonus, true);
    });
    panel.querySelectorAll("[data-cantrip-dmg]").forEach((b) => b.onclick = () => {
      const s = SPELLS[b.dataset.cantripDmg];
      const k = pickAtKey(s.damage.atChar, drv.level);
      const p = k != null ? parseDice(s.damage.atChar[k], 0) : null;
      if (p) rollSpec(L(`${s.name} (damage)`), p.spec, p.modifier);
      else toast(`${s.name}: see the description`);
    });
    panel.querySelectorAll("[data-prep]").forEach((b) => b.onclick = () => {
      const idx = b.dataset.prep;
      const prep = char.spells.prepared;
      const at = prep.indexOf(idx);
      if (at >= 0) prep.splice(at, 1);
      else {
        if (sc.preparedMax != null && prep.length >= sc.preparedMax) {
          toast(`You can prepare at most ${sc.preparedMax} spells`);
          return;
        }
        prep.push(idx);
      }
      save(); renderTab();
    });
    panel.querySelectorAll("[data-cast]").forEach((b) => b.onclick = () => castSpell(panel, drv, b.dataset.cast));
    panel.querySelectorAll("[data-racial-atk]").forEach((b) => b.onclick = () => {
      const rs = drv.racialSpells[+b.dataset.racialAtk];
      const s = SPELLS[rs.spell];
      rollD20(L(s.name), drv.profBonus + drv.abilities[rs.ability || "cha"].mod, true);
    });
    panel.querySelectorAll("[data-racial-dmg]").forEach((b) => b.onclick = () => {
      const rs = drv.racialSpells[+b.dataset.racialDmg];
      const s = SPELLS[rs.spell];
      const map = s.damage?.atSlot || s.damage?.atChar || {};
      const useLv = s.damage?.atSlot ? (+b.dataset.castLv || s.level) : drv.level;
      const k = pickAtKey(map, useLv);
      const p = k != null ? parseDice(map[k], 0) : null;
      if (p) rollSpec(L(`${s.name} (damage)`), p.spec, p.modifier);
    });
    panel.querySelectorAll("[data-cu-hit]").forEach((b) => b.onclick = () => {
      const sp = char.spells.custom[+b.dataset.cuHit];
      const bonus = sc ? sc.attackBonus
        : drv.profBonus + Math.max(drv.abilities.int.mod, drv.abilities.wis.mod, drv.abilities.cha.mod);
      rollD20(L(sp.name || "Custom spell"), bonus, true);
    });
    panel.querySelectorAll("[data-cu-dmg]").forEach((b) => b.onclick = () => {
      const sp = char.spells.custom[+b.dataset.cuDmg];
      const p = parseDice(sp.dmg, sc ? drv.abilities[sc.ability].mod : 0);
      if (p) rollSpec(L(`${sp.name || "Custom spell"} (damage)`), p.spec, p.modifier);
      else toast(`${sp.name || "Custom spell"}: "${sp.dmg}" isn't a dice string like 8d6`);
    });
    panel.querySelectorAll("[data-cu-del]").forEach((b) => b.onclick = () => {
      char.spells.custom.splice(+b.dataset.cuDel, 1);
      save(); renderTab();
    });
    const cuAdd = panel.querySelector("#cu-add");
    if (cuAdd) cuAdd.onclick = () => {
      const v = (sel) => panel.querySelector(sel).value.trim();
      const chk = (sel) => panel.querySelector(sel).checked;
      const name = v("#cu-name");
      if (!name) { toast("Name the spell first"); return; }
      char.spells.custom.push({
        name,
        level: parseInt(panel.querySelector("#cu-level").value, 10) || 0,
        school: v("#cu-school"),
        time: v("#cu-time"),
        range: v("#cu-range"),
        components: v("#cu-comp"),
        duration: v("#cu-dur"),
        concentration: chk("#cu-conc"),
        ritual: chk("#cu-rit"),
        attack: chk("#cu-atk"),
        save: panel.querySelector("#cu-save").value || null,
        dmg: v("#cu-dmg"),
        dmgType: v("#cu-dmgtype"),
        desc: panel.querySelector("#cu-desc").value.trim(),
      });
      save(); renderTab();
    };
  }

  /* lazy description folds (spell + feature texts load on first open) */
  function wireFolds(panel) {
    panel.querySelectorAll("details[data-sp-text]").forEach((d) => {
      d.addEventListener("toggle", () => {
        if (!d.open || d._loaded) return;
        d._loaded = true;
        guard(async () => {
          const t = await spellText(d.dataset.spText);
          const body = d.querySelector(".sp-body");
          if (!body) return;
          body.innerHTML = t
            ? md([t.desc, t.higher ? `**At higher levels.** ${t.higher}` : "",
                t.material ? `*Materials: ${t.material}*` : ""].filter(Boolean).join("\n\n"))
            : `<span class="muted small">No SRD text for this spell.</span>`;
        });
      });
    });
    panel.querySelectorAll("details[data-ft-text]").forEach((d) => {
      d.addEventListener("toggle", () => {
        if (!d.open || d._loaded) return;
        d._loaded = true;
        guard(async () => {
          const t = await featureText(d.dataset.ftText);
          const body = d.querySelector(".ft-body");
          if (!body) return;
          body.innerHTML = t ? md(t.desc)
            : `<span class="muted small">No SRD text — check your class writeup.</span>`;
        });
      });
    });
  }

  /* ════════════════ FEATURES tab ════════════════ */
  function featuresHtml() {
    const drv = safeDerive();
    const std = drv.features.filter((f) => f.source !== "custom");
    const rows = std.map((f) => {
      const src = `${f.source}${f.level ? ` · level ${f.level}` : ""}`;
      const body = f.desc
        ? md(f.desc)
        : f.index
          ? `<details class="fold" data-ft-text="${esc(f.index)}"><summary>details</summary><div class="ft-body"><span class="muted small">…</span></div></details>`
          : "";
      return `<div class="feature-block">
        <span class="f-name">${esc(f.name)}</span><span class="f-src">${esc(src)}</span>
        ${body}
      </div>`;
    }).join("");
    const customs = (char.customFeatures || []).map((f, i) => `
      <div class="feature-block">
        <span class="f-name">${esc(f.name)}</span><span class="f-src">custom</span>
        ${canEdit ? `<button class="x-note" data-ft-edit="${i}" title="Edit">✏</button><button class="x-note" data-ft-del="${i}" title="Remove">✕</button>` : ""}
        ${f.desc ? md(f.desc) : ""}
      </div>`).join("");
    const editing = featEdit >= 0 ? char.customFeatures[featEdit] : null;
    const form = canEdit ? `
      <div class="rule"></div>
      <div class="row">
        <input type="text" id="cf-name" placeholder="Feature name (e.g. Gift: Never Lost at Sea)" class="grow" value="${esc(editing?.name || "")}" />
      </div>
      <label class="field">Description (markdown ok)</label>
      <textarea id="cf-desc">${esc(editing?.desc || "")}</textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="cf-save">${editing ? "Save feature" : "＋ Add feature"}</button>
        ${editing ? `<button class="btn-ghost" id="cf-cancel">Cancel</button>` : ""}
      </div>` : "";
    return `<div class="card">
      <h3 class="section">Features & traits</h3>
      ${rows || `<div class="empty">No features yet — pick a race and class in the builder.</div>`}
      ${customs ? `<div class="rule"></div><h3 class="section">Custom features</h3>${customs}` : ""}
      ${form}
    </div>`;
  }

  function wireFeatures(panel) {
    wireFolds(panel);
    panel.querySelectorAll("[data-ft-del]").forEach((b) => b.onclick = () => {
      char.customFeatures.splice(+b.dataset.ftDel, 1);
      featEdit = -1;
      save(); renderTab();
    });
    panel.querySelectorAll("[data-ft-edit]").forEach((b) => b.onclick = () => {
      featEdit = +b.dataset.ftEdit;
      renderTab();
    });
    const cancel = panel.querySelector("#cf-cancel");
    if (cancel) cancel.onclick = () => { featEdit = -1; renderTab(); };
    const saveBtn = panel.querySelector("#cf-save");
    if (saveBtn) saveBtn.onclick = () => {
      const name = panel.querySelector("#cf-name").value.trim();
      const desc = panel.querySelector("#cf-desc").value.trim();
      if (!name) { toast("Name the feature first"); return; }
      if (featEdit >= 0 && char.customFeatures[featEdit]) char.customFeatures[featEdit] = { name, desc };
      else char.customFeatures.push({ name, desc });
      featEdit = -1;
      save(); renderTab();
    };
  }

  /* ════════════════ INVENTORY tab ════════════════ */
  function itemName(e) {
    if (e.kind === "custom") return e.name || "Item";
    return ITEM_SOURCES[e.kind]?.[e.item]?.name || e.item || "Item";
  }
  function weaponOptions() {
    const groups = { "Simple weapons": [], "Martial weapons": [] };
    for (const w of Object.values(WEAPONS))
      groups[w.category.startsWith("simple") ? "Simple weapons" : "Martial weapons"].push(w);
    return Object.entries(groups).map(([label, ws]) =>
      `<optgroup label="${esc(label)}">${ws.map((w) =>
        `<option value="${esc(w.index)}">${esc(w.name)} — ${esc(w.dmg || "—")} ${esc(w.dmgType)}</option>`).join("")}</optgroup>`).join("");
  }
  function armorOptions() {
    return Object.values(ARMOR).map((a) =>
      `<option value="${esc(a.index)}">${esc(a.name)}${a.category === "shield" ? " — +2 AC"
        : ` — AC ${a.base}${a.dexBonus ? " + DEX" + (a.dexMax != null ? ` (max ${a.dexMax})` : "") : ""}`}</option>`).join("");
  }
  function gearOptions() {
    const gear = Object.values(GEAR).map((g) => `<option value="gear:${esc(g.index)}">${esc(g.name)}</option>`).join("");
    const packs = Object.values(PACKS).map((p) => `<option value="pack:${esc(p.index)}">${esc(p.name)}</option>`).join("");
    return `<optgroup label="Adventuring gear">${gear}</optgroup><optgroup label="Equipment packs">${packs}</optgroup>`;
  }

  function inventoryHtml(drv) {
    const items = char.equipment || [];
    const rows = items.map((e, i) => {
      const equippable = e.kind === "weapon" || e.kind === "armor";
      const hb = e.hb || null;   // homebrew item detail carried onto the sheet (from the Armory)
      return `<div class="spell-row"><div class="row">
        <span class="sp-name" style="flex:1">${esc(itemName(e))}${hb && hb.rarity ? ` <span class="pill mystic" style="margin-left:5px">${esc(hb.rarity)}</span>` : ""}${hb && hb.attunement ? ` <span class="sp-meta" title="Requires attunement">(A)</span>` : ""}</span>
        ${canEdit ? `
          <span class="row" style="gap:4px">
            <button class="x-note" data-qty="${i}:-1" title="Fewer">−</button>
            <span class="sp-meta">× ${e.qty || 1}</span>
            <button class="x-note" data-qty="${i}:1" title="More">＋</button>
          </span>` : `<span class="sp-meta">× ${e.qty || 1}</span>`}
        ${equippable ? (canEdit
          ? `<label class="checkline"><input type="checkbox" data-equip="${i}"${e.equipped ? " checked" : ""} /> equipped</label>`
          : (e.equipped ? `<span class="pill moss">equipped</span>` : "")) : ""}
        ${canEdit ? `<button class="x-note" data-item-del="${i}" title="Remove">✕</button>` : ""}
      </div>${hb ? `<details class="fold"><summary>${esc([cap(hb.type), hb.attunement ? `attunement${hb.attunement_note ? ` ${hb.attunement_note}` : ""}` : ""].filter(Boolean).join(" · ")) || "details"}</summary>
        ${hb.props ? `<p style="margin:4px 0"><strong>${esc(hb.props)}</strong></p>` : ""}
        ${hb.charges ? `<p class="sp-meta" style="margin:2px 0">${esc(hb.charges)}</p>` : ""}
        ${hb.desc ? md(hb.desc) : ""}</details>` : ""}</div>`;
    }).join("");
    const adders = canEdit ? `
      <div class="rule"></div>
      <div class="row" style="margin-top:8px">
        <select id="add-weapon" class="grow">${weaponOptions()}</select>
        <button class="btn-ghost" id="b-add-weapon">Add</button>
      </div>
      <div class="row" style="margin-top:8px">
        <select id="add-armor" class="grow">${armorOptions()}</select>
        <button class="btn-ghost" id="b-add-armor">Add</button>
      </div>
      <div class="row" style="margin-top:8px">
        <select id="add-gear" class="grow">${gearOptions()}</select>
        <button class="btn-ghost" id="b-add-gear">Add</button>
      </div>
      <div class="row" style="margin-top:8px">
        <input type="text" id="add-custom" placeholder="Custom item (e.g. The Mouse Baron's tiny cape)" class="grow" />
        <button class="btn-ghost" id="b-add-custom">Add</button>
      </div>` : "";
    return `<div class="card">
      <h3 class="section">Inventory</h3>
      ${rows || `<div class="empty">Empty pockets.</div>`}
      ${adders}
      <p class="muted small" style="margin:10px 0 0">AC ${drv.ac.value} (${esc(drv.ac.desc)}) — equipping armor and weapons updates AC and attacks instantly.</p>
    </div>`;
  }

  function addItem(kind, index) {
    if (!index) return;
    const ex = (char.equipment || []).find((e) => e.kind === kind && e.item === index);
    if (ex) ex.qty = (ex.qty || 1) + 1;
    else {
      let equipped;
      if (kind === "weapon") equipped = true;
      if (kind === "armor") {
        const isShield = ARMOR[index]?.category === "shield";
        equipped = !char.equipment.some((e) =>
          e.kind === "armor" && e.equipped && (ARMOR[e.item]?.category === "shield") === isShield);
      }
      char.equipment.push({ kind, item: index, qty: 1, ...(equipped !== undefined ? { equipped } : {}) });
    }
    save(); render();
  }

  function wireInventory(panel) {
    panel.querySelectorAll("[data-qty]").forEach((b) => b.onclick = () => {
      const [i, d] = b.dataset.qty.split(":").map(Number);
      const e = char.equipment[i];
      if (!e) return;
      e.qty = Math.max(1, (e.qty || 1) + d);
      save(); renderTab();
    });
    panel.querySelectorAll("[data-equip]").forEach((cb) => cb.onchange = () => {
      const e = char.equipment[+cb.dataset.equip];
      if (!e) return;
      e.equipped = cb.checked;
      save(); render();
    });
    panel.querySelectorAll("[data-item-del]").forEach((b) => b.onclick = () => {
      char.equipment.splice(+b.dataset.itemDel, 1);
      save(); render();
    });
    const on = (sel, fn) => { const el = panel.querySelector(sel); if (el) el.onclick = fn; };
    on("#b-add-weapon", () => addItem("weapon", panel.querySelector("#add-weapon").value));
    on("#b-add-armor", () => addItem("armor", panel.querySelector("#add-armor").value));
    on("#b-add-gear", () => {
      const [kind, idx] = panel.querySelector("#add-gear").value.split(":");
      addItem(kind, idx);
    });
    on("#b-add-custom", () => {
      const inp = panel.querySelector("#add-custom");
      const name = inp.value.trim();
      if (!name) return;
      char.equipment.push({ kind: "custom", item: null, name, qty: 1 });
      save(); render();
    });
  }

  /* ════════════════ NOTES tab ════════════════ */
  function notesHtml() {
    const d = char.details || {};
    const fields = [
      ["Personality", d.personality], ["Ideals", d.ideals], ["Bonds", d.bonds],
      ["Flaws", d.flaws], ["Appearance", d.appearance], ["Backstory", d.backstory],
    ].filter(([, v]) => v && String(v).trim());
    const detailBlocks = fields.map(([k, v]) =>
      `<div class="feature-block"><span class="f-name">${k}</span>${md(v)}</div>`).join("");
    const notesArea = canEdit
      ? `<label class="field" for="notes-ta">Session notes (markdown ok — saves as you type)</label>
         <textarea id="notes-ta" style="min-height:220px" placeholder="Loot owed, promises made, people to apologize to…">${esc(char.notes || "")}</textarea>`
      : (char.notes ? md(char.notes) : `<div class="empty">No notes yet.</div>`);
    return `<div class="card"><h3 class="section">Notes</h3>${notesArea}</div>
      ${detailBlocks || char.alignment ? `<div class="card"><h3 class="section">Character details</h3>
        ${detailBlocks}
        ${char.alignment ? `<p class="muted small" style="margin:8px 0 0">Alignment: ${esc(cap(char.alignment))}</p>` : ""}
      </div>` : ""}`;
  }
  function wireNotes(panel) {
    const ta = panel.querySelector("#notes-ta");
    if (ta) ta.oninput = () => { char.notes = ta.value; save(false, 800); };
  }

  /* ════════════════ level up ════════════════ */
  function openLevelUp(drv) {
    const next = drv.level + 1;
    const sum = levelUpSummary(char, next);
    if (!sum) { toast("Choose a class in the builder before leveling up"); return; }
    const conMod = drv.abilities.con.mod;
    const avg = Math.floor(sum.hitDie / 2) + 1;
    const flavor = classInfo(char)?.subclassFlavor || "subclass";
    const li = [];
    if (sum.features.length) li.push(`<li><strong>New features:</strong> ${esc(sum.features.join(", "))}</li>`);
    if (sum.profBonusUp) li.push(`<li><strong>Proficiency bonus</strong> rises to ${fmtMod(sum.profBonusUp)}</li>`);
    if (sum.asi) li.push(`<li><strong>Ability Score Improvement</strong> (or a feat) — pick it in the builder</li>`);
    if (sum.subclassDue) li.push(`<li><strong>Choose your ${esc(flavor)}</strong> in the builder</li>`);
    if (sum.expertiseUp) li.push(`<li><strong>New expertise picks</strong> unlock — choose them in the builder</li>`);
    if (sum.spells) {
      if (sum.spells.newSlots.length) li.push(`<li><strong>Spell slots:</strong> ${esc(sum.spells.newSlots.join(", "))}</li>`);
      if (sum.spells.cantrips > 0) li.push(`<li><strong>+${sum.spells.cantrips} cantrip${sum.spells.cantrips > 1 ? "s" : ""}</strong> — pick in the builder</li>`);
      if (sum.spells.known != null && sum.spells.known > 0) li.push(`<li><strong>+${sum.spells.known} spell${sum.spells.known > 1 ? "s" : ""} known</strong> — pick in the builder</li>`);
      if (sum.spells.bookSpells) li.push(`<li><strong>+${sum.spells.bookSpells} spells for your spellbook</strong></li>`);
    }
    let hpHtml;
    if (char.hp.method === "roll") {
      hpHtml = `<div class="row" style="margin-top:10px">
        <button class="btn-ghost" id="lu-roll">🎲 Roll 1d${sum.hitDie} for hit points</button>
        <span class="muted small" id="lu-out">…or roll later in the builder</span>
      </div>`;
    } else if (char.hp.method === "manual") {
      hpHtml = `<p class="muted small">Manual HP — remember to raise your maximum in the builder.</p>`;
    } else {
      hpHtml = `<p><strong>+${Math.max(1, avg + conMod)} HP</strong> <span class="muted small">(average ${avg} + CON ${fmtMod(conMod)})</span></p>`;
    }
    const { el, close } = openModal(`Level up — ${heroName()}`, `
      <p>Rising to <strong>level ${next}</strong> brings:</p>
      <ul class="log">${li.join("") || "<li>A quiet level — mostly bigger numbers.</li>"}</ul>
      ${hpHtml}
      <div class="row" style="margin-top:14px">
        <button class="btn" id="lu-go">⬆ Level up to ${next}</button>
        <button class="btn-ghost" id="lu-cancel">Not yet</button>
      </div>`);
    let rolledHp = null;
    const rollBtn = el.querySelector("#lu-roll");
    if (rollBtn) rollBtn.onclick = () => guard(async () => {
      rollBtn.disabled = true;
      const row = await dice.roll(L(`Hit points (level ${next})`), [{ sides: sum.hitDie, count: 1 }], 0);
      opts.rollFx.show(row);
      rolledHp = row.dice?.[0]?.results?.[0] ?? null;
      const out = el.querySelector("#lu-out");
      if (out && rolledHp != null) out.textContent = `Rolled ${rolledHp} → +${Math.max(1, rolledHp + conMod)} HP`;
    });
    el.querySelector("#lu-cancel").onclick = close;
    el.querySelector("#lu-go").onclick = () => guard(async () => {
      if (char.hp.method === "roll" && rolledHp != null) char.hp.rolled[next - 2] = rolledHp;
      char.level = next;
      await opts.onSaveSheet(char);
      close();
      const pend = pendingChoices(char);
      if (pend.length) {
        afterLevelUp = next;
        toast(`Level ${next}! ${pend.length} choice${pend.length > 1 ? "s" : ""} to finish in the builder`);
      } else {
        afterLevelUp = null;
        toast(`Level ${next}!`);
      }
      render();
    });
  }

  render();
}
