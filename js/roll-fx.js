// ─────────────────────────────────────────────────────────────
//  roll-fx.js — the dice show, shared by every page that rolls.
//  Renders die faces (SVG), formats roll specs, and runs the
//  center-stage overlay where dice tumble and land. The Dice
//  page and the character sheets both plug into this, so a roll
//  looks identical wherever it was made.
// ─────────────────────────────────────────────────────────────
import { esc } from "./shell.js";

// One flat-ish polygon per die type (viewBox 0 0 100 100).
const SHAPES = {
  4: "50,8 95,88 5,88",
  6: "14,14 86,14 86,86 14,86",
  8: "50,4 96,50 50,96 4,50",
  10: "50,4 90,34 76,94 24,94 10,34",
  12: "50,4 93,37 77,92 23,92 7,37",
  20: "50,3 91,26 91,74 50,97 9,74 9,26",
  100: "50,3 83,15 97,50 83,85 50,97 17,85 3,50 17,15",
};

export function dieSvg(sides, value, cls = "") {
  return `<svg class="die ${cls}" viewBox="0 0 100 100" role="img" aria-label="d${sides}">
    <polygon points="${SHAPES[sides] || SHAPES[6]}" />
    <text x="50" y="${sides === 4 ? 66 : 56}">${esc(value)}</text>
  </svg>`;
}

export function specText(spec, modifier) {
  let out = spec.map((s) => `${s.count}d${s.sides}`).join(" + ");
  if (modifier > 0) out += ` + ${modifier}`;
  if (modifier < 0) out += ` − ${Math.abs(modifier)}`;
  return out;
}

// Flattens a roll row's dice into one entry per die, marking any
// die dropped by advantage/disadvantage ("keep":"high"/"low").
export function flattenDice(row) {
  const flat = [];
  (row.dice || []).forEach((d) => {
    let dropIdx = -1;
    if (d.keep && d.results.length === 2) {
      const [a, b] = d.results;
      dropIdx = d.keep === "high" ? (a >= b ? 1 : 0) : (a <= b ? 1 : 0);
    }
    d.results.forEach((r, i) => flat.push({ sides: d.sides, result: r, dropped: i === dropIdx }));
  });
  return flat;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The center-stage overlay. nameOf(email) → display name.
export function createRollStage(nameOf) {
  let stage = document.getElementById("roll-stage");
  if (!stage) {
    stage = document.createElement("div");
    stage.id = "roll-stage";
    document.body.appendChild(stage);
  }
  const queue = [];
  let staging = false;

  async function nextShow() {
    const row = queue.shift();
    if (!row) { staging = false; return; }
    staging = true;
    const flat = flattenDice(row);
    const shownDice = flat.slice(0, 12);
    stage.innerHTML = `
      <div class="who">${esc(nameOf(row.roller_email))} rolls${row.label ? ` <em>${esc(row.label)}</em>` : ""}…</div>
      <div class="dice-row">${shownDice.map((d) => dieSvg(d.sides, "?", "tumbling")).join("")}</div>
      <div class="sum"></div>`;
    stage.classList.add("show");
    stage.classList.remove("done");
    const dieEls = [...stage.querySelectorAll(".die")];
    const flicker = setInterval(() => {
      dieEls.forEach((el, i) => {
        if (el.classList.contains("tumbling"))
          el.querySelector("text").textContent = 1 + Math.floor(Math.random() * shownDice[i].sides);
      });
    }, 75);
    await sleep(850);
    dieEls.forEach((el, i) => setTimeout(() => {
      const d = shownDice[i];
      el.classList.remove("tumbling");
      el.querySelector("text").textContent = d.result;
      if (d.sides === 20 && d.result === 20 && !d.dropped) el.classList.add("crit");
      if (d.sides === 20 && d.result === 1 && !d.dropped) el.classList.add("fumble");
      if (d.dropped) el.classList.add("dropped");
      el.classList.add("landed");
    }, i * 90));
    await sleep(shownDice.length * 90 + 250);
    clearInterval(flicker);
    const extra = flat.length - shownDice.length;
    stage.querySelector(".sum").textContent =
      `${specText(row.dice || [], row.modifier)}${extra > 0 ? ` (+${extra} more)` : ""}  =  ${row.total}`;
    stage.classList.add("done");
    await sleep(2000);
    stage.classList.remove("show");
    await sleep(300);
    nextShow();
  }

  return {
    show(row) {
      queue.push(row);
      if (!staging) nextShow();
    },
  };
}
