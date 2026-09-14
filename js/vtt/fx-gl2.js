// ─────────────────────────────────────────────────────────────
//  fx-gl2.js — raw WebGL2 VOLUMETRIC layer (no libraries, no CDN).
//
//  A companion to fx-webgl.js. Where that module needs PixiJS from a CDN
//  import map (and silently stays on flat canvas-2D if the CDN, the map, or
//  a filter is missing), THIS module uses only the browser's built-in WebGL2
//  — so it ALWAYS loads. It stacks a transparent GL canvas over the 2-D fx
//  canvas, blended additively ('plus-lighter'), and raymarches genuinely
//  volumetric fire (fbm density + domain warping + blackbody emission +
//  front-to-back self-shadowing) as a billboard placed at any point/size on
//  the battle map. The 2-D engine keeps drawing the AoE ring + range label
//  beneath; this only ADDS the 3-D blaze on top — so a fireball reads like a
//  real, rolling, video-game explosion instead of a flat vector puff.
//
//  Owned outright: every frame is generated from this code — no third-party
//  assets, no licence, no per-cast cost. Pure view: no DB, no page logic.
// ─────────────────────────────────────────────────────────────

/* Synchronous "do we have WebGL2 at all?" probe. */
export function webgl2Available() {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch { return false; }
}

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

// Volumetric fire ELEMENT on black — a billboard centred at uCenter (device px),
// sized by uScale (px). uT is seconds since detonation (0 → ~1.6). Output is
// fire-on-black with alpha 1; the canvas is composited with CSS 'plus-lighter'
// so black adds nothing and only the blaze lands on the map.
const FS = `#version 300 es
precision highp float;
uniform vec2 uCenter;   // blast centre, device px
uniform float uScale;   // billboard half-extent, px
uniform float uT;       // seconds since detonation
uniform vec3  uColA;    // inner (hot) tint
uniform vec3  uColB;    // outer (cool) tint
uniform int   uStyle;   // 0 fire · 1 frost · 2 spark(lightning) · 3 holy(radiant) · 4 void(necrotic)
out vec4 o;

float hash13(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i+vec3(0,0,0)),hash13(i+vec3(1,0,0)),f.x),
                 mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),
                 mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
const mat3 M3 = mat3(0.00,0.80,0.60,-0.80,0.36,-0.48,-0.60,-0.48,0.64);
float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p=M3*p*2.02; a*=0.5; } return v; }

// blackbody-ish ramp, tinted by the spell's palette (uColA hot core → uColB edge)
vec3 fireRamp(float t){
  t=clamp(t,0.0,1.0);
  vec3 ember = uColB*0.5;
  vec3 c = mix(vec3(0.04,0.01,0.005), ember,           smoothstep(0.03,0.30,t));
  c = mix(c, uColB,                                    smoothstep(0.25,0.52,t));
  c = mix(c, mix(uColB,uColA,0.6),                     smoothstep(0.48,0.72,t));
  c = mix(c, uColA,                                    smoothstep(0.66,0.88,t));
  float wf = (uStyle==1 || uStyle==4) ? 0.22 : 0.7;    // frost/void keep their colour (not white-hot)
  c = mix(c, mix(uColA,vec3(1.0),wf),                  smoothstep(0.86,1.0,t));
  return c;
}

// One volumetric field, shaped per style. All share the raymarch below; they
// differ in rise, turbulence frequency, ridged (crystal/filament) sharpening,
// swirl, vertical bias and threshold — enough to read as fire vs frost vs
// lightning vs a shaft of holy light vs a swirling necrotic implosion.
float field(vec3 p, float R, float t, out float heat){
  float r=length(p);
  vec3 q=p/R;
  float rise=1.15, freq=2.5, ridged=0.0, swirl=0.0, bulgeY=0.18, thr=0.44;
  if(uStyle==1){ rise=0.30; freq=3.3; ridged=0.55; bulgeY=-0.04; thr=0.46; }   // frost: spreads, crystalline
  else if(uStyle==2){ rise=0.45; freq=5.2; ridged=1.0; bulgeY=0.02; thr=0.55; }// spark: thin bright filaments
  else if(uStyle==3){ rise=0.85; freq=1.9; ridged=0.0; bulgeY=0.05; thr=0.40; }// holy: smooth, tall
  else if(uStyle==4){ rise=0.20; freq=2.8; ridged=0.45; swirl=2.4; bulgeY=0.0; thr=0.46; } // void: swirl
  vec3 fp=q*freq; fp.y-=t*rise;
  if(swirl>0.0){ float a=swirl*(t*0.7+q.y*0.7); float c=cos(a),s=sin(a); fp.xz=mat2(c,-s,s,c)*fp.xz; }
  float w1=fbm(fp+vec3(0.0,t*0.6,1.7));
  float w2=fbm(fp*1.3+vec3(5.2,t*0.4,-1.1));
  vec3 warp=vec3(w1,w2,w1-w2)-0.5;
  float n=fbm(fp+warp*1.6);
  if(ridged>0.0){ float rn=1.0-abs(2.0*n-1.0); n=mix(n, rn*rn, ridged); }      // ridges → shards/bolts
  float bulge=R*(1.0+bulgeY*smoothstep(0.0,R*1.6,p.y));
  float sphere=1.0-smoothstep(R*0.30,bulge,r);
  if(uStyle==3){                                                               // holy: add a vertical shaft
    float rad=length(p.xz);
    float col=(1.0-smoothstep(R*0.12,R*0.85,rad))*(1.0-smoothstep(R*2.4,R*3.1,abs(p.y-R*0.7)));
    sphere=max(sphere, col);
  }
  float dens=clamp(sphere*(0.5+1.0*n)-thr,0.0,1.0);
  float h=(1.0-r/(R*1.3))-0.22*smoothstep(0.0,R*1.7,p.y)+0.30*n; h-=t*0.22;
  if(uStyle==1) h*=0.92;                                                       // frost reads cooler
  heat=clamp(h,0.0,1.0);
  return dens;
}

void main(){
  vec2 uv=(gl_FragCoord.xy-uCenter)/uScale;   // billboard-local, ~[-1,1]
  float t=uT;

  vec3 ro=vec3(0.0,3.0,8.6);
  vec3 ta=vec3(0.0,1.7,0.0);
  vec3 ww=normalize(ta-ro);
  vec3 uu=normalize(cross(ww,vec3(0,1,0)));
  vec3 vv=cross(uu,ww);
  vec3 rd=normalize(uv.x*uu+uv.y*vv+1.6*ww);

  float grow=1.0-exp(-t*7.0);
  float R=0.6+2.7*grow;
  vec3 bc=vec3(0.0,0.7+1.05*grow,0.0);
  float fade=exp(-t*1.05);
  if(uStyle==1){ R=0.6+3.2*grow; bc.y=0.5+0.55*grow; }     // frost spreads wider + lower
  else if(uStyle==2){ R=0.5+2.2*grow; fade=exp(-t*1.7); }  // lightning tighter, snaps out fast
  else if(uStyle==3){ bc.y=0.9+1.4*grow; }                 // holy rises into a taller shaft
  else if(uStyle==4){ R=0.6+2.4*grow; }                    // void

  vec3 oc=ro-bc; float b=dot(oc,rd); float c2=dot(oc,oc)-(R*1.9)*(R*1.9);
  float disc=b*b-c2;
  vec3 acc=vec3(0.0); float trans=1.0;
  if(disc>0.0){
    float ds=sqrt(disc); float t0=max(-b-ds,0.0); float t1=-b+ds; float span=t1-t0;
    if(span>0.0){
      float dt=span/40.0;
      float jit=hash13(vec3(gl_FragCoord.xy,t));
      float tc=t0+dt*jit;
      for(int i=0;i<40;i++){
        if(tc>t1||trans<0.02) break;
        vec3 pp=ro+rd*tc-bc; float heat; float dens=field(pp,R,t,heat);
        if(dens>0.002){
          vec3 col=fireRamp(heat)*(0.55+1.7*heat);
          float a=clamp(dens*dt*2.6,0.0,1.0);
          acc+=trans*col*a*2.3*fade; trans*=(1.0-a);
        }
        tc+=dt;
      }
    }
  }

  // detonation flash core (local to the billboard) + a soft warm bloom.
  // Both fall to 0 by dc=1.0 so nothing lands on the scissor-box edge.
  float fl=exp(-t*(uStyle==2?11.0:8.5)); float dc=length(uv);
  acc+=uColA*fl*smoothstep(1.0,0.0,dc)*(uStyle==2?2.1:1.6);
  acc+=uColB*fl*0.22*smoothstep(1.0,0.0,dc);

  acc=acc/(1.0+acc*0.34)*1.35;
  acc=pow(max(acc,0.0),vec3(0.88));
  // PREMULTIPLIED output: rgb = the light to add, alpha = its coverage. Under
  // 'plus-lighter' the rgb is added to the map; if a browser lacks that blend
  // and falls back to normal compositing, alpha keeps empty areas transparent
  // (the map shows through) instead of a black box covering the board.
  float cov=clamp(max(max(acc.r,acc.g),acc.b),0.0,1.0);
  o=vec4(acc,cov);
}`;

/*  createVolLayer(source, wrap, opts)
      source : the 2-D fx canvas (we mirror its device size)
      wrap   : the positioned container the fx canvas lives in
      opts   : { } (reserved)
    Throws if WebGL2 or shader compilation is unavailable — the caller then
    simply never volumetrically enhances (the 2-D + optional Pixi path stands).
*/
export function createVolLayer(source, wrap, opts = {}) {
  if (!webgl2Available()) throw new Error("fx-gl2: WebGL2 unavailable");
  if (!wrap) throw new Error("fx-gl2: no wrap container");

  const canvas = document.createElement("canvas");
  canvas.className = "fx sod-fx-gl2";
  // Inline styles so we never depend on a CSS rule existing: exact overlay,
  // click-through, additive blend onto the 2-D art + map beneath.
  const st = canvas.style;
  st.position = "absolute"; st.left = "0"; st.top = "0";
  st.width = "100%"; st.height = "100%";
  st.pointerEvents = "none";
  try { st.mixBlendMode = "plus-lighter"; } catch { /* older engines: plain over */ }

  const gl = canvas.getContext("webgl2", {
    premultipliedAlpha: true, alpha: true, antialias: true,
    // a verification harness can pin readback; harmless in production
    preserveDrawingBuffer: (() => { try { return localStorage.getItem("sod-fx-preserve") === "1"; } catch { return false; } })(),
  });
  if (!gl) throw new Error("fx-gl2: no webgl2 context");

  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s); gl.deleteShader(s);
      throw new Error("fx-gl2: shader compile failed: " + log);
    }
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog); throw new Error("fx-gl2: link failed: " + log);
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {
    center: gl.getUniformLocation(prog, "uCenter"),
    scale: gl.getUniformLocation(prog, "uScale"),
    t: gl.getUniformLocation(prog, "uT"),
    colA: gl.getUniformLocation(prog, "uColA"),
    colB: gl.getUniformLocation(prog, "uColB"),
    style: gl.getUniformLocation(prog, "uStyle"),
  };
  const STYLE = { fire: 0, frost: 1, spark: 2, holy: 3, void: 4 };

  // additive stacking of multiple simultaneous blasts
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  let W = 0, H = 0;
  function resize(w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === W && h === H) return;
    W = canvas.width = w; H = canvas.height = h;
  }
  resize(source.width, source.height);
  wrap.appendChild(canvas);

  // hex "#rrggbb" or {r,g,b} 0..255 → vec3 0..1 (with sane fire defaults)
  function toRGB(c, fallback) {
    if (Array.isArray(c) && c.length >= 3) return [c[0] / 255, c[1] / 255, c[2] / 255];
    if (c && typeof c === "object" && "r" in c) return [c.r / 255, c.g / 255, c.b / 255];
    if (typeof c === "string" && c[0] === "#" && c.length >= 7) {
      return [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
    }
    return fallback;
  }

  /* Clear the overlay for a fresh frame (opaque black → adds nothing where no fire). */
  function beginFrame() {
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);          // fully transparent → adds nothing where no fire
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /* Draw one volumetric blast.
       x,y      : centre in device px (canvas coords, same space as the fx canvas)
       radiusPx : the effect radius in px (e.g. feetToPx(radiusFt))
       t        : progress 0..1 over the stage; mapped to the shader's timeline
       opts     : { style, colHot, colCool, spanSec, spread }
       style: "fire" | "frost" | "spark" | "holy" | "void" (or its int) */
  function fire(x, y, radiusPx, t, opts = {}) {
    const styleInt = typeof opts.style === "number" ? opts.style : (STYLE[opts.style] ?? 0);
    const spanSec = opts.spanSec ?? 1.5;
    const spread = opts.spread ?? (styleInt === 3 ? 2.4 : 1.55); // holy shaft needs headroom
    const scale = Math.max(4, radiusPx * spread);
    const colA = toRGB(opts.colHot, [1.0, 0.86, 0.45]);
    const colB = toRGB(opts.colCool, [1.0, 0.42, 0.06]);
    // scissor to the billboard's bounding box so we only shade local pixels
    const bx = Math.max(0, Math.floor(x - scale)), by = Math.max(0, Math.floor((H - y) - scale));
    const bw = Math.min(W - bx, Math.ceil(scale * 2)), bh = Math.min(H - by, Math.ceil(scale * 2));
    if (bw <= 0 || bh <= 0) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(bx, by, bw, bh);
    gl.uniform2f(U.center, x, H - y);             // GL y is bottom-up
    gl.uniform1f(U.scale, scale);
    gl.uniform1f(U.t, Math.max(0, t) * spanSec);
    gl.uniform3fv(U.colA, colA);
    gl.uniform3fv(U.colB, colB);
    gl.uniform1i(U.style, styleInt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function clear() {
    try { beginFrame(); } catch { /* fine */ }
  }
  let destroyed = false;
  function destroy() {
    if (destroyed) return; destroyed = true;
    try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* fine */ }
    try { canvas.remove(); } catch { /* fine */ }
  }

  return { canvas, resize, beginFrame, fire, clear, destroy, available: true };
}
