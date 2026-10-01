// ⚔️ Enter the Dungeon — the sign-in / create-account door.
//
// This page just calls boot(): signed OUT, boot() draws the login gate
// (sign in or create a free account) under the public nav. Signed IN, we
// send the person on: to ?next=<page>.html if they came for something
// specific (e.g. the pricing page's "sign in to upgrade"), else to their
// campaign home. A signed-in account with no campaign yet is sent to
// `next` when there is one; otherwise boot() has already shown them the
// "welcome, Adventurer" screen and we leave them there.
import { boot } from "../shell.js";
import { auth, isReal } from "../db.js";

// only ever follow a same-site page name — never an arbitrary URL
const next = new URLSearchParams(location.search).get("next") || "";
const safeNext = /^[a-z0-9-]+\.html$/i.test(next) ? `./${next}` : null;

const ctx = await boot("login.html", "Sign in");
if (ctx) {
  location.replace(safeNext || "./hub.html");
} else if (safeNext && isReal()) {
  // boot() returned null but the visitor may still be signed in (no
  // campaign yet) — honour the return address they came with.
  let s = null;
  try { s = await auth.session(); } catch { s = null; }
  if (s) location.replace(safeNext);
}
