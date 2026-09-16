// 💎 Pricing — the public plans page: what an Adventurer gets for free,
// what a Dungeon Lord unlocks, and the one button that starts a
// subscription. bootPublic() never gates, so the copy is the same for
// everyone; only the calls-to-action change with who's looking:
//   signed out             → create a free account / sign in to upgrade
//   signed in, free tier   → Become a <DM tier>  (→ Stripe Checkout)
//   signed in, DM tier     → Manage subscription (→ Stripe Customer Portal),
//                            or "lifetime access" for owner/manual grants
//   billing not set up     → "Coming soon" (migration, function or Stripe
//                            secrets missing, or demo mode) — never a
//                            broken button.
// Tier names + the price come from CONFIG; Stripe is the source of truth.
import { bootPublic, esc, guard, toast } from "../shell.js";
import { CONFIG } from "../config.js";
import { billing } from "../db.js";

const FREE = CONFIG.TIERS?.FREE || { name: "Adventurer", icon: "🗡️" };
const DM = CONFIG.TIERS?.DM || { name: "Dungeon Lord", icon: "🔥" };
const PRICE = CONFIG.PRICING || { DM_PRICE: "—", DM_PERIOD: "month" };
const NOT_SET_UP = "Billing isn't set up yet — see docs/BILLING.md";

const pub = await bootPublic("pricing.html", "Pricing");
main();

async function main() {
  const root = document.getElementById("main");
  const signedIn = !!pub.session;
  const demo = pub.mode === "demo";
  // only ever compare the query param — never render it
  const checkout = new URLSearchParams(location.search).get("checkout");

  // The database's word on this account. null ⇒ billing isn't set up
  // (migration missing, or demo) ⇒ every upgrade button is "Coming soon".
  const st = signedIn ? (await guard(() => billing.status())) ?? null : null;

  const freeFeats = [
    "Create an account — no card needed",
    "Build unlimited heroes with the full SRD 5.1 builder — 12 classes, 9 races, 319 spells",
    "Join any table by invite link",
    "Play on the live battle map — move your hero, roll initiative, cast animated spells",
    "Dice rolled by the server, seen by the whole table",
    "Read the campaign hub, quests, notes, codex, spellbook, armory and bestiary",
    "Your own profile and avatar",
  ];
  const dmFeats = [
    "Create and run unlimited campaigns",
    "Invite players by link or email — revoke in a click",
    "Upload battle maps (revealed only when you say so), stage encounters, go live",
    "Smart combat assist",
    "Homebrew editors — bestiary, spellbook, armory, and an NPC workshop with private secrets",
    "Discord posting — session reminders, recaps and announcements to your channel",
    "The AI dungeon-prep suite: Create-Adventure, NPC generator, monster generator, AI battle maps & portraits — with a predictable monthly allowance (failed drafts never count)",
  ];
  const list = (items) => `<ul class="feats">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

  root.innerHTML = `
    ${checkoutNote(checkout)}
    <div class="price-head">
      <h2>Play for free. Pay only to run the table.</h2>
      <p>Every hero at the table plays for free — only the one running it needs a subscription.</p>
    </div>

    <div class="grid tiers">
      <div class="card tier">
        <h3>${esc(FREE.icon)} ${esc(FREE.name)}</h3>
        <div class="tier-price">Free <small>forever</small></div>
        <p class="tier-lead">For everyone who sits down to play.</p>
        ${list(freeFeats)}
        <div class="tier-cta" id="free-cta"></div>
      </div>

      <div class="card tier hi">
        <span class="tier-eyebrow">Runs the table</span>
        <h3>${esc(DM.icon)} ${esc(DM.name)}</h3>
        <div class="tier-price">${esc(PRICE.DM_PRICE)} <small>/ ${esc(PRICE.DM_PERIOD)}</small></div>
        <p class="tier-lead">Everything in ${esc(FREE.name)}, plus:</p>
        ${list(dmFeats)}
        <div class="tier-cta" id="dm-cta"></div>
      </div>
    </div>
    <p class="price-foot">Cancel any time from your profile. Payments are handled by Stripe.</p>

    <div class="card faq">
      <h3 class="section">Questions, traveler?</h3>
      <details class="fold">
        <summary>Do my players have to pay?</summary>
        <p>No. Players are ${esc(FREE.name)}s and play for free — heroes, dice, the battle map, all of it.
        Only whoever runs the table needs to be a ${esc(DM.name)}.</p>
      </details>
      <details class="fold">
        <summary>What happens if I cancel?</summary>
        <p>You keep playing as an ${esc(FREE.name)}. Campaigns you created remain and you stay their DM
        inside them, but you can't create new ones until you resubscribe.</p>
      </details>
      <details class="fold">
        <summary>Is my data safe?</summary>
        <p>The rules are enforced by the database itself, not just by the page you see: each campaign is
        walled off from every other, and DM secrets — hidden maps, private NPC notes — never reach a
        player's browser. Payments go through Stripe Checkout, so your card details never touch
        ${esc(CONFIG.APP_NAME)}.</p>
      </details>
      <details class="fold">
        <summary>Is this affiliated with Wizards of the Coast?</summary>
        <p>No. ${esc(CONFIG.APP_NAME)} is an independent project. The game rules it uses come from the
        System Reference Document 5.1, used under the Creative Commons Attribution 4.0 license —
        see <a href="./licenses.html">Licenses &amp; Attribution</a>.</p>
      </details>
    </div>`;

  renderFreeCta(root.querySelector("#free-cta"));
  renderDmCta(root.querySelector("#dm-cta"));

  /* ── the Adventurer card's button ── */
  function renderFreeCta(slot) {
    slot.innerHTML = signedIn
      ? `<span class="pill moss">✓ You're in</span>`
      : `<a class="btn btn-lg" href="./login.html#create">Create a free account</a>`;
  }

  /* ── the Dungeon Lord card's button (the one that matters) ── */
  function renderDmCta(slot) {
    if (!signedIn) {
      slot.innerHTML = `
        <a class="btn btn-lg" href="./login.html?next=pricing.html">Sign in to upgrade</a>
        <a class="tier-alt" href="./login.html#create">or create a free account first</a>`;
      return;
    }
    if (demo) { comingSoon(slot, "Demo mode can't bill — connect your database (README, step 2) to switch subscriptions on."); return; }
    if (!st) { comingSoon(slot, "Subscriptions aren't switched on yet."); return; }

    if (st.tier === "dm") {
      slot.innerHTML = `<span class="pill gold">✓ You're a ${esc(DM.name)}</span>`;
      if (st.subscription?.has_customer) {
        const b = document.createElement("button");
        b.className = "btn-ghost";
        b.textContent = "Manage subscription";
        b.onclick = () => guard(async () => {
          b.disabled = true;
          try { location.href = await billing.portal(); }
          catch (e) { b.disabled = false; if (e.code === "not-configured") { toast(NOT_SET_UP); return; } throw e; }
        });
        slot.appendChild(b);
      } else {
        slot.insertAdjacentHTML("beforeend", `<p class="muted small tier-note">Lifetime access — nothing to manage.</p>`);
      }
      return;
    }

    // Just back from a successful checkout but the webhook hasn't flipped
    // the tier yet: don't offer a second checkout, offer a refresh.
    if (checkout === "success") {
      slot.innerHTML = `
        <span class="pill gold">⏳ Activating…</span>
        <button class="btn-ghost" id="dm-refresh">Refresh</button>
        <p class="muted small tier-note">Stripe is confirming your payment — this usually takes a few seconds.</p>`;
      slot.querySelector("#dm-refresh").onclick = () => location.reload();
      return;
    }

    // free tier → start a subscription
    const label = `${DM.icon} Become a ${DM.name}`;
    slot.innerHTML = `<button class="btn btn-lg" id="dm-go">${esc(label)}</button>`;
    const go = slot.querySelector("#dm-go");
    go.onclick = () => guard(async () => {
      go.disabled = true;
      go.textContent = "Opening checkout…";
      try {
        location.href = await billing.checkout();
      } catch (e) {
        if (e.code === "not-configured") { toast(NOT_SET_UP); comingSoon(slot, "Subscriptions aren't switched on yet."); return; }
        go.disabled = false;
        go.textContent = label;
        if (e.code === "already-subscribed") { toast("You already have a subscription — manage it from your profile."); return; }
        throw e;   // guard → "⚠ <message>"
      }
    });
  }

  // A disabled "Coming soon" in place of the upgrade button, plus why.
  function comingSoon(slot, why) {
    slot.innerHTML = `
      <button class="btn btn-lg" disabled>Coming soon</button>
      <p class="muted small tier-note">${esc(why)}</p>`;
  }
}

// The card shown above the plans when Stripe sends the person back.
function checkoutNote(checkout) {
  if (checkout === "success") {
    return `
      <div class="card price-note success">
        <p>🎉 <strong>Welcome, ${esc(DM.name)}!</strong> Your subscription is active — it can take a few
        seconds to unlock, so if a door still looks shut, give it a moment and refresh.</p>
        <a class="btn" href="./hub.html">⚔ Open your campaign</a>
      </div>`;
  }
  if (checkout === "cancelled") {
    return `
      <div class="card price-note">
        <p class="muted" style="margin:0">Checkout was cancelled — no charge was made. The plans below will be here
        whenever you're ready.</p>
      </div>`;
  }
  return "";
}
