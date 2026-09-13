#!/usr/bin/env node
// Parses every ES module in js/ for syntax errors without
// executing them (browser globals aren't available in node).
// Run: node --experimental-vm-modules tools/check-syntax.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".js") || f.endsWith(".mjs")) files.push(p);
  }
})(join(ROOT, "js"));
files.push(join(ROOT, "server.js"));

let bad = 0;
for (const p of files) {
  try {
    new vm.SourceTextModule(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`✗ ${p.replace(ROOT + "/", "")}: ${e.message}`);
    bad++;
  }
}
console.log(bad ? `${bad} file(s) with syntax errors` : `${files.length} modules parse clean`);
process.exit(bad ? 1 : 0);
