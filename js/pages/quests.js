// Quests — a board of four columns. Players read; the DM adds
// quests, moves them between statuses, and appends journal
// entries as things unfold.
import { boot, esc, md, guard, fmtDate, toast } from "../shell.js";
import { quests } from "../db.js";

const STATUSES = [
  ["active", "🔥 Active", "gold"],
  ["rumor", "🕯️ Rumors & Leads", "mystic"],
  ["completed", "🏆 Completed", "moss"],
  ["failed", "💀 Failed", "ember"],
];

const ctx = await boot("quests.html", "Quests");
if (ctx) main();

async function main() {
  const root = document.getElementById("main");
  await render();

  async function render() {
    const [list, ups] = await Promise.all([quests.list(), quests.updates()]);
    const journal = {};
    ups.forEach((u) => (journal[u.quest_id] ??= []).push(u));

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; margin-bottom:14px">
        <h2 class="section" style="margin:0">Quest Board</h2>
        ${ctx.me.isDM ? '<button class="btn" id="new-q">+ New quest</button>' : ""}
      </div>
      <div id="new-slot"></div>
      <div class="board" id="board"></div>`;

    const board = root.querySelector("#board");
    for (const [key, label] of STATUSES) {
      const qs = list.filter((q) => q.status === key);
      const col = document.createElement("div");
      col.innerHTML = `<h3 class="col">${label} · ${qs.length}</h3>`;
      const stack = document.createElement("div");
      stack.className = "stack";
      if (!qs.length) stack.innerHTML = `<div class="empty small">Nothing here… yet.</div>`;
      qs.forEach((q) => stack.appendChild(questCard(q, journal[q.id] || [])));
      col.appendChild(stack);
      board.appendChild(col);
    }

    const nb = root.querySelector("#new-q");
    if (nb) nb.onclick = () => { root.querySelector("#new-slot").replaceChildren(questForm({})); nb.disabled = true; };
  }

  function questCard(q, ups) {
    const card = document.createElement("div");
    card.className = "card quest";
    const meta = [q.giver && `From ${q.giver}`, q.location, q.reward && q.reward !== "—" && `Reward: ${q.reward}`]
      .filter(Boolean).map(esc).join(" · ");
    card.innerHTML = `
      <p class="title">${esc(q.title)}</p>
      ${meta ? `<p class="meta">${meta}</p>` : ""}
      ${md(q.summary)}
      <details class="fold">
        <summary>Journal · ${ups.length} ${ups.length === 1 ? "entry" : "entries"}</summary>
        ${ups.length
          ? `<ul class="log">${ups.map((u) => `<li>${esc(u.body)}<span class="when">${fmtDate(u.created_at)}</span></li>`).join("")}</ul>`
          : `<p class="muted small">No entries yet.</p>`}
        ${ctx.me.isDM ? `
        <form class="row" style="margin-top:8px">
          <input type="text" class="grow" name="body" placeholder="Add a journal entry…" required />
          <button class="btn-ghost">Add</button>
        </form>` : ""}
      </details>
      ${ctx.me.isDM ? `
      <div class="row" style="margin-top:12px">
        <select class="q-status" style="width:auto">
          ${STATUSES.map(([k, l]) => `<option value="${k}" ${k === q.status ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="btn-ghost b-edit">Edit</button>
        <button class="btn-danger b-del">Delete</button>
      </div>` : ""}`;

    if (ctx.me.isDM) {
      const form = card.querySelector("details form");
      if (form) form.onsubmit = (e) => {
        e.preventDefault();
        const body = new FormData(e.target).get("body");
        guard(async () => { await quests.addUpdate(q.id, body); toast("Journal updated"); render(); });
      };
      card.querySelector(".q-status").onchange = (e) =>
        guard(async () => { await quests.update(q.id, { status: e.target.value }); render(); });
      card.querySelector(".b-edit").onclick = () => card.replaceWith(questForm(q));
      card.querySelector(".b-del").onclick = () => {
        if (!confirm(`Delete quest "${q.title}" and its journal?`)) return;
        guard(async () => { await quests.remove(q.id); render(); });
      };
    }
    return card;
  }

  function questForm(q) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <form>
        <label class="field">Quest title</label>
        <input type="text" name="title" required value="${esc(q.title || "")}" />
        <div class="row">
          <div class="grow"><label class="field">Quest giver</label><input type="text" name="giver" value="${esc(q.giver || "")}" /></div>
          <div class="grow"><label class="field">Location</label><input type="text" name="location" value="${esc(q.location || "")}" /></div>
          <div class="grow"><label class="field">Reward</label><input type="text" name="reward" value="${esc(q.reward || "")}" /></div>
        </div>
        <label class="field">Status</label>
        <select name="status" style="width:auto">
          ${STATUSES.map(([k, l]) => `<option value="${k}" ${k === (q.status || "active") ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <label class="field">Summary — what the party knows</label>
        <textarea name="summary">${esc(q.summary || "")}</textarea>
        <div class="actions">
          <button class="btn" type="submit">${q.id ? "Save quest" : "Post to the board"}</button>
          <button class="btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    card.querySelector("[data-cancel]").onclick = () => render();
    card.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const fields = { title: f.get("title"), giver: f.get("giver"), location: f.get("location"), reward: f.get("reward"), status: f.get("status"), summary: f.get("summary") };
      guard(async () => {
        if (q.id) await quests.update(q.id, fields);
        else await quests.add(fields);
        toast(q.id ? "Quest updated" : "Quest posted");
        render();
      });
    };
    return card;
  }
}
