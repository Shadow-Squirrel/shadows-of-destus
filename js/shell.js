// ─────────────────────────────────────────────────────────────
//  shell.js — the doorkeeper. Every page calls boot() first.
//  It draws the shared header + nav, connects the database,
//  and enforces the gate: in real mode you must be signed in
//  AND on the invite list (members table) to see anything.
//
//  boot() returns a "ctx" object the page uses:
//    ctx.me      → { email, name, role, isDM }
//    ctx.nameOf  → turns an email into a display name
//    ctx.mode    → "demo" or "real"
//  ...or null if the visitor was stopped at the gate.
// ─────────────────────────────────────────────────────────────
import { CONFIG } from "./config.js";
import { initDb, isReal, auth, members } from "./db.js";

/* ── tiny helpers every page imports ── */

// Escapes text so user input can never inject HTML/scripts.
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Mini-markdown: **bold**, *italic*, "# " headings, "- " lists.
// Input is escaped FIRST, so it's safe to render.
export function md(src) {
  const inline = (t) => t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const lines = esc(src ?? "").split(/\r?\n/);
  const out = [];
  let list = null, para = [];
  const flushP = () => { if (para.length) { out.push("<p>" + inline(para.join("<br>")) + "</p>"); para = []; } };
  const flushL = () => { if (list) { out.push("<ul>" + list.map((i) => "<li>" + inline(i) + "</li>").join("") + "</ul>"); list = null; } };
  for (const ln of lines) {
    if (/^# /.test(ln)) { flushP(); flushL(); out.push("<h3>" + inline(ln.slice(2)) + "</h3>"); }
    else if (/^- /.test(ln)) { flushP(); (list ??= []).push(ln.slice(2)); }
    else if (!ln.trim()) { flushP(); flushL(); }
    else { flushL(); para.push(ln); }
  }
  flushP(); flushL();
  return '<div class="prose">' + out.join("") + "</div>";
}

export function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 3200);
}

// Runs an async action; failures become a toast instead of a
// silent broken page.
export async function guard(fn) {
  try { return await fn(); }
  catch (e) { console.error(e); toast("⚠ " + (e.message || "Something went wrong")); }
}

/* ── shared header ── */
const NAV = [
  ["index.html", "⚔️ Home"],
  ["quests.html", "📜 Quests"],
  ["maps.html", "🗺️ Maps"],
  ["codex.html", "🐉 Codex"],
  ["notes.html", "🖋️ Notes"],
  ["party.html", "🎲 Party"],
];

function renderHeader(pageFile, who) {
  const header = document.getElementById("site-header");
  header.innerHTML = `
    <div class="masthead">
      <h1>${esc(CONFIG.CAMPAIGN_NAME)}</h1>
      <span class="tagline">${esc(CONFIG.TAGLINE)}</span>
      <span class="who" id="who-slot"></span>
    </div>
    <nav class="site">
      ${NAV.map(([file, label]) => `<a href="./${file}" class="${file === pageFile ? "active" : ""}">${label}</a>`).join("")}
    </nav>`;
  document.getElementById("who-slot").replaceChildren(...who);
}

function pill(text, cls = "") {
  const s = document.createElement("span");
  s.className = "pill " + cls;
  s.textContent = text;
  return s;
}

function banner(html, isErr = false) {
  const slot = document.getElementById("banner-slot");
  const div = document.createElement("div");
  div.className = "banner" + (isErr ? " err" : "");
  div.innerHTML = html;
  slot.replaceChildren(div);
}

/* ── the login gate (real mode, not signed in) ── */
function renderGate(main) {
  main.innerHTML = `
    <div class="card gate">
      <h2>${esc(CONFIG.CAMPAIGN_NAME)}</h2>
      <p class="muted small">Members only. Sign in, or create your account with the same
      email your DM invited. No invite yet? Pester your DM.</p>
      <div class="tabs">
        <button class="btn" id="tab-in">Sign in</button>
        <button class="btn-ghost" id="tab-up">Create account</button>
      </div>
      <form id="gate-form">
        <label class="field">Email</label>
        <input type="email" id="g-email" required autocomplete="email" />
        <label class="field">Password</label>
        <input type="password" id="g-pass" required minlength="8" autocomplete="current-password" />
        <div class="actions">
          <button class="btn" type="submit" id="g-go">Enter</button>
          <span class="muted small" id="g-msg"></span>
        </div>
      </form>
    </div>`;
  let modeUp = false;
  const setTab = (up) => {
    modeUp = up;
    document.getElementById("tab-in").className = up ? "btn-ghost" : "btn";
    document.getElementById("tab-up").className = up ? "btn" : "btn-ghost";
    document.getElementById("g-go").textContent = up ? "Create account" : "Enter";
  };
  document.getElementById("tab-in").onclick = () => setTab(false);
  document.getElementById("tab-up").onclick = () => setTab(true);
  document.getElementById("gate-form").onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const email = document.getElementById("g-email").value.trim();
      const pass = document.getElementById("g-pass").value;
      document.getElementById("g-msg").textContent = "…";
      if (modeUp) {
        await auth.signUp(email, pass);
        location.reload();
      } else {
        await auth.signIn(email, pass);
        location.reload();
      }
    }).then(() => (document.getElementById("g-msg").textContent = ""));
  };
}

function renderPending(main, email) {
  main.innerHTML = `
    <div class="card gate">
      <h2>Almost there, traveler</h2>
      <p>You're signed in as <strong>${esc(email)}</strong>, but this email isn't on the
      party roster yet. Ask your DM to invite it (Party page → Invite players),
      then refresh.</p>
      <div class="actions"><button class="btn-ghost" id="p-out">Sign out</button></div>
    </div>`;
  document.getElementById("p-out").onclick = async () => { await auth.signOut(); location.reload(); };
}

/* ── boot: call this first on every page ── */
export async function boot(pageFile, pageTitle) {
  document.title = `${pageTitle} · ${CONFIG.CAMPAIGN_NAME}`;
  const main = document.getElementById("main");
  const mode = await initDb();

  if (!isReal()) {
    renderHeader(pageFile, [pill("demo mode", "mystic")]);
    banner(`🧪 <strong>Demo mode</strong> — sample data, and edits vanish on refresh.
      You're previewing as the DM so every control is visible.
      Connect your free database to make it real (README, step 2).`);
    const me = { email: "dm@example.com", name: "You (DM preview)", role: "dm", isDM: true };
    const all = await members.list();
    return { mode, me, members: all, nameOf: nameResolver(all, me) };
  }

  const session = await auth.session();
  if (!session) { renderHeader(pageFile, []); renderGate(main); return null; }

  const me = await members.mine(session.email);
  if (!me) { renderHeader(pageFile, []); renderPending(main, session.email); return null; }

  const out = document.createElement("button");
  out.className = "btn-ghost";
  out.textContent = "Sign out";
  out.onclick = async () => { await auth.signOut(); location.reload(); };
  renderHeader(pageFile, [
    document.createTextNode(me.display_name || session.email),
    pill(me.role === "dm" ? "DM" : "player", me.role === "dm" ? "gold" : "steel"),
    out,
  ]);

  const all = await members.list();
  const ctx = {
    mode,
    me: { email: session.email.toLowerCase(), name: me.display_name, role: me.role, isDM: me.role === "dm" },
    members: all,
  };
  ctx.nameOf = nameResolver(all, ctx.me);
  return ctx;
}

function nameResolver(all, me) {
  const map = new Map(all.map((m) => [m.email.toLowerCase(), m.display_name || m.email]));
  return (email) => {
    if (!email) return "someone";
    const key = String(email).toLowerCase();
    if (key === me.email) return me.name || "you";
    return map.get(key) || email;
  };
}
