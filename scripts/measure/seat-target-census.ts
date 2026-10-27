/** Replay recorded launch inputs, not outcomes: npx tsx scripts/measure/seat-target-census.ts <swarms-dir>.
 * Counts first numbered lists and the conservative subset explicitly headed THIS ROOM'S OWN RULES. A match is
 * routing risk, not proof the run used flat targeting or that its answer failed. Task texts are not copied out. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { briefSeeds } from "../../src/seat-targets.ts";

const root = process.argv[2];
if (!root) throw new Error("usage: seat-target-census.ts <swarms-dir>");
const rows: { run: string; source: string; task_sha256: string; numbered_items: number; explicit_rules_heading: boolean; first_label?: string }[] = [];
const errors: string[] = [];
for (const dir of readdirSync(root, { withFileTypes: true }).filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const source = resolve(root, dir.name, "result.json");
  if (!existsSync(source)) continue;
  try {
    const result = JSON.parse(readFileSync(source, "utf8"));
    const task: unknown = result.run?.task;
    if (typeof task !== "string" || !task) continue;
    const seeds = briefSeeds(task);
    const rules = /(?:^|\n)THIS ROOM'S OWN RULES[^\n]*\n(?:\s*\n)*\s*1[.)]\s+([^\n]*)/i.exec(task);
    const rulesLabel = rules ? briefSeeds(`1. ${rules[1]}\n2. sentinel`)[0] : undefined;
    rows.push({ run: result.run.id ?? dir.name, source, task_sha256: createHash("sha256").update(task).digest("hex"), numbered_items: seeds.length, explicit_rules_heading: !!rulesLabel && rulesLabel === seeds[0], ...(seeds.length ? { first_label: seeds[0] } : {}) });
  } catch (error) { errors.push(`${join(dir.name, "result.json")}: ${String(error)}`); }
}
console.log(JSON.stringify({ runs: rows.length, unique_task_texts: new Set(rows.map((r) => r.task_sha256)).size, numbered_runs: rows.filter((r) => r.numbered_items).length, explicit_rules_first: rows.filter((r) => r.explicit_rules_heading).length, errors, rows }, null, 2));
if (errors.length) process.exitCode = 1;
