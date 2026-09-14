// ─────────────────────────────────────────────────────────────
//  fx-webgl.js — the cinematic GPU compositor for the FX engine.
//
//  effects.js paints its data-driven, pseudo-3D structural spell art (rings,
//  cones, bolts, walls, columns, projectiles, labels …) straight into the 2-D
//  fx canvas — ONE code path that covers all 319 spells and IS the canvas-only
//  fallback. This module stacks a transparent GL canvas OVER that fx canvas,
//  blended with CSS 'plus-lighter' (true additive), and reads the fx canvas as
//  a live texture to build a real-time VFX scene that only ever ADDS light —
//  so the crisp 2-D art beneath is never dimmed or blown out (an additive-drawn
//  canvas can't be faithfully RE-presented through one GPU alpha mode without
//  either dimming glows or blowing out solids, so we don't re-present it — we
//  augment it). With PixiJS v8 + pixi-filters:
//
//    • HDR-style threshold BLOOM — two additive copies of the fx-canvas art
//      passed through a custom bright-pass GLSL Filter then blurred, so ONLY
//      hot cores bloom (solid stone / smoke / darkness stay true — no haze).
//    • a sprite-based PARTICLE system with runtime-generated soft textures
//      (glow, ember, spark-streak, shard), additive blend, turbulence,
//      size/colour-over-life and motion streaks — crisp fire/sparks over the
//      2-D motes.
//    • dynamic LIGHTING — bright casts throw a transient additive light onto
//      the battlefield (a fireball lights the room).
//    • per-cast POST effects, spun up only when a spell needs them and torn
//      down after: SHOCKWAVE (ShockwaveFilter), HEAT-HAZE / refraction
//      (DisplacementFilter + animated noise), GOD-RAYS (GodrayFilter),
//      chromatic aberration / RGB-split (RGBSplitFilter) and a screen FLASH.
//    • a custom GLSL PLASMA field Filter for hero fire/energy spells.
//
//  Rendering is MANUAL (Pixi's ticker is stopped): effects.js calls present()
//  each animation frame and the GPU idles out the moment the show — 2-D art
//  AND GPU particles/post effects — is over. Bare specifiers ("pixi.js" /
//  "pixi-filters") are resolved by the import map in the host page; if the map,
//  the CDN, WebGL or any filter is missing or throws, we throw here and
//  effects.js silently stays on canvas-2D.
//
//  Pure view: no DB, no page logic.
// ─────────────────────────────────────────────────────────────

// The libraries load through the page's <script type="importmap"> as bare
// specifiers (pixi-filters itself does `import … from "pixi.js"`, which only
// a browser import map can resolve). Exact, pinned versions live in the map
// in vtt.html; recorded here for reference / diagnostics only.
export const PIXI_URL = "pixi.js";
export const PIXI_FILTERS_URL = "pixi-filters";
export const PIXI_CDN = "https://cdn.jsdelivr.net/npm/pixi.js@8.5.2/dist/pixi.min.mjs";
export const PIXI_FILTERS_CDN = "https://cdn.jsdelivr.net/npm/pixi-filters@6.1.4/dist/pixi-filters.mjs";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

/* Cheap, synchronous "can we even try WebGL?" probe. */
export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(
      c.getContext("webgl2") ||
      c.getContext("webgl") ||
      c.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

/* ── runtime-generated particle / light textures ──────────────────
   All are WHITE on transparent so a per-sprite tint paints any colour.
   Drawn once into small canvases and uploaded as GPU textures. */
function makeTextures(PIXI) {
  const tex = (size, paint) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    paint(g, size);
    return PIXI.Texture.from(c);
  };

  // soft round glow — the workhorse energy/ember/light mote
  const glow = tex(64, (g, s) => {
    const r = s / 2;
    const rg = g.createRadialGradient(r, r, 0, r, r, r);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.25, "rgba(255,255,255,0.85)");
    rg.addColorStop(0.55, "rgba(255,255,255,0.32)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
  });

  // tight hot ember with a bright pip
  const ember = tex(48, (g, s) => {
    const r = s / 2;
    const rg = g.createRadialGradient(r, r, 0, r, r, r);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.4, "rgba(255,230,180,0.7)");
    rg.addColorStop(1, "rgba(255,180,90,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
  });

  // elongated spark streak (drawn along +x, rotated to velocity, scaled by speed)
  const spark = tex(64, (g, s) => {
    const cy = s / 2;
    const lg = g.createLinearGradient(0, cy, s, cy);
    lg.addColorStop(0, "rgba(255,255,255,0)");
    lg.addColorStop(0.55, "rgba(255,255,255,0.55)");
    lg.addColorStop(0.9, "rgba(255,255,255,1)");
    lg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = lg;
    const h = s * 0.16;
    g.fillRect(0, cy - h / 2, s, h);
    // bright round head
    const rg = g.createRadialGradient(s * 0.9, cy, 0, s * 0.9, cy, s * 0.14);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(s * 0.7, cy - s * 0.16, s * 0.3, s * 0.32);
  });

  // soft smoke puff — irregular, low-contrast (normal blend, tintable)
  const smoke = tex(96, (g, s) => {
    const r = s / 2;
    for (let i = 0; i < 5; i++) {
      const px = r + rnd(-r * 0.28, r * 0.28);
      const py = r + rnd(-r * 0.28, r * 0.28);
      const rr = rnd(r * 0.4, r * 0.72);
      const rg = g.createRadialGradient(px, py, 0, px, py, rr);
      rg.addColorStop(0, "rgba(255,255,255,0.5)");
      rg.addColorStop(0.6, "rgba(255,255,255,0.18)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, s, s);
    }
  });

  // faceted crystal shard (ice / force / crystalline debris)
  const shard = tex(48, (g, s) => {
    const cx = s / 2;
    g.translate(cx, cx);
    g.beginPath();
    g.moveTo(0, -s * 0.46);
    g.lineTo(s * 0.2, -s * 0.05);
    g.lineTo(s * 0.1, s * 0.46);
    g.lineTo(-s * 0.14, s * 0.2);
    g.lineTo(-s * 0.2, -s * 0.1);
    g.closePath();
    const lg = g.createLinearGradient(-s * 0.2, -s * 0.4, s * 0.2, s * 0.4);
    lg.addColorStop(0, "rgba(255,255,255,1)");
    lg.addColorStop(0.5, "rgba(255,255,255,0.45)");
    lg.addColorStop(1, "rgba(255,255,255,0.85)");
    g.fillStyle = lg;
    g.fill();
  });

  // big soft light kernel for dynamic lighting + screen flash
  const light = tex(256, (g, s) => {
    const r = s / 2;
    const rg = g.createRadialGradient(r, r, 0, r, r, r);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.35, "rgba(255,255,255,0.5)");
    rg.addColorStop(0.7, "rgba(255,255,255,0.12)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
  });

  // tiling value-noise for the displacement (heat-haze) map
  const noise = tex(256, (g, s) => {
    const img = g.createImageData(s, s);
    // smooth-ish value noise by summing a couple of low-freq lattices
    const lattice = (freq) => {
      const n = freq + 1;
      const grid = new Float32Array(n * n);
      for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
      return (x, y) => {
        const gx = (x / s) * freq, gy = (y / s) * freq;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const g00 = grid[(y0 % freq) * n + (x0 % freq)];
        const g10 = grid[(y0 % freq) * n + ((x0 + 1) % freq)];
        const g01 = grid[((y0 + 1) % freq) * n + (x0 % freq)];
        const g11 = grid[((y0 + 1) % freq) * n + ((x0 + 1) % freq)];
        return lerp(lerp(g00, g10, sx), lerp(g01, g11, sx), sy);
      };
    };
    const a = lattice(4), b = lattice(8), c = lattice(16);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = a(x, y) * 0.55 + b(x, y) * 0.3 + c(x, y) * 0.15;
        const i = (y * s + x) * 4;
        img.data[i] = v * 255;         // R drives x displacement
        img.data[i + 1] = (1 - v) * 255; // G drives y displacement
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });

  return { glow, ember, spark, smoke, shard, light, noise };
}

/* the animated plasma / fire-field Filter (custom GLSL). Adds a churning,
   self-lit energy field where the underlying art is bright — used for hero
   fire/energy casts. Cheap flowing 3-octave value noise, colour-ramped. */
function makePlasmaFilter(PIXI) {
  const vertex = `
    in vec2 aPosition;
    out vec2 vTextureCoord;
    uniform vec4 uInputSize;
    uniform vec4 uOutputFrame;
    uniform vec4 uOutputTexture;
    vec4 filterVertexPosition(void){
      vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
      position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
      position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
      return vec4(position, 0.0, 1.0);
    }
    vec2 filterTextureCoord(void){ return aPosition * (uOutputFrame.zw * uInputSize.zw); }
    void main(void){ gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }`;
  const fragment = `
    precision highp float;
    in vec2 vTextureCoord;
    out vec4 finalColor;
    uniform sampler2D uTexture;
    uniform float uTime;
    uniform float uStrength;
    uniform vec3 uColA;
    uniform vec3 uColB;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash(i), b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      for(int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }
      return v;
    }
    void main(void){
      vec4 base = texture(uTexture, vTextureCoord);
      float lum = max(base.r, max(base.g, base.b));
      // only ignite where the underlying art is already hot
      float mask = smoothstep(0.35, 0.9, lum) * base.a;
      vec2 q = vTextureCoord * 6.0;
      float flow = fbm(q + vec2(0.0, -uTime * 1.6) + fbm(q + uTime * 0.5));
      float f2 = fbm(q * 1.7 + vec2(uTime * 0.4, -uTime * 2.2));
      float fire = pow(clamp(flow * 0.7 + f2 * 0.5, 0.0, 1.0), 1.5);
      vec3 col = mix(uColA, uColB, fire) * (0.6 + fire);
      vec3 add = col * fire * mask * uStrength;
      finalColor = base + vec4(add, 0.0);
    }`;
  return new PIXI.Filter({
    glProgram: PIXI.GlProgram.from({ vertex, fragment, name: "sod-plasma" }),
    resources: {
      plasmaUniforms: {
        uTime: { value: 0, type: "f32" },
        uStrength: { value: 1, type: "f32" },
        uColA: { value: [1.0, 0.42, 0.11], type: "vec3<f32>" },
        uColB: { value: [1.0, 0.92, 0.6], type: "vec3<f32>" },
      },
    },
  });
}

/* A HDR-style bright-pass Filter: keeps only pixels above a luminance
   threshold (soft knee) and zeroes the rest, so a following blur blooms ONLY
   hot cores — solid stone, smoke, darkness and mid-tones never haze. Applied
   to an ADDITIVE copy of the art stacked over the crisp, full-brightness base
   (so the base is never dimmed by the bloom). */
function makeBrightPassFilter(PIXI, threshold) {
  const vertex = `
    in vec2 aPosition;
    out vec2 vTextureCoord;
    uniform vec4 uInputSize;
    uniform vec4 uOutputFrame;
    uniform vec4 uOutputTexture;
    vec4 filterVertexPosition(void){
      vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
      position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
      position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
      return vec4(position, 0.0, 1.0);
    }
    vec2 filterTextureCoord(void){ return aPosition * (uOutputFrame.zw * uInputSize.zw); }
    void main(void){ gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }`;
  const fragment = `
    precision highp float;
    in vec2 vTextureCoord;
    out vec4 finalColor;
    uniform sampler2D uTexture;
    uniform float uThreshold;
    void main(void){
      vec4 c = texture(uTexture, vTextureCoord);
      float l = max(c.r, max(c.g, c.b));
      float k = smoothstep(uThreshold, uThreshold + 0.18, l);
      finalColor = vec4(c.rgb * k, c.a * k);
    }`;
  return new PIXI.Filter({
    glProgram: PIXI.GlProgram.from({ vertex, fragment, name: "sod-brightpass" }),
    resources: { bpUniforms: { uThreshold: { value: threshold, type: "f32" } } },
  });
}

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const rgbToInt = (r, g, b) => ((clamp(r, 0, 1) * 255) << 16) | ((clamp(g, 0, 1) * 255) << 8) | (clamp(b, 0, 1) * 255);
const parseColor = (c) => {
  if (typeof c === "number") return c;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
  if (m) return parseInt(m[1], 16);
  const rm = /rgba?\(([^)]+)\)/i.exec(String(c || ""));
  if (rm) { const [r, g, b] = rm[1].split(",").map((v) => parseFloat(v)); return rgbToInt(r / 255, g / 255, b / 255); }
  return 0xffffff;
};
const rgbOf = (int) => [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];

/* Create the cinematic compositor layer.
   `source` : the offscreen 2-D canvas effects.js draws into (device px).
   `wrap`   : the .board-wrap; a transparent GL canvas is stacked over the fx one.
   `opts`   : { strength, view } — `view` (optional) lets positioned post
              effects track pan/zoom by resolving grid→px each frame.
   Returns the compositor handle or throws (→ effects.js stays on canvas-2D). */
export async function createGlowLayer(source, wrap, opts = {}) {
  if (!webglAvailable()) throw new Error("fx-webgl: WebGL unavailable");

  const PIXI = await import(/* @vite-ignore */ "pixi.js");
  const PF = await import(/* @vite-ignore */ "pixi-filters");
  const { Application, Sprite, Container, Texture, CanvasSource, DisplacementFilter, BlurFilter } = PIXI;
  const { ShockwaveFilter, GodrayFilter, RGBSplitFilter } = PF;
  if (!Application || !Sprite || !Container || !BlurFilter) throw new Error("fx-webgl: missing exports");

  const view = opts.view || null;
  const canvas = document.createElement("canvas");
  canvas.className = "fx sod-fx-gl";      // css gives it inset:0 + pointer-events:none

  // A verification harness can set 'sod-fx-preserve' to keep the GL drawing
  // buffer readable (so it can composite the additive layer with the 2-D canvas
  // off-screen). Off in production — it only costs a little memory bandwidth.
  let PRESERVE = false;
  try { PRESERVE = localStorage.getItem("sod-fx-preserve") === "1"; } catch {}
  const app = new Application();
  await app.init({
    canvas,
    width: Math.max(1, source.width | 0),
    height: Math.max(1, source.height | 0),
    backgroundAlpha: 0,                   // transparent — the 2-D fx canvas + map show through
    antialias: true,
    autoDensity: false,                   // we manage device px ourselves (matches the fx canvas)
    clearBeforeRender: true,
    preserveDrawingBuffer: PRESERVE,
    powerPreference: "high-performance",
    preference: "webgl",                  // swiftshader-friendly
  });
  app.ticker.stop();                      // WE drive rendering (idle-friendly)
  // ADDITIVE overlay: this GL canvas stacks over the 2-D fx canvas and only ever
  // ADDS light. 'plus-lighter' is true linear addition of the glow onto the crisp
  // 2-D art beneath, so the base can never be dimmed or blown out; dark materials
  // (stone, smoke, darkness) live on the 2-D canvas and the additive layer, being
  // near-black there, leaves them untouched.
  try { canvas.style.mixBlendMode = "plus-lighter"; } catch { /* fine */ }

  const TEX = makeTextures(PIXI);

  // ── scene graph (ALL additive — this layer only adds light) ──────
  //  fxRoot                       → carries per-cast post fx (haze/shock/chroma)
  //    bloomWide / bloomTight     : threshold-bloom copies of the fx canvas art
  //    heroSprite                 : the plasma shader igniting hot art (hero fire)
  //    smokeLayer                 : smoke puffs (drawn dark → screen leaves them soft)
  //    lightLayer                 : dynamic-light kernels (a fireball lights the room)
  //    partLayer                  : textured sprite particles (embers/sparks/shards)
  //    flashSprite                : full-screen screen-flash on big impacts
  const worldRoot = new Container();
  const fxRoot = new Container();
  const smokeLayer = new Container();
  const partLayer = new Container();
  const lightLayer = new Container();
  lightLayer.blendMode = "add";

  // live texture bound to the fx canvas (the 2-D art) for the bright-pass bloom
  const bind = () => {
    try { const t = Texture.from(source); if (t) return t; } catch { /* below */ }
    return new Texture({ source: new CanvasSource({ resource: source }) });
  };
  let tex = bind();
  const strength = opts.strength ?? 1;
  // two additive threshold-bloom copies → HDR-ish multi-scale glow on hot cores.
  // The bright-pass keeps only the hottest pixels, so mid-tones / stone / smoke /
  // darkness never haze; the blurred result is ADDED over the crisp 2-D base.
  const bloomTight = new Sprite(tex);
  const bloomWide = new Sprite(tex);
  bloomTight.blendMode = "add"; bloomWide.blendMode = "add";
  bloomTight.filters = [makeBrightPassFilter(PIXI, 0.55), new BlurFilter({ strength: 8, quality: 4 })];
  bloomWide.filters = [makeBrightPassFilter(PIXI, 0.68), new BlurFilter({ strength: 20, quality: 4 })];
  bloomTight.alpha = 0.85 * strength;
  bloomWide.alpha = 0.55 * strength;
  // a copy the plasma shader ignites where the art is hot (hero fire/energy)
  const heroSprite = new Sprite(tex);
  heroSprite.visible = false;
  heroSprite.blendMode = "add";
  const plasma = makePlasmaFilter(PIXI);
  heroSprite.filters = [plasma];

  worldRoot.addChild(bloomWide, bloomTight, heroSprite, smokeLayer, lightLayer, partLayer);
  fxRoot.addChild(worldRoot);

  // full-screen additive screen flash (device px; resized with the canvas)
  const flashSprite = new Sprite(TEX.light);
  flashSprite.anchor.set(0.5);
  flashSprite.blendMode = "add";
  flashSprite.alpha = 0;
  flashSprite.x = canvas.width / 2; flashSprite.y = canvas.height / 2;
  flashSprite.scale.set(Math.hypot(canvas.width, canvas.height) / (flashSprite.texture.width || 256));
  fxRoot.addChild(flashSprite);

  app.stage.addChild(fxRoot);

  // displacement (heat-haze) — one shared noise sprite, added to worldRoot so
  // it is part of the rendered scene; the filter samples it. Off until needed.
  const dispSprite = new Sprite(TEX.noise);
  dispSprite.anchor.set(0.5);
  dispSprite.alpha = 0;                     // invisible, but still a valid sampler source
  dispSprite.scale.set(3);
  worldRoot.addChild(dispSprite);
  let dispFilter = null;                    // created lazily

  let dead = false;
  let lastNow = performance.now();

  // ── particle pool ─────────────────────────────────────────────
  const CAP = 620;
  const pool = [];
  const live = [];
  const kindTex = { glow: TEX.glow, ember: TEX.ember, spark: TEX.spark, smoke: TEX.smoke, shard: TEX.shard };
  function acquire(kind) {
    let p = pool.pop();
    if (!p) {
      if (live.length >= CAP) return null;
      p = { sprite: new Sprite(TEX.glow) };
      p.sprite.anchor.set(0.5);
    }
    const sp = p.sprite;
    sp.texture = kindTex[kind] || TEX.glow;
    sp.visible = true;
    (kind === "smoke" ? smokeLayer : partLayer).addChild(sp);
    return p;
  }
  function release(p) {
    const sp = p.sprite;
    try { sp.parent && sp.parent.removeChild(sp); } catch { /* fine */ }
    sp.visible = false;
    if (pool.length < CAP) pool.push(p);
  }

  /* emit(spec): device-px origin. spec:
       { x, y, count, kind, angle, spread, speed:[a,b] (px/s), life:[a,b] (ms),
         size:[a,b] (px), col0, col1 (hex/int), blend, drag, gravity (px/s²),
         turb (px/s²), z (bool, ember arc), rise (px/s), streak (bool) }        */
  function emit(spec) {
    if (dead) return;
    const n = Math.min(spec.count | 0, CAP - live.length);
    const kind = spec.kind || "glow";
    const blend = spec.blend || (kind === "smoke" ? "normal" : "add");
    const c0 = spec.col0 != null ? parseColor(spec.col0) : 0xffffff;
    const c1 = spec.col1 != null ? parseColor(spec.col1) : c0;
    for (let i = 0; i < n; i++) {
      const p = acquire(kind);
      if (!p) break;
      const ang = spec.angle != null ? spec.angle + rnd(-(spec.spread ?? 0), spec.spread ?? 0) : rnd(0, TAU);
      const sp = spec.speed ? rnd(spec.speed[0], spec.speed[1]) : rnd(30, 120);
      p.x = spec.x; p.y = spec.y;
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp - (spec.rise || 0);
      p.drag = spec.drag ?? 0.9;
      p.gravity = spec.gravity ?? 0;
      p.turb = spec.turb ?? 0;
      p.phase = rnd(0, TAU);
      p.age = 0;
      p.life = spec.life ? rnd(spec.life[0], spec.life[1]) : rnd(400, 900);
      p.size0 = spec.size ? rnd(spec.size[0], spec.size[1]) : 8;
      p.size1 = p.size0 * (spec.grow ?? (kind === "smoke" ? 2.2 : 0.15));
      p.c0 = c0; p.c1 = c1;
      p.kind = kind;
      p.streak = !!spec.streak || kind === "spark";
      p.blend = blend;
      p.spin = spec.spin ? rnd(-spec.spin, spec.spin) : 0;
      p.rot = rnd(0, TAU);
      p.z = spec.z ? 0 : -1;
      p.vz = spec.z ? rnd(40, 120) : 0;
      p.sprite.blendMode = blend;
      p.sprite.texture = kindTex[kind] || TEX.glow;
      live.push(p);
    }
    kick();
  }

  function updateParticles(dt) {
    const g = Math.min(dt, 0.05);
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt * 1000;
      const lt = p.age / p.life;
      if (lt >= 1) { live.splice(i, 1); release(p); continue; }
      // turbulence: layered sin field → curl-ish wander
      if (p.turb) {
        p.vx += Math.sin(p.y * 0.01 + p.phase + p.age * 0.004) * p.turb * g;
        p.vy += Math.cos(p.x * 0.01 + p.phase + p.age * 0.004) * p.turb * g;
      }
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.gravity * g;
      p.x += p.vx * g; p.y += p.vy * g;
      let lift = 0;
      if (p.z >= 0) { p.z += p.vz * g; p.vz -= 220 * g; if (p.z < 0) { p.z = 0; p.vz *= -0.3; } lift = p.z; }
      const sp = p.sprite;
      sp.x = p.x; sp.y = p.y - lift;
      // size + colour over life
      const size = lerp(p.size0, p.size1, lt);
      const baseR = sp.texture.width || 64;
      const fade = p.kind === "smoke"
        ? Math.sin(Math.min(1, lt * 1.2) * Math.PI) * 0.5
        : (1 - lt) * (lt < 0.12 ? lt / 0.12 : 1);
      sp.alpha = clamp(fade, 0, 1) * (p.kind === "smoke" ? 0.7 : 1);
      const [r0, g0, b0] = rgbOf(p.c0), [r1, g1, b1] = rgbOf(p.c1);
      sp.tint = rgbToInt(lerp(r0, r1, lt), lerp(g0, g1, lt), lerp(b0, b1, lt));
      if (p.streak) {
        const spd = Math.hypot(p.vx, p.vy);
        sp.rotation = Math.atan2(p.vy, p.vx);
        sp.scale.set((size / baseR) * (1 + spd * 0.012), (size / baseR));
      } else {
        p.rot += p.spin * g;
        sp.rotation = p.rot;
        sp.scale.set((size / baseR) * 2);
      }
    }
  }

  // ── dynamic lights ────────────────────────────────────────────
  const lights = [];
  function addLight(x, y, color, radiusPx, ttlMs, peak = 0.9) {
    if (dead) return;
    const sp = new Sprite(TEX.light);
    sp.anchor.set(0.5);
    sp.blendMode = "add";
    sp.tint = parseColor(color);
    sp.x = x; sp.y = y;
    const base = sp.texture.width || 256;
    sp.scale.set((radiusPx * 2) / base);
    lightLayer.addChild(sp);
    lights.push({ sp, age: 0, ttl: ttlMs, peak });
    kick();
  }
  function updateLights(dt) {
    for (let i = lights.length - 1; i >= 0; i--) {
      const L = lights[i];
      L.age += dt * 1000;
      const t = L.age / L.ttl;
      if (t >= 1) { try { lightLayer.removeChild(L.sp); L.sp.destroy(); } catch { /* fine */ } lights.splice(i, 1); continue; }
      // fast rise, slow decay
      L.sp.alpha = L.peak * (t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.6));
    }
  }

  // ── per-cast post effects (spun up on demand, torn down after) ──
  const posts = [];   // { filter, update(dt), age, ttl, kind }
  function refreshFilters() {
    // per-cast post effects. World-level ones (shockwave / heat-haze / god-rays)
    // distort the whole battlefield show; screen-level ones (chromatic split)
    // ride the final composite. Bloom lives on the sprites, not here, so the
    // base art is never dimmed.
    const worldPost = [];
    for (const p of posts) if (p.filter && p.attach === "world") worldPost.push(p.filter);
    worldRoot.filters = worldPost.length ? worldPost : null;
    const screenPost = [];
    for (const p of posts) if (p.filter && p.attach === "fx") screenPost.push(p.filter);
    fxRoot.filters = screenPost.length ? screenPost : null;
  }
  function addPost(entry) {
    posts.push(entry);
    refreshFilters();
    kick();
  }
  function updatePosts(dt) {
    let changed = false;
    for (let i = posts.length - 1; i >= 0; i--) {
      const p = posts[i];
      p.age += dt * 1000;
      if (p.update) p.update(p.age / 1000, p.age / p.ttl);
      if (p.age >= p.ttl) {
        if (p.cleanup) try { p.cleanup(); } catch { /* fine */ }
        posts.splice(i, 1); changed = true;
      }
    }
    if (changed) refreshFilters();
  }

  function shock(x, y, opts2 = {}) {
    if (dead || !ShockwaveFilter) return;
    const f = new ShockwaveFilter({
      center: { x, y },
      speed: opts2.speed ?? 900,
      amplitude: opts2.amplitude ?? 22,
      wavelength: opts2.wavelength ?? 90,
      brightness: opts2.brightness ?? 1.1,
      radius: opts2.radius ?? -1,
      time: 0,
    });
    const ttl = opts2.ttl ?? 900;
    addPost({
      filter: f, attach: "world", age: 0, ttl,
      update: (t) => { f.time = t; },
    });
  }

  function heatHaze(x, y, radiusPx, ttlMs = 1400, power = 26) {
    if (dead || !DisplacementFilter) return;
    dispSprite.x = x; dispSprite.y = y;
    dispSprite.scale.set(Math.max(2, (radiusPx * 2) / (dispSprite.texture.width || 256)));
    if (!dispFilter) dispFilter = new DisplacementFilter({ sprite: dispSprite, scale: power });
    // (re)configure and add if not present
    const existing = posts.find((p) => p.kind === "haze");
    if (existing) { existing.age = 0; existing.ttl = ttlMs; existing.power = power; return; }
    addPost({
      filter: dispFilter, attach: "world", kind: "haze", age: 0, ttl: ttlMs,
      update: (t, u) => {
        dispSprite.rotation += 0.01;
        dispSprite.x = x + Math.sin(t * 3) * radiusPx * 0.04;
        dispFilter.scale.x = dispFilter.scale.y = power * (1 - u) * (0.7 + 0.3 * Math.sin(t * 8));
      },
    });
  }

  function godray(x, y, opts2 = {}) {
    if (dead || !GodrayFilter) return;
    const parallel = opts2.parallel ?? true;
    // kept subtle — GodrayFilter is full-screen, so a high alpha greys the whole
    // board; a low alpha adds just a breath of volumetric shafts over the beam art
    const peakA = opts2.alpha ?? 0.16;
    const f = new GodrayFilter({
      gain: opts2.gain ?? 0.5,
      lacunarity: opts2.lacunarity ?? 2.2,
      parallel,
      angle: opts2.angle ?? 30,
      center: { x, y },
      alpha: 0.01,
      time: 0,
    });
    const ttl = opts2.ttl ?? 1400;
    addPost({
      filter: f, attach: "world", age: 0, ttl,
      update: (t, u) => {
        f.time = t * 1.1;
        try { f.alpha = Math.max(0.01, peakA * Math.sin(Math.min(1, u * 1.25) * Math.PI)); } catch { /* fine */ }
      },
    });
  }

  function chroma(strengthPx = 8, ttlMs = 380) {
    if (dead || !RGBSplitFilter) return;
    const f = new RGBSplitFilter({ red: { x: -strengthPx, y: 0 }, green: { x: 0, y: 0 }, blue: { x: strengthPx, y: 0 } });
    addPost({
      filter: f, attach: "fx", age: 0, ttl: ttlMs,
      update: (t, u) => {
        const k = strengthPx * (1 - u);
        f.red = { x: -k, y: 0 };
        f.blue = { x: k, y: 0 };
      },
    });
  }

  function flash(color = "#ffffff", peak = 0.6, ttlMs = 320) {
    if (dead) return;
    flashSprite.tint = parseColor(color);
    posts.push({
      kind: "flash", attach: "none", age: 0, ttl: ttlMs,
      update: (t, u) => { flashSprite.alpha = peak * Math.max(0, 1 - u) * (u < 0.12 ? u / 0.12 : 1); },
      cleanup: () => { flashSprite.alpha = 0; },
    });
    kick();
  }

  function plasmaBurst(colA, colB, strengthV = 1, ttlMs = 1200) {
    if (dead) return;
    heroSprite.visible = true;
    try {
      const u = plasma.resources.plasmaUniforms.uniforms;
      u.uColA = hexToRgb(colA || "#ff6b1c");
      u.uColB = hexToRgb(colB || "#ffec99");
      u.uStrength = strengthV;
    } catch { /* fine */ }
    const existing = posts.find((p) => p.kind === "plasma");
    if (existing) { existing.age = 0; existing.ttl = ttlMs; return; }
    posts.push({
      kind: "plasma", attach: "none", age: 0, ttl: ttlMs,
      update: (t, u) => {
        try { plasma.resources.plasmaUniforms.uniforms.uStrength = strengthV * Math.max(0, 1 - u * u); } catch { /* fine */ }
      },
      cleanup: () => { heroSprite.visible = false; },
    });
    kick();
  }

  // ── frame lifecycle ───────────────────────────────────────────
  //  effects.js is the single rAF driver: it calls present() every frame and
  //  keeps looping while busy() is true, so our GPU-only content (particles,
  //  lights, posts that outlast the 2-D art) keeps advancing. kick() is a
  //  safety net that self-drives if present() ever stops being called.
  let selfRaf = 0;
  let lastPresentAt = 0;
  function kick() {
    if (selfRaf || dead) return;
    selfRaf = requestAnimationFrame(function spin() {
      selfRaf = 0;
      if (dead) return;
      // if effects.js is already driving present() this frame, don't double-render
      if (performance.now() - lastPresentAt > 40) present();
      if (busy()) kick();
    });
  }
  function busy() {
    return live.length > 0 || lights.length > 0 || posts.length > 0;
  }

  // ── the calls effects.js already makes ────────────────────────
  function refreshTexture() {
    const old = tex;
    tex = bind();
    bloomTight.texture = bloomWide.texture = heroSprite.texture = tex;
    try { old?.destroy?.(true); } catch { /* fine */ }
  }
  function resize(w, h) {
    if (dead) return;
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (canvas.width === w && canvas.height === h) return;
    try { app.renderer.resize(w, h); } catch { /* fine */ }
    flashSprite.x = w / 2; flashSprite.y = h / 2;
    flashSprite.scale.set((Math.hypot(w, h)) / (flashSprite.texture.width || 256));
    refreshTexture();
  }
  // one-time initial sizing of the overlay
  resize(canvas.width, canvas.height);

  function present() {
    if (dead) return;
    const now = performance.now();
    lastPresentAt = now;
    const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    updateParticles(dt);
    updateLights(dt);
    updatePosts(dt);
    try {
      tex.source.update();
      app.renderer.render(app.stage);
    } catch { /* a transient GL hiccup shouldn't kill the show */ }
  }
  function setStrength(k) {
    bloomTight.alpha = 0.85 * k;
    bloomWide.alpha = 0.55 * k;
  }
  function clear() {
    for (let i = live.length - 1; i >= 0; i--) release(live[i]);
    live.length = 0;
    for (const L of lights) { try { lightLayer.removeChild(L.sp); L.sp.destroy(); } catch { /* fine */ } }
    lights.length = 0;
    for (const p of posts) if (p.cleanup) try { p.cleanup(); } catch { /* fine */ }
    posts.length = 0;
    refreshFilters();
  }
  function destroy() {
    if (dead) return;
    dead = true;
    try { app.destroy(true, { children: true, texture: true, textureSource: true }); } catch { /* fine */ }
    try { canvas.remove(); } catch { /* fine */ }
  }

  wrap.appendChild(canvas);
  return {
    canvas, present, resize, setStrength, destroy, clear, busy,
    get width() { return canvas.width; },
    get height() { return canvas.height; },
    // cinematic bridge — effects.js fires these when webgl is live
    emit, addLight, shock, heatHaze, godray, chroma, flash, plasmaBurst,
  };
}
