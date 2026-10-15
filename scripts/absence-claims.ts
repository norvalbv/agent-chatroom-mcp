#!/usr/bin/env node
/** Absence claims ("no", "none", "zero", "never"...) in each proposal version of the given room logs, and whether each
 * names where it looked. Usage: npx tsx scripts/absence-claims.ts data/<room>.jsonl [...] [--json] */
import { readFileSync } from "node:fs";
import { absenceClaims, parseRoomLog } from "../src/run-metrics.js";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: absence-claims <room.jsonl> [...] [--json]");
  process.exit(2);
}
const rows = absenceClaims(files.map((f) => parseRoomLog(readFileSync(f, "utf8"))));
if (argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  const unsourced = rows.filter((r) => !r.sourced);
  console.log(`${rows.length} absence claims across proposal versions, ${unsourced.length} naming no source checked.\n\n| proposal | v | sourced | claim |\n|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.id} | ${r.version} | ${r.sourced ? "yes" : "NO"} | ${r.claim.replace(/\|/g, "/").slice(0, 120)} |`);
}
