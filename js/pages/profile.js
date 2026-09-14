// profile.js — a signed-in page: your avatar, display name + contact,
// email (read-only login identity), password change, and a billing
// placeholder. boot() draws the shared chrome and enforces the gate; if it
// returns null it already handled that (gate / pending / no-campaign), so we
// only build the page when it hands us a ctx.
//
// The DATABASE is the security here — RLS lets you read/write only your own
// profile, save_profile upserts just your row, and Supabase Auth owns the
// password. This file is only the browser wiring around profile.* in db.js.
import { boot, esc, guard, toast } from "../shell.js";
import { profile } from "../db.js";

const MAX_AVATAR = 5 * 1024 * 1024; // 5 MB — matches the bucket's limit

const ctx = await boot("profile.html", "Profile");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");

  // Load the current profile up front. A missing row (never saved) or a
  // pre-migration database both just mean "nothing to prefill".
  let me = null;
  try { me = await profile.mine(); } catch (e) { console.error(e); }
  const contact = (me && me.contact) || {};

  root.innerHTML = `
    <h2 class="section" style="margin-bottom:6px">Your profile</h2>
    <p class="muted small" style="margin-top:0">Your name and avatar are what the rest of the party sees.
    Everything else is private to you.</p>

    <div class="card">
      <h3 class="section">Avatar</h3>
      <div class="pf-avatar-row">
        <div id="pf-avatar-slot"></div>
        <div class="grow">
          <label class="field" for="pf-file">Upload a new avatar</label>
          <input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp,image/gif" />
          <p class="muted small">JPG, PNG, WebP or GIF · up to 5&nbsp;MB.</p>
          <div class="actions">
            <button class="btn" id="pf-avatar-save" disabled>Save avatar</button>
            <span class="muted small" id="pf-avatar-msg"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="section">Name &amp; contact</h3>
      <label class="field" for="pf-name">Display name</label>
      <input type="text" id="pf-name" placeholder="Name shown on notes, rolls &amp; the party" autocomplete="nickname" />
      <label class="field" for="pf-discord">Discord handle</label>
      <input type="text" id="pf-discord" placeholder="e.g. tavrogue" />
      <label class="field" for="pf-tz">Timezone</label>
      <input type="text" id="pf-tz" placeholder="e.g. America/New_York or UTC-5" />
      <label class="field" for="pf-pronouns">Pronouns</label>
      <input type="text" id="pf-pronouns" placeholder="e.g. she/her" />
      <div class="actions">
        <button class="btn" id="pf-save">Save profile</button>
        <span class="muted small" id="pf-save-msg"></span>
      </div>
    </div>

    <div class="card">
      <h3 class="section">Email &amp; sign-in</h3>
      <label class="field" for="pf-email">Your email (your login)</label>
      <input type="email" id="pf-email" value="${esc(ctx.me.email)}" readonly />
      <p class="muted small">Your email is your login identity — there's no separate username.</p>
      <details class="fold">
        <summary>Change email address</summary>
        <p class="muted small">Changing your email is a separate, confirmed step. We'll send a link to the
        new address; the change only takes effect once you click it.</p>
        <label class="field" for="pf-newemail">New email</label>
        <input type="email" id="pf-newemail" autocomplete="email" />
        <div class="actions">
          <button class="btn-ghost" id="pf-email-go">Send confirmation</button>
          <span class="muted small" id="pf-email-msg"></span>
        </div>
      </details>
    </div>

    <div class="card">
      <h3 class="section">Change password</h3>
      <label class="field" for="pf-cur">Current password</label>
      <input type="password" id="pf-cur" autocomplete="current-password" />
      <label class="field" for="pf-new">New password</label>
      <input type="password" id="pf-new" autocomplete="new-password" minlength="8" />
      <label class="field" for="pf-new2">Confirm new password</label>
      <input type="password" id="pf-new2" autocomplete="new-password" minlength="8" />
      <p class="muted small">At least 8 characters. We'll ask for your current password to confirm it's you.</p>
      <div class="actions">
        <button class="btn" id="pf-pw-go">Update password</button>
        <span class="muted small" id="pf-pw-msg"></span>
      </div>
    </div>

    <div class="card">
      <h3 class="section">Billing &amp; subscription</h3>
      <p class="muted">Coming soon — subscriptions and payments will be managed securely through Stripe.</p>
      <div class="actions"><button class="btn" disabled>Manage subscription</button></div>
    </div>`;

  /* ── avatar ── */
  const avatarSlot = root.querySelector("#pf-avatar-slot");
  const initial = (me?.display_name || ctx.me.name || ctx.me.email || "?").trim().charAt(0).toUpperCase() || "?";
  const showAvatar = (url) => {
    if (url) {
      avatarSlot.innerHTML = `<img class="pf-avatar" alt="Your avatar" src="${esc(url)}" />`;
    } else {
      avatarSlot.innerHTML = `<div class="pf-avatar pf-avatar-ph" aria-hidden="true">${esc(initial)}</div>`;
    }
  };
  showAvatar(me && me.avatar_path ? profile.avatarUrl(me.avatar_path) : null);

  const fileIn = root.querySelector("#pf-file");
  const saveAvatarBtn = root.querySelector("#pf-avatar-save");
  const avatarMsg = root.querySelector("#pf-avatar-msg");
  let pending = null;      // the File the user picked
  let previewUrl = null;   // object URL for the preview (revoked on replace)

  fileIn.onchange = () => {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    pending = fileIn.files && fileIn.files[0];
    avatarMsg.textContent = "";
    if (!pending) { saveAvatarBtn.disabled = true; return; }
    if (!/^image\//.test(pending.type)) { toast("⚠ Please choose an image file."); fileIn.value = ""; pending = null; saveAvatarBtn.disabled = true; return; }
    if (pending.size > MAX_AVATAR) { toast("⚠ That image is over 5 MB — pick a smaller one."); fileIn.value = ""; pending = null; saveAvatarBtn.disabled = true; return; }
    previewUrl = URL.createObjectURL(pending);
    showAvatar(previewUrl);
    saveAvatarBtn.disabled = false;
  };

  saveAvatarBtn.onclick = () => guard(async () => {
    if (!pending) return;
    saveAvatarBtn.disabled = true;
    avatarMsg.textContent = "Uploading…";
    const url = await profile.uploadAvatar(pending);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    showAvatar(url);
    pending = null;
    fileIn.value = "";
    avatarMsg.textContent = "";
    toast("Avatar updated.");
  }).then(() => { if (pending) saveAvatarBtn.disabled = false; });

  /* ── name + contact ── */
  root.querySelector("#pf-name").value = me?.display_name || "";
  root.querySelector("#pf-discord").value = contact.discord || "";
  root.querySelector("#pf-tz").value = contact.timezone || "";
  root.querySelector("#pf-pronouns").value = contact.pronouns || "";

  root.querySelector("#pf-save").onclick = () => guard(async () => {
    const msg = root.querySelector("#pf-save-msg");
    msg.textContent = "Saving…";
    const displayName = root.querySelector("#pf-name").value.trim();
    const nextContact = {
      discord: root.querySelector("#pf-discord").value.trim(),
      timezone: root.querySelector("#pf-tz").value.trim(),
      pronouns: root.querySelector("#pf-pronouns").value.trim(),
    };
    me = await profile.save({ displayName, contact: nextContact });
    msg.textContent = "";
    toast("Profile saved.");
  }).then(() => { const m = root.querySelector("#pf-save-msg"); if (m) m.textContent = ""; });

  /* ── change email (optional, separate) ── */
  root.querySelector("#pf-email-go").onclick = () => guard(async () => {
    const msg = root.querySelector("#pf-email-msg");
    const next = root.querySelector("#pf-newemail").value.trim();
    if (!next || !/.+@.+\..+/.test(next)) { toast("⚠ Enter a valid email address."); return; }
    if (next.toLowerCase() === ctx.me.email) { toast("That's already your email."); return; }
    msg.textContent = "Sending…";
    await profile.changeEmail(next);
    msg.textContent = "";
    toast("Check your new email to confirm the change.");
  }).then(() => { const m = root.querySelector("#pf-email-msg"); if (m) m.textContent = ""; });

  /* ── change password (re-auth happens in db.js) ── */
  root.querySelector("#pf-pw-go").onclick = () => guard(async () => {
    const cur = root.querySelector("#pf-cur").value;
    const nw = root.querySelector("#pf-new").value;
    const nw2 = root.querySelector("#pf-new2").value;
    const msg = root.querySelector("#pf-pw-msg");
    if (!cur) { toast("⚠ Enter your current password."); return; }
    if (nw.length < 8) { toast("⚠ New password must be at least 8 characters."); return; }
    if (nw !== nw2) { toast("⚠ New passwords don't match."); return; }
    msg.textContent = "Updating…";
    await profile.changePassword(cur, nw);
    root.querySelector("#pf-cur").value = "";
    root.querySelector("#pf-new").value = "";
    root.querySelector("#pf-new2").value = "";
    msg.textContent = "";
    toast("Password updated.");
  }).then(() => { const m = root.querySelector("#pf-pw-msg"); if (m) m.textContent = ""; });
}
