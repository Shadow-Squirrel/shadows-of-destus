// ─────────────────────────────────────────────────────────────
//  dice3d.js — optional 3D physics dice, layered over the page.
//
//  IMPORTANT: results are decided by the DATABASE, never by the
//  physics sim. We hand the library the exact values each die
//  must land on (dice-box-threejs "forced result" notation, e.g.
//  "2d20@18,4"), so the tumble is pure theater. If anything at
//  all goes wrong — no WebGL, CDN unreachable, odd dice, slow
//  settle — roll3d() resolves false and the caller falls back to
//  the classic 2D overlay. It must never throw and never lie.
//
//  Library: @3d-dice/dice-box-threejs (three.js + cannon-es,
//  self-contained ESM bundle, default export = DiceBox class).
//  Loaded lazily from jsdelivr on the first 3D roll only.
// ─────────────────────────────────────────────────────────────

const LIB_URL =
  "https://cdn.jsdelivr.net/npm/@3d-dice/dice-box-threejs@0.0.12/dist/dice-box-threejs.es.js";
// Textures/sounds live under /public in the package. We use a flat
// custom colorset (texture "none", sounds off) so nothing is fetched
// from here in practice, but pointing assetPath at the CDN keeps any
// asset the library ever asks for resolving instead of 404ing.
const ASSET_PATH =
  "https://cdn.jsdelivr.net/npm/@3d-dice/dice-box-threejs@0.0.12/public/";

const STORAGE_KEY = "sod-dice3d";
const CONTAINER_ID = "sod-dice3d-stage";
const MAX_PHYSICAL_DICE = 14;      // more than this looks like popcorn — use 2D
const SUPPORTED_SIDES = [4, 6, 8, 10, 12, 20]; // library's d100 is a tens die only
const LIB_LOAD_TIMEOUT_MS = 6000;
const SETTLE_TIMEOUT_MS = 10000;
const LINGER_MS = 2000;            // dice stay on the table after settling
const FADE_MS = 600;               // then fade out over this long

// Gold / parchment dice on the site's dark leather. --gold is #d4a531.
const COLORSET = {
  name: "sod-gold",
  description: "Shadows of Destus gold",
  category: "Custom Sets",
  foreground: "#2a1a08",                                    // dark leather ink
  background: ["#d4a531", "#c0922b", "#e8c463", "#e6d7b2"], // golds → parchment
  outline: "#3a2a10",
  edge: "#8a6a1f",
  texture: "none",                                          // no CDN texture fetch
  material: "plastic",
};

// ── module state ─────────────────────────────────────────────
let webglOk = null;      // cached capability probe
let broken = false;      // set once the library proves unusable; stop retrying
let boxPromise = null;   // singleton DiceBox init (library import + scene setup)
let container = null;
let cleanupTimer = 0;
let chain = Promise.resolve(false); // serializes concurrent roll3d() calls

// ── small utilities ──────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`dice3d: ${label} timed out`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function webglSupported() {
  if (webglOk !== null) return webglOk;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    webglOk = !!gl;
  } catch {
    webglOk = false;
  }
  return webglOk;
}

// ── public toggle (localStorage, default ON) ─────────────────
export function dice3dEnabled() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v !== "0";
  } catch {
    return true;
  }
}

export function setDice3dEnabled(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch { /* private mode etc. — the session just keeps its default */ }
}

// True when a 3D show could plausibly run: user hasn't turned it off,
// the GPU can do WebGL, and the library hasn't already failed hard.
export function dice3dAvailable() {
  try {
    return !broken && dice3dEnabled() && typeof document !== "undefined" && webglSupported();
  } catch {
    return false;
  }
}

// ── overlay + library bootstrap (lazy, once) ─────────────────
function ensureContainer() {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = CONTAINER_ID;
    // Fullscreen, click-through, above everything, fade via opacity.
    el.style.cssText =
      "position:fixed;inset:0;z-index:9990;pointer-events:none;" +
      `opacity:0;transition:opacity ${FADE_MS}ms ease;`;
    document.body.appendChild(el);
  }
  container = el;
  return el;
}

function getBox() {
  if (!boxPromise) {
    boxPromise = (async () => {
      const mod = await withTimeout(import(LIB_URL), LIB_LOAD_TIMEOUT_MS, "library load");
      const DiceBox = mod.default;
      if (typeof DiceBox !== "function") throw new Error("dice3d: unexpected module shape");
      ensureContainer();
      const box = new DiceBox(`#${CONTAINER_ID}`, {
        assetPath: ASSET_PATH,
        sounds: false,                 // keeps the library from fetching any mp3s
        shadows: true,
        theme_surface: "green-felt",   // surface only picks sound files; desk is a
        theme_customColorset: COLORSET, // transparent shadow-catcher either way
        light_intensity: 0.9,
        gravity_multiplier: 400,
        strength: 1.5,
        baseScale: 100,
      });
      await withTimeout(box.initialize(), LIB_LOAD_TIMEOUT_MS, "scene init");
      return box;
    })().catch((e) => {
      // Library or WebGL context failed for real: don't retry every roll.
      broken = true;
      boxPromise = null;
      if (container) { try { container.remove(); } catch { /* ignore */ } container = null; }
      throw e;
    });
  }
  return boxPromise;
}

// ── notation building ────────────────────────────────────────
// row.dice = [{sides, count, results:[...], keep?}]. The number of
// physical dice is results.length (advantage rows carry count 2 /
// two results). dice-box-threejs applies "@a,b,c" to spawned dice
// in notation order, which matches our flattened order exactly.
function buildNotation(row) {
  if (!row || !Array.isArray(row.dice) || row.dice.length === 0) return null;
  const sets = [];
  const forced = [];
  for (const d of row.dice) {
    const sides = Number(d && d.sides);
    const results = Array.isArray(d && d.results) ? d.results : [];
    if (!SUPPORTED_SIDES.includes(sides) || results.length === 0) return null;
    for (const r of results) {
      const v = Number(r);
      if (!Number.isInteger(v) || v < 1 || v > sides) return null;
      forced.push({ sides, value: v });
    }
    sets.push(`${results.length}d${sides}`);
  }
  if (forced.length === 0 || forced.length > MAX_PHYSICAL_DICE) return null;
  let notation = sets.join("+");
  const mod = Number(row.modifier) || 0;
  if (mod > 0) notation += `+${mod}`;
  if (mod < 0) notation += `-${Math.abs(mod)}`;
  notation += `@${forced.map((f) => f.value).join(",")}`;
  return { notation, forced };
}

// Compare what the library says landed with what the database decreed.
function resultsMatch(report, forced) {
  try {
    const rolls = [];
    for (const set of report.sets || []) for (const roll of set.rolls || []) rolls.push(roll);
    if (rolls.length !== forced.length) return false;
    return rolls.every((roll, i) => {
      let v = Number(roll.value);
      if (forced[i].sides === 10 && v === 0) v = 10; // d10 face "0" is a ten
      return v === forced[i].value;
    });
  } catch {
    return false;
  }
}

// ── teardown between shows ───────────────────────────────────
function clearStage(box, fade) {
  try {
    if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = 0; }
    if (container) container.style.opacity = "0";
    const wipe = () => { try { box && box.clearDice(); } catch { /* ignore */ } };
    if (fade) setTimeout(wipe, FADE_MS + 50);
    else wipe();
  } catch { /* ignore */ }
}

// ── the show ─────────────────────────────────────────────────
// Resolves true the moment the dice have settled on the forced faces
// (the caller can then reveal the totals line while they linger); the
// canvas fades and clears itself ~2s later. Resolves false — never
// throws — on any failure, so the caller can run the 2D overlay.
export async function roll3d(row) {
  const run = chain.then(() => doRoll(row)).catch(() => false);
  // Keep the chain alive whether or not this show succeeds.
  chain = run.catch(() => false);
  return run;
}

async function doRoll(row) {
  try {
    if (!dice3dAvailable()) return false;
    const plan = buildNotation(row);
    if (!plan) return false;

    const box = await getBox();
    if (!container) return false;

    // A previous show may still be lingering/fading — clear it now.
    clearStage(box, false);
    container.style.opacity = "1";

    const rollP = box.roll(plan.notation);
    if (!rollP || typeof rollP.then !== "function") {
      // Library rejected the notation synchronously.
      clearStage(box, false);
      return false;
    }
    const report = await withTimeout(rollP, SETTLE_TIMEOUT_MS, "settle");

    if (!report || !resultsMatch(report, plan.forced)) {
      // The table must never contradict the database.
      clearStage(box, false);
      return false;
    }

    // Success: let the dice sit for a beat, then fade and clear.
    cleanupTimer = setTimeout(() => {
      cleanupTimer = 0;
      clearStage(box, true);
    }, LINGER_MS);
    return true;
  } catch {
    try {
      const box = boxPromise ? await boxPromise.catch(() => null) : null;
      clearStage(box, false);
    } catch { /* ignore */ }
    return false;
  }
}
