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
import { initDb, isReal, auth, members, campaigns, setCampaign, isLegacy } from "./db.js";

/* ── which campaign is the user looking at? (remembered per browser) ── */
const CAMP_KEY = "sod-campaign";
const rememberedCampaign = () => { try { return localStorage.getItem(CAMP_KEY) || null; } catch { return null; } };
const rememberCampaign = (id) => { try { localStorage.setItem(CAMP_KEY, id); } catch {} };

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
  ["characters.html", "🧙 Characters"],
  ["vtt.html", "⚔️ Battle"],
  ["dice.html", "🎲 Dice"],
  ["party.html", "🛡️ Party"],
];

function renderHeader(pageFile, who, tagline) {
  const header = document.getElementById("site-header");
  header.innerHTML = `
    <div class="masthead">
      <h1>${esc(CONFIG.APP_NAME)}</h1>
      ${tagline ? `<span class="tagline">${esc(tagline)}</span>` : ""}
      <span class="who" id="who-slot"></span>
    </div>
    <nav class="site">
      ${NAV.map(([file, label]) => `<a href="./${file}" class="${file === pageFile ? "active" : ""}">${label}</a>`).join("")}
    </nav>`;
  document.getElementById("who-slot").replaceChildren(...who);
}

// One consistent legal footer on every page (replaces the per-page markup).
function renderFooter() {
  const foot = document.querySelector("footer.site");
  if (!foot) return;
  const year = new Date().getFullYear();
  foot.innerHTML = `
    <nav class="foot-links">
      <a href="./terms.html">Terms of Service</a>
      <a href="./privacy.html">Privacy Policy</a>
      <a href="./licenses.html">Licenses &amp; Attribution</a>
    </nav>
    <p class="foot-legal">© ${year} ${esc(CONFIG.APP_NAME)}. All rights reserved.</p>
    <p class="foot-legal">${esc(CONFIG.APP_NAME)} is an independent virtual tabletop and is not affiliated with,
      endorsed, or sponsored by Wizards of the Coast, Dungeons &amp; Dragons, or D&amp;D Beyond.</p>
    <p class="foot-legal">Game rules content is from the System Reference Document 5.1, © Wizards of the Coast LLC,
      licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC&nbsp;BY&nbsp;4.0</a>.</p>
    <p class="foot-flavor">Forged with dice · data guarded by Supabase</p>`;
}

// A dropdown of the user's campaigns + a link to manage them. Switching
// remembers the choice and reloads so every page re-reads in the new scope.
function campaignSwitcher(list, currentId) {
  const wrap = document.createElement("span");
  wrap.className = "camp-switch";
  if (list.length > 1) {
    const sel = document.createElement("select");
    sel.className = "camp-select";
    sel.innerHTML = list.map((c) => `<option value="${esc(c.id)}" ${c.id === currentId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    sel.onchange = () => { rememberCampaign(sel.value); location.reload(); };
    wrap.appendChild(sel);
  } else {
    const one = document.createElement("span");
    one.className = "camp-one";
    one.textContent = list[0]?.name || "";
    wrap.appendChild(one);
  }
  const manage = document.createElement("a");
  manage.href = "./campaigns.html";
  manage.className = "camp-manage";
  manage.title = "Manage campaigns";
  manage.textContent = "⚙";
  wrap.appendChild(manage);
  return wrap;
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
      <h2>${esc(CONFIG.APP_NAME)}</h2>
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

// pick the campaign to show: the remembered one if still valid, else the first
function chooseCampaign(list) {
  const want = rememberedCampaign();
  const hit = list.find((c) => c.id === want);
  return (hit || list[0]).id;
}

function signOutBtn() {
  const out = document.createElement("button");
  out.className = "btn-ghost";
  out.textContent = "Sign out";
  out.onclick = async () => { await auth.signOut(); location.reload(); };
  return out;
}

/* ── boot: call this first on every page ── */
export async function boot(pageFile, pageTitle) {
  document.title = `${pageTitle} · ${CONFIG.APP_NAME}`;
  const main = document.getElementById("main");
  renderFooter();
  const mode = await initDb();

  if (!isReal()) {
    // demo: two sample campaigns so the switcher is real
    const list = await campaigns.mine("dm@example.com");
    const currentId = chooseCampaign(list);
    setCampaign(currentId);
    const current = list.find((c) => c.id === currentId);
    renderHeader(pageFile, [pill("demo mode", "mystic"), campaignSwitcher(list, currentId)], current?.tagline);
    banner(`🧪 <strong>Demo mode</strong> — sample data, and edits vanish on refresh.
      You're previewing as the DM so every control is visible.
      Connect your free database to make it real (README, step 2).`);
    const me = { email: "dm@example.com", name: "You (DM preview)", role: "dm", isDM: true };
    const all = await members.list();
    return { mode, me, campaign: current, campaigns: list, members: all, nameOf: nameResolver(all, me) };
  }

  const session = await auth.session();
  if (!session) { renderHeader(pageFile, []); renderGate(main); return null; }

  // which campaigns does this signed-in person belong to?
  let myCampaigns = [];
  try { myCampaigns = await campaigns.mine(session.email); }
  catch (e) { renderHeader(pageFile, [signOutBtn()]); banner(`⚠ ${esc(e.message)}`, true); return null; }

  // Legacy: multi-campaign migration not applied yet → behave like the old
  // single-campaign site so nothing breaks until the DM runs the update.
  if (isLegacy()) {
    setCampaign(null);
    const meL = await members.mine(session.email);
    if (!meL) { renderHeader(pageFile, [signOutBtn()]); renderPending(main, session.email); return null; }
    renderHeader(pageFile, [
      document.createTextNode(meL.display_name || session.email),
      pill(meL.role === "dm" ? "DM" : "player", meL.role === "dm" ? "gold" : "steel"),
      signOutBtn(),
    ], CONFIG.TAGLINE);
    const allL = await members.list();
    const ctxL = {
      mode, legacy: true,
      me: { email: session.email.toLowerCase(), name: meL.display_name, role: meL.role, isDM: meL.role === "dm" },
      campaign: null, campaigns: [], members: allL,
    };
    ctxL.nameOf = nameResolver(allL, ctxL.me);
    return ctxL;
  }

  if (!myCampaigns.length) {
    renderHeader(pageFile, [document.createTextNode(session.email), signOutBtn()]);
    renderNoCampaigns(main, session.email);
    return null;
  }

  const currentId = chooseCampaign(myCampaigns);
  rememberCampaign(currentId);
  setCampaign(currentId);
  const current = myCampaigns.find((c) => c.id === currentId);

  const me = await members.mine(session.email);
  if (!me) { renderHeader(pageFile, [signOutBtn()]); renderPending(main, session.email); return null; }

  renderHeader(pageFile, [
    campaignSwitcher(myCampaigns, currentId),
    document.createTextNode(me.display_name || session.email),
    pill(me.role === "dm" ? "DM" : "player", me.role === "dm" ? "gold" : "steel"),
    signOutBtn(),
  ], current?.tagline);

  const all = await members.list();
  const ctx = {
    mode,
    me: { email: session.email.toLowerCase(), name: me.display_name, role: me.role, isDM: me.role === "dm" },
    campaign: current,
    campaigns: myCampaigns,
    members: all,
  };
  ctx.nameOf = nameResolver(all, ctx.me);
  return ctx;
}

/* ── signed in, but not in any campaign yet ── */
function renderNoCampaigns(main, email) {
  main.innerHTML = `
    <div class="card gate">
      <h2>Welcome, ${esc(email)}</h2>
      <p class="muted small">You're signed in but not part of any campaign yet. Start your own
      table below, or ask a DM to invite this email to theirs — then refresh.</p>
      <label class="field">Name your first campaign</label>
      <input type="text" id="nc-name" placeholder="e.g. Shadows of Destus" />
      <div class="actions">
        <button class="btn" id="nc-go">Create campaign</button>
        <span class="muted small" id="nc-msg"></span>
      </div>
    </div>`;
  document.getElementById("nc-go").onclick = () => guard(async () => {
    const name = document.getElementById("nc-name").value.trim() || "My Campaign";
    document.getElementById("nc-msg").textContent = "…";
    const c = await campaigns.create(name);
    if (c?.id) rememberCampaign(c.id);
    location.reload();
  });
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
