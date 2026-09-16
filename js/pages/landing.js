// 🏰 index.html — the PUBLIC landing page (the front door).
//
// Never gated: bootPublic() draws the public chrome and tells us whether
// someone is signed in, so the calls-to-action can point a visitor at the
// sign-in door and a member at their campaign. All the marketing copy is
// static and original; the only dynamic text is tier names/prices from
// CONFIG (escaped anyway, out of habit).
import { bootPublic, esc } from "../shell.js";
import { CONFIG } from "../config.js";

// The front door must render even if the database client can't load (CDN
// blocked, offline) — fall back to the signed-out view rather than a blank page.
let pub = { mode: "real", session: null, email: null };
try { pub = await bootPublic("index.html", "Home"); }
catch (e) { console.error(e); }

const main = document.getElementById("main");
const signedIn = !!pub.session;
const FREE = CONFIG.TIERS?.FREE || { name: "Adventurer", icon: "🗡️" };
const DM = CONFIG.TIERS?.DM || { name: "Dungeon Lord", icon: "🔥" };
const PRICE = CONFIG.PRICING || { DM_PRICE: "—", DM_PERIOD: "month" };

// Session-aware calls to action (same pair in the hero and the closing band).
const primary = signedIn
  ? { href: "./hub.html", label: "⚔ Open your campaign" }
  : { href: "./login.html", label: "⚔️ Enter the Dungeon" };
const secondary = signedIn
  ? { href: "./pricing.html", label: "See plans" }
  : { href: "./login.html#create", label: "Create a free account" };

const ctaPrimary = `<a class="btn btn-lg" href="${primary.href}">${esc(primary.label)}</a>`;
const ctaSecondary = `<a class="btn-ghost btn-lg" href="${secondary.href}">${esc(secondary.label)}</a>`;

// Decorative d20: a hexagon outline, the front face, and the nine edges between
// them — drawn with strokes so it takes the gold from CSS. Two dashed rune
// rings orbit it slowly.
const D20 = `
  <svg class="hero-d20" viewBox="-8 -8 116 116" aria-hidden="true" focusable="false">
    <circle class="ring2" cx="50" cy="50" r="56" />
    <circle class="ring" cx="50" cy="50" r="51" />
    <polygon class="shell" points="50,4 89.8,27 89.8,73 50,96 10.2,73 10.2,27" />
    <path d="M27.5,37 L10.2,27 M27.5,37 L50,4 M72.5,37 L50,4 M72.5,37 L89.8,27 M72.5,37 L89.8,73 M50,76 L89.8,73 M50,76 L50,96 M50,76 L10.2,73 M27.5,37 L10.2,73" />
    <polygon class="face" points="27.5,37 72.5,37 50,76" />
    <text x="50" y="53">20</text>
  </svg>`;

const FEATURES = [
  ["⚔️", "A living battle map", "One shared board the whole table watches move: tokens, initiative, conditions, and GPU-drawn spell effects for all 319 SRD spells."],
  ["🎲", "Dice the server rolls", "Every roll happens in the database, so nobody can fudge it, and the whole table sees it land live. Optional cinematic 3D dice always settle on the real result."],
  ["🧙", "A full character builder", "12 classes · 9 races · 319 spells, built on the SRD 5.1. Click-to-roll sheets, guided level-ups, rests, and a homebrew option in every picker."],
  ["📖", "AI that preps — and never plays for you", "One paragraph becomes a whole adventure with read-aloud text. Draft NPCs with secrets, monsters with stat blocks, and battle maps ready to stage."],
  ["🔒", "Guarded like a vault", "Every rule is enforced by the database, not the browser. A DM's secrets stay secret. Made by a security engineer who takes that personally."],
  ["🏰", "Run many tables", "Campaigns are walled off from each other. Invite by link, revoke in a click, and hop between tables from the header."],
  ["🎭", "Homebrew everything", "Monsters, spells and magic items of your own — then drop them straight into play on sheets and the battle map."],
  ["💬", "Discord in the loop", "Session reminders, recaps and natural 20s posted straight to your server, so the table stays hyped between games."],
];

const STEPS = [
  ["Create a free account", "An email and a password. No card, no invite code needed to walk in."],
  ["Join a table — or run one", `Open a friend's invite link and you're at their table. Or become a ${esc(DM.name)} and start your own.`],
  ["Play", "Forge a hero, take your seat at the battle map, and roll with the table."],
];

const FREE_PERKS = [
  "Create an account and build heroes",
  "Join tables by invite link",
  "Play on the live battle map",
  "Roll with the table — server-rolled dice",
  "Read the campaign hub, notes and codex",
];
const DM_PERKS = [
  `Everything in ${esc(FREE.name)}`,
  "Run your own campaigns and invite players",
  "Stage encounters and go live",
  "Homebrew editors: monsters, spells, items",
  "Discord in the loop",
  "Every AI dungeon-prep tool",
];

main.innerHTML = `
  <section class="hero">
    <div>
      <span class="land-eyebrow rise">A 5e-compatible virtual tabletop</span>
      <h1 class="rise">Run the game you've always wanted to run.</h1>
      <p class="sub rise">A living battle map, dice the server rolls, a full character builder,
        and AI that kills the prep — <em>not the magic.</em></p>
      <div class="cta rise">${ctaPrimary}${ctaSecondary}</div>
      <p class="trust rise"><b>Free to play.</b> Independent. Built on the SRD 5.1.</p>
    </div>
    <div class="hero-art rise">${D20}</div>
  </section>

  <section class="land-sec" id="why">
    <h2 class="section">Why ${esc(CONFIG.APP_NAME)}</h2>
    <p class="lead">Everything a table needs to play, in one place — and nothing that plays for you.</p>
    <div class="grid feat-grid">
      ${FEATURES.map(([glyph, title, body]) => `
        <div class="card">
          <div class="feat-glyph" aria-hidden="true">${glyph}</div>
          <h3 class="feat-title">${esc(title)}</h3>
          <p>${esc(body)}</p>
        </div>`).join("")}
    </div>
  </section>

  <section class="land-sec" id="how">
    <h2 class="section">How it works</h2>
    <p class="lead">Three steps from the front door to the first initiative roll.</p>
    <div class="steps">
      ${STEPS.map(([title, body], i) => `
        <div class="card step">
          <div class="step-num" aria-hidden="true">${i + 1}</div>
          <h3>${esc(title)}</h3>
          <p>${body}</p>
        </div>`).join("")}
    </div>
  </section>

  <section class="land-sec" id="story">
    <h2 class="section">Forged after hours</h2>
    <div class="card founder">
      <p class="quote">Built for one table of friends. Kept for everyone who asked to pull up a chair.</p>
      <p>${esc(CONFIG.APP_NAME)}'s maker is a cybersecurity engineer who loves D&amp;D — and plays it
        religiously, a few times a week, whenever work lets go. They were tired of the virtual
        tabletops out there: clunky to run, pricey to keep, and locked down exactly where a table
        wants to tinker. So they built something for their own friend group.</p>
      <p>Then the other DMs in the group wanted in. Then <em>their</em> friends did. It grew into
        what is now ${esc(CONFIG.APP_NAME)}.</p>
      <p>The day job shows: its maker cares as much about your table's data being guarded as about
        your fireballs looking right. Every permission is enforced in the database, not the browser,
        and what a DM keeps behind the screen stays behind the screen.</p>
      <p class="sig">— still forged after hours, still played a few nights a week.</p>
    </div>
  </section>

  <section class="land-sec" id="paths">
    <h2 class="section">Pick your path</h2>
    <p class="lead">Play for free. Run the table for the price of a dice set.</p>
    <div class="grid tiers">
      <div class="card tier">
        <p class="tier-eyebrow">Joins the table</p>
        <h3>${esc(FREE.icon)} ${esc(FREE.name)}</h3>
        <p class="price">Free</p>
        <p class="blurb">For every player at every table.</p>
        <ul>${FREE_PERKS.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        <div class="actions"><a class="btn-ghost" href="./pricing.html">See plans</a></div>
      </div>
      <div class="card tier hi">
        <p class="tier-eyebrow">Runs the table</p>
        <h3>${esc(DM.icon)} ${esc(DM.name)}</h3>
        <p class="price">${esc(PRICE.DM_PRICE)} <small>/ ${esc(PRICE.DM_PERIOD)}</small></p>
        <p class="blurb">For the one holding the map.</p>
        <ul>${DM_PERKS.map((p) => `<li>${p}</li>`).join("")}</ul>
        <div class="actions"><a class="btn" href="./pricing.html">See plans</a></div>
      </div>
    </div>
  </section>

  <section class="cta-band">
    <h2>The table is set. The dice are waiting.</h2>
    <p>${signedIn ? "Your campaign is right where you left it." : "Create a free account in under a minute — no card, no invite code."}</p>
    ${ctaPrimary}
  </section>
  <p class="srd-line">Built on the System Reference Document 5.1 (CC BY 4.0) —
    see <a href="./licenses.html">Licenses &amp; Attribution</a>.</p>`;
