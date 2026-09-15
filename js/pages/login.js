// ⚔️ Enter the Dungeon — the sign-in / create-account door.
//
// This page just calls boot(): signed OUT, boot() draws the login gate
// (sign in or create a free account) under the public nav; signed IN with a
// campaign, boot() hands back a ctx and we send the person on to their
// campaign home (or to ?next=<page>.html if they came for something
// specific, e.g. the pricing page's "sign in to upgrade"). Signed in with
// no campaign yet, boot() shows the "welcome, Adventurer" screen itself.
import { boot } from "../shell.js";

const ctx = await boot("login.html", "Sign in");
if (ctx) {
  // only ever follow a same-site page name — never an arbitrary URL
  const next = new URLSearchParams(location.search).get("next") || "";
  const safe = /^[a-z0-9-]+\.html$/i.test(next) ? `./${next}` : "./hub.html";
  location.replace(safe);
}
