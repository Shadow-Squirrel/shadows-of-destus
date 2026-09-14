// ─────────────────────────────────────────────────────────────
//  effects.js — spell & attack animations for the battle map.
//
//  Every spell gets a show. Recipes are STAGES (projectile,
//  burst, ring, cone, beam, cloud…) composed automatically from
//  the spell's real data — damage type → colors, area of effect
//  → a lingering outline, attack spells → projectiles, heals →
//  rising sparkles — with hand-tuned signatures for the icons
//  (fireball, magic missile, lightning bolt, meteor swarm…).
//
//  Pure view: positions arrive in GRID coordinates and a `view`
//  adapter maps them to pixels every frame, so pan/zoom mid-cast
//  just works. Nothing here touches the database.
// ─────────────────────────────────────────────────────────────
import { SPELLS } from "../dnd/data/spells.js";

/* ── palettes by damage type / school ── */
const PALETTES = {
  fire:        { core: "#ffd166", mid: "#ff7b2d", edge: "#c22b12", glow: "rgba(255,120,30,.5)" },
  cold:        { core: "#ffffff", mid: "#9fd8ff", edge: "#3a7fc2", glow: "rgba(140,200,255,.45)" },
  lightning:   { core: "#ffffff", mid: "#8fd3ff", edge: "#3f6fff", glow: "rgba(120,180,255,.5)" },
  acid:        { core: "#d8ff7a", mid: "#7ac74f", edge: "#3e7a1f", glow: "rgba(140,220,90,.45)" },
  poison:      { core: "#c9f27d", mid: "#6f9a3d", edge: "#3c5c1e", glow: "rgba(120,160,70,.4)" },
  necrotic:    { core: "#d9c1ff", mid: "#7b4fd1", edge: "#2c1257", glow: "rgba(120,70,200,.45)" },
  radiant:     { core: "#fffbe0", mid: "#ffd166", edge: "#c9921a", glow: "rgba(255,220,120,.5)" },
  force:       { core: "#ffffff", mid: "#c9b3ff", edge: "#6f4fd1", glow: "rgba(180,150,255,.5)" },
  thunder:     { core: "#ffffff", mid: "#cfd8e3", edge: "#8fa3b0", glow: "rgba(200,215,230,.4)" },
  psychic:     { core: "#ffd6f2", mid: "#e06fc0", edge: "#8a2f72", glow: "rgba(220,120,190,.45)" },
  bludgeoning: { core: "#e8e0d0", mid: "#a5906a", edge: "#5c4d33", glow: "rgba(180,160,120,.35)" },
  piercing:    { core: "#e8e0d0", mid: "#b9c9d3", edge: "#5c6d77", glow: "rgba(180,200,210,.35)" },
  slashing:    { core: "#ffffff", mid: "#cfd8e3", edge: "#6d7f8a", glow: "rgba(200,210,220,.35)" },
  heal:        { core: "#fff7cf", mid: "#a7cf8b", edge: "#5c8a3d", glow: "rgba(170,220,140,.5)" },
  // school fallbacks (no damage type)
  abjuration:    { core: "#dff3ff", mid: "#8fd3ff", edge: "#3a7fc2", glow: "rgba(140,200,255,.45)" },
  conjuration:   { core: "#fff1d6", mid: "#e8a05c", edge: "#8a5a1f", glow: "rgba(230,170,100,.45)" },
  divination:    { core: "#ffffff", mid: "#cbb3ff", edge: "#6f5fb0", glow: "rgba(190,170,255,.45)" },
  enchantment:   { core: "#ffe0ef", mid: "#e08fc0", edge: "#a04f82", glow: "rgba(230,150,200,.45)" },
  evocation:     { core: "#ffd166", mid: "#ff7b2d", edge: "#c22b12", glow: "rgba(255,120,30,.5)" },
  illusion:      { core: "#f2e0ff", mid: "#b58fe0", edge: "#5f3a8a", glow: "rgba(180,140,230,.45)" },
  necromancy:    { core: "#d9c1ff", mid: "#7b4fd1", edge: "#2c1257", glow: "rgba(120,70,200,.45)" },
  transmutation: { core: "#eaffd6", mid: "#a9d17b", edge: "#5c7a3d", glow: "rgba(170,210,130,.45)" },
  // material / element flavours the signatures reach for by name
  stone:  { core: "#c9bfa8", mid: "#8a8073", edge: "#4a453a", glow: "rgba(150,140,120,.4)" },
  water:  { core: "#dff3ff", mid: "#5fb0d8", edge: "#2a6a9a", glow: "rgba(120,190,230,.45)" },
  ice:    { core: "#ffffff", mid: "#9fd8ff", edge: "#3a7fc2", glow: "rgba(160,215,255,.5)" },
  wind:   { core: "#ffffff", mid: "#dfeaf0", edge: "#9fb3bf", glow: "rgba(220,235,245,.35)" },
  plant:  { core: "#d8ff9a", mid: "#5f9a3d", edge: "#2f5a1e", glow: "rgba(120,180,70,.4)" },
  dust:   { core: "#e8d8b8", mid: "#a5906a", edge: "#5c4d33", glow: "rgba(180,160,120,.4)" },
  holy:   { core: "#fffbe0", mid: "#ffd166", edge: "#c9921a", glow: "rgba(255,220,120,.55)" },
};
const pal = (key) => PALETTES[key] || PALETTES.evocation;

const GOLD = "#d4a531";                 // theme accent — the size-label colour
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* wall / barrier materials — signatures pick one by name; each carries
   its own palette so a stone wall reads stone no matter the spell's school. */
const MAT = {
  stone: { face: "#6b6357", light: "#9a9082", dark: "#312c25", seam: "#221e18", solid: true },
  ice:   { face: "rgba(150,205,235,.5)", light: "rgba(230,248,255,.9)", dark: "rgba(60,110,150,.6)", seam: "rgba(200,235,255,.5)", solid: false },
  thorn: { face: "#3a5a2a", light: "#6f9a3d", dark: "#1c2e12", seam: "#122008", solid: true },
  blade: { face: "rgba(180,200,215,.35)", light: "#fff2c4", dark: "rgba(120,20,10,.4)", seam: "rgba(255,220,160,.7)", solid: false },
  force: { face: "rgba(150,130,255,.24)", light: "rgba(225,215,255,.85)", dark: "rgba(90,70,180,.5)", seam: "rgba(200,190,255,.6)", solid: false },
};

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
};

/* ═══ stage primitives ═══
   Each stage: {type, at:"to"|"from", delay, dur, …params}.
   Distances in FEET (ft) or cells (cells) — converted per frame. */

export function createFx(canvas, view) {
  // view: { toPx({x,y}grid) → {x,y}px, cellPx() → px, feetToPx(ft) → px }
  const ctx = canvas.getContext("2d");
  let effects = [];   // {stages:[...], t0, from, to, palette}
  let particles = []; // {x,y,vx,vy(px/s? grid/s), born, life, size, colorStops, kind, anchor}
  let running = false;

  const P = (gridPt) => view.toPx(gridPt);
  const F = (ft) => view.feetToPx(ft);

  function spawnParticles(n, originGrid, opts) {
    const cap = 700 - particles.length;
    n = Math.min(n, Math.max(0, cap));
    for (let i = 0; i < n; i++) {
      const ang = opts.angle != null ? opts.angle + rand(-opts.spread, opts.spread) : rand(0, TAU);
      const sp = rand(opts.speed[0], opts.speed[1]); // feet/sec
      particles.push({
        grid: { ...originGrid },
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        drag: opts.drag ?? 0.9,
        gravity: opts.gravity ?? 0,
        born: performance.now(),
        life: rand(opts.life[0], opts.life[1]),
        size: rand(opts.size[0], opts.size[1]),   // px at cell 70
        palette: opts.palette,
        twinkle: opts.twinkle || false,
        rise: opts.rise || 0,
      });
    }
  }

  /* draw helpers (px space) */
  const glowCircle = (x, y, r, palette, alpha) => {
    if (r <= 0.5) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, palette.core);
    g.addColorStop(0.45, palette.mid);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  function jaggedPath(a, b, jag, forks) {
    // returns array of point arrays (main + branches), px space
    const pts = [a];
    const seg = 8;
    for (let i = 1; i < seg; i++) {
      const t = i / seg;
      pts.push({
        x: a.x + (b.x - a.x) * t + rand(-jag, jag),
        y: a.y + (b.y - a.y) * t + rand(-jag, jag),
      });
    }
    pts.push(b);
    const paths = [pts];
    for (let f = 0; f < forks; f++) {
      const start = pts[2 + Math.floor(rand(0, seg - 3))];
      const ang = rand(0, TAU);
      const len = rand(jag * 1.5, jag * 3.5);
      paths.push([start, { x: start.x + Math.cos(ang) * len, y: start.y + Math.sin(ang) * len }]);
    }
    return paths;
  }

  /* per-stage renderers: (stage, tNorm, eff) with ctx ready */
  const STAGE = {
    projectile(s, t, eff) {
      const a = P(eff.from), b = P(eff.to);
      const tt = ease.inOut(t);
      const arc = (s.arc ?? 0.25) * Math.sin(Math.PI * tt) * F(10);
      const x = a.x + (b.x - a.x) * tt;
      const y = a.y + (b.y - a.y) * tt - arc;
      glowCircle(x, y, (s.size ?? 9) * (view.cellPx() / 70), eff.palette, 1);
      if (Math.random() < 0.8)
        spawnParticles(2, pxToGridApprox({ x, y }), {
          speed: [1, 5], life: [200, 450], size: [2, 4], palette: eff.palette, drag: 0.9,
        });
    },
    burst(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to);
      const R = F(s.radiusFt ?? 10);
      glowCircle(c.x, c.y, R * ease.out(t) * (s.scale ?? 1), eff.palette, (1 - t) * 0.9);
      if (t < 0.15 && !s._spawned) {
        s._spawned = true;
        const rf = s.radiusFt ?? 10;
        spawnParticles(s.particles ?? 50, s.at === "from" ? eff.from : eff.to, {
          speed: [rf * 1.2, rf * 3], life: [350, 900],
          size: [2, 6], palette: eff.palette, drag: 0.88, gravity: s.embers ? 14 : 0,
        });
      }
    },
    ring(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to);
      const R = F(s.radiusFt ?? 20);
      const r = s.expand ? R * ease.out(t) : R;
      const fade = s.linger ? Math.min(1, (1 - t) * 3) : 1 - t;
      const pulse = s.linger ? 0.75 + 0.25 * Math.sin(t * 22) : 1;
      ctx.globalAlpha = Math.max(0, fade * 0.9);
      ctx.strokeStyle = eff.palette.mid;
      ctx.lineWidth = 3 * pulse;
      ctx.setLineDash(s.dashed ? [8, 7] : []);
      ctx.shadowColor = eff.palette.glow;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
    rect(s, t, eff) {
      const c = P(eff.to);
      const half = F(s.sizeFt ?? 15) / 2;
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - t) * 3) * 0.9);
      ctx.strokeStyle = eff.palette.mid;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 7]);
      ctx.shadowColor = eff.palette.glow;
      ctx.shadowBlur = 12;
      ctx.strokeRect(c.x - half, c.y - half, half * 2, half * 2);
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
    cone(s, t, eff) {
      const a = P(eff.from), b = P(eff.to);
      const dir = Math.atan2(b.y - a.y, b.x - a.x);
      const len = F(s.lengthFt ?? 15);
      const half = Math.atan(0.5); // 5e cone: width = length
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - t) * 2.5) * 0.85);
      ctx.strokeStyle = eff.palette.mid;
      ctx.fillStyle = eff.palette.glow;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.arc(a.x, a.y, len, dir - half, dir + half);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (t < 0.5)
        spawnParticles(6, eff.from, {
          angle: dir, spread: half * 0.9, speed: [s.lengthFt * 1.6, s.lengthFt * 3],
          life: [250, 650], size: [3, 7], palette: eff.palette, drag: 0.92,
        });
    },
    line(s, t, eff) {
      const a = P(eff.from), b0 = P(eff.to);
      const dir = Math.atan2(b0.y - a.y, b0.x - a.x);
      const len = F(s.lengthFt ?? 30);
      const b = { x: a.x + Math.cos(dir) * len, y: a.y + Math.sin(dir) * len };
      const wide = F(s.widthFt ?? 5);
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - t) * 2.5) * 0.8);
      ctx.strokeStyle = eff.palette.mid;
      ctx.lineWidth = wide;
      ctx.lineCap = "round";
      ctx.shadowColor = eff.palette.glow;
      ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = eff.palette.core;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
    bolt(s, t, eff) {
      if (t > 0.9) return;
      const a = P(eff.from), b = P(eff.to);
      // `steady` keeps one jagged shape for the whole flash (always readable);
      // otherwise the path re-rolls each frame for a live electric flicker.
      if (!s._paths || (!s.steady && Math.random() < 0.35)) s._paths = jaggedPath(a, b, F(s.jagFt ?? 4), s.forks ?? 3);
      ctx.globalAlpha = s.steady ? 0.95 : 0.55 + Math.random() * 0.45;
      ctx.lineCap = "round";
      ctx.shadowColor = eff.palette.glow;
      ctx.shadowBlur = 18;
      for (const [w, col] of [[5, eff.palette.mid], [2, eff.palette.core]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        for (const path of s._paths) {
          ctx.beginPath();
          ctx.moveTo(path[0].x, path[0].y);
          for (const p of path.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
    column(s, t, eff) {
      const c = P(eff.to);
      const h = F(s.heightFt ?? 30) * 1.6;
      const w = F(s.widthFt ?? 8);
      const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      const g = ctx.createLinearGradient(c.x, c.y - h, c.x, c.y);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.6, eff.palette.glow);
      g.addColorStop(1, eff.palette.core);
      ctx.globalAlpha = Math.max(0, alpha * 0.9);
      ctx.fillStyle = g;
      ctx.fillRect(c.x - w / 2, c.y - h, w, h);
      ctx.globalAlpha = 1;
      glowCircle(c.x, c.y, w * 0.9, eff.palette, Math.max(0, alpha * 0.8));
    },
    cloud(s, t, eff) {
      const c = P(eff.to);
      const R = F(s.radiusFt ?? 15);
      if (!s._blobs) s._blobs = Array.from({ length: 14 }, () => ({ a: rand(0, TAU), r: rand(0.15, 0.95), s: rand(0.35, 0.7), drift: rand(-0.4, 0.4) }));
      const alpha = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
      ctx.globalAlpha = Math.max(0, alpha * 0.5);
      for (const bl of s._blobs) {
        const ang = bl.a + t * bl.drift * 4;
        glowCircle(c.x + Math.cos(ang) * R * bl.r, c.y + Math.sin(ang) * R * bl.r, R * bl.s, eff.palette, alpha * 0.5);
      }
      ctx.globalAlpha = 1;
    },
    sparkles(s, t, eff) {
      if (t < 0.6 && Math.random() < 0.7)
        spawnParticles(3, s.at === "from" ? eff.from : eff.to, {
          speed: [1, 6], life: [500, 1100], size: [2, 4.5],
          palette: eff.palette, drag: 0.96, rise: -7, twinkle: true, // ft/s upward drift
        });
    },
    orbit(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to);
      const R = F(s.radiusFt ?? 7.5);
      const n = s.count ?? 6;
      const alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + t * TAU * (s.turns ?? 2);
        glowCircle(c.x + Math.cos(ang) * R, c.y + Math.sin(ang) * R, 6 * (view.cellPx() / 70), eff.palette, alpha);
      }
    },
    implode(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to);
      const R = F(s.radiusFt ?? 8) * (1 - ease.in(t));
      ctx.globalAlpha = t * 0.9;
      ctx.strokeStyle = eff.palette.mid;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = eff.palette.glow;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(1, R), 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
    slash(s, t, eff) {
      const c = P(eff.to);
      const r = F(4.5);
      const a0 = (s.angle ?? -0.8) + ease.out(t) * 2.2;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = eff.palette.core;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.shadowColor = eff.palette.glow;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, a0, a0 + 1.1);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },

    /* ── the size read-out that rides a lingering area outline ──
       gold theme text ("20 ft radius") that fades in with the ring and
       out with it. Drawn source-over so it stays crisp over the glow. */
    label(s, t, eff) {
      const cs = view.cellPx() / 70;
      let x, y;
      if (s.shape === "cone" || s.shape === "line") {
        const a = P(eff.from), b = P(eff.to);
        let dir = Math.atan2(b.y - a.y, b.x - a.x);
        if (a.x === b.x && a.y === b.y) dir = 0;      // self-cast → read to the right
        const len = F(s.sizeFt);
        x = a.x + Math.cos(dir) * len * 0.5;
        y = a.y + Math.sin(dir) * len * 0.5 - 18 * cs; // float above the shape
      } else {
        const c = P(s.at === "from" ? eff.from : eff.to);
        const R = s.shape === "cube" ? F(s.sizeFt) / 2 : F(s.sizeFt);
        x = c.x;
        y = c.y + R + 16 * cs;                         // tuck just below the ring
      }
      const fade = s.linger ? Math.min(1, t * 6) * Math.min(1, (1 - t) * 3) : 1 - t;
      const fs = 13 * clamp(cs, 0.85, 2.4);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.max(0, fade);
      ctx.font = `600 ${fs}px "Cinzel", Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, fs * 0.3);
      ctx.strokeStyle = "rgba(10,7,3,.85)";            // dark halo → legible on any map
      ctx.strokeText(s.text, x, y);
      ctx.shadowColor = "rgba(212,165,49,.5)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = GOLD;
      ctx.fillText(s.text, x, y);
      ctx.restore();
    },

    /* ── the ground heaves: ask the board (or fx canvas) to judder,
       then billow dust up across the area ── */
    quake(s, t, eff) {
      if (!s._done) { s._done = true; requestShake(s.ms ?? 900, s.magFt ?? 1.4); }
      if (t < 0.55 && Math.random() < 0.9) {
        const R = s.radiusFt ?? 20;
        const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * R / 5; // ft→cells
        spawnParticles(2, { x: eff.to.x + Math.cos(a) * rr, y: eff.to.y + Math.sin(a) * rr }, {
          speed: [1, 6], life: [500, 1150], size: [3, 8], palette: pal("dust"),
          drag: 0.9, gravity: -3, rise: -3,
        });
      }
    },

    /* cracks racing outward from the epicentre, branching as they go */
    fissure(s, t, eff) {
      const c = P(eff.to), R = F(s.radiusFt ?? 40), n = s.count ?? 10, cs = view.cellPx() / 70;
      if (!s._cracks) {
        s._cracks = [];
        for (let i = 0; i < n; i++) {
          let a = (i / n) * TAU + rand(-0.25, 0.25), px = 0, py = 0;
          const pts = [{ x: 0, y: 0 }], steps = 6 + Math.floor(rand(0, 4)), seg = R / steps;
          for (let k = 0; k < steps; k++) { a += rand(-0.5, 0.5); px += Math.cos(a) * seg; py += Math.sin(a) * seg; pts.push({ x: px, y: py }); }
          s._cracks.push(pts);
        }
      }
      const grow = ease.out(Math.min(1, t * 1.6)), fade = t > 0.7 ? (1 - t) / 0.3 : 1;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";    // dark cracks — additive would hide them
      ctx.globalAlpha = Math.max(0, fade) * 0.92;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const pts of s._cracks) {
        const last = Math.max(1, Math.floor((pts.length - 1) * grow));
        ctx.beginPath();
        ctx.moveTo(c.x + pts[0].x, c.y + pts[0].y);
        for (let k = 1; k <= last && k < pts.length; k++) ctx.lineTo(c.x + pts[k].x, c.y + pts[k].y);
        ctx.strokeStyle = "#120d07"; ctx.lineWidth = Math.max(2.5, 6 * cs); ctx.stroke();       // dark cleft (shows on light maps)
        ctx.strokeStyle = "rgba(205,170,120,.55)"; ctx.lineWidth = Math.max(1.5, 2.5 * cs); ctx.stroke(); // dusty rim (shows on dark maps)
      }
      ctx.restore();
    },

    /* an actual WALL of flames licking upward along the from→to line */
    flamewall(s, t, eff) {
      const a = P(eff.from), b0 = P(eff.to);
      let dir = Math.atan2(b0.y - a.y, b0.x - a.x);
      if (a.x === b0.x && a.y === b0.y) dir = 0;
      const len = F(s.lengthFt ?? 60), cs = view.cellPx() / 70;
      const bx = a.x + Math.cos(dir) * len, by = a.y + Math.sin(dir) * len;
      const H = F(s.heightFt ?? 20);
      const alpha = t < 0.1 ? t / 0.1 : t > 0.85 ? (1 - t) / 0.15 : 1;
      const tongues = clamp(Math.round(len / (10 * cs)), 8, 60);
      const now = performance.now();
      for (let i = 0; i <= tongues; i++) {
        const f = i / tongues, x = a.x + (bx - a.x) * f, y = a.y + (by - a.y) * f;
        const flick = 0.55 + 0.45 * Math.abs(Math.sin(now / 120 + i * 1.7));
        const h = H * flick * alpha, w = 8 * cs;
        const g = ctx.createLinearGradient(x, y, x, y - h);
        g.addColorStop(0, eff.palette.core); g.addColorStop(0.4, eff.palette.mid); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.7 * alpha; ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - w, y);
        ctx.quadraticCurveTo(x - w * 0.3, y - h * 0.6, x + Math.sin(now / 200 + i) * w * 0.5, y - h);
        ctx.quadraticCurveTo(x + w * 0.3, y - h * 0.6, x + w, y);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = alpha; ctx.strokeStyle = eff.palette.core; ctx.lineWidth = 3 * cs; ctx.lineCap = "round";
      ctx.shadowColor = eff.palette.glow; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      if (Math.random() < 0.6) {
        const f = Math.random();
        spawnParticles(1, { x: eff.from.x + (eff.to.x - eff.from.x) * f, y: eff.from.y + (eff.to.y - eff.from.y) * f },
          { speed: [1, 5], life: [400, 900], size: [2, 4], palette: eff.palette, drag: 0.92, rise: -8 });
      }
    },

    /* a built barrier along the line — stone / ice / thorn / blade / force */
    wall(s, t, eff) {
      const a = P(eff.from), b0 = P(eff.to);
      let dir = Math.atan2(b0.y - a.y, b0.x - a.x);
      if (a.x === b0.x && a.y === b0.y) dir = 0;
      const len = F(s.lengthFt ?? 30), cs = view.cellPx() / 70;
      const nx = Math.cos(dir), ny = Math.sin(dir), px = -Math.sin(dir), py = Math.cos(dir);
      const ht = F(s.thickFt ?? 5) * 0.5;              // half thickness
      const wipe = ease.out(Math.min(1, t * 2.4));     // the wall builds in along its length
      const alpha = t > 0.9 ? (1 - t) / 0.1 : 1;
      const mat = MAT[s.material] || MAT.stone;
      const dl = len * wipe, bx = a.x + nx * dl, by = a.y + ny * dl;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";    // solid material, not glow
      ctx.globalAlpha = alpha;
      // footprint slab
      ctx.beginPath();
      ctx.moveTo(a.x + px * ht, a.y + py * ht);
      ctx.lineTo(bx + px * ht, by + py * ht);
      ctx.lineTo(bx - px * ht, by - py * ht);
      ctx.lineTo(a.x - px * ht, a.y - py * ht);
      ctx.closePath();
      ctx.fillStyle = mat.face; ctx.fill();
      // lit edge / shadow edge for a touch of relief
      ctx.lineWidth = Math.max(2, ht * 0.4); ctx.lineCap = "round";
      ctx.strokeStyle = mat.light;
      ctx.beginPath(); ctx.moveTo(a.x + px * ht, a.y + py * ht); ctx.lineTo(bx + px * ht, by + py * ht); ctx.stroke();
      ctx.strokeStyle = mat.dark;
      ctx.beginPath(); ctx.moveTo(a.x - px * ht, a.y - py * ht); ctx.lineTo(bx - px * ht, by - py * ht); ctx.stroke();
      // material motifs
      const blocks = clamp(Math.round(dl / (12 * cs)), 2, 40);
      if (s.material === "stone" || s.material === "thorn") {
        ctx.strokeStyle = mat.seam; ctx.lineWidth = Math.max(1, 1.6 * cs);
        for (let i = 1; i < blocks; i++) {
          const f = i / blocks, x = a.x + nx * dl * f, y = a.y + ny * dl * f;
          ctx.beginPath(); ctx.moveTo(x + px * ht, y + py * ht); ctx.lineTo(x - px * ht, y - py * ht); ctx.stroke();
        }
        if (s.material === "thorn") {                  // barbs poking out along both faces
          ctx.fillStyle = mat.light;
          for (let i = 0; i < blocks; i++) {
            const f = (i + 0.5) / blocks, x = a.x + nx * dl * f, y = a.y + ny * dl * f, sgn = i % 2 ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(x + px * ht * sgn, y + py * ht * sgn);
            ctx.lineTo(x + px * (ht + 7 * cs) * sgn + nx * 3 * cs, y + py * (ht + 7 * cs) * sgn + ny * 3 * cs);
            ctx.lineTo(x + px * ht * sgn + nx * 5 * cs, y + py * ht * sgn + ny * 5 * cs);
            ctx.closePath(); ctx.fill();
          }
        }
      } else {                                          // ice / blade / force: glassy sheen + bright rim
        ctx.strokeStyle = mat.seam; ctx.lineWidth = Math.max(1.5, 2 * cs);
        ctx.beginPath();
        ctx.moveTo(a.x + px * ht, a.y + py * ht); ctx.lineTo(bx + px * ht, by + py * ht);
        ctx.lineTo(bx - px * ht, by - py * ht); ctx.lineTo(a.x - px * ht, a.y - py * ht);
        ctx.closePath(); ctx.stroke();
        if (s.material === "blade") {                   // whirling blade glints riding the barrier
          const now = performance.now();
          ctx.strokeStyle = mat.light; ctx.lineWidth = Math.max(1.5, 2.2 * cs);
          for (let i = 0; i < blocks; i++) {
            const f = (i + 0.5) / blocks, x = a.x + nx * dl * f, y = a.y + ny * dl * f, r = ht * 0.9;
            const aa = now / 120 + i;
            ctx.beginPath(); ctx.arc(x, y, r, aa, aa + 1.6); ctx.stroke();
          }
        } else {                                        // ice/force: a couple of vertical facets
          ctx.strokeStyle = mat.light; ctx.globalAlpha = alpha * 0.5; ctx.lineWidth = Math.max(1, 1.4 * cs);
          for (let i = 1; i < blocks; i++) {
            const f = i / blocks, x = a.x + nx * dl * f, y = a.y + ny * dl * f;
            ctx.beginPath(); ctx.moveTo(x + px * ht * 0.7, y + py * ht * 0.7); ctx.lineTo(x - px * ht * 0.7, y - py * ht * 0.7); ctx.stroke();
          }
        }
      }
      ctx.restore();
      if (s.material === "stone" && Math.random() < 0.4) {      // a little dust as it grinds up
        const f = Math.random();
        spawnParticles(1, { x: eff.from.x + (eff.to.x - eff.from.x) * f * wipe, y: eff.from.y + (eff.to.y - eff.from.y) * f * wipe },
          { speed: [1, 4], life: [400, 800], size: [2, 5], palette: pal("dust"), drag: 0.9, rise: -4 });
      }
    },

    /* expanding water rings, gently squashed like ripples seen on the ground */
    ripple(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to), R = F(s.radiusFt ?? 15), cs = view.cellPx() / 70, rings = s.rings ?? 3;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < rings; i++) {
        const ph = (t * 1.4 + i / rings) % 1, r = R * ph;
        const al = (1 - ph) * (t > 0.85 ? (1 - t) / 0.15 : 1) * 0.6;
        ctx.globalAlpha = Math.max(0, al);
        ctx.strokeStyle = "rgba(150,205,235,.9)"; ctx.lineWidth = Math.max(1.5, 2.5 * cs);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * 0.7, 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    },

    /* faint footprints appearing in sequence from→to (water-walk) */
    footsteps(s, t, eff) {
      const a = P(eff.from), b = P(eff.to), cs = view.cellPx() / 70, pairs = s.pairs ?? 5;
      let dir = Math.atan2(b.y - a.y, b.x - a.x);
      if (a.x === b.x && a.y === b.y) dir = 0;
      const px = -Math.sin(dir), py = Math.cos(dir);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < pairs; i++) {
        const f = (i + 0.5) / pairs, appear = t * 1.3 - f;
        if (appear <= 0) continue;
        const al = Math.min(1, appear * 3) * (1 - Math.max(0, (t - 0.7) / 0.3)) * 0.5, side = i % 2 ? 1 : -1;
        const x = a.x + (b.x - a.x) * f + px * side * 6 * cs, y = a.y + (b.y - a.y) * f + py * side * 6 * cs;
        ctx.globalAlpha = Math.max(0, al); ctx.fillStyle = "rgba(200,230,245,.9)";
        ctx.beginPath(); ctx.ellipse(x, y, 4 * cs, 6 * cs, dir, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },

    /* hail streaks raining down inside the area */
    hail(s, t, eff) {
      const c = P(eff.to), R = F(s.radiusFt ?? 20), cs = view.cellPx() / 70;
      const k = clamp(Math.round(R / (10 * cs)) + 3, 4, 16), fade = t > 0.8 ? (1 - t) / 0.2 : 1;
      ctx.save();
      ctx.strokeStyle = "rgba(220,245,255,.95)"; ctx.lineCap = "round"; ctx.lineWidth = Math.max(1.5, 2 * cs);
      for (let i = 0; i < k; i++) {
        const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * R, x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr, L = rand(8, 16) * cs;
        ctx.globalAlpha = rand(0.4, 0.9) * fade;
        ctx.beginPath(); ctx.moveTo(x, y - L); ctx.lineTo(x + L * 0.25, y); ctx.stroke();
      }
      ctx.restore();
    },

    /* a frost ring + slick sheen glazing the ground */
    frost(s, t, eff) {
      const c = P(eff.to), R = F(s.radiusFt ?? 20), cs = view.cellPx() / 70, fade = t > 0.6 ? (1 - t) / 0.4 : 1;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.max(0, fade) * 0.7;
      ctx.strokeStyle = "rgba(180,225,255,.8)"; ctx.lineWidth = Math.max(2, 3 * cs);
      ctx.setLineDash([10 * cs, 7 * cs]);
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      const g = ctx.createRadialGradient(c.x, c.y, R * 0.2, c.x, c.y, R);
      g.addColorStop(0, "rgba(200,235,255,.2)"); g.addColorStop(1, "rgba(140,200,240,0)");
      ctx.globalAlpha = Math.max(0, fade) * 0.6; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(220,245,255,.5)"; ctx.lineWidth = Math.max(1, 1.5 * cs);
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(c.x + Math.cos(a) * R * 0.3, c.y + Math.sin(a) * R * 0.3); ctx.lineTo(c.x + Math.cos(a) * R * 0.9, c.y + Math.sin(a) * R * 0.9); ctx.stroke(); }
      ctx.restore();
    },

    /* spikes / vines / thorns growing up out of the ground across the area */
    spikes(s, t, eff) {
      const c = P(eff.to), R = F(s.radiusFt ?? 20), cs = view.cellPx() / 70, n = s.count ?? 22, variant = s.variant || "spike";
      if (!s._pts) { s._pts = []; for (let i = 0; i < n; i++) { const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * R; s._pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, h: rand(0.6, 1.2), ph: rand(0, TAU) }); } }
      const grow = ease.out(Math.min(1, t * 1.5)), fade = t > 0.85 ? (1 - t) / 0.15 : 1;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.max(0, fade);
      for (const p of s._pts.slice().sort((u, v) => u.y - v.y)) {  // painter's order: back → front
        const x = c.x + p.x, y = c.y + p.y;
        const H = (variant === "vine" ? 26 : 16) * cs * p.h * grow, W = (variant === "vine" ? 5 : 7) * cs;
        if (variant === "vine") {
          ctx.strokeStyle = "#3f6a2a"; ctx.lineWidth = Math.max(2, W * 0.6); ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.sin(p.ph) * 8 * cs, y - H * 0.6, x + Math.sin(p.ph + 1) * 5 * cs, y - H); ctx.stroke();
          ctx.fillStyle = "#5f9a3d"; ctx.beginPath(); ctx.ellipse(x + Math.sin(p.ph + 1) * 5 * cs, y - H, 4 * cs, 2.5 * cs, p.ph, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = variant === "thorn" ? "#5a3a22" : "#8a8073";
          ctx.strokeStyle = variant === "thorn" ? "#2e1c10" : "#3f3a31"; ctx.lineWidth = Math.max(1, 1.5 * cs);
          ctx.beginPath(); ctx.moveTo(x - W, y); ctx.lineTo(x, y - H); ctx.lineTo(x + W, y); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.beginPath(); ctx.moveTo(x, y - H); ctx.lineTo(x - W * 0.3, y - H * 0.3); ctx.stroke();
        }
      }
      ctx.restore();
    },

    /* a churning swarm of dark specks over a faint haze (insects) */
    swarm(s, t, eff) {
      const c = P(eff.to), R = F(s.radiusFt ?? 20), cs = view.cellPx() / 70;
      const alpha = t < 0.12 ? t / 0.12 : t > 0.8 ? (1 - t) / 0.2 : 1;
      glowCircle(c.x, c.y, R * 0.9, pal("poison"), alpha * 0.25);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(40,55,20,.9)";
      const n = clamp(Math.round(R / cs * 0.5) + 30, 30, 90), now = performance.now();
      for (let i = 0; i < n; i++) {
        const a = i * 2.399 + now / 300, rr = (0.3 + 0.7 * Math.abs(Math.sin(i * 1.3 + now / 500))) * R;
        const x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a * 1.1) * rr, sz = rand(1.2, 2.6) * cs;
        ctx.globalAlpha = alpha * rand(0.5, 0.9);
        ctx.fillRect(x, y, sz, sz);
      }
      ctx.restore();
    },

    /* a rolling ball of fire travelling from→to, spinning as it goes */
    rollball(s, t, eff) {
      const a = P(eff.from), b = P(eff.to), cs = view.cellPx() / 70, tt = ease.inOut(t);
      const x = a.x + (b.x - a.x) * tt, y = a.y + (b.y - a.y) * tt, R = F(s.radiusFt ?? 2.5);
      glowCircle(x, y, R * 1.3, eff.palette, 1);
      glowCircle(x, y, R * 0.7, { core: "#fff", mid: eff.palette.core, edge: eff.palette.mid, glow: eff.palette.glow }, 0.9);
      if (Math.random() < 0.9) spawnParticles(2, pxToGridApprox({ x, y }), { speed: [2, 7], life: [250, 600], size: [2, 5], palette: eff.palette, drag: 0.9, gravity: 8 });
      ctx.save();
      ctx.globalAlpha = 0.6; ctx.strokeStyle = eff.palette.core; ctx.lineWidth = 2 * cs;
      const rot = tt * TAU * 3;
      for (let i = 0; i < 3; i++) { const aa = rot + i / 3 * TAU; ctx.beginPath(); ctx.arc(x, y, R * 0.9, aa, aa + 0.6); ctx.stroke(); }
      ctx.restore();
    },

    /* a conjured weapon hanging at the target, swinging once */
    weapon(s, t, eff) {
      const c = P(eff.to), cs = view.cellPx() / 70, kind = s.kind || "sword";
      const ang = (s.angle ?? -0.6) + Math.sin(t * Math.PI) * 1.4, L = F(s.lengthFt ?? 8);
      const alpha = t < 0.1 ? t / 0.1 : t > 0.85 ? (1 - t) / 0.15 : 1;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(ang);
      ctx.globalAlpha = alpha; ctx.shadowColor = eff.palette.glow; ctx.shadowBlur = 16;
      if (kind === "mace") {
        ctx.strokeStyle = eff.palette.mid; ctx.lineWidth = 5 * cs; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L * 0.7); ctx.stroke();
        glowCircle(0, -L * 0.8, 7 * cs, eff.palette, alpha);
      } else {
        ctx.fillStyle = eff.palette.core;
        ctx.beginPath(); ctx.moveTo(-3 * cs, 0); ctx.lineTo(3 * cs, 0); ctx.lineTo(1 * cs, -L); ctx.lineTo(-1 * cs, -L); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = eff.palette.mid; ctx.lineWidth = 2 * cs;
        ctx.beginPath(); ctx.moveTo(-6 * cs, 0); ctx.lineTo(6 * cs, 0); ctx.stroke();
      }
      ctx.restore();
      if (Math.random() < 0.4) spawnParticles(1, { x: eff.to.x, y: eff.to.y }, { speed: [1, 4], life: [200, 500], size: [2, 4], palette: eff.palette, drag: 0.9 });
    },

    /* radiant rays flaring outward (sunburst / divine word) */
    rays(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to), R = F(s.radiusFt ?? 30) * ease.out(t), n = s.count ?? 12, fade = 1 - t, rot = t * 0.5;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + rot, w = 0.08;
        ctx.globalAlpha = fade * 0.7; ctx.fillStyle = eff.palette.mid;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, R, a - w, a + w); ctx.closePath(); ctx.fill();
      }
      glowCircle(c.x, c.y, R * 0.4, eff.palette, fade);
      ctx.globalAlpha = 1;
    },

    /* a spreading pool of darkness (real dark, painted source-over) */
    gloom(s, t, eff) {
      const c = P(eff.to), R = F(s.radiusFt ?? 15);
      const grow = t < 0.15 ? ease.out(t / 0.15) : 1, fade = t > 0.85 ? (1 - t) / 0.15 : 1, r = R * grow;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      const g = ctx.createRadialGradient(c.x, c.y, r * 0.2, c.x, c.y, r);
      g.addColorStop(0, `rgba(6,4,12,${0.92 * fade})`); g.addColorStop(0.7, `rgba(12,8,24,${0.85 * fade})`); g.addColorStop(1, "rgba(20,12,40,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = fade * 0.5; ctx.strokeStyle = "rgba(90,60,150,.6)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.stroke();
      ctx.restore();
    },

    /* a glossy grease slick with specular flickers */
    slick(s, t, eff) {
      const c = P(eff.to), R = F(s.radiusFt ?? 5), cs = view.cellPx() / 70, fade = t < 0.1 ? t / 0.1 : t > 0.8 ? (1 - t) / 0.2 : 1;
      if (!s._blobs) s._blobs = Array.from({ length: 5 }, () => ({ a: rand(0, TAU), d: rand(0, 0.6), s: rand(0.5, 1) }));
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.max(0, fade) * 0.55; ctx.fillStyle = "rgba(30,28,20,.9)";
      for (const bl of s._blobs) { const x = c.x + Math.cos(bl.a) * R * bl.d, y = c.y + Math.sin(bl.a) * R * bl.d; ctx.beginPath(); ctx.ellipse(x, y, R * bl.s, R * bl.s * 0.7, bl.a, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = Math.max(0, fade) * 0.4; ctx.strokeStyle = "rgba(180,200,180,.8)"; ctx.lineWidth = Math.max(1, 2 * cs);
      for (let i = 0; i < 3; i++) { const a = rand(0, TAU); ctx.beginPath(); ctx.moveTo(c.x + Math.cos(a) * R * 0.2, c.y + Math.sin(a) * R * 0.2); ctx.lineTo(c.x + Math.cos(a) * R * 0.7, c.y + Math.sin(a) * R * 0.7); ctx.stroke(); }
      ctx.restore();
    },

    /* healing motes: little plus-signs rising up out of the target */
    motes(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to), cs = view.cellPx() / 70, R = F(s.radiusFt ?? 5);
      if (!s._m) s._m = Array.from({ length: s.count ?? 8 }, () => ({ x: rand(-1, 1), z: rand(0, 1), sp: rand(0.6, 1.2), ph: rand(0, TAU) }));
      ctx.save();
      ctx.lineCap = "round"; ctx.shadowColor = eff.palette.glow; ctx.shadowBlur = 8;
      for (const m of s._m) {
        const life = (t * m.sp + m.z) % 1, x = c.x + m.x * R, y = c.y + R * 0.4 - life * R * 2.2;
        const al = Math.sin(life * Math.PI), sz = (3 + 2 * Math.sin(m.ph + t * 6)) * cs;
        ctx.globalAlpha = al * 0.9; ctx.strokeStyle = eff.palette.core; ctx.lineWidth = Math.max(1.5, 2 * cs);
        ctx.beginPath(); ctx.moveTo(x - sz, y); ctx.lineTo(x + sz, y); ctx.moveTo(x, y - sz); ctx.lineTo(x, y + sz); ctx.stroke();
      }
      ctx.restore();
    },

    /* drifting rune glyphs — up & gold for blessings, down for banes */
    glyphs(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to), cs = view.cellPx() / 70, R = F(s.radiusFt ?? 5), dir = s.dir === "down" ? 1 : -1;
      if (!s._g) s._g = Array.from({ length: s.count ?? 4 }, () => ({ a: rand(0, TAU), z: rand(0, 1), r: rand(0.4, 1), k: Math.floor(rand(0, 3)) }));
      ctx.save();
      ctx.shadowColor = eff.palette.glow; ctx.shadowBlur = 8;
      for (const g of s._g) {
        const life = (t + g.z) % 1, ang = g.a + t * 1.5;
        const x = c.x + Math.cos(ang) * R * g.r, y = c.y + Math.sin(ang) * R * g.r * 0.5 + dir * (life - 0.5) * R * 1.5;
        const al = Math.sin(life * Math.PI) * 0.9, sz = 6 * cs;
        ctx.globalAlpha = al; ctx.strokeStyle = eff.palette.core; ctx.lineWidth = Math.max(1.5, 1.8 * cs);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang * 0.2); ctx.beginPath();
        if (g.k === 0) { ctx.arc(0, 0, sz * 0.6, 0, TAU); ctx.moveTo(0, -sz); ctx.lineTo(0, sz); }
        else if (g.k === 1) { ctx.moveTo(-sz, -sz); ctx.lineTo(sz, sz); ctx.moveTo(sz, -sz); ctx.lineTo(-sz, sz); }
        else { ctx.moveTo(0, -sz); ctx.lineTo(sz, sz); ctx.lineTo(-sz, sz); ctx.closePath(); }
        ctx.stroke(); ctx.restore();
      }
      ctx.restore();
    },

    /* directional wind streaks flowing along the from→to line */
    wind(s, t, eff) {
      const a = P(eff.from), b0 = P(eff.to);
      let dir = Math.atan2(b0.y - a.y, b0.x - a.x);
      if (a.x === b0.x && a.y === b0.y) dir = 0;
      const len = F(s.lengthFt ?? 60), cs = view.cellPx() / 70;
      const px = -Math.sin(dir), py = Math.cos(dir), nx = Math.cos(dir), ny = Math.sin(dir);
      const alpha = t < 0.1 ? t / 0.1 : t > 0.8 ? (1 - t) / 0.2 : 1, n = 9;
      ctx.save();
      ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = "rgba(220,235,245,.75)"; ctx.lineCap = "round";
      for (let i = 0; i < n; i++) {
        const off = (i / (n - 1) - 0.5) * len * 0.55, ph = (t * 1.6 + i * 0.13) % 1;
        const startL = len * ph, endL = Math.min(len, startL + len * 0.32);
        const p0 = { x: a.x + px * off + nx * startL, y: a.y + py * off + ny * startL };
        const p1 = { x: a.x + px * off + nx * endL, y: a.y + py * off + ny * endL };
        ctx.globalAlpha = alpha * Math.sin(ph * Math.PI) * 0.8; ctx.lineWidth = Math.max(1.5, 2.4 * cs);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo((p0.x + p1.x) / 2 + px * 6 * cs, (p0.y + p1.y) / 2 + py * 6 * cs, p1.x, p1.y); ctx.stroke();
      }
      ctx.restore();
    },

    /* a spiderweb: radial spokes + concentric threads */
    web(s, t, eff) {
      const c = P(eff.to), R = F(s.radiusFt ?? 10), cs = view.cellPx() / 70, spokes = s.spokes ?? 9;
      const grow = ease.out(Math.min(1, t * 3)), fade = t > 0.85 ? (1 - t) / 0.15 : 1, rr = R * grow;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.max(0, fade) * 0.7; ctx.strokeStyle = "rgba(230,235,240,.8)"; ctx.lineWidth = Math.max(1, 1.4 * cs);
      for (let i = 0; i < spokes; i++) { const a = i / spokes * TAU; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr); ctx.stroke(); }
      for (let ring = 1; ring <= 4; ring++) { const r = rr * ring / 4; ctx.beginPath(); for (let i = 0; i <= spokes; i++) { const a = i / spokes * TAU, x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      ctx.restore();
    },

    /* orbiting spirit wisps with little trailing tails */
    spirits(s, t, eff) {
      const c = P(s.at === "from" ? eff.from : eff.to), R = F(s.radiusFt ?? 15), cs = view.cellPx() / 70, n = s.count ?? 6;
      const alpha = t > 0.85 ? (1 - t) / 0.15 : 1;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + t * TAU * (s.turns ?? 2);
        glowCircle(c.x + Math.cos(a) * R, c.y + Math.sin(a) * R * 0.85, 7 * cs, eff.palette, alpha * 0.9);
        const a2 = a - 0.3;
        glowCircle(c.x + Math.cos(a2) * R, c.y + Math.sin(a2) * R * 0.85, 4 * cs, eff.palette, alpha * 0.4);
      }
    },

    /* a homing dart with a shrinking lateral wobble (magic missile) */
    dart(s, t, eff) {
      const a = P(eff.from), b = P(eff.to), cs = view.cellPx() / 70, tt = ease.out(t);
      const dx = b.x - a.x, dy = b.y - a.y, dl = Math.hypot(dx, dy) || 1, px = -dy / dl, py = dx / dl;
      const wob = Math.sin(t * 10 + (s.phase || 0)) * (1 - tt) * F(4);
      const x = a.x + dx * tt + px * wob, y = a.y + dy * tt + py * wob;
      glowCircle(x, y, (s.size ?? 6) * cs, eff.palette, 1);
      if (Math.random() < 0.9) spawnParticles(1, pxToGridApprox({ x, y }), { speed: [1, 3], life: [150, 350], size: [1.5, 3], palette: eff.palette, drag: 0.9 });
    },
  };

  // rough inverse for particle spawning at a px point
  function pxToGridApprox(px) {
    const o = P({ x: 0, y: 0 });
    const c = view.cellPx();
    return { x: (px.x - o.x) / c, y: (px.y - o.y) / c };
  }

  /* ── transient ground-shake (earthquake) ──
     We prefer the board's own shake so the MAP and tokens judder too and
     stay perfectly in step with the fx layer (view.toPx carries the same
     offset). With a bare view (e.g. a test harness) there's nothing to ask,
     so we fall back to juddering just the fx canvas — it always settles. */
  let shakeStart = 0, shakeDur = 0, shakeMag = 0;
  const shakeSeed = Math.random() * 1000;
  function requestShake(ms, magFt) {
    if (typeof view.shake === "function") { view.shake(ms, magFt); return; }
    shakeStart = performance.now(); shakeDur = Math.max(120, ms || 0); shakeMag = magFt || 0;
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  function frame(now) {
    // fx-canvas fallback shake: a decaying random offset that settles to 0
    let sdx = 0, sdy = 0;
    const shaking = now - shakeStart < shakeDur;
    if (shaking) {
      const amp = F(shakeMag) * (1 - (now - shakeStart) / shakeDur);
      sdx = (Math.sin(now / 13 + shakeSeed) + (Math.random() - 0.5)) * amp;
      sdy = (Math.cos(now / 11 + shakeSeed) + (Math.random() - 0.5)) * amp;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, sdx, sdy);
    ctx.globalCompositeOperation = "lighter";

    effects = effects.filter((eff) => {
      let alive = false;
      for (const s of eff.stages) {
        const t = (now - eff.t0 - s.delay) / s.dur;
        if (t < 0) { alive = true; continue; }
        if (t <= 1) { alive = true; STAGE[s.type]?.(s, t, eff); }
      }
      return alive;
    });

    const cellScale = view.cellPx() / 70;
    particles = particles.filter((p) => {
      const age = now - p.born;
      if (age > p.life) return false;
      const dt = 16 / 1000;
      p.grid.x += (p.vx * dt) / 5;                        // ft/s → cells (5 ft per cell)
      p.grid.y += (p.vy * dt) / 5 + ((p.rise || 0) * dt) / 5; // rise is ft/s too
      p.vx *= p.drag; p.vy = p.vy * p.drag + (p.gravity || 0) * dt;
      const q = P(p.grid);
      const lifeT = age / p.life;
      const alpha = p.twinkle ? (0.4 + 0.6 * Math.abs(Math.sin(age / 60))) * (1 - lifeT) : 1 - lifeT;
      glowCircle(q.x, q.y, p.size * cellScale * (1 - lifeT * 0.5), p.palette, alpha);
      return true;
    });

    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (effects.length || particles.length || shaking) requestAnimationFrame(frame);
    else running = false;
  }

  function play(stages, from, to, palette) {
    effects.push({ stages: stages.map((s) => ({ ...s })), from, to: to || from, palette, t0: performance.now() });
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  /* ═══ recipes ═══ */

  const A = (over) => ({ delay: 0, dur: 600, ...over });

  // area size straight from the spell's own data, with a sane fallback
  const sz = (sp, d) => (sp.aoe && sp.aoe.size) || d;

  // hand-tuned signatures for the icons — each meant to read as THAT spell.
  // (Area size labels are added automatically in playSpell, so recipes here
  //  concentrate on the look.)
  const SIGNATURES = {
    /* ── fire ── */
    "fireball": () => [
      A({ type: "projectile", dur: 480, size: 10, arc: 0.35 }),
      A({ type: "burst", delay: 480, dur: 700, radiusFt: 20, particles: 90, embers: true }),
      A({ type: "burst", delay: 560, dur: 500, radiusFt: 10, scale: 0.7 }),
      A({ type: "ring", delay: 480, dur: 600, radiusFt: 20, expand: true }),
      A({ type: "ring", delay: 1080, dur: 3200, radiusFt: 20, linger: true, dashed: true }),
    ],
    "delayed-blast-fireball": (sp) => [
      A({ type: "ring", dur: 1400, radiusFt: sz(sp, 20), linger: true, dashed: true }),
      A({ type: "orbit", dur: 1400, radiusFt: 4, count: 5, turns: 3 }),
      A({ type: "burst", delay: 1200, dur: 800, radiusFt: sz(sp, 20), particles: 100, embers: true }),
      A({ type: "ring", delay: 1200, dur: 700, radiusFt: sz(sp, 20), expand: true }),
    ],
    "fire-bolt": () => [
      A({ type: "projectile", dur: 420, size: 8, arc: 0.28 }),
      A({ type: "burst", delay: 420, dur: 420, radiusFt: 4, particles: 22, embers: true }),
    ],
    "scorching-ray": () => [0, 130, 260].map((d) =>
      A({ type: "projectile", delay: d, dur: 380, size: 7, arc: 0.18 })
    ).concat([A({ type: "burst", delay: 600, dur: 450, radiusFt: 5, particles: 28, embers: true })]),
    "produce-flame": () => [
      A({ type: "projectile", dur: 480, size: 7, arc: 0.4 }),
      A({ type: "burst", delay: 480, dur: 380, radiusFt: 3, particles: 16, embers: true }),
    ],
    "flaming-sphere": () => [
      A({ type: "rollball", dur: 1100, radiusFt: 4 }),
      A({ type: "burst", delay: 900, dur: 500, radiusFt: 5, particles: 24, embers: true }),
    ],
    "wall-of-fire": (sp) => [
      A({ type: "flamewall", dur: 3600, lengthFt: sz(sp, 60), heightFt: 22 }),
    ],
    "burning-hands": (sp) => [A({ type: "cone", dur: 800, lengthFt: sz(sp, 15) })],
    "fire-storm": (sp) => [0, 130, 260, 390].map((d) =>
      A({ type: "column", delay: d, dur: 500, heightFt: 40, widthFt: 8 })
    ).concat([
      A({ type: "burst", delay: 200, dur: 800, radiusFt: sz(sp, 30) / 2, particles: 90, embers: true }),
      A({ type: "ring", delay: 200, dur: 700, radiusFt: sz(sp, 30) / 2, expand: true }),
    ]),
    "flame-strike": (sp) => [
      A({ type: "column", dur: 1000, heightFt: 45, widthFt: 12 }),
      A({ type: "rays", delay: 100, dur: 700, radiusFt: 14, count: 10 }),
      A({ type: "burst", delay: 250, dur: 700, radiusFt: sz(sp, 20), particles: 70, embers: true }),
      A({ type: "ring", delay: 250, dur: 700, radiusFt: sz(sp, 20), expand: true }),
    ],
    "hellish-rebuke": () => [
      A({ type: "burst", dur: 650, radiusFt: 7, particles: 44, embers: true }),
      A({ type: "column", delay: 60, dur: 600, heightFt: 24, widthFt: 10 }),
    ],
    "incendiary-cloud": (sp) => [
      A({ type: "cloud", dur: 4000, radiusFt: sz(sp, 20) }),
      A({ type: "ring", delay: 300, dur: 3400, radiusFt: sz(sp, 20), linger: true, dashed: true }),
      A({ type: "sparkles", dur: 3200 }),
    ],
    "fire-shield": () => [
      A({ type: "ring", dur: 1600, at: "to", radiusFt: 6, linger: true }),
      A({ type: "orbit", dur: 1600, radiusFt: 6, count: 8, turns: 2 }),
    ],
    "heat-metal": () => [
      A({ type: "column", dur: 900, heightFt: 12, widthFt: 5 }),
      A({ type: "burst", dur: 500, radiusFt: 2.5, particles: 12, embers: true }),
    ],
    "meteor-swarm": (sp) => [0, 220, 440, 660].map((d) =>
      A({ type: "projectile", delay: d, dur: 500, size: 14, arc: 1.4 })
    ).concat([
      A({ type: "burst", delay: 900, dur: 900, radiusFt: sz(sp, 40), particles: 120, embers: true }),
      A({ type: "ring", delay: 900, dur: 800, radiusFt: sz(sp, 40), expand: true }),
      A({ type: "ring", delay: 1700, dur: 3600, radiusFt: sz(sp, 40), linger: true, dashed: true }),
    ]),

    /* ── cold / ice ── */
    "ray-of-frost": () => [
      A({ type: "projectile", dur: 440, size: 7, arc: 0.12 }),
      A({ type: "frost", delay: 440, dur: 1400, radiusFt: 5 }),
    ],
    "cone-of-cold": (sp) => [
      A({ type: "cone", dur: 950, lengthFt: sz(sp, 60) }),
      A({ type: "frost", delay: 500, dur: 2400, radiusFt: sz(sp, 60) * 0.4 }),
    ],
    "ice-storm": (sp) => [
      A({ type: "hail", dur: 1600, radiusFt: sz(sp, 20) }),
      A({ type: "burst", delay: 100, dur: 700, radiusFt: sz(sp, 20), particles: 60 }),
      A({ type: "frost", delay: 500, dur: 3000, radiusFt: sz(sp, 20) }),
    ],
    "sleet-storm": (sp) => [
      A({ type: "hail", dur: 2200, radiusFt: sz(sp, 20) }),
      A({ type: "frost", delay: 200, dur: 3200, radiusFt: sz(sp, 20) }),
      A({ type: "slick", dur: 3200, radiusFt: sz(sp, 20) }),
    ],
    "freezing-sphere": (sp) => [
      A({ type: "projectile", dur: 480, size: 10, arc: 0.35 }),
      A({ type: "burst", delay: 480, dur: 700, radiusFt: sz(sp, 60) * 0.4, particles: 70 }),
      A({ type: "frost", delay: 480, dur: 2800, radiusFt: sz(sp, 60) * 0.4 }),
    ],
    "wall-of-ice": (sp) => [
      A({ type: "wall", dur: 3600, lengthFt: 30, material: "ice", thickFt: 6 }),
      A({ type: "frost", delay: 200, dur: 3200, radiusFt: 12 }),
    ],

    /* ── lightning / thunder ── */
    "lightning-bolt": () => [
      A({ type: "bolt", dur: 850, steady: true, jagFt: 5, forks: 4 }), // a persistent forked bolt, not a tube
      A({ type: "bolt", delay: 40, dur: 760 }),                        // a live flicker layered on
      A({ type: "burst", delay: 150, dur: 500, radiusFt: 6, particles: 34 }),
    ],
    "chain-lightning": () => [
      A({ type: "bolt", dur: 500 }),
      A({ type: "bolt", delay: 120, dur: 500 }),
      A({ type: "bolt", delay: 240, dur: 460 }),
      A({ type: "burst", delay: 300, dur: 500, radiusFt: 6, particles: 34 }),
    ],
    "call-lightning": () => [
      A({ type: "bolt", dur: 500 }),
      A({ type: "column", dur: 420, heightFt: 60, widthFt: 5 }),
      A({ type: "burst", delay: 300, dur: 450, radiusFt: 5, particles: 30 }),
    ],
    "shocking-grasp": () => [
      A({ type: "bolt", dur: 380 }),
      A({ type: "burst", delay: 120, dur: 400, radiusFt: 4, particles: 22 }),
    ],
    "storm-of-vengeance": (sp) => [
      A({ type: "cloud", dur: 3800, radiusFt: sz(sp, 60) * 0.35 }),
      A({ type: "bolt", delay: 300, dur: 500 }),
      A({ type: "bolt", delay: 700, dur: 500 }),
      A({ type: "bolt", delay: 1200, dur: 500 }),
      A({ type: "ring", delay: 300, dur: 3200, radiusFt: sz(sp, 60) * 0.35, linger: true, dashed: true }),
    ],
    "witch-bolt": () => [
      A({ type: "bolt", dur: 900 }),
      A({ type: "burst", delay: 200, dur: 500, radiusFt: 4, particles: 22 }),
    ],
    "thunderwave": (sp) => [
      A({ type: "rect", dur: 500, sizeFt: sz(sp, 15) }),
      A({ type: "ring", delay: 60, dur: 550, radiusFt: sz(sp, 15), expand: true }),
      A({ type: "ring", delay: 200, dur: 550, radiusFt: sz(sp, 15) * 1.4, expand: true }),
      A({ type: "burst", dur: 400, radiusFt: 8, particles: 30 }),
    ],
    "shatter": (sp) => [
      A({ type: "ring", dur: 500, radiusFt: sz(sp, 10), expand: true }),
      A({ type: "ring", delay: 140, dur: 500, radiusFt: sz(sp, 10), expand: true }),
      A({ type: "burst", dur: 450, radiusFt: sz(sp, 10), particles: 45 }),
    ],
    "gust-of-wind": (sp) => [A({ type: "wind", dur: 1800, lengthFt: sz(sp, 60) })],
    "wind-wall": (sp) => [A({ type: "wind", dur: 3200, lengthFt: sz(sp, 50) })],

    /* ── force / arcane ── */
    "magic-missile": () => [0, 120, 240].map((d, i) =>
      A({ type: "dart", delay: d, dur: 620, size: 6, phase: i * 2.1 })
    ).concat([A({ type: "burst", delay: 760, dur: 420, radiusFt: 4, particles: 22 })]),
    "eldritch-blast": () => [
      A({ type: "bolt", dur: 420 }),
      A({ type: "burst", delay: 300, dur: 450, radiusFt: 5, particles: 26 }),
    ],
    "disintegrate": () => [
      A({ type: "line", dur: 700, lengthFt: 60, widthFt: 4 }),
      A({ type: "burst", delay: 500, dur: 700, radiusFt: 5, particles: 50 }),
    ],
    "wall-of-force": () => [A({ type: "wall", dur: 3600, lengthFt: 30, material: "force", thickFt: 4 })],
    "arcane-sword": () => [
      A({ type: "weapon", dur: 1200, kind: "sword", lengthFt: 9 }),
      A({ type: "burst", delay: 600, dur: 450, radiusFt: 4, particles: 20 }),
    ],
    "arcane-hand": () => [
      A({ type: "implode", dur: 420, radiusFt: 12 }),
      A({ type: "burst", delay: 380, dur: 600, radiusFt: 8, particles: 40 }),
      A({ type: "ring", delay: 380, dur: 700, radiusFt: 8, expand: true }),
    ],
    "telekinesis": () => [
      A({ type: "orbit", dur: 2200, radiusFt: 8, count: 5, turns: 2 }),
      A({ type: "ring", delay: 100, dur: 2000, radiusFt: 8, linger: true, dashed: true }),
    ],
    "shield": () => [
      A({ type: "implode", dur: 350, at: "from", radiusFt: 8 }),
      A({ type: "ring", delay: 300, dur: 700, at: "from", radiusFt: 5 }),
    ],
    "shield-of-faith": () => [
      A({ type: "ring", dur: 1500, at: "to", radiusFt: 5, linger: true }),
      A({ type: "sparkles", dur: 1400 }),
    ],
    "counterspell": () => [
      A({ type: "implode", dur: 450, radiusFt: 12 }),
      A({ type: "burst", delay: 420, dur: 350, radiusFt: 5, particles: 20 }),
    ],
    "dispel-magic": () => [
      A({ type: "implode", dur: 500, radiusFt: 10 }),
      A({ type: "sparkles", delay: 200, dur: 1000 }),
      A({ type: "ring", delay: 300, dur: 700, radiusFt: 6 }),
    ],

    /* ── radiant / holy ── */
    "guiding-bolt": () => [
      A({ type: "projectile", dur: 550, size: 11, arc: 0.15 }),
      A({ type: "burst", delay: 550, dur: 600, radiusFt: 6, particles: 40 }),
      A({ type: "sparkles", delay: 550, dur: 1400 }),
    ],
    "sacred-flame": () => [
      A({ type: "column", dur: 900, heightFt: 30, widthFt: 8 }),
      A({ type: "sparkles", delay: 250, dur: 900 }),
    ],
    "sunbeam": (sp) => [
      A({ type: "line", dur: 1400, lengthFt: sz(sp, 60), widthFt: 8 }),
      A({ type: "rays", delay: 100, dur: 900, radiusFt: 12, count: 12 }),
    ],
    "sunburst": (sp) => [
      A({ type: "rays", dur: 900, radiusFt: sz(sp, 60) * 0.9, count: 16 }),
      A({ type: "burst", dur: 800, radiusFt: sz(sp, 60), particles: 90 }),
      A({ type: "ring", dur: 800, radiusFt: sz(sp, 60), expand: true }),
    ],
    "moonbeam": () => [
      A({ type: "column", dur: 2600, heightFt: 40, widthFt: 10 }),
      A({ type: "ring", delay: 200, dur: 2400, radiusFt: 5, linger: true }),
      A({ type: "sparkles", dur: 2400 }),
    ],
    "daylight": (sp) => [
      A({ type: "rays", dur: 1400, radiusFt: sz(sp, 60) * 0.8, count: 14 }),
      A({ type: "ring", delay: 200, dur: 2600, radiusFt: sz(sp, 60), linger: true }),
    ],
    "divine-word": () => [
      A({ type: "rays", dur: 700, radiusFt: 24, count: 14 }),
      A({ type: "implode", dur: 500, radiusFt: 10 }),
    ],
    "spirit-guardians": (sp) => [
      A({ type: "spirits", dur: 2800, at: "from", radiusFt: sz(sp, 15), count: 7, turns: 3 }),
      A({ type: "ring", delay: 100, dur: 2800, at: "from", radiusFt: sz(sp, 15), linger: true, dashed: true }),
    ],
    "guardian-of-faith": () => [
      A({ type: "weapon", dur: 1600, kind: "sword", lengthFt: 10, angle: 0 }),
      A({ type: "ring", delay: 100, dur: 2200, radiusFt: 5, linger: true }),
    ],
    "flame-blade": () => [A({ type: "weapon", dur: 1400, kind: "sword", lengthFt: 9 })],
    "spiritual-weapon": () => [A({ type: "weapon", dur: 1200, kind: "mace", lengthFt: 8 })],

    /* ── necrotic ── */
    "chill-touch": () => [
      A({ type: "projectile", dur: 460, size: 7, arc: 0.2 }),
      A({ type: "implode", delay: 460, dur: 600, radiusFt: 5 }),
    ],
    "inflict-wounds": () => [A({ type: "burst", dur: 650, radiusFt: 6, particles: 44 })],
    "vampiric-touch": () => [
      A({ type: "line", dur: 700, lengthFt: 15, widthFt: 4 }),
      A({ type: "burst", delay: 200, dur: 600, radiusFt: 4, particles: 28 }),
    ],
    "finger-of-death": () => [
      A({ type: "line", dur: 700, lengthFt: 40, widthFt: 5 }),
      A({ type: "burst", delay: 400, dur: 700, radiusFt: 6, particles: 50 }),
    ],
    "circle-of-death": (sp) => [
      A({ type: "burst", dur: 900, radiusFt: sz(sp, 60), particles: 120 }),
      A({ type: "ring", dur: 800, radiusFt: sz(sp, 60), expand: true }),
      A({ type: "ring", delay: 700, dur: 3200, radiusFt: sz(sp, 60), linger: true, dashed: true }),
    ],
    "blight": () => [
      A({ type: "implode", dur: 500, radiusFt: 8 }),
      A({ type: "burst", delay: 400, dur: 600, radiusFt: 5, particles: 30 }),
    ],
    "harm": () => [A({ type: "burst", dur: 700, radiusFt: 6, particles: 50 })],
    "ray-of-enfeeblement": () => [
      A({ type: "line", dur: 650, lengthFt: 30, widthFt: 4 }),
      A({ type: "burst", delay: 300, dur: 500, radiusFt: 4, particles: 18 }),
    ],
    "animate-dead": () => [
      A({ type: "gloom", dur: 1400, radiusFt: 6 }),
      A({ type: "sparkles", delay: 200, dur: 1400 }),
    ],

    /* ── clouds, swarms & ground hazards ── */
    "fog-cloud": (sp) => [A({ type: "cloud", dur: 4200, radiusFt: sz(sp, 20) })],
    "darkness": (sp) => [A({ type: "gloom", dur: 4200, radiusFt: sz(sp, 15) })],
    "cloudkill": (sp) => [
      A({ type: "cloud", dur: 4200, radiusFt: sz(sp, 20) }),
      A({ type: "swarm", dur: 3800, radiusFt: sz(sp, 20) * 0.85 }),
      A({ type: "ring", delay: 300, dur: 3600, radiusFt: sz(sp, 20), linger: true, dashed: true }),
    ],
    "stinking-cloud": (sp) => [
      A({ type: "cloud", dur: 3600, radiusFt: sz(sp, 20) }),
      A({ type: "ring", delay: 200, dur: 3200, radiusFt: sz(sp, 20), linger: true, dashed: true }),
    ],
    "insect-plague": (sp) => [
      A({ type: "swarm", dur: 3800, radiusFt: sz(sp, 20) }),
      A({ type: "ring", delay: 200, dur: 3400, radiusFt: sz(sp, 20), linger: true, dashed: true }),
    ],
    "web": (sp) => [A({ type: "web", dur: 3400, radiusFt: sz(sp, 20) / 2, spokes: 10 })],
    "black-tentacles": (sp) => [
      A({ type: "spikes", dur: 3200, radiusFt: sz(sp, 20) / 2, variant: "vine", count: 26 }),
      A({ type: "ring", delay: 200, dur: 3000, radiusFt: sz(sp, 20) / 2, linger: true, dashed: true }),
    ],
    "grease": (sp) => [A({ type: "slick", dur: 3200, radiusFt: sz(sp, 10) / 2 })],
    "entangle": (sp) => [
      A({ type: "spikes", dur: 3000, radiusFt: sz(sp, 20) / 2, variant: "vine", count: 24 }),
      A({ type: "ring", delay: 200, dur: 2800, radiusFt: sz(sp, 20) / 2, linger: true, dashed: true }),
    ],
    "spike-growth": (sp) => [
      A({ type: "spikes", dur: 3200, radiusFt: sz(sp, 20), variant: "spike", count: 30 }),
      A({ type: "ring", delay: 200, dur: 3000, radiusFt: sz(sp, 20), linger: true, dashed: true }),
    ],
    "plant-growth": (sp) => [
      A({ type: "spikes", dur: 3200, radiusFt: sz(sp, 20), variant: "vine", count: 34 }),
      A({ type: "ring", delay: 200, dur: 3000, radiusFt: sz(sp, 20), linger: true, dashed: true }),
    ],
    "sleep": (sp) => [
      A({ type: "cloud", dur: 2200, radiusFt: sz(sp, 20) }),
      A({ type: "ring", delay: 200, dur: 2600, radiusFt: sz(sp, 20), linger: true, dashed: true }),
      A({ type: "sparkles", dur: 2400 }),
    ],

    /* ── walls & barriers ── */
    "wall-of-stone": (sp) => [
      A({ type: "wall", dur: 3600, lengthFt: 30, material: "stone", thickFt: 6 }),
      A({ type: "quake", ms: 500, magFt: 0.5, radiusFt: 15 }),
    ],
    "wall-of-thorns": (sp) => [A({ type: "wall", dur: 3600, lengthFt: sz(sp, 60), material: "thorn", thickFt: 6 })],
    "blade-barrier": (sp) => [A({ type: "wall", dur: 3600, lengthFt: sz(sp, 100), material: "blade", thickFt: 5 })],
    "prismatic-wall": (sp) => ["fire", "cold", "lightning", "acid", "radiant"].map((k, i) =>
      A({ type: "wall", delay: i * 90, dur: 3200 - i * 90, lengthFt: sz(sp, 90), material: "force", thickFt: 5, _pal: k })
    ),
    "forcecage": (sp) => [
      A({ type: "rect", dur: 3400, sizeFt: sz(sp, 20) }),
      A({ type: "ring", delay: 100, dur: 3200, radiusFt: sz(sp, 20) / 2, linger: true, dashed: true }),
    ],

    /* ── earth ── */
    "earthquake": (sp) => [
      A({ type: "quake", dur: 1600, ms: 1400, magFt: 1.8, radiusFt: sz(sp, 100) * 0.4 }),
      A({ type: "fissure", dur: 2600, radiusFt: sz(sp, 100) * 0.45, count: 12 }),
      A({ type: "ring", delay: 200, dur: 3000, radiusFt: sz(sp, 100), linger: true, dashed: true }),
    ],
    "move-earth": (sp) => [
      A({ type: "fissure", dur: 2200, radiusFt: sz(sp, 40) * 0.5, count: 7 }),
      A({ type: "quake", dur: 900, ms: 700, magFt: 0.8, radiusFt: sz(sp, 40) * 0.5 }),
    ],
    "stone-shape": () => [
      A({ type: "implode", dur: 600, radiusFt: 6 }),
      A({ type: "quake", ms: 400, magFt: 0.4, radiusFt: 8 }),
    ],
    "flesh-to-stone": () => [
      A({ type: "implode", dur: 800, radiusFt: 7 }),
      A({ type: "burst", delay: 400, dur: 600, radiusFt: 4, particles: 22 }),
    ],

    /* ── water & wind ── */
    "control-water": (sp) => [
      A({ type: "ripple", dur: 3200, radiusFt: sz(sp, 100) * 0.25, rings: 4 }),
      A({ type: "ring", delay: 200, dur: 3000, radiusFt: sz(sp, 100) * 0.25, linger: true, dashed: true }),
    ],
    "control-weather": () => [
      A({ type: "cloud", dur: 3600, radiusFt: 30 }),
      A({ type: "bolt", delay: 600, dur: 500 }),
      A({ type: "wind", dur: 3200, lengthFt: 40 }),
    ],
    "water-walk": () => [
      A({ type: "ripple", dur: 2400, radiusFt: 8, rings: 3 }),
      A({ type: "footsteps", dur: 2400, pairs: 6 }),
    ],
    "create-or-destroy-water": (sp) => [
      A({ type: "ripple", dur: 2000, radiusFt: sz(sp, 30) * 0.3, rings: 3 }),
      A({ type: "sparkles", dur: 1600 }),
    ],

    /* ── enchantment / illusion / control ── */
    "prismatic-spray": (sp) => ["fire", "cold", "lightning", "acid", "poison", "psychic", "radiant"].map((k, i) =>
      A({ type: "cone", delay: i * 70, dur: 700, lengthFt: sz(sp, 60), _pal: k })
    ),
    "color-spray": (sp) => ["radiant", "cold", "psychic"].map((k, i) =>
      A({ type: "cone", delay: i * 80, dur: 650, lengthFt: sz(sp, 15), _pal: k })
    ),
    "faerie-fire": (sp) => [
      A({ type: "ring", dur: 2800, radiusFt: sz(sp, 20) / 2, linger: true, dashed: true }),
      A({ type: "sparkles", dur: 2600 }),
    ],
    "fear": (sp) => [A({ type: "cone", dur: 900, lengthFt: sz(sp, 30) })],
    "confusion": (sp) => [
      A({ type: "glyphs", dur: 2600, radiusFt: sz(sp, 10), count: 6 }),
      A({ type: "ring", delay: 200, dur: 2400, radiusFt: sz(sp, 10), linger: true, dashed: true }),
    ],
    "hypnotic-pattern": () => [
      A({ type: "glyphs", dur: 2600, radiusFt: 8, count: 6, _pal: "psychic" }),
      A({ type: "cloud", dur: 2400, radiusFt: 8, _pal: "psychic" }),
    ],
    "hold-person": () => [
      A({ type: "implode", dur: 500, radiusFt: 7 }),
      A({ type: "ring", delay: 300, dur: 1400, radiusFt: 5, linger: true }),
    ],
    "hold-monster": () => [
      A({ type: "implode", dur: 500, radiusFt: 8 }),
      A({ type: "ring", delay: 300, dur: 1400, radiusFt: 6, linger: true }),
    ],
    "command": () => [A({ type: "glyphs", dur: 1200, radiusFt: 4, count: 3, dir: "down" })],
    "banishment": () => [
      A({ type: "implode", dur: 500, radiusFt: 8 }),
      A({ type: "gloom", delay: 300, dur: 700, radiusFt: 6 }),
    ],
    "misty-step": () => [
      A({ type: "implode", dur: 380, at: "from", radiusFt: 6 }),
      A({ type: "cloud", delay: 100, dur: 900, at: "from", radiusFt: 4 }),
      A({ type: "burst", delay: 420, dur: 450, radiusFt: 4, particles: 26 }),
    ],
    "dimension-door": () => [
      A({ type: "implode", dur: 400, at: "from", radiusFt: 6 }),
      A({ type: "burst", delay: 360, dur: 450, radiusFt: 5, particles: 26 }),
    ],
    "teleport": () => [
      A({ type: "implode", dur: 400, radiusFt: 8 }),
      A({ type: "burst", delay: 360, dur: 500, radiusFt: 6, particles: 34 }),
    ],
    "polymorph": () => [
      A({ type: "implode", dur: 500, radiusFt: 7 }),
      A({ type: "sparkles", delay: 200, dur: 1200 }),
      A({ type: "ring", delay: 300, dur: 800, radiusFt: 5 }),
    ],
    "invisibility": () => [
      A({ type: "implode", dur: 500, at: "to", radiusFt: 6 }),
      A({ type: "sparkles", dur: 900 }),
    ],
    "greater-invisibility": () => [
      A({ type: "implode", dur: 500, at: "to", radiusFt: 6 }),
      A({ type: "sparkles", dur: 1100 }),
    ],
    "blur": () => [A({ type: "cloud", dur: 1400, radiusFt: 4 }), A({ type: "sparkles", dur: 1200 })],
    "mirror-image": () => [
      A({ type: "ring", dur: 900, at: "to", radiusFt: 5 }),
      A({ type: "ring", delay: 120, dur: 900, at: "to", radiusFt: 6 }),
      A({ type: "ring", delay: 240, dur: 900, at: "to", radiusFt: 7 }),
    ],

    /* ── buffs / blessings / banes ── */
    "bless": () => [A({ type: "glyphs", dur: 1800, radiusFt: 5, count: 4, dir: "up" }), A({ type: "sparkles", dur: 1600 })],
    "bane": () => [A({ type: "glyphs", dur: 1800, radiusFt: 5, count: 4, dir: "down", _pal: "necrotic" })],
    "guidance": () => [A({ type: "glyphs", dur: 1100, radiusFt: 3.5, count: 2, dir: "up" })],
    "resistance": () => [A({ type: "ring", dur: 1100, at: "to", radiusFt: 4 }), A({ type: "sparkles", dur: 1000 })],
    "divine-favor": () => [A({ type: "glyphs", dur: 1400, radiusFt: 4, count: 3, dir: "up" })],
    "heroism": () => [A({ type: "motes", dur: 1600, radiusFt: 4, count: 6 }), A({ type: "ring", dur: 900, radiusFt: 4 })],
    "haste": () => [A({ type: "orbit", dur: 1400, radiusFt: 5, count: 6, turns: 4 }), A({ type: "sparkles", dur: 1200 })],
    "slow": () => [A({ type: "orbit", dur: 1800, radiusFt: 5, count: 4, turns: 1 }), A({ type: "ring", delay: 200, dur: 1600, radiusFt: 5, linger: true })],
    "stoneskin": () => [A({ type: "ring", dur: 1600, at: "to", radiusFt: 5, linger: true, _pal: "stone" }), A({ type: "sparkles", dur: 1200 })],
    "barkskin": () => [A({ type: "ring", dur: 1600, at: "to", radiusFt: 5, linger: true, _pal: "plant" })],

    /* ── healing ── */
    "cure-wounds": () => [A({ type: "motes", dur: 1600, radiusFt: 5, count: 8 }), A({ type: "burst", dur: 600, radiusFt: 4, particles: 20 })],
    "healing-word": () => [A({ type: "motes", dur: 1400, radiusFt: 5, count: 6 }), A({ type: "ring", dur: 900, radiusFt: 4 })],
    "mass-cure-wounds": (sp) => [
      A({ type: "motes", dur: 2000, radiusFt: sz(sp, 30) * 0.5, count: 16 }),
      A({ type: "ring", delay: 100, dur: 1800, radiusFt: sz(sp, 30) / 2, expand: true }),
    ],
    "mass-healing-word": () => [A({ type: "motes", dur: 1800, radiusFt: 12, count: 14 })],
    "heal": () => [A({ type: "motes", dur: 1800, radiusFt: 6, count: 12 }), A({ type: "burst", dur: 700, radiusFt: 5, particles: 30 })],
    "mass-heal": () => [A({ type: "motes", dur: 2200, radiusFt: 16, count: 20 })],
    "prayer-of-healing": () => [A({ type: "motes", dur: 2000, radiusFt: 10, count: 14 }), A({ type: "glyphs", dur: 1800, radiusFt: 8, count: 4, dir: "up" })],
    "aid": () => [A({ type: "motes", dur: 1600, radiusFt: 8, count: 10 }), A({ type: "ring", dur: 900, radiusFt: 6 })],
    "goodberry": () => [A({ type: "motes", dur: 1200, radiusFt: 3, count: 5 })],
    "regenerate": () => [A({ type: "motes", dur: 2000, radiusFt: 6, count: 12 }), A({ type: "ring", dur: 1000, radiusFt: 5 })],
    "lesser-restoration": () => [A({ type: "motes", dur: 1400, radiusFt: 4, count: 6 }), A({ type: "sparkles", dur: 1200 })],
    "greater-restoration": () => [A({ type: "motes", dur: 1800, radiusFt: 5, count: 8 }), A({ type: "sparkles", dur: 1400 })],
    "spare-the-dying": () => [A({ type: "motes", dur: 1100, radiusFt: 3, count: 4 })],
    "revivify": () => [A({ type: "column", dur: 1200, heightFt: 26, widthFt: 8, _pal: "holy" }), A({ type: "motes", dur: 1600, radiusFt: 5, count: 10 })],
    "raise-dead": () => [A({ type: "column", dur: 1400, heightFt: 30, widthFt: 9, _pal: "holy" }), A({ type: "motes", dur: 1800, radiusFt: 5, count: 10 })],
    "resurrection": () => [A({ type: "column", dur: 1600, heightFt: 34, widthFt: 10, _pal: "holy" }), A({ type: "rays", delay: 200, dur: 900, radiusFt: 14, count: 12 })],
  };

  function defaultRecipe(sp) {
    const stages = [];
    const aoe = sp.aoe;
    const targeted = sp.range && !/self/i.test(sp.range);
    // delivery
    if (sp.attack === "ranged") {
      stages.push(A({ type: "projectile", dur: 480, size: 8, arc: 0.3 }));
      stages.push(A({ type: "burst", delay: 480, dur: 500, radiusFt: 4, particles: 26 }));
    } else if (sp.attack === "melee") {
      stages.push(A({ type: "slash", dur: 420 }));
      stages.push(A({ type: "burst", delay: 250, dur: 400, radiusFt: 3, particles: 16 }));
    }
    // area
    if (aoe) {
      const size = aoe.size || 15;
      if (aoe.type === "sphere" || aoe.type === "cylinder") {
        if (!sp.attack && targeted) stages.push(A({ type: "projectile", dur: 420, size: 8, arc: 0.3 }));
        const d0 = stages.length ? 420 : 0;
        stages.push(A({ type: "burst", delay: d0, dur: 650, radiusFt: size, particles: Math.min(90, size * 3) }));
        stages.push(A({ type: "ring", delay: d0, dur: 600, radiusFt: size, expand: true }));
        stages.push(A({ type: "ring", delay: d0 + 600, dur: 3000, radiusFt: size, linger: true, dashed: true }));
      } else if (aoe.type === "cone") {
        stages.push(A({ type: "cone", dur: 850, lengthFt: size }));
      } else if (aoe.type === "line") {
        stages.push(A({ type: "line", dur: 800, lengthFt: size, widthFt: 5 }));
        stages.push(A({ type: "burst", delay: 250, dur: 450, radiusFt: 5, particles: 24 }));
      } else if (aoe.type === "cube") {
        stages.push(A({ type: "rect", dur: 2200, sizeFt: size }));
        stages.push(A({ type: "burst", dur: 500, radiusFt: size / 2, particles: 30 }));
      }
    }
    // heals
    if (sp.heal) {
      stages.push(A({ type: "motes", dur: 1600, radiusFt: 5, count: 8 }));
      stages.push(A({ type: "ring", dur: 900, radiusFt: 4 }));
    }
    // nothing yet? school-flavored aura on the target
    if (!stages.length) {
      if (sp.damage) {
        if (targeted) stages.push(A({ type: "projectile", dur: 450, size: 7, arc: 0.25 }));
        stages.push(A({ type: "burst", delay: targeted ? 450 : 0, dur: 500, radiusFt: 4, particles: 24 }));
      } else {
        stages.push(A({ type: "implode", dur: 500, radiusFt: 6 }));
        stages.push(A({ type: "sparkles", delay: 200, dur: 1300 }));
        stages.push(A({ type: "ring", delay: 400, dur: 800, radiusFt: 4 }));
      }
    }
    return stages;
  }

  function paletteFor(sp) {
    if (sp.heal && !sp.damage) return pal("heal");
    return pal(sp.damage?.type || sp.school);
  }

  // the human-readable size read-out for an area of effect
  function aoeLabelText(aoe) {
    if (!aoe || aoe.size == null) return null;
    const s = aoe.size;
    if (aoe.type === "cone") return `${s} ft cone`;
    if (aoe.type === "line") return `${s} ft line`;
    if (aoe.type === "cube") return `${s} ft cube`;
    return `${s} ft radius`;                 // sphere / cylinder — 5e lists the radius
  }

  return {
    /* payload: {spell, from:{x,y}|null, to:{x,y}} — spell = SRD index
       or a custom-spell object {name, school, dmg, dmgType, aoe…} */
    playSpell(payload) {
      const sp = typeof payload.spell === "string"
        ? SPELLS[payload.spell]
        : payload.spell;
      if (!sp || !payload.to) return;
      const from = payload.from || payload.to;
      const spec = { ...sp, damage: sp.damage || (sp.dmg ? { type: sp.dmgType || null } : null) };
      const make = SIGNATURES[sp.index];
      const stages = make ? make(spec) : defaultRecipe(spec);
      // every area spell carries a subtle gold size read-out that fades
      // with its outline — unless a signature already drew its own label
      const lblText = aoeLabelText(spec.aoe);
      if (lblText && !stages.some((s) => s.type === "label"))
        stages.push(A({ type: "label", shape: spec.aoe.type, sizeFt: spec.aoe.size, text: lblText, linger: true, delay: 300, dur: 2600 }));
      const base = paletteFor(spec);
      // prismatic-style stages may carry their own palette
      const byPal = new Map();
      for (const s of stages) {
        const key = s._pal || "_";
        if (!byPal.has(key)) byPal.set(key, []);
        byPal.get(key).push(s);
      }
      for (const [key, group] of byPal)
        play(group, from, payload.to, key === "_" ? base : pal(key));
    },
    /* weapon swings & arrows from the board */
    playAttack({ from, to, ranged, dmgType }) {
      const p = pal(dmgType || (ranged ? "piercing" : "slashing"));
      const stages = ranged
        ? [A({ type: "projectile", dur: 380, size: 5, arc: 0.18 }), A({ type: "burst", delay: 380, dur: 320, radiusFt: 2.5, particles: 12 })]
        : [A({ type: "slash", dur: 400 })];
      play(stages, from || to, to, p);
    },
    clear() { effects = []; particles = []; },
  };
}
