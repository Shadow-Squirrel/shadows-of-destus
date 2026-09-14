// reset.js — the PUBLIC "set a new password" page. Like join.html it does
// NOT call boot(): the visitor arrives here from the emailed reset link while
// signed OUT. supabase-js parses the recovery token out of the URL when the
// client is created, establishes a short recovery session, and fires
// onAuthStateChange with event === 'PASSWORD_RECOVERY'. We listen for that
// (and also check for an already-present session, in case the event fired
// before we attached, or the page was refreshed) and show the form. With no
// valid recovery token/session we show a friendly "link expired" dead-end.
//
// The database / Supabase Auth is the security: completeReset() just calls
// sb.auth.updateUser({ password }) on the recovery session.
import { CONFIG } from "../config.js";
import { initDb, isReal, profile } from "../db.js";
import { esc, toast, guard } from "../shell.js";

const main = document.getElementById("main");

renderChrome();
run();

function renderChrome() {
  const header = document.getElementById("site-header");
  if (header) header.innerHTML = `<div class="masthead"><h1>${esc(CONFIG.APP_NAME)}</h1></div>`;
  const y = document.getElementById("foot-year");
  if (y) y.textContent = new Date().getFullYear();
}

function card(html) { main.innerHTML = `<div class="card gate">${html}</div>`; }

async function run() {
  card(`<h2>${esc(CONFIG.APP_NAME)}</h2><p class="muted small">Checking your reset link…</p>`);

  await initDb();

  let done = false;
  const showForm = () => { if (!done) { done = true; renderForm(); } };

  if (isReal()) {
    // Fires when supabase-js detects & consumes the recovery token in the URL.
    profile.onPasswordRecovery(() => showForm());
    // The recovery session may already be live (event fired before this
    // listener attached, or the page was refreshed after landing).
    if (await profile.hasSession()) { showForm(); return; }
    // Give supabase a moment to parse the URL, then conclude it's invalid.
    setTimeout(async () => {
      if (done) return;
      if (await profile.hasSession()) showForm();
      else renderInvalid();
    }, 1500);
  } else {
    // Demo smoke-test: a real recovery link carries `type=recovery` in the
    // URL, so mirror that to preview the "set new password" screen; anything
    // else previews the "invalid link" screen.
    if (/type=recovery/.test(location.hash + location.search)) showForm();
    else renderInvalid();
  }
}

// No valid recovery token/session — the link is bad, already used, or expired.
function renderInvalid() {
  card(`
    <h2>Reset link invalid</h2>
    <p class="muted small">This reset link is invalid or has expired — request a new one from the login page.</p>
    <div class="actions"><a class="btn" href="./index.html">Back to sign in</a></div>`);
}

// A valid recovery session is active — let them set a new password.
function renderForm() {
  card(`
    <h2>Set a new password</h2>
    <p class="muted small">Choose a new password for your account. You'll be signed in with it right away.</p>
    <form id="reset-form">
      <label class="field" for="r-new">New password</label>
      <input type="password" id="r-new" required minlength="8" autocomplete="new-password" />
      <label class="field" for="r-new2">Confirm new password</label>
      <input type="password" id="r-new2" required minlength="8" autocomplete="new-password" />
      <div class="actions">
        <button class="btn" type="submit" id="r-go">Update password</button>
        <span class="muted small" id="r-msg"></span>
      </div>
    </form>`);

  document.getElementById("reset-form").onsubmit = (e) => {
    e.preventDefault();
    const nw = document.getElementById("r-new").value;
    const nw2 = document.getElementById("r-new2").value;
    const msg = document.getElementById("r-msg");
    if (nw.length < 8) { toast("⚠ Password must be at least 8 characters."); return; }
    if (nw !== nw2) { toast("⚠ Passwords don't match."); return; }
    msg.textContent = "Updating…";
    guard(async () => {
      await profile.completeReset(nw);
      renderDone();
    }).then(() => { const m = document.getElementById("r-msg"); if (m) m.textContent = ""; });
  };
}

function renderDone() {
  card(`
    <h2>Password updated</h2>
    <p class="muted small">Your password has been changed and you're signed in. Head to
    ${esc(CONFIG.APP_NAME)} to continue.</p>
    <div class="actions"><a class="btn" href="./index.html">Enter ${esc(CONFIG.APP_NAME)}</a></div>`);
  setTimeout(() => { location.href = "./index.html"; }, 2500);
}
