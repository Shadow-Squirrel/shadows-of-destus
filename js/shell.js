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
import { initDb, isReal, auth, members, campaigns, setCampaign, isLegacy, profile } from "./db.js";

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
// The signed-in app nav. (index.html is the PUBLIC landing page; the
// campaign home lives at hub.html.)
const NAV = [
  ["hub.html", "⚔️ Home"],
  ["quests.html", "📜 Quests"],
  ["maps.html", "🗺️ Maps"],
  ["codex.html", "🐉 Codex"],
  ["npcs.html", "🎭 NPCs"],
  ["notes.html", "🖋️ Notes"],
  ["characters.html", "🧙 Characters"],
  ["spells.html", "✨ Spellbook"],
  ["items.html", "🎒 Armory"],
  ["monsters.html", "👹 Bestiary"],
  ["adventures.html", "📖 Adventures"],
  ["vtt.html", "⚔️ Battle"],
  ["dice.html", "🎲 Dice"],
  ["party.html", "🛡️ Party"],
];
// The public nav: what visitors see before they sign in (landing, pricing,
// the sign-in page, and any gated page they hit while signed out).
export const PUBLIC_NAV = [
  ["index.html", "🏰 Home"],
  ["pricing.html", "💎 Pricing"],
  ["login.html", "⚔️ Enter the Dungeon"],
];

// navItems: NAV (signed-in app) or PUBLIC_NAV. brandHref: where the wordmark
// links (the app home for members, the landing page for visitors).
function renderHeader(pageFile, who, tagline, navItems = NAV, brandHref = "./hub.html") {
  const header = document.getElementById("site-header");
  header.innerHTML = `
    <div class="masthead">
      <h1><a href="${esc(brandHref)}">${esc(CONFIG.APP_NAME)}</a></h1>
      ${tagline ? `<span class="tagline">${esc(tagline)}</span>` : ""}
      <span class="who" id="who-slot"></span>
    </div>
    <nav class="site">
      ${navItems.map(([file, label]) => `<a href="./${file}" class="${file === pageFile ? "active" : ""}">${label}</a>`).join("")}
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

/* ── the login gate (real mode, not signed in) ──
   Anyone can create a free account (an "Adventurer"); a link like
   login.html#create opens straight on the Create-account tab. */
function renderGate(main) {
  const free = CONFIG.TIERS?.FREE?.name || "Adventurer";
  main.innerHTML = `
    <div class="card gate">
      <h2>${esc(CONFIG.APP_NAME)}</h2>
      <p class="muted small">Sign in, or create a <strong>free ${esc(free)} account</strong> — build heroes,
      join your friends' tables and play. Got an invite link from a DM? Open it and
      you'll land straight at their table.</p>
      <div class="tabs">
        <button class="btn" id="tab-in">Sign in</button>
        <button class="btn-ghost" id="tab-up">Create free account</button>
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
      <button type="button" class="linklike" id="g-forgot">Forgot password?</button>
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
  if (location.hash === "#create") setTab(true);   // deep link from the landing/pricing pages
  // Forgot password → email a reset link (Supabase Auth). The reset flow
  // completes on the public reset.html page the link lands on.
  document.getElementById("g-forgot").onclick = () => guard(async () => {
    const pre = document.getElementById("g-email").value.trim();
    const email = (prompt("Enter your account email and we'll send a password-reset link:", pre) || "").trim();
    if (!email) return;
    await profile.sendReset(email);
    toast("Check your email for a reset link.");
  });
  document.getElementById("gate-form").onsubmit = (e) => {
    e.preventDefault();
    let keepMsg = false;   // the "check your email" notice must survive the cleanup below
    guard(async () => {
      const email = document.getElementById("g-email").value.trim();
      const pass = document.getElementById("g-pass").value;
      document.getElementById("g-msg").textContent = "…";
      if (modeUp) {
        await auth.signUp(email, pass);
        // With "Confirm email" ON there's no session yet — say so instead
        // of reloading to a blank gate.
        let s = null;
        try { s = await auth.session(); } catch { s = null; }
        if (!s) {
          document.getElementById("g-msg").textContent = "Check your email to confirm your account, then sign in.";
          setTab(false);
          keepMsg = true;
          return;
        }
        location.reload();
      } else {
        await auth.signIn(email, pass);
        location.reload();
      }
    }).then(() => { if (!keepMsg) document.getElementById("g-msg").textContent = ""; });
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

// A small link to the profile/account page, shown in the header for every
// signed-in user (on every booted page).
function profileLink() {
  const a = document.createElement("a");
  a.href = "./profile.html";
  a.className = "who-profile";
  a.title = "Your profile & account";
  a.textContent = "⚙ Profile";
  return a;
}

// Back to the public front page (landing + plans) — the app nav's Home tab
// is the campaign hub, so members need this to reach the site itself.
function siteLink() {
  const a = document.createElement("a");
  a.href = "./index.html";
  a.className = "who-profile";
  a.title = "The site's front page";
  a.textContent = "🏰 Site";
  return a;
}

/* ── boot: call this first on every page ── */
// opts.allowNoCampaign: render the page for a signed-in account that belongs
// to no campaign yet (profile/billing must work for a brand-new subscriber);
// the ctx then has campaign:null, no members, and a player-role `me`.
export async function boot(pageFile, pageTitle, opts = {}) {
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
    renderHeader(pageFile, [pill("demo mode", "mystic"), campaignSwitcher(list, currentId), siteLink(), profileLink()], current?.tagline);
    banner(`🧪 <strong>Demo mode</strong> — sample data, and edits vanish on refresh.
      You're previewing as the DM so every control is visible.
      Connect your free database to make it real (README, step 2).`);
    const me = { email: "dm@example.com", name: "You (DM preview)", role: "dm", isDM: true };
    const all = await members.list();
    return { mode, me, campaign: current, campaigns: list, members: all, nameOf: nameResolver(all, me) };
  }

  // Signed out → the PUBLIC nav (Home · Pricing · Enter) above the gate, so a
  // visitor isn't shown fourteen app tabs they can't open yet.
  const session = await auth.session();
  if (!session) { renderHeader(pageFile, [], null, PUBLIC_NAV, "./index.html"); renderGate(main); return null; }

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
      siteLink(),
      profileLink(),
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
    renderHeader(pageFile, [document.createTextNode(session.email), siteLink(), profileLink(), signOutBtn()]);
    if (opts.allowNoCampaign) {
      setCampaign(null);
      const me = { email: session.email.toLowerCase(), name: "", role: "player", isDM: false };
      return { mode, me, campaign: null, campaigns: [], members: [], nameOf: nameResolver([], me) };
    }
    await renderNoCampaigns(main, session.email);
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
    siteLink(),
    profileLink(),
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

/* ── signed in, but not in any campaign yet ──
   Allow-listed accounts (can create campaigns) get the "start your first
   table" form. Everyone else joins through an invite link, so they see a
   note pointing them at their DM instead of a create form. */
async function renderNoCampaigns(main, email) {
  let canCreate = false;
  try { canCreate = await campaigns.canCreate(); } catch { canCreate = false; }

  if (!canCreate) {
    const free = CONFIG.TIERS?.FREE?.name || "Adventurer";
    const dm = CONFIG.TIERS?.DM?.name || "DM";
    main.innerHTML = `
      <div class="card gate">
        <h2>Welcome, ${esc(free)}</h2>
        <p class="muted small">You're signed in as <strong>${esc(email)}</strong> but not part of any
        campaign yet. Ask your DM for an invite link — open it and you'll be dropped straight
        into their table.</p>
        <p class="muted small">Want to run your own? Become a <strong>${esc(dm)}</strong> to create
        campaigns and unlock the AI dungeon-prep tools.</p>
        <div class="actions">
          <a class="btn" href="./pricing.html">${esc(CONFIG.TIERS?.DM?.icon || "🔥")} See plans</a>
          <button class="btn-ghost" id="nc-out">Sign out</button>
        </div>
      </div>`;
    document.getElementById("nc-out").onclick = async () => { await auth.signOut(); location.reload(); };
    return;
  }

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

/* ── bootPublic: chrome for PUBLIC pages (landing, pricing) ──
   Unlike boot(), this never gates: it draws the public header/nav + footer,
   connects the database, and reports whether someone is signed in so the
   page can swap its calls-to-action ("Create a free account" vs "Open your
   campaign"). Returns { mode, session, email } — session is null when signed
   out (and a stand-in in demo mode, where the site is always "signed in"). */
export async function bootPublic(pageFile, pageTitle) {
  // A falsy pageTitle keeps the page's own <title> (the landing page ships a
  // descriptive one for search/social).
  if (pageTitle) document.title = `${pageTitle} · ${CONFIG.APP_NAME}`;
  const link = (href, text) => {
    const a = document.createElement("a");
    a.href = href; a.className = "who-profile"; a.textContent = text;
    return a;
  };
  // Draw the signed-out chrome FIRST, so the page still has a header and
  // nav even if the database client fails to load (CDN blocked, offline).
  renderHeader(pageFile, [link("./login.html", "Sign in")], null, PUBLIC_NAV, "./index.html");
  renderFooter();
  const mode = await initDb();
  let session = null;
  try { session = await auth.session(); } catch { session = null; }
  const email = session?.email ? String(session.email).toLowerCase() : null;
  if (session) renderHeader(pageFile, [link("./hub.html", "⚔ Open your campaign")], null, PUBLIC_NAV, "./index.html");
  return { mode, session, email };
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
