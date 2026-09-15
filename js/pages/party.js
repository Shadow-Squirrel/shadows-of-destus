// Party — the roster. Character sheets stay on D&D Beyond
// (there's no official public API, and embedding is blocked),
// so each card links straight to the sheet. This page is also
// where the DM manages the invite list.
import { boot, esc, guard, toast } from "../shell.js";
import { party, members, discord, getCampaign, isReal } from "../db.js";

const WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//i;
const postError = (msg) => ({
  "not-connected": "Connect Discord first.",
  "not-deployed": "The discord-post function isn't deployed yet — see docs/DISCORD.md.",
  "webhook-invalid": "Discord rejected the webhook — it may have been deleted. Reconnect with a new URL.",
}[msg] || msg || "Discord post failed");

const ctx = await boot("party.html", "Party");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  await render();

  async function render() {
    const chars = await party.list();
    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">The Party</h2>
        ${ctx.me.isDM ? '<button class="btn" id="new-c">+ Add character</button>' : ""}
      </div>
      <p class="muted small" style="margin-top:-6px">Sheets and stats live on <strong>D&D Beyond</strong> — each card links straight to one.
      (Tip: on D&D Beyond, set the character's privacy to <em>Public</em> so the whole table can open it.)</p>
      <div id="new-slot"></div>
      <div class="grid" id="grid"></div>
      ${ctx.me.isDM ? `<div id="roster-slot" style="margin-top:26px"></div>
        <div id="discord-slot" style="margin-top:18px"></div>` : ""}`;

    const grid = root.querySelector("#grid");
    if (!chars.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No heroes enlisted yet.</div>`;
    chars.forEach((c) => grid.appendChild(charCard(c)));

    const nb = root.querySelector("#new-c");
    if (nb) nb.onclick = () => { root.querySelector("#new-slot").replaceChildren(charForm()); nb.disabled = true; };

    if (ctx.me.isDM) { renderRoster(); renderDiscord(); }
  }

  function charCard(c) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <strong style="font-size:19px">${esc(c.character_name)}</strong>
        ${c.class_text ? `<span class="pill gold">${esc(c.class_text)}</span>` : ""}
      </div>
      ${c.player_name ? `<p class="muted small" style="margin:4px 0 0">played by ${esc(c.player_name)}</p>` : ""}
      ${c.blurb ? `<p style="margin:10px 0 0">${esc(c.blurb)}</p>` : ""}
      <div class="actions">
        ${c.ddb_url ? `<a class="btn" style="text-decoration:none" href="${esc(c.ddb_url)}" target="_blank" rel="noopener">Open sheet ↗</a>` : `<span class="muted small">No sheet linked yet</span>`}
        ${ctx.me.isDM ? `<button class="btn-danger b-del">Remove</button>` : ""}
      </div>`;
    const del = card.querySelector(".b-del");
    if (del) del.onclick = () => {
      if (!confirm(`Remove ${c.character_name} from the roster?`)) return;
      guard(async () => { await party.remove(c.id); render(); });
    };
    return card;
  }

  function charForm() {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <form>
        <div class="row">
          <div class="grow"><label class="field">Character name</label><input type="text" name="character_name" required /></div>
          <div class="grow"><label class="field">Player</label><input type="text" name="player_name" /></div>
          <div class="grow"><label class="field">Class & level</label><input type="text" name="class_text" placeholder="Half-orc Barbarian 4" /></div>
        </div>
        <label class="field">D&D Beyond sheet link</label>
        <input type="text" name="ddb_url" placeholder="https://www.dndbeyond.com/characters/12345678" />
        <label class="field">One-line legend</label>
        <input type="text" name="blurb" placeholder="Has never met a lock she respected." />
        <div class="actions">
          <button class="btn" type="submit">Enlist</button>
          <button class="btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    card.querySelector("[data-cancel]").onclick = () => render();
    card.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      guard(async () => {
        await party.add({ character_name: f.get("character_name"), player_name: f.get("player_name"), class_text: f.get("class_text"), ddb_url: f.get("ddb_url"), blurb: f.get("blurb") });
        toast("Welcomed to the party");
        render();
      });
    };
    return card;
  }

  /* ── DM only: the invite list ── */
  async function renderRoster() {
    const slot = root.querySelector("#roster-slot");
    const list = await members.list();
    slot.innerHTML = `
      <div class="card">
        <h3 class="section">🗝️ Invite players <span class="pill gold">DM only</span></h3>
        <p class="muted small">Add a player's email here, then have them visit the site and
        <strong>Create account</strong> with that exact email. Until an email is on this list,
        an account for it sees nothing at all.</p>
        <div id="m-list"></div>
        <form class="row" style="margin-top:12px">
          <input type="email" class="grow" name="email" placeholder="player@email.com" required />
          <input type="text" class="grow" name="display_name" placeholder="Name shown on notes" required />
          <select name="role" style="width:auto"><option value="player">player</option><option value="dm">dm</option></select>
          <button class="btn">Invite</button>
        </form>
      </div>`;
    const mList = slot.querySelector("#m-list");
    list.forEach((m) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.cssText = "justify-content:space-between; border-top:1px solid var(--border-soft); padding:8px 0";
      const isSelf = m.email.toLowerCase() === ctx.me.email;
      row.innerHTML = `
        <span><strong>${esc(m.display_name || "—")}</strong> <span class="muted small">${esc(m.email)}</span></span>
        <span class="row">
          <span class="pill ${m.role === "dm" ? "gold" : "steel"}">${esc(m.role)}</span>
          ${isSelf ? "" : `<button class="btn-danger b-del">Remove</button>`}
        </span>`;
      const del = row.querySelector(".b-del");
      if (del) del.onclick = () => {
        if (!confirm(`Remove ${m.email} from the party? They'll lose access immediately.`)) return;
        guard(async () => { await members.remove(m.id); render(); });
      };
      mList.appendChild(row);
    });
    slot.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      guard(async () => {
        await members.add(f.get("email"), f.get("display_name"), f.get("role"));
        toast("Invited — tell them to create their account");
        render();
      });
    };
  }

  /* ── DM only: connect Discord (webhook) ── */
  async function renderDiscord() {
    const slot = root.querySelector("#discord-slot");
    if (!slot) return;
    if (!isReal()) {
      slot.innerHTML = `<div class="card"><h3 class="section">🔗 Discord <span class="pill gold">DM only</span></h3>
        <p class="muted small">Connecting Discord needs the live database — not available in demo mode.</p></div>`;
      return;
    }
    let cfg = null;
    try { cfg = await discord.get(getCampaign()); } catch { cfg = null; }
    cfg ? renderConnected(slot, cfg) : renderConnect(slot);
  }

  // Not connected yet: paste a channel webhook URL.
  function renderConnect(slot) {
    slot.innerHTML = `
      <div class="card">
        <h3 class="section">🔗 Connect Discord <span class="pill gold">DM only</span></h3>
        <p class="muted small" style="margin-top:-2px">Let Onyx post game reminders, session recaps, announcements and (optionally) dice
          results to your table's Discord channel. It only ever <strong>posts</strong> — no bot, no login.</p>
        <details style="margin:6px 0 10px">
          <summary class="muted small" style="cursor:pointer">How do I get a webhook URL?</summary>
          <ol class="muted small" style="margin:6px 0 0; padding-left:18px">
            <li>In Discord: <strong>Server Settings → Integrations → Webhooks → New Webhook</strong>.</li>
            <li>Pick the channel it should post to, then <strong>Copy Webhook URL</strong>.</li>
            <li>Paste it below. (Keep it private — anyone with it can post to that channel.)</li>
          </ol>
        </details>
        <form class="row" style="gap:8px; flex-wrap:wrap">
          <input type="url" class="grow" name="url" placeholder="https://discord.com/api/webhooks/…" required style="min-width:240px" />
          <button class="btn">Connect &amp; send a test</button>
        </form>
        <p class="muted small" id="dc-msg" style="margin:8px 0 0"></p>
      </div>`;
    slot.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const url = new FormData(e.target).get("url").trim();
      const msg = slot.querySelector("#dc-msg");
      if (!WEBHOOK_RE.test(url)) { msg.textContent = "⚠ That doesn't look like a Discord webhook URL."; return; }
      const btn = slot.querySelector("button");
      btn.disabled = true; msg.textContent = "Connecting and sending a test message…";
      guard(async () => {
        try {
          await discord.save(getCampaign(), { webhook_url: url, enabled: true, dice_mode: "off" });
          await discord.post({ type: "test" });
          toast("Discord connected — check your channel for the test message");
          renderDiscord();
        } catch (err) {
          btn.disabled = false;
          msg.textContent = "⚠ " + postError(err.message);
        }
      });
    };
  }

  // Connected: status + dice mode + the three post composers.
  function renderConnected(slot, cfg) {
    const modeOpt = (v, label) => `<option value="${v}" ${cfg.dice_mode === v ? "selected" : ""}>${label}</option>`;
    slot.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center">
          <h3 class="section" style="margin:0">🔗 Discord <span class="pill ${cfg.enabled ? "moss" : "steel"}">${cfg.enabled ? "connected" : "paused"}</span></h3>
          <span class="row" style="gap:6px">
            <button class="btn-ghost" id="dc-test">Send test</button>
            <button class="btn-danger" id="dc-disc">Disconnect</button>
          </span>
        </div>
        <div class="row" style="gap:14px; align-items:center; margin-top:8px; flex-wrap:wrap">
          <label class="checkline" style="margin:0"><input type="checkbox" id="dc-enabled" ${cfg.enabled ? "checked" : ""} /> Posting on</label>
          <label class="field" style="margin:0">Auto-post dice
            <select id="dc-dice" style="width:auto; margin-left:6px">
              ${modeOpt("off", "Off")}${modeOpt("crits", "Crits & fumbles only")}${modeOpt("all", "Every roll (chatty)")}
            </select>
          </label>
        </div>

        <div style="margin-top:14px; display:grid; gap:12px">
          <div>
            <label class="field">⚔ Game reminder</label>
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <input type="text" id="rem-title" class="grow" placeholder="Curse of the Crimson King — tonight 7:00 PM" style="min-width:220px" />
            </div>
            <textarea id="rem-msg" style="min-height:44px; margin-top:6px" placeholder="Bring your sheets. We pick up at the sunken gate."></textarea>
            <div class="actions"><button class="btn" data-post="reminder">Post reminder</button></div>
          </div>
          <div>
            <label class="field">📖 Session recap</label>
            <input type="text" id="rec-title" placeholder="Session 14 — The Sunken Gate" />
            <textarea id="rec-msg" style="min-height:60px; margin-top:6px" placeholder="What happened, cliffhangers, XP…"></textarea>
            <div class="actions"><button class="btn" data-post="recap">Post recap</button></div>
          </div>
          <div>
            <label class="field">📣 Announcement</label>
            <textarea id="ann-msg" style="min-height:44px" placeholder="Any message to drop in the channel…"></textarea>
            <div class="actions"><button class="btn" data-post="announce">Post announcement</button></div>
          </div>
        </div>
        <p class="muted small" id="dc-msg" style="margin:10px 0 0"></p>
      </div>`;

    const msg = (s) => { slot.querySelector("#dc-msg").textContent = s || ""; };
    const settings = () => ({ webhook_url: null, enabled: slot.querySelector("#dc-enabled").checked, dice_mode: slot.querySelector("#dc-dice").value });

    // toggling posting / dice mode saves immediately (keep the stored URL)
    const saveSettings = () => guard(async () => {
      try {
        const s = settings();
        // re-fetch the URL isn't exposed here; upsert needs it, so read it back first
        const cur = await discord.get(getCampaign());
        await discord.save(getCampaign(), { webhook_url: cur.webhook_url, enabled: s.enabled, dice_mode: s.dice_mode });
        msg("Saved.");
      } catch (e) { msg("⚠ " + postError(e.message)); }
    });
    slot.querySelector("#dc-enabled").onchange = saveSettings;
    slot.querySelector("#dc-dice").onchange = saveSettings;

    slot.querySelector("#dc-test").onclick = () => guard(async () => {
      try { await discord.post({ type: "test" }); toast("Test sent — check your channel"); }
      catch (e) { msg("⚠ " + postError(e.message)); }
    });

    slot.querySelector("#dc-disc").onclick = () => {
      if (!confirm("Disconnect Discord from this campaign? Onyx will stop posting. (Your Discord channel is untouched.)")) return;
      guard(async () => { await discord.disconnect(getCampaign()); toast("Discord disconnected"); renderDiscord(); });
    };

    slot.querySelectorAll("[data-post]").forEach((btn) => {
      btn.onclick = () => {
        const type = btn.dataset.post;
        const title = type === "reminder" ? slot.querySelector("#rem-title").value.trim()
          : type === "recap" ? slot.querySelector("#rec-title").value.trim() : "";
        const message = type === "reminder" ? slot.querySelector("#rem-msg").value.trim()
          : type === "recap" ? slot.querySelector("#rec-msg").value.trim()
          : slot.querySelector("#ann-msg").value.trim();
        if (!title && !message) { msg("⚠ Write something to post first."); return; }
        btn.disabled = true; msg("Posting…");
        guard(async () => {
          try {
            await discord.post({ type, title, message });
            toast("Posted to Discord");
            btn.disabled = false; msg("Posted ✓");
          } catch (e) { btn.disabled = false; msg("⚠ " + postError(e.message)); }
        });
      };
    });
  }
}
