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
};
const pal = (key) => PALETTES[key] || PALETTES.evocation;

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
        spawnParticles(s.particles ?? 50, s.at === "from" ? eff.from : eff.to, {
          speed: [s.radiusFt * 1.2, s.radiusFt * 3], life: [350, 900],
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
      if (t > 0.85) return;
      const a = P(eff.from), b = P(eff.to);
      if (!s._paths || Math.random() < 0.35) s._paths = jaggedPath(a, b, F(4), 3);
      ctx.globalAlpha = 0.5 + Math.random() * 0.5;
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
          palette: eff.palette, drag: 0.96, rise: -F(6) / 1000, twinkle: true,
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
  };

  // rough inverse for particle spawning at a px point
  function pxToGridApprox(px) {
    const o = P({ x: 0, y: 0 });
    const c = view.cellPx();
    return { x: (px.x - o.x) / c, y: (px.y - o.y) / c };
  }

  function frame(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      p.grid.x += (p.vx * dt) / 5;   // ft/s → cells/s (5 ft per cell)
      p.grid.y += (p.vy * dt) / 5 + p.rise * 16;
      p.vx *= p.drag; p.vy = p.vy * p.drag + (p.gravity || 0) * dt;
      const q = P(p.grid);
      const lifeT = age / p.life;
      const alpha = p.twinkle ? (0.4 + 0.6 * Math.abs(Math.sin(age / 60))) * (1 - lifeT) : 1 - lifeT;
      glowCircle(q.x, q.y, p.size * cellScale * (1 - lifeT * 0.5), p.palette, alpha);
      return true;
    });

    ctx.globalCompositeOperation = "source-over";
    if (effects.length || particles.length) requestAnimationFrame(frame);
    else running = false;
  }

  function play(stages, from, to, palette) {
    effects.push({ stages: stages.map((s) => ({ ...s })), from, to: to || from, palette, t0: performance.now() });
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  /* ═══ recipes ═══ */

  const A = (over) => ({ delay: 0, dur: 600, ...over });

  // hand-tuned signatures for the icons
  const SIGNATURES = {
    "fireball": (sp) => [
      A({ type: "projectile", dur: 480, size: 10, arc: 0.35 }),
      A({ type: "burst", delay: 480, dur: 700, radiusFt: 20, particles: 90, embers: true }),
      A({ type: "burst", delay: 560, dur: 500, radiusFt: 10, scale: 0.7 }),
      A({ type: "ring", delay: 480, dur: 600, radiusFt: 20, expand: true }),
      A({ type: "ring", delay: 1080, dur: 3200, radiusFt: 20, linger: true, dashed: true }),
    ],
    "magic-missile": () => [0, 160, 320].map((d) =>
      A({ type: "projectile", delay: d, dur: 420, size: 6, arc: 0.5 })
    ).concat([A({ type: "burst", delay: 740, dur: 400, radiusFt: 4, particles: 24 })]),
    "lightning-bolt": () => [
      A({ type: "bolt", dur: 650 }),
      A({ type: "line", delay: 80, dur: 900, lengthFt: 100, widthFt: 5, }),
      A({ type: "burst", delay: 200, dur: 450, radiusFt: 5, particles: 30 }),
    ],
    "eldritch-blast": () => [
      A({ type: "bolt", dur: 420 }),
      A({ type: "burst", delay: 300, dur: 450, radiusFt: 5, particles: 26 }),
    ],
    "guiding-bolt": () => [
      A({ type: "projectile", dur: 550, size: 11, arc: 0.15 }),
      A({ type: "burst", delay: 550, dur: 600, radiusFt: 6, particles: 40 }),
      A({ type: "sparkles", delay: 550, dur: 1400 }),
    ],
    "sacred-flame": () => [
      A({ type: "column", dur: 900, heightFt: 30, widthFt: 8 }),
      A({ type: "sparkles", delay: 250, dur: 900 }),
    ],
    "burning-hands": () => [
      A({ type: "cone", dur: 800, lengthFt: 15 }),
    ],
    "cone-of-cold": () => [
      A({ type: "cone", dur: 950, lengthFt: 60 }),
      A({ type: "ring", delay: 700, dur: 2600, radiusFt: 8, linger: true, dashed: true }),
    ],
    "thunderwave": () => [
      A({ type: "rect", dur: 500, sizeFt: 15 }),
      A({ type: "ring", delay: 60, dur: 550, radiusFt: 15, expand: true }),
      A({ type: "ring", delay: 200, dur: 550, radiusFt: 20, expand: true }),
      A({ type: "burst", dur: 400, at: "to", radiusFt: 8, particles: 30 }),
    ],
    "shatter": () => [
      A({ type: "ring", dur: 500, radiusFt: 10, expand: true }),
      A({ type: "ring", delay: 140, dur: 500, radiusFt: 10, expand: true }),
      A({ type: "burst", dur: 450, radiusFt: 10, particles: 45 }),
    ],
    "call-lightning": (sp, eff) => [
      A({ type: "bolt", dur: 500, _vert: true }),
      A({ type: "column", dur: 420, heightFt: 60, widthFt: 5 }),
      A({ type: "burst", delay: 300, dur: 450, radiusFt: 5, particles: 30 }),
    ],
    "moonbeam": () => [
      A({ type: "column", dur: 2600, heightFt: 40, widthFt: 10 }),
      A({ type: "ring", delay: 200, dur: 2400, radiusFt: 5, linger: true }),
      A({ type: "sparkles", dur: 2400 }),
    ],
    "spirit-guardians": () => [
      A({ type: "orbit", dur: 2800, at: "from", radiusFt: 15, count: 7, turns: 3 }),
      A({ type: "ring", delay: 100, dur: 2800, at: "from", radiusFt: 15, linger: true, dashed: true }),
    ],
    "bless": () => [
      A({ type: "orbit", dur: 1600, radiusFt: 4, count: 3, turns: 2 }),
      A({ type: "sparkles", dur: 1600 }),
    ],
    "shield": () => [
      A({ type: "implode", dur: 350, at: "from", radiusFt: 8 }),
      A({ type: "ring", delay: 300, dur: 700, at: "from", radiusFt: 5 }),
    ],
    "counterspell": () => [
      A({ type: "implode", dur: 450, radiusFt: 12 }),
      A({ type: "burst", delay: 420, dur: 350, radiusFt: 5, particles: 20 }),
    ],
    "misty-step": () => [
      A({ type: "implode", dur: 380, at: "from", radiusFt: 6 }),
      A({ type: "cloud", delay: 100, dur: 900, at: "from", radiusFt: 4 }),
      A({ type: "burst", delay: 420, dur: 450, radiusFt: 4, particles: 26 }),
    ],
    "fog-cloud": () => [A({ type: "cloud", dur: 4200, radiusFt: 20 })],
    "darkness": () => [A({ type: "cloud", dur: 4200, radiusFt: 15 })],
    "cloudkill": () => [
      A({ type: "cloud", dur: 4200, radiusFt: 20 }),
      A({ type: "ring", delay: 300, dur: 3600, radiusFt: 20, linger: true, dashed: true }),
    ],
    "web": () => [
      A({ type: "rect", dur: 3200, sizeFt: 20 }),
      A({ type: "cloud", dur: 2600, radiusFt: 9 }),
    ],
    "grease": () => [A({ type: "ring", dur: 3000, radiusFt: 5, linger: true }), A({ type: "cloud", dur: 1400, radiusFt: 5 })],
    "entangle": () => [
      A({ type: "rect", dur: 3000, sizeFt: 20 }),
      A({ type: "sparkles", dur: 2200 }),
    ],
    "ice-storm": () => [0, 120, 240, 360, 480].map((d) =>
      A({ type: "column", delay: d, dur: 380, heightFt: 40, widthFt: 6 })
    ).concat([
      A({ type: "ring", delay: 500, dur: 3000, radiusFt: 20, linger: true, dashed: true }),
      A({ type: "burst", delay: 400, dur: 700, radiusFt: 20, particles: 60 }),
    ]),
    "meteor-swarm": () => [0, 220, 440, 660].map((d) =>
      A({ type: "projectile", delay: d, dur: 500, size: 14, arc: 1.4 })
    ).concat([
      A({ type: "burst", delay: 900, dur: 900, radiusFt: 40, particles: 120, embers: true }),
      A({ type: "ring", delay: 900, dur: 800, radiusFt: 40, expand: true }),
      A({ type: "ring", delay: 1700, dur: 3600, radiusFt: 40, linger: true, dashed: true }),
    ]),
    "disintegrate": () => [
      A({ type: "line", dur: 700, lengthFt: 60, widthFt: 4 }),
      A({ type: "burst", delay: 500, dur: 700, radiusFt: 5, particles: 50 }),
    ],
    "prismatic-spray": () => ["fire", "cold", "lightning", "acid", "poison", "psychic", "radiant"].map((k, i) =>
      A({ type: "cone", delay: i * 70, dur: 700, lengthFt: 60, _pal: k })
    ),
    "wall-of-fire": () => [
      A({ type: "line", dur: 3600, lengthFt: 60, widthFt: 5 }),
      A({ type: "sparkles", dur: 3000 }),
    ],
    "sleep": () => [
      A({ type: "cloud", dur: 2200, radiusFt: 20 }),
      A({ type: "ring", delay: 200, dur: 2600, radiusFt: 20, linger: true, dashed: true }),
      A({ type: "sparkles", dur: 2400 }),
    ],
    "healing-word": () => [A({ type: "sparkles", dur: 1500 }), A({ type: "ring", dur: 900, radiusFt: 4 })],
    "cure-wounds": () => [A({ type: "sparkles", dur: 1800 }), A({ type: "burst", dur: 600, radiusFt: 4, particles: 24 })],
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
      stages.push(A({ type: "sparkles", dur: 1600 }));
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
