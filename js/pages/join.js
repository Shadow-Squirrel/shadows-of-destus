// join.js — the PUBLIC invite-link landing page. Unlike every other page
// it does NOT call boot()/the members gate: a brand-new person must be able
// to open it while signed out, see which campaign they've been invited to,
// create an account, and be dropped straight into that table.
//
// URL shape: /join.html?invite=<token>
//
// The database does the real work and the real checks:
//   • invites.info(token)  — anon-safe peek: is this token valid, and for
//                            which campaign? (used to show the name)
//   • invites.redeem(token)— requires auth; adds you to the campaign.
// This file is just the four screens around those two calls.
import { CONFIG } from "../config.js";
import { initDb, auth, invites } from "../db.js";
import { esc, toast, guard } from "../shell.js";

const CAMP_KEY = "sod-campaign"; // same key shell.js's switcher reads
const rememberCampaign = (id) => { try { localStorage.setItem(CAMP_KEY, id); } catch {} };

const main = document.getElementById("main");
const token = new URLSearchParams(location.search).get("invite");

renderChrome();
run();

function renderChrome() {
  const header = document.getElementById("site-header");
  if (header) header.innerHTML = `<div class="masthead"><h1>${esc(CONFIG.APP_NAME)}</h1></div>`;
  const y = document.getElementById("foot-year");
  if (y) y.textContent = new Date().getFullYear();
}

function card(html) { main.innerHTML = `<div class="card gate">${html}</div>`; }

// A friendly dead-end for a missing / bad / expired / used-up link.
function renderInvalid() {
  card(`
    <h2>Invite not valid</h2>
    <p class="muted small">This invite link is invalid or has expired — ask your DM for a new one.</p>
    <div class="actions"><a class="btn-ghost" href="./index.html">Go to ${esc(CONFIG.APP_NAME)}</a></div>`);
}

async function run() {
  if (!token) { renderInvalid(); return; }

  card(`<h2>${esc(CONFIG.APP_NAME)}</h2><p class="muted small">Checking your invite…</p>`);

  await initDb();

  let info = null;
  try {
    info = await invites.info(token);
  } catch (e) {
    console.error(e);
    renderInvalid();
    return;
  }
  if (!info || info.valid === false) { renderInvalid(); return; }

  const campaignName = info.campaign_name || "a campaign";

  // Signed in already? (real mode → null when not; demo → always "signed in")
  let session = null;
  try { session = await auth.session(); } catch (e) { console.error(e); }

  if (session) renderJoin(campaignName);
  else renderAuth(campaignName);
}

// Already signed in: confirm and drop them in.
function renderJoin(campaignName) {
  card(`
    <h2>You're invited</h2>
    <p>You've been invited to join <strong>${esc(campaignName)}</strong>.</p>
    <label class="field">Your name at the table <span class="muted small">(optional)</span></label>
    <input type="text" id="j-name" placeholder="Name shown on notes & rolls" autocomplete="name" />
    <div class="actions">
      <button class="btn" id="j-go">Join ${esc(campaignName)}</button>
      <span class="muted small" id="j-msg"></span>
    </div>`);
  document.getElementById("j-go").onclick = () => {
    document.getElementById("j-msg").textContent = "…";
    proceed(document.getElementById("j-name").value.trim())
      .catch((e) => { console.error(e); toast("⚠ " + (e.message || "Couldn't join")); })
      .finally(() => { const m = document.getElementById("j-msg"); if (m) m.textContent = ""; });
  };
}

// Not signed in: same create-account / sign-in choice as the main gate,
// but on success we continue straight to redeeming the invite.
function renderAuth(campaignName) {
  card(`
    <h2>You're invited</h2>
    <p>You've been invited to join <strong>${esc(campaignName)}</strong>.</p>
    <p class="muted small">Create an account (or sign in) and you'll be dropped straight into the table.
    Your email is your login — there's no separate username.</p>
    <div class="tabs">
      <button class="btn" id="tab-up">Create account</button>
      <button class="btn-ghost" id="tab-in">Sign in</button>
    </div>
    <form id="join-form">
      <label class="field" id="a-name-label">Your name at the table</label>
      <input type="text" id="a-name" placeholder="Name shown on notes & rolls" autocomplete="name" />
      <label class="field">Email</label>
      <input type="email" id="a-email" required autocomplete="email" />
      <label class="field">Password</label>
      <input type="password" id="a-pass" required minlength="8" autocomplete="current-password" />
      <div class="actions">
        <button class="btn" type="submit" id="a-go">Create account &amp; join</button>
        <span class="muted small" id="a-msg"></span>
      </div>
    </form>`);

  let modeUp = true;
  const setTab = (up) => {
    modeUp = up;
    document.getElementById("tab-up").className = up ? "btn" : "btn-ghost";
    document.getElementById("tab-in").className = up ? "btn-ghost" : "btn";
    document.getElementById("a-go").textContent = up ? "Create account & join" : "Sign in & join";
    // A display name only matters when creating a brand-new membership.
    document.getElementById("a-name-label").style.display = up ? "" : "none";
    document.getElementById("a-name").style.display = up ? "" : "none";
  };
  document.getElementById("tab-up").onclick = () => setTab(true);
  document.getElementById("tab-in").onclick = () => setTab(false);

  document.getElementById("join-form").onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const name = document.getElementById("a-name").value.trim();
      const email = document.getElementById("a-email").value.trim();
      const pass = document.getElementById("a-pass").value;
      document.getElementById("a-msg").textContent = "…";
      if (modeUp) await auth.signUp(email, pass);
      else await auth.signIn(email, pass);

      // Signed in now? Redeem + go. If sign-up needs email confirmation
      // there's no session yet, so tell them rather than failing silently.
      const s = await auth.session();
      if (s) { await proceed(name); return; }
      document.getElementById("a-msg").textContent = "";
      card(`
        <h2>Almost there</h2>
        <p>Check your email to confirm your account, then open this invite link again to join
        <strong>${esc(campaignName)}</strong>.</p>`);
    }).then(() => { const m = document.getElementById("a-msg"); if (m) m.textContent = ""; });
  };
}

// The critical path: redeem the token, remember the campaign so the
// switcher lands on it, and go make a character. "Already a member" is
// not an error — the DB returns { already:true } and we just go in.
async function proceed(displayName) {
  const res = await invites.redeem(token, displayName || null);
  const cid = res && res.campaign_id;
  if (cid) rememberCampaign(cid);
  location.href = "./characters.html";
}
