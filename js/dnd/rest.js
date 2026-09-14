// Pure 5e rest mechanics, operating on a character sheet (model shape).
// These MUTATE the passed sheet and return it. `drv` is derive(sheet) — it
// supplies hp.max, hp.hitDie, hp.hitDiceCount and ability modifiers. Keeping
// the rules here lets the character sheet AND the battle map share one
// definition of what a rest does.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Current HP as a concrete number (the sheet stores null = "full").
export function currentHp(c, drv) {
  const max = drv?.hp?.max ?? 1;
  return c?.hp?.current == null ? max : clamp(c.hp.current, 0, max);
}

// Hit dice not yet spent since the last long rest.
export function hitDiceLeft(c, drv) {
  const total = drv?.hp?.hitDiceCount ?? 1;
  return Math.max(0, total - (c?.hp?.hitDiceUsed || 0));
}

// Long rest: full HP, temp cleared, all spell slots + pact slots back, and
// you regain up to half your total hit dice (minimum one).
export function longRest(c, drv) {
  const total = drv?.hp?.hitDiceCount ?? 1;
  const regain = Math.max(1, Math.floor(total / 2));
  c.hp = {
    ...c.hp,
    current: null,
    temp: 0,
    hitDiceUsed: Math.max(0, (c.hp?.hitDiceUsed || 0) - regain),
  };
  c.spells = { ...c.spells, slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0 };
  return c;
}

// Short rest: Warlock pact slots return and short-rest features refresh.
// (Hit points on a short rest come only from spending hit dice — do that
// with spendHitDie, one die at a time, as 5e intends.)
export function shortRest(c) {
  c.spells = { ...c.spells, pactUsed: 0 };
  return c;
}

// Spend one hit die to heal: roll the class hit die + CON modifier and add it
// to current HP (never above max). Returns the roll breakdown, or null if no
// hit dice remain.
export function spendHitDie(c, drv) {
  if (hitDiceLeft(c, drv) <= 0) return null;
  const die = drv?.hp?.hitDie || 8;
  const con = drv?.abilities?.con?.mod ?? 0;
  const roll = 1 + Math.floor(Math.random() * die);
  const healed = Math.max(0, roll + con);
  const max = drv?.hp?.max ?? 1;
  const next = clamp(currentHp(c, drv) + healed, 0, max);
  c.hp = { ...c.hp, current: next, hitDiceUsed: (c.hp?.hitDiceUsed || 0) + 1 };
  return { die, roll, con, healed, current: next, max, remaining: hitDiceLeft(c, drv) };
}
