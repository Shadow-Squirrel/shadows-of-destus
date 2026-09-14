// Rest mechanics (js/dnd/rest.js) — pure, so we test against a mock derive().
import { longRest, shortRest, spendHitDie, hitDiceLeft, currentHp } from "../js/dnd/rest.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails++; };

const drv = { hp: { max: 40, hitDie: 10, hitDiceCount: 5 }, abilities: { con: { mod: 2 } } };

// currentHp: null means full
ok(currentHp({ hp: { current: null } }, drv) === 40, "currentHp: null → max");
ok(currentHp({ hp: { current: 12 } }, drv) === 12, "currentHp: concrete value");
ok(currentHp({ hp: { current: 999 } }, drv) === 40, "currentHp: clamped to max");

// hit dice left
ok(hitDiceLeft({ hp: { hitDiceUsed: 4 } }, drv) === 1, "hitDiceLeft: 5 total − 4 used = 1");
ok(hitDiceLeft({ hp: { hitDiceUsed: 9 } }, drv) === 0, "hitDiceLeft: never negative");

// spend hit die: heals and decrements; returns null when empty
const c1 = { hp: { current: 10, temp: 0, hitDiceUsed: 4 }, spells: {} };
const r = spendHitDie(c1, drv);
ok(r && r.remaining === 0 && c1.hp.hitDiceUsed === 5, "spendHitDie: consumes the last die");
ok(r.healed >= 3 && r.healed <= 12, "spendHitDie: heals roll(1..10)+CON(2)");
ok(c1.hp.current > 10 && c1.hp.current <= 40, "spendHitDie: raises current HP, capped at max");
ok(spendHitDie(c1, drv) === null, "spendHitDie: null when no dice left");

// heal never exceeds max
const c2 = { hp: { current: 39, temp: 0, hitDiceUsed: 0 }, spells: {} };
spendHitDie(c2, drv);
ok(c2.hp.current === 40, "spendHitDie: cannot overheal past max");

// long rest: full HP, temp cleared, slots+pact back, regain half (min 1) hit dice
const c3 = { hp: { current: 5, temp: 7, hitDiceUsed: 5 }, spells: { slotsUsed: [1, 1, 1, 0, 0, 0, 0, 0, 0], pactUsed: 2 } };
longRest(c3, drv);
ok(c3.hp.current === null && c3.hp.temp === 0, "longRest: HP full, temp cleared");
ok(c3.hp.hitDiceUsed === 3, "longRest: regains floor(5/2)=2 hit dice (5→3)");
ok(c3.spells.pactUsed === 0 && c3.spells.slotsUsed.every((x) => x === 0), "longRest: all slots + pact restored");

// long rest regains at least one hit die even for a level 1 (total 1)
const c4 = { hp: { hitDiceUsed: 1 }, spells: {} };
longRest(c4, { hp: { max: 8, hitDie: 8, hitDiceCount: 1 }, abilities: { con: { mod: 0 } } });
ok(c4.hp.hitDiceUsed === 0, "longRest: minimum one hit die back");

// short rest: pact slots back, spell slots untouched
const c5 = { hp: {}, spells: { pactUsed: 2, slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0] } };
shortRest(c5);
ok(c5.spells.pactUsed === 0, "shortRest: pact slots restored");
ok(c5.spells.slotsUsed[0] === 1, "shortRest: normal spell slots untouched");

console.log(fails ? `\n${fails} FAILED` : "\nAll rest tests pass.");
process.exit(fails ? 1 : 0);
