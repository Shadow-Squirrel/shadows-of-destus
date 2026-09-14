// ─────────────────────────────────────────────────────────────
//  fx-webgl.js — optional GPU bloom/glow layer for the FX engine.
//
//  The 2-D engine in effects.js paints all its (already data-driven,
//  pseudo-3D) spell art into an OFFSCREEN canvas. This module hands
//  that offscreen to the GPU as a texture and re-presents it through
//  PixiJS v8 with a real, additive, multi-pass bloom — the kind of
//  volumetric glow flat canvas-2D can't reach. Fire blooms, lightning
//  leaves an afterglow, radiant reads like god-light.
//
//  Deliberately PixiJS-core only (no pixi-filters): pixi-filters ships
//  a bare `import … from "pixi.js"` specifier that a browser can't
//  resolve without an <script type=importmap> (which we can't add — no
//  HTML edits). Core `BlurFilter` + additive-blend sprites give a
//  genuine bloom with a single self-contained ESM import, so the layer
//  can never half-load. If anything here throws, effects.js silently
//  falls back to drawing the same offscreen straight to the fx canvas.
//
//  Pure view: no DB, no page logic. Rendering is MANUAL (Pixi's own
//  ticker is stopped) so the layer idles out the instant the FX loop
//  does — no busy GPU loop between spells.
// ─────────────────────────────────────────────────────────────

// Pinned, exact, verified-resolvable ESM build (UMD-free .mjs).
export const PIXI_URL = "https://cdn.jsdelivr.net/npm/pixi.js@8.5.2/dist/pixi.min.mjs";

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

/* Create the additive-bloom presentation layer.
   `source` : the offscreen 2-D canvas the FX engine draws into (device px).
   `wrap`   : the .board-wrap; we append a transparent GL canvas over the fx one.
   Returns { canvas, present(), resize(w,h), setStrength(k), destroy() } or throws. */
export async function createGlowLayer(source, wrap, opts = {}) {
  if (!webglAvailable()) throw new Error("fx-webgl: WebGL unavailable");

  const PIXI = await import(PIXI_URL);
  const { Application, Sprite, BlurFilter, Texture, CanvasSource } = PIXI;
  if (!Application || !Sprite || !BlurFilter) throw new Error("fx-webgl: Pixi build missing exports");

  const canvas = document.createElement("canvas");
  // class "fx" → css hands it `position:absolute; inset:0` + `pointer-events:none`,
  // so it fills the wrap and never eats board interaction. Extra class = easy find.
  canvas.className = "fx sod-fx-gl";

  const app = new Application();
  await app.init({
    canvas,
    width: Math.max(1, source.width | 0),
    height: Math.max(1, source.height | 0),
    backgroundAlpha: 0,                 // transparent — the map/tokens show through
    antialias: true,
    autoDensity: false,                 // we manage device px ourselves (matches offscreen)
    clearBeforeRender: true,
    powerPreference: "high-performance",
    preference: "webgl",                // stick to WebGL; swiftshader-friendly
  });
  app.ticker.stop();                    // WE drive rendering (idle-friendly), not Pixi

  // Bind a live texture to the offscreen canvas. Texture.from handles a canvas
  // resource in v8; fall back to an explicit CanvasSource if that shape changes.
  const bind = () => {
    try {
      const t = Texture.from(source);
      if (t) return t;
    } catch { /* try explicit source below */ }
    return new Texture({ source: new CanvasSource({ resource: source }) });
  };

  let tex = bind();
  const base = new Sprite(tex);         // the art, straight
  const glowA = new Sprite(tex);        // tight blurred copy, added → inner bloom
  const glowB = new Sprite(tex);        // wide  blurred copy, added → soft halo
  // No pixi-filters → no bright-pass threshold, so both blurred copies would
  // bloom mid-tones too and haze solid materials (stone walls). We keep the
  // additive alphas modest: a bright glow (fire/lightning/radiant, already at
  // full core value) still blooms hard, while a mid-tone slab barely lifts.
  const strength = opts.strength ?? 1;
  const blurA = new BlurFilter({ strength: 4 * strength, quality: 4 });
  const blurB = new BlurFilter({ strength: 11 * strength, quality: 4 });
  glowA.filters = [blurA];
  glowB.filters = [blurB];
  glowA.blendMode = "add";
  glowB.blendMode = "add";
  glowA.alpha = 0.55;
  glowB.alpha = 0.32;

  // base first (source-over: dark art like stone walls / darkness render true),
  // then the two additive blurred copies stack the bloom only on bright pixels.
  app.stage.addChild(base, glowB, glowA);

  let dead = false;

  function refreshTexture() {
    const old = tex;
    tex = bind();
    base.texture = glowA.texture = glowB.texture = tex;
    try { old?.destroy?.(true); } catch { /* fine */ }
  }

  function resize(w, h) {
    if (dead) return;
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (canvas.width === w && canvas.height === h) return;
    try { app.renderer.resize(w, h); } catch { /* fine */ }
    refreshTexture();                   // offscreen was already resized by the caller
  }

  function present() {
    if (dead) return;
    try {
      tex.source.update();              // upload the fresh offscreen pixels
      app.renderer.render(app.stage);
    } catch { /* a transient GL hiccup shouldn't kill the show */ }
  }

  function setStrength(k) {
    blurA.strength = 4 * k;
    blurB.strength = 11 * k;
  }

  function destroy() {
    if (dead) return;
    dead = true;
    try { app.destroy(true, { children: true, texture: true, textureSource: true }); }
    catch { /* fine */ }
    try { canvas.remove(); } catch { /* fine */ }
  }

  wrap.appendChild(canvas);             // stacked above the 2-D fx canvas
  return { canvas, present, resize, setStrength, destroy };
}
