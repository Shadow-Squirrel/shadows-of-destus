// ─────────────────────────────────────────────────────────────
//  board.js — the battle-map canvas engine (pure view).
//
//  The page hands createBoard() an empty .board-wrap plus a few
//  hooks; three canvases get stacked inside:
//      base   → map image (or parchment fallback) + grid lines
//      tokens → token discs, HP arcs, badges, selection rings
//      fx     → left untouched for effects.js (see fxCanvas)
//
//  Pure view: no database, no page logic. State arrives through
//  setMap / setGrid / setTokens / setSelected / setTargeting and
//  player intent leaves through the hooks:
//      canMove(token)            → may THIS user drag that token?
//      onMoveToken(id, x, y)     → once, on drop, snapped to ints
//      onSelectToken(t|null, pt) → plain tap; pt is wrap-relative
//      onPickPoint(gridPt)       → one targeting-mode pick
//
//  World model: 1 cell = 5 ft = 70 world px. The map image is
//  drawn scaled by (70 / grid.cell) so its painted squares line
//  up with world cells; token (x, y) is the TOP-LEFT cell of its
//  footprint. A single transform (scale, pan) maps world px →
//  CSS px, and `view` republishes it in CANVAS px for the
//  effects engine — computed live on every call, so panning or
//  zooming mid-fireball just works.
//
//  Painting is on demand (state change / pan / zoom). The one
//  exception: while some token carries _turn, a token-layer-only
//  rAF (~30 fps) breathes the gold "whose turn" ring, and stops
//  the moment the turn marker is gone.
// ─────────────────────────────────────────────────────────────

const CELL = 70;                    // world px per 5-ft cell
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const EMPTY_COLS = 24;              // parchment board size, cells
const EMPTY_ROWS = 16;
const TAU = Math.PI * 2;
const GOLD = "#d4a531";
const KIND_COLORS = { pc: "#7fa860", monster: "#c05b4d", marker: "#8fa3b0" };
const DISPLAY_FONT = '"Cinzel", Georgia, serif';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sizeOf = (t) => clamp(Math.round(t.size) || 1, 1, 4);

/* Token initials: first letter of up to three words → "Goblin A" = "GA". */
function initialsOf(label) {
  const words = String(label ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

/* Darken a #hex color for token rims; unparsable → plain dark. */
function darken(col, f = 0.55) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col).trim());
  if (!m) return "rgba(0,0,0,.5)";
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  const ch = (v) => Math.round(v * f);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/* HP fraction → green → gold → red (smooth). */
function hpColor(frac) {
  const G = [127, 168, 96], Y = [212, 165, 49], R = [192, 91, 77];
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const c = frac >= 0.5 ? mix(Y, G, (frac - 0.5) * 2) : mix(R, Y, frac * 2);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* Drain a #hex toward stony gray — for the petrified look. */
function grayify(col, mix = 0.85) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col).trim());
  if (!m) return "#6f6a60";
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const stone = lum * 0.55 + 78;                 // lift toward a mid stone tone
  const bl = (v) => Math.round(v + (stone - v) * mix);
  return `rgb(${bl(r)},${bl(g) + 3},${bl(b) + 6})`; // faint cool cast
}

/* Aura presets a token can opt into via a `t.aura` hint (see setTokens note). */
const AURA_PRESETS = {
  bless:   { tint: "#ffdf8a", style: "glow" },
  holy:    { tint: "#fffbe0", style: "glow" },
  burning: { tint: "#ff7b2d", style: "ember" },
  toxic:   { tint: "#8fbf4f", style: "ember" },
  blur:    { tint: "#9b8ec9", style: "blur" },
  stone:   { tint: "#c9bfa8", style: "glow" },
};
/* A couple of conditions light up a subtle aura on their own, so casting a
   spell that adds the condition is all it takes (nothing else to wire). */
const COND_AURA = { poisoned: "toxic" };

export function createBoard(wrap, hooks = {}) {
  /* ── the three stacked canvases ── */
  const mkCanvas = (cls) => {
    const c = document.createElement("canvas");
    if (cls) c.className = cls;
    wrap.appendChild(c);
    return c;
  };
  const baseC = mkCanvas("");
  const tokC = mkCanvas("");
  const fxC = mkCanvas("fx");            // pointer-events: none via css
  const bctx = baseC.getContext("2d");
  const tctx = tokC.getContext("2d");

  /* ── state ── */
  let grid = { cell: CELL, feet: 5, show: true };
  let mapImg = null;                     // null → parchment fallback
  let mapUrl;                            // undefined until first setMap
  let mapGen = 0;                        // stale image-load guard
  let tokens = [];
  let selectedId = null;
  let targeting = false;
  let destroyed = false;

  let scale = 1;                         // world px → css px
  let pan = { x: 0, y: 0 };              // css px
  let minZoom = MIN_ZOOM;                // relaxed when a huge map needs it
  let dpr = 1;
  let cssW = 0, cssH = 0;
  let needFit = true;                    // auto-fit once we have real size
  let shakeOff = { x: 0, y: 0 };         // transient earthquake offset (css px)

  /* ── coordinate plumbing ── */
  const cssToWorld = (x, y) => ({ x: (x - pan.x) / scale, y: (y - pan.y) / scale });
  const cssToGrid = (x, y) => {
    const w = cssToWorld(x, y);
    return { x: w.x / CELL, y: w.y / CELL };
  };
  function worldSize() {
    if (mapImg && mapImg.naturalWidth > 0) {
      const k = CELL / (grid.cell > 0 ? grid.cell : CELL);
      return { w: mapImg.naturalWidth * k, h: mapImg.naturalHeight * k };
    }
    return { w: EMPTY_COLS * CELL, h: EMPTY_ROWS * CELL };
  }

  /* LIVE adapter for effects.js — canvas (device) px, every call. The
     shake offset rides along here too, so spell fx judder in lock-step
     with the map and tokens during an earthquake. */
  const view = {
    toPx: (g) => ({ x: (g.x * CELL * scale + pan.x + shakeOff.x) * dpr, y: (g.y * CELL * scale + pan.y + shakeOff.y) * dpr }),
    cellPx: () => CELL * scale * dpr,
    feetToPx: (ft) => (ft / (grid.feet > 0 ? grid.feet : 5)) * CELL * scale * dpr,
    // effects.js calls this for earthquake — the whole board judders, then settles
    shake: (ms, magFt) => shakeBoard(ms, magFt),
  };

  /* ── sizing ── */
  function resize() {
    if (destroyed) return;
    const r = wrap.getBoundingClientRect();
    cssW = Math.max(1, Math.round(r.width));
    cssH = Math.max(1, Math.round(r.height));
    dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    for (const c of [baseC, tokC, fxC]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = cssW + "px";
      c.style.height = cssH + "px";
    }
    if (needFit && cssW > 8 && cssH > 8) fit();
    else redrawAll();
  }

  function fit() {
    if (cssW < 8 || cssH < 8) { needFit = true; return; }
    needFit = false;
    const ws = worldSize();
    const s = Math.min(cssW / ws.w, cssH / ws.h) * 0.96;
    minZoom = Math.min(MIN_ZOOM, s);           // let huge maps zoom back out to "fit"
    scale = clamp(s, minZoom, MAX_ZOOM);
    pan = { x: (cssW - ws.w * scale) / 2, y: (cssH - ws.h * scale) / 2 };
    redrawAll();
  }

  function zoomAt(pt, factor) {
    const next = clamp(scale * factor, minZoom, MAX_ZOOM);
    if (next === scale) return;
    const w = cssToWorld(pt.x, pt.y);          // keep this world point under the cursor
    scale = next;
    pan = { x: pt.x - w.x * scale, y: pt.y - w.y * scale };
    redrawAll();
  }

  /* ── base layer: map (or parchment) + grid ── */
  function drawBase() {
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, baseC.width, baseC.height);
    bctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (pan.x + shakeOff.x), dpr * (pan.y + shakeOff.y));
    const ws = worldSize();

    if (mapImg && mapImg.naturalWidth > 0) {
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = "high";
      bctx.drawImage(mapImg, 0, 0, ws.w, ws.h);
    } else {
      // parchment fallback: dark leather with a whisper of checker
      bctx.fillStyle = "#1a150c";
      bctx.fillRect(0, 0, ws.w, ws.h);
      bctx.fillStyle = "rgba(234,223,195,.03)";
      const cols = Math.ceil(ws.w / CELL), rows = Math.ceil(ws.h / CELL);
      for (let ry = 0; ry < rows; ry++)
        for (let rx = ry % 2; rx < cols; rx += 2)
          bctx.fillRect(rx * CELL, ry * CELL, CELL, CELL);
      bctx.strokeStyle = "rgba(212,165,49,.30)";
      bctx.lineWidth = 2 / scale;
      bctx.strokeRect(0, 0, ws.w, ws.h);
    }

    if (grid.show) {
      const onMap = !!(mapImg && mapImg.naturalWidth > 0);
      const strokeGrid = () => {
        bctx.beginPath();
        for (let x = 0; x <= ws.w + 0.01; x += CELL) { bctx.moveTo(x, 0); bctx.lineTo(x, ws.h); }
        for (let y = 0; y <= ws.h + 0.01; y += CELL) { bctx.moveTo(0, y); bctx.lineTo(ws.w, y); }
        bctx.stroke();
      };
      if (onMap) {
        // over a map, a faint gold line washes out — lay a dark halo under a
        // brighter gold line so the grid reads clearly on any artwork
        bctx.strokeStyle = "rgba(8,6,3,.40)"; bctx.lineWidth = 3 / scale; strokeGrid();
        bctx.strokeStyle = "rgba(222,190,110,.55)"; bctx.lineWidth = 1 / scale; strokeGrid();
      } else {
        bctx.strokeStyle = "rgba(212,165,49,.16)"; bctx.lineWidth = 1 / scale; strokeGrid();
      }
    }
  }

  /* ── condition-state helper drawers (all in world px, upright) ── */
  // pick an aura from the token's optional `t.aura` hint, else from a
  // condition that maps to one (see the setTokens note for the hook).
  function resolveAura(t, conds) {
    let a = t.aura;
    if (typeof a === "string") a = AURA_PRESETS[a];
    if (!a) for (const c of conds) if (COND_AURA[c]) { a = AURA_PRESETS[COND_AURA[c]]; break; }
    return a && a.tint ? a : null;
  }
  function drawAura(cx, cy, r, aura, alpha, now) {
    tctx.save();
    const R = r * 1.28;
    if (aura.style === "blur") {                 // soft haze — two offset discs
      tctx.globalAlpha = alpha * 0.26; tctx.fillStyle = aura.tint;
      for (const d of [-1, 1]) { tctx.beginPath(); tctx.arc(cx + d * r * 0.16, cy, r * 1.06, 0, TAU); tctx.fill(); }
    } else if (aura.style === "ember") {         // ring of flickering embers
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + now / 900, f = 0.5 + 0.5 * Math.sin(now / 200 + i);
        tctx.globalAlpha = alpha * (0.3 + 0.5 * f); tctx.fillStyle = aura.tint;
        tctx.beginPath(); tctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, Math.max(1.5 / scale, r * 0.09 * (0.6 + f * 0.6)), 0, TAU); tctx.fill();
      }
    } else {                                     // soft glow ring
      tctx.globalAlpha = alpha * 0.7; tctx.strokeStyle = aura.tint;
      tctx.shadowColor = aura.tint; tctx.shadowBlur = 16;
      tctx.lineWidth = Math.max(2 / scale, r * 0.12);
      tctx.beginPath(); tctx.arc(cx, cy, R, 0, TAU); tctx.stroke();
    }
    tctx.restore();
  }
  function drawBinding(cx, cy, r, alpha) {       // web / chain hint for restrained·grappled
    tctx.save();
    tctx.globalAlpha = alpha * 0.7; tctx.strokeStyle = "rgba(225,230,238,.85)";
    tctx.lineWidth = Math.max(1 / scale, r * 0.05);
    tctx.beginPath(); tctx.arc(cx, cy, r * 0.98, 0, TAU); tctx.clip();  // keep the net on the disc
    tctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; tctx.moveTo(cx, cy); tctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    tctx.stroke();
    tctx.beginPath(); tctx.arc(cx, cy, r * 0.5, 0, TAU); tctx.stroke();
    tctx.beginPath(); tctx.arc(cx, cy, r * 0.82, 0, TAU); tctx.stroke();
    tctx.restore();
  }
  function starAt(x, y, rad, points) {
    tctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = i / (points * 2) * TAU - Math.PI / 2, rr = i % 2 ? rad * 0.42 : rad;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? tctx.lineTo(px, py) : tctx.moveTo(px, py);
    }
    tctx.closePath(); tctx.fill();
  }
  function drawDownedStars(cx, cy, r, now) {     // stunned·paralyzed·unconscious
    tctx.save();
    tctx.fillStyle = GOLD; tctx.shadowColor = "rgba(212,165,49,.7)"; tctx.shadowBlur = 6;
    const R = r * 0.7, top = cy - r * 1.02;
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + now / 500;
      tctx.globalAlpha = 0.85;
      starAt(cx + Math.cos(a) * R, top + Math.sin(a) * R * 0.35, Math.max(2, r * 0.15), 4);
    }
    tctx.restore();
  }

  /* ── token layer ── */
  function drawToken(t, gx, gy, ghost) {
    const size = sizeOf(t);
    const cx = (gx + size / 2) * CELL;
    const cy = (gy + size / 2) * CELL;
    const r = size * CELL * 0.44;                // diameter = size · cell · 0.88
    const baseColor = t.color || KIND_COLORS[t.kind] || KIND_COLORS.marker;

    // condition-driven state, all from the synced `conditions` array
    const conds = Array.isArray(t.conditions) ? t.conditions.map((c) => String(c).toLowerCase()) : [];
    const has = (c) => conds.includes(c);
    const invisible = has("invisible");
    const petrified = has("petrified");
    const prone = has("prone");
    const downed = has("stunned") || has("paralyzed") || has("unconscious");
    const bound = has("restrained") || has("grappled");
    const aura = resolveAura(t, conds);

    const color = petrified ? grayify(baseColor) : baseColor;   // stone-gray
    let alpha = (t.hidden ? 0.45 : 1) * (ghost ? 0.85 : 1);
    if (invisible) alpha *= 0.35;                                // translucent
    else if (downed && !petrified) alpha *= 0.72;               // dimmed
    const now = performance.now();
    tctx.save();

    // whose-turn ring — breathes while the pulse loop runs
    if (t._turn) {
      const p = 0.5 + 0.5 * Math.sin(now / 260);
      tctx.globalAlpha = alpha * (0.5 + 0.45 * p);
      tctx.strokeStyle = GOLD;
      tctx.shadowColor = "rgba(212,165,49,.85)";
      tctx.shadowBlur = 14;
      tctx.lineWidth = Math.max(2 / scale, r * (0.07 + 0.05 * p));
      tctx.beginPath();
      tctx.arc(cx, cy, r + Math.max(6 / scale, r * 0.22), 0, TAU);
      tctx.stroke();
      tctx.shadowBlur = 0;
    }

    // selection ring: gold, thicker
    if (t.id === selectedId) {
      tctx.globalAlpha = alpha;
      tctx.strokeStyle = GOLD;
      tctx.shadowColor = "rgba(212,165,49,.7)";
      tctx.shadowBlur = 10;
      tctx.lineWidth = Math.max(2.4 / scale, r * 0.1);
      tctx.beginPath();
      tctx.arc(cx, cy, r + Math.max(3 / scale, r * 0.11), 0, TAU);
      tctx.stroke();
      tctx.shadowBlur = 0;
    }

    // optional aura glow (behind the body, upright)
    if (aura) drawAura(cx, cy, r, aura, alpha, now);

    // ── the body: disc + rim + hp + initials — visibly toppled when prone ──
    tctx.save();
    if (prone) { tctx.translate(cx, cy); tctx.rotate(-0.62); tctx.scale(1, 0.5); tctx.translate(-cx, -cy); }

    tctx.globalAlpha = alpha;
    tctx.beginPath();
    tctx.arc(cx, cy, r, 0, TAU);
    tctx.fillStyle = color;
    tctx.fill();
    tctx.lineWidth = Math.max(1.2 / scale, r * 0.075);
    tctx.strokeStyle = petrified ? "#4c473d" : darken(color);
    if (t.hidden) tctx.setLineDash([7, 5]);
    tctx.stroke();
    tctx.setLineDash([]);

    // invisible: a faint shimmering dashed outline
    if (invisible) {
      tctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 300);
      tctx.strokeStyle = "rgba(200,225,255,.85)";
      tctx.lineWidth = Math.max(1 / scale, r * 0.06);
      tctx.setLineDash([Math.max(3, r * 0.16), Math.max(3, r * 0.16)]);
      tctx.lineDashOffset = (now / 40) % 1000;
      tctx.beginPath(); tctx.arc(cx, cy, r * 1.05, 0, TAU); tctx.stroke();
      tctx.setLineDash([]); tctx.lineDashOffset = 0;
    }
    // petrified: a couple of stony cracks
    if (petrified) {
      tctx.globalAlpha = alpha * 0.5; tctx.strokeStyle = "#413c33"; tctx.lineWidth = Math.max(1 / scale, r * 0.05);
      tctx.beginPath();
      tctx.moveTo(cx - r * 0.4, cy - r * 0.5); tctx.lineTo(cx - r * 0.05, cy + r * 0.1); tctx.lineTo(cx - r * 0.3, cy + r * 0.6);
      tctx.moveTo(cx + r * 0.35, cy - r * 0.55); tctx.lineTo(cx + r * 0.1, cy);
      tctx.stroke();
    }

    // thin HP arc riding the rim: 12 o'clock, clockwise, green→gold→red
    if (Number.isFinite(+t.hp_max) && +t.hp_max > 0) {
      const cur = t.hp_current == null ? +t.hp_max : +t.hp_current;
      const frac = clamp(cur / +t.hp_max, 0, 1);
      if (frac > 0) {
        tctx.globalAlpha = alpha;
        tctx.beginPath();
        tctx.arc(cx, cy, r, -TAU / 4, -TAU / 4 + frac * TAU);
        tctx.lineWidth = Math.max(1.5 / scale, r * 0.075);
        tctx.strokeStyle = hpColor(frac);
        tctx.lineCap = frac < 1 ? "round" : "butt";
        if (t.hidden) tctx.setLineDash([7, 5]);   // keep the hidden cue readable
        tctx.stroke();
        tctx.setLineDash([]);
        tctx.lineCap = "butt";
      }
    }

    // initials
    const ini = initialsOf(t.label);
    const fs = r * (ini.length === 1 ? 0.9 : ini.length === 2 ? 0.6 : 0.46);
    tctx.globalAlpha = alpha;
    tctx.font = `700 ${fs}px ${DISPLAY_FONT}`;
    tctx.textAlign = "center";
    tctx.textBaseline = "middle";
    tctx.lineWidth = Math.max(1 / scale, fs * 0.1);
    tctx.strokeStyle = "rgba(22,16,7,.5)";
    tctx.strokeText(ini, cx, cy + fs * 0.06);
    tctx.fillStyle = petrified ? "#d8d2c4" : "#f6efdc";
    tctx.fillText(ini, cx, cy + fs * 0.06);
    tctx.restore();                              // end body (drops the prone tilt)

    // ── overlays that stay upright ──
    if (bound) drawBinding(cx, cy, r, alpha);    // web / chain hint
    if (downed) drawDownedStars(cx, cy, r, now); // stunned / paralyzed / unconscious

    // condition badges along the bottom: up to 3 letters, then "+n"
    if (conds.length) {
      const shown = conds.slice(0, 3).map((c) => String(c).charAt(0).toUpperCase() || "?");
      if (conds.length > 3) shown.push("+" + (conds.length - 3));
      const br = Math.max(7, r * 0.21);
      const step = br * 2.2;
      const by = cy + r * 0.86;
      let bx = cx - ((shown.length - 1) * step) / 2;
      for (const badge of shown) {
        const more = badge.length > 1;
        tctx.globalAlpha = 1;
        tctx.beginPath();
        tctx.arc(bx, by, br, 0, TAU);
        tctx.fillStyle = "#7e2f24";
        tctx.fill();
        tctx.lineWidth = Math.max(1 / scale, br * 0.14);
        tctx.strokeStyle = "#e39387";
        tctx.stroke();
        tctx.font = `700 ${br * (more ? 0.95 : 1.15)}px ${DISPLAY_FONT}`;
        tctx.fillStyle = "#ffe4de";
        tctx.fillText(badge, bx, by + br * 0.08);
        bx += step;
      }
    }
    tctx.restore();
  }

  function drawTokens() {
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, tokC.width, tokC.height);
    tctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (pan.x + shakeOff.x), dpr * (pan.y + shakeOff.y));

    const dragging = gesture && gesture.kind === "token" ? gesture : null;
    if (dragging) {
      // gold snap hint under everything: where the drop will land
      const sx = Math.round(dragging.gx), sy = Math.round(dragging.gy);
      const s = sizeOf(dragging.tok);
      tctx.strokeStyle = "rgba(212,165,49,.55)";
      tctx.lineWidth = 2 / scale;
      tctx.setLineDash([6 / scale, 5 / scale]);
      tctx.strokeRect(sx * CELL, sy * CELL, s * CELL, s * CELL);
      tctx.setLineDash([]);
    }
    for (const t of tokens) {
      if (dragging && t.id === dragging.tok.id) continue;   // ghost drawn last
      drawToken(t, t.x, t.y, false);
    }
    if (dragging) drawToken(dragging.tok, dragging.gx, dragging.gy, true);
  }

  const redrawAll = () => { drawBase(); drawTokens(); };

  /* turn-ring pulse: runs ONLY while a _turn token exists */
  let pulseRaf = 0, pulseLast = 0;
  function pulseTick(now) {
    pulseRaf = 0;
    if (destroyed) return;
    if (now - pulseLast >= 33) { pulseLast = now; drawTokens(); }   // ~30 fps is plenty
    if (tokens.some((t) => t._turn)) pulseRaf = requestAnimationFrame(pulseTick);
  }
  function syncPulse() {
    if (!pulseRaf && !destroyed && tokens.some((t) => t._turn))
      pulseRaf = requestAnimationFrame(pulseTick);
  }

  /* transient ground-shake (earthquake): a short, decaying random offset
     applied to every layer that settles back to zero — never sticks. */
  let shakeRaf = 0, shakeStart = 0, shakeDur = 0, shakeMag = 0;
  function shakeTick(now) {
    shakeRaf = 0;
    if (destroyed) return;
    const el = now - shakeStart;
    if (el >= shakeDur) { shakeOff = { x: 0, y: 0 }; redrawAll(); return; }
    const amp = shakeMag * (1 - el / shakeDur);            // decay to nothing
    shakeOff = { x: (Math.random() * 2 - 1) * amp, y: (Math.random() * 2 - 1) * amp };
    redrawAll();
    shakeRaf = requestAnimationFrame(shakeTick);
  }
  function shakeBoard(ms = 800, magFt = 1.5) {
    if (destroyed) return;
    const px = (magFt / (grid.feet > 0 ? grid.feet : 5)) * CELL * scale; // ft → css px, zoom-aware
    shakeStart = performance.now();
    shakeDur = Math.max(120, ms | 0);
    shakeMag = clamp(px * 0.6, 2, 48);                     // damp + cap so it reads as a judder, not chaos
    if (!shakeRaf) shakeRaf = requestAnimationFrame(shakeTick);
  }

  /* ── input: pan / zoom / pinch / drag / tap ── */
  const pointers = new Map();          // pointerId → wrap-relative css pt
  let gesture = null;                  // {kind: press|pan|token|pinch, …}

  const relPt = (e) => {
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function hitToken(pt) {
    const w = cssToWorld(pt.x, pt.y);
    for (let i = tokens.length - 1; i >= 0; i--) {        // topmost first
      const t = tokens[i];
      const size = sizeOf(t);
      const cx = (t.x + size / 2) * CELL, cy = (t.y + size / 2) * CELL;
      const hr = Math.max(size * CELL * 0.44, 12 / scale); // stay tappable zoomed out
      if ((w.x - cx) ** 2 + (w.y - cy) ** 2 <= hr * hr) return t;
    }
    return null;
  }

  function setCursor(cur) {
    if (targeting) cur = "";                    // let .targeting's crosshair rule
    if (wrap.style.cursor !== cur) wrap.style.cursor = cur;
  }
  const hoverCursor = (pt) => setCursor(pt && hitToken(pt) ? "pointer" : "grab");

  function onDown(e) {
    if (destroyed) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const pt = relPt(e);
    pointers.set(e.pointerId, pt);
    try { wrap.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }

    if (pointers.size === 2) {                  // second finger → pinch (drops any drag)
      const [a, b] = [...pointers.values()];
      gesture = {
        kind: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s0: scale,
        w0: cssToWorld((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
      drawTokens();                             // erase a half-dragged ghost
      return;
    }
    if (pointers.size > 2 || gesture) return;

    gesture = {
      kind: "press",
      id: e.pointerId,
      start: pt,
      slop: e.pointerType === "touch" ? 9 : 5,
      tok: hitToken(pt),
    };
  }

  function onMove(e) {
    if (destroyed) return;
    const pt = relPt(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);

    if (!gesture) { hoverCursor(pt); return; }

    if (gesture.kind === "pinch") {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      scale = clamp(gesture.s0 * (d / gesture.d0), minZoom, MAX_ZOOM);
      pan = { x: mid.x - gesture.w0.x * scale, y: mid.y - gesture.w0.y * scale };
      redrawAll();
      return;
    }
    if (e.pointerId !== gesture.id) return;

    if (gesture.kind === "press") {
      if (Math.hypot(pt.x - gesture.start.x, pt.y - gesture.start.y) < gesture.slop) return;
      // it's a real drag: movable token → move it; anything else → pan
      if (gesture.tok && !targeting && hooks.canMove?.(gesture.tok)) {
        const g0 = cssToGrid(gesture.start.x, gesture.start.y);
        gesture = {
          kind: "token", id: gesture.id, tok: gesture.tok,
          offX: g0.x - gesture.tok.x, offY: g0.y - gesture.tok.y,
          gx: gesture.tok.x, gy: gesture.tok.y,
        };
        setCursor("grabbing");
      } else {
        gesture = { kind: "pan", id: gesture.id, start: gesture.start, pan0: { ...pan } };
        setCursor("grabbing");
      }
    }

    if (gesture.kind === "pan") {
      pan = { x: gesture.pan0.x + (pt.x - gesture.start.x), y: gesture.pan0.y + (pt.y - gesture.start.y) };
      redrawAll();
    } else if (gesture.kind === "token") {
      const g = cssToGrid(pt.x, pt.y);
      gesture.gx = g.x - gesture.offX;
      gesture.gy = g.y - gesture.offY;
      drawTokens();
    }
  }

  function onUp(e) {
    if (destroyed) return;
    if (!pointers.delete(e.pointerId)) return;
    const pt = relPt(e);

    if (gesture && gesture.kind === "pinch") {
      if (pointers.size === 1) {                // one finger stays → keep panning
        const [id] = pointers.keys();
        gesture = { kind: "pan", id, start: pointers.get(id), pan0: { ...pan } };
      } else if (!pointers.size) gesture = null;
      return;
    }
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;

    if (g.kind === "press") {
      // a plain click / tap (never moved past the slop)
      if (targeting) {
        setTargeting(false);                    // one pick per arm; hook may re-arm
        hooks.onPickPoint?.(cssToGrid(pt.x, pt.y));
      } else if (g.tok) {
        hooks.onSelectToken?.(g.tok, pt);
      } else {
        hooks.onSelectToken?.(null, pt);
      }
    } else if (g.kind === "token") {
      const sx = Math.round(g.gx), sy = Math.round(g.gy);   // snap: integer top-left
      const live = tokens.find((t) => t.id === g.tok.id);
      if (live) { live.x = sx; live.y = sy; }               // no flicker while saving
      drawTokens();
      hooks.onMoveToken?.(g.tok.id, sx, sy);
    }
    hoverCursor(pt);
  }

  function onCancel(e) {
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === "pinch" ? pointers.size < 2 : gesture.id === e.pointerId) {
      const wasToken = gesture.kind === "token";
      gesture = null;
      if (wasToken) drawTokens();               // ghost reverts, nothing was moved
      setCursor("grab");
    }
  }

  function onWheel(e) {
    if (destroyed) return;
    e.preventDefault();                         // keep the page still, incl. ctrl-pinch
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    zoomAt(relPt(e), factor);
  }

  const onCtxMenu = (e) => e.preventDefault();  // long-press must not pop a menu mid-drag

  wrap.addEventListener("pointerdown", onDown);
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerup", onUp);
  wrap.addEventListener("pointercancel", onCancel);
  wrap.addEventListener("wheel", onWheel, { passive: false });
  wrap.addEventListener("contextmenu", onCtxMenu);
  setCursor("grab");

  const ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  window.addEventListener("resize", resize);    // catches devicePixelRatio changes
  resize();

  // redraw once the display font arrives so initials render in Cinzel
  document.fonts?.ready?.then(() => { if (!destroyed) drawTokens(); });

  /* ── public api ── */
  function setMap(url) {
    if (url === mapUrl) return;                 // same scene — keep the camera
    mapUrl = url;
    const gen = ++mapGen;
    const apply = (img) => {
      if (gen !== mapGen || destroyed) return;
      const before = worldSize();
      mapImg = img;
      const after = worldSize();
      // a genuinely new scene auto-fits; a same-size reload (signed
      // urls rotate) keeps the player's pan/zoom untouched
      if (needFit || Math.abs(before.w - after.w) > 1 || Math.abs(before.h - after.h) > 1) fit();
      else redrawAll();
    };
    if (!url) { apply(null); return; }
    // We only DRAW the map (never read its pixels back), so we don't need
    // crossOrigin — and requesting it would make the image fail to load
    // whenever the host (e.g. a Supabase signed URL) omits CORS headers,
    // silently blanking the board. Load plainly; the canvas may become
    // "tainted", which is harmless here.
    const load = (useCors) => {
      const img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = () => apply(img);
      // a CORS attempt that fails gets one plain retry; a plain load that
      // fails is a genuinely broken image → parchment fallback
      img.onerror = () => (useCors ? load(false) : apply(null));
      img.src = url;
    };
    load(false);
  }

  function setGrid(g) {
    grid = { cell: CELL, feet: 5, show: true, ...(g || {}) };
    if (!(grid.cell > 0)) grid.cell = CELL;
    redrawAll();
  }

  // ── Persistent per-token spell states ──
  // Token visuals are driven entirely by the already-synced `conditions`
  // array (and one optional `aura` hint), so they persist for the spell's
  // duration and clear the moment the condition is removed — nothing else
  // to wire on the render side. To light one up, the Cast tab just adds the
  // matching condition to the target token (the same array the token menu
  // already toggles). Suggested caster mapping:
  //     invisibility / greater-invisibility → add "invisible"  (translucent + shimmer)
  //     flesh-to-stone                       → add "petrified"  (stone-gray + cracks)
  //     (any knock-down / hit while at 0 hp) → add "prone"      (toppled disc)
  //     hold-person / hold-monster           → add "paralyzed"  (dim + circling stars)
  //     power-word-stun                      → add "stunned"
  //     sleep / unconsciousness              → add "unconscious"
  //     web / entangle / black-tentacles     → add "restrained" (web overlay)
  //     grappled by a creature               → add "grappled"
  // Optional generic AURA: set `t.aura` to a preset name ("bless" | "holy" |
  // "burning" | "toxic" | "blur" | "stone") or a `{ tint:"#hex", style:"glow"|
  // "ember"|"blur" }` object — e.g. bless → "bless", stoneskin → "stone",
  // fire-shield → "burning", blur → "blur". A few conditions also imply an
  // aura on their own (see COND_AURA: poisoned → toxic-green embers).
  function setTokens(list) {
    tokens = Array.isArray(list) ? list.map((t) => ({ ...t })) : [];
    if (gesture && gesture.kind === "token") {
      const live = tokens.find((t) => t.id === gesture.tok.id);
      if (live) gesture.tok = live;             // keep dragging the fresh row
      else gesture = null;                      // it was removed under us
    }
    drawTokens();
    syncPulse();
  }

  function setSelected(id) {
    selectedId = id ?? null;
    drawTokens();
  }

  function setTargeting(on) {
    targeting = !!on;
    wrap.classList.toggle("targeting", targeting);
    if (targeting) wrap.style.cursor = "";      // crosshair comes from the css class
    else setCursor("grab");
  }

  function destroy() {
    destroyed = true;
    if (pulseRaf) cancelAnimationFrame(pulseRaf);
    if (shakeRaf) cancelAnimationFrame(shakeRaf);
    ro.disconnect();
    window.removeEventListener("resize", resize);
    wrap.removeEventListener("pointerdown", onDown);
    wrap.removeEventListener("pointermove", onMove);
    wrap.removeEventListener("pointerup", onUp);
    wrap.removeEventListener("pointercancel", onCancel);
    wrap.removeEventListener("wheel", onWheel);
    wrap.removeEventListener("contextmenu", onCtxMenu);
    wrap.classList.remove("targeting");
    wrap.style.cursor = "";
    pointers.clear();
    gesture = null;
    for (const c of [baseC, tokC, fxC]) c.remove();
  }

  return { setMap, setGrid, setTokens, setSelected, setTargeting, fit, view, fxCanvas: fxC, shake: shakeBoard, destroy };
}
